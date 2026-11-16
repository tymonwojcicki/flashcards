import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Pencil, RotateCcw } from 'lucide-react'
import { Button, IconButton, Kbd } from '@renderer/components/ui'
import { useApp } from '@renderer/store/app'
import { SCOPE_LABELS, SHORTCUTS, effectiveKeysFor } from '@renderer/lib/shortcuts'
import type { ShortcutId, ShortcutScope } from '@renderer/lib/shortcuts'

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'])

/** Build a combo string like "Ctrl+Shift+I" from a keydown event; null for bare modifier presses. */
function comboFromEvent(e: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  let key = e.key === ' ' ? 'Space' : e.key
  const isSymbol = key.length === 1 && !/[a-z0-9]/i.test(key)
  if (key.length === 1) key = key.toUpperCase()
  if (e.shiftKey && !isSymbol) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

const IDS = Object.keys(SHORTCUTS) as ShortcutId[]
const SCOPES = Array.from(new Set(IDS.map((id) => SHORTCUTS[id].scope))) as ShortcutScope[]

export function ShortcutsEditor(): React.JSX.Element {
  const overrides = useApp((s) => s.prefs.shortcutOverrides)
  const setPrefs = useApp((s) => s.setPrefs)
  const [recording, setRecording] = useState<ShortcutId | null>(null)

  const save = (next: Record<string, string>): void => void setPrefs({ shortcutOverrides: next })

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Escape') {
        setRecording(null)
        return
      }
      const combo = comboFromEvent(e)
      if (!combo) return
      const next = { ...useApp.getState().prefs.shortcutOverrides }
      if (combo.toLowerCase() === SHORTCUTS[recording].keys.toLowerCase()) delete next[recording]
      else next[recording] = combo
      save(next)
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording])

  const conflicts = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const id of IDS) {
      const keys = effectiveKeysFor(id, overrides).toLowerCase()
      const sc = SHORTCUTS[id].scope
      out[id] = IDS.filter((o) => {
        if (o === id) return false
        const os = SHORTCUTS[o].scope
        if (!(os === sc || os === 'global' || sc === 'global')) return false
        return effectiveKeysFor(o, overrides).toLowerCase() === keys
      }).map((o) => SHORTCUTS[o].label)
    }
    return out
  }, [overrides])

  const hasOverrides = Object.keys(overrides).length > 0

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          Click a shortcut, then press the new key combination. Esc cancels.
        </p>
        <Button size="sm" icon={<RotateCcw size={14} />} disabled={!hasOverrides} onClick={() => save({})}>
          Reset all
        </Button>
      </div>
      {SCOPES.map((scope) => (
        <section key={scope}>
          <h4 className="mb-1 text-xs font-bold tracking-wide text-muted uppercase">{SCOPE_LABELS[scope]}</h4>
          <ul className="divide-y divide-muted/15">
            {IDS.filter((id) => SHORTCUTS[id].scope === scope).map((id) => {
              const keys = effectiveKeysFor(id, overrides)
              const isRec = recording === id
              const changed = !!overrides[id]
              return (
                <li key={id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 text-sm">{SHORTCUTS[id].label}</span>
                  {conflicts[id] && conflicts[id].length > 0 && (
                    <span className="flex items-center gap-1 text-xs text-warning" title="Both shortcuts may trigger at once">
                      <AlertTriangle size={13} /> Also used by {conflicts[id].join(', ')}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setRecording(isRec ? null : id)}
                    aria-label={isRec ? 'Listening for keys. Press Esc to cancel.' : `Change shortcut for ${SHORTCUTS[id].label}`}
                    aria-pressed={isRec}
                    title={isRec ? 'Press the new key combination. Esc cancels.' : 'Click to change'}
                    className={clsx(
                      'group/key relative flex h-9 items-center rounded-xl px-2 transition-all duration-150',
                      isRec
                        ? 'neu-inset ring-2 ring-accent/45'
                        : 'hover:bg-text/[0.04] hover:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--text)_10%,transparent)] focus-visible:bg-text/[0.04]'
                    )}
                  >
                    {isRec ? (
                      <span className="flex items-center gap-1 font-mono text-xs text-accent">
                        Press keys
                        <span className="inline-block h-3.5 w-px animate-pulse bg-accent" aria-hidden />
                      </span>
                    ) : (
                      <>
                        <Pencil
                          size={12}
                          aria-hidden
                          className="pointer-events-none absolute top-1/2 right-full mr-1 -translate-y-1/2 text-muted opacity-0 transition-opacity duration-150 group-hover/key:opacity-70 group-focus-visible/key:opacity-70"
                        />
                        <Kbd hotkey={keys} force />
                      </>
                    )}
                    {changed && !isRec && (
                      <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-accent" title="Changed from default" aria-hidden />
                    )}
                  </button>
                  <span className="flex w-8 justify-center">
                    {changed && (
                      <IconButton
                        size="sm"
                        variant="ghost"
                        label={`Reset ${SHORTCUTS[id].label} to default`}
                        icon={<RotateCcw size={14} />}
                        onClick={() => {
                          const next = { ...overrides }
                          delete next[id]
                          save(next)
                        }}
                      />
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
