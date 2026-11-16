import clsx from 'clsx'
import { useApp } from '@renderer/store/app'
import { formatKeys } from '@renderer/lib/shortcuts'

const DISPLAY: Record<string, string> = { Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }

export interface KbdProps {
  /** Key combo, e.g. "Ctrl+Enter". Rendered as separate key caps. */
  hotkey: string
  /** Render even when hotkey hints are turned off. */
  force?: boolean
  /** Use on accent-filled backgrounds. */
  tone?: 'default' | 'onAccent'
  className?: string
}

/** Small key-cap badge. Renders null when hotkey hints are off (unless `force`). */
export function Kbd({ hotkey, force, tone = 'default', className }: KbdProps): React.JSX.Element | null {
  const show = useApp((s) => s.prefs.showHotkeyHints)
  if (!show && !force) return null
  const keys = formatKeys(hotkey)
  if (keys.length === 0) return null
  return (
    <span className={clsx('inline-flex items-center gap-0.5 align-middle', className)} aria-hidden="true">
      {keys.map((k, i) => (
        <kbd
          key={i}
          className={clsx(
            'inline-flex h-[1.4rem] min-w-[1.4rem] items-center justify-center rounded-md px-1.5 whitespace-nowrap font-mono text-[0.62rem] font-semibold leading-none',
            tone === 'onAccent'
              ? 'bg-black/20 text-accent-contrast'
              : 'border border-shadow-dark/70 border-b-2 bg-bg text-muted'
          )}
        >
          {DISPLAY[k] ?? k}
        </kbd>
      ))}
    </span>
  )
}
