import { effectiveKeys, formatKeys } from '@renderer/lib/shortcuts'
import type { ShortcutId } from '@renderer/lib/shortcuts'

/** Does the keyboard event match the (user-overridable) shortcut `id`? */
export function eventMatches(e: KeyboardEvent, id: ShortcutId): boolean {
  let ctrl = false
  let shift = false
  let alt = false
  let key = ''
  for (const raw of formatKeys(effectiveKeys(id))) {
    const p = raw.toLowerCase()
    if (p === 'ctrl' || p === 'cmd' || p === 'meta') ctrl = true
    else if (p === 'shift') shift = true
    else if (p === 'alt') alt = true
    else key = p === 'space' ? ' ' : p === 'esc' ? 'escape' : p
  }
  if (!key || e.key.toLowerCase() !== key) return false
  return (e.ctrlKey || e.metaKey) === ctrl && e.altKey === alt && e.shiftKey === shift
}
