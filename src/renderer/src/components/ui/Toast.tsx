import { create } from 'zustand'
import clsx from 'clsx'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { playSound, type SoundName } from '@renderer/lib/sound'

export interface ToastOptions {
  kind?: 'info' | 'success' | 'error'
  action?: { label: string; onClick: () => void }
  /** Toasts sharing a key replace each other instead of stacking. */
  key?: string
  /** Sound to play instead of the default for this kind; false = silent. */
  sound?: SoundName | false
}

interface ToastItem extends ToastOptions {
  id: number
  message: string
  closing?: boolean
}

const useToasts = create<{ items: ToastItem[] }>(() => ({ items: [] }))
let nextId = 1

/** Plays the exit animation (160ms), then removes the toast. */
function dismiss(id: number): void {
  clearTimeout(timers.get(id))
  timers.delete(id)
  useToasts.setState((s) => ({ items: s.items.map((t) => (t.id === id ? { ...t, closing: true } : t)) }))
  setTimeout(() => useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) })), 160)
}

const timers = new Map<number, ReturnType<typeof setTimeout>>()

/**
 * Show a transient message (auto-dismisses after 4s). A toast with the same `key` as one already
 * on screen replaces it in place instead of stacking (e.g. "Hotkey hints on" → "off").
 */
export function toast(message: string, opts: ToastOptions = {}): void {
  if (opts.sound) playSound(opts.sound)
  else if (opts.sound === false) {
    /* silent */
  } else if (opts.kind === 'success') playSound('success')
  else if (opts.kind === 'error') playSound('error')
  const existing = opts.key ? useToasts.getState().items.find((t) => t.key === opts.key && !t.closing) : undefined
  if (existing) {
    clearTimeout(timers.get(existing.id))
    useToasts.setState((s) => ({ items: s.items.map((t) => (t.id === existing.id ? { ...t, ...opts, message } : t)) }))
    timers.set(existing.id, setTimeout(() => dismiss(existing.id), 4000))
    return
  }
  const id = nextId++
  useToasts.setState((s) => ({ items: [...s.items.slice(-3), { id, message, ...opts }] }))
  timers.set(id, setTimeout(() => dismiss(id), 4000))
}

const ICONS = { info: Info, success: CheckCircle2, error: AlertCircle }
const TONE = { info: 'text-accent', success: 'text-success', error: 'text-danger' }

/** Mount once (bottom-right). */
export function Toaster(): React.JSX.Element {
  const items = useToasts((s) => s.items)
  return (
    <div
      className="pointer-events-none fixed right-5 bottom-5 z-[100] flex w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col gap-3"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => {
        const kind = t.kind ?? 'info'
        const Icon = ICONS[kind]
        return (
          <div
            key={t.id}
            data-closing={t.closing ? 'true' : undefined}
            className="anim-slide-up anim-toast neu-raised pointer-events-auto flex items-center gap-3 rounded-2xl py-3 pr-2 pl-4 text-sm"
          >
            <Icon size={18} className={clsx('shrink-0', TONE[kind], kind === 'success' && 'anim-pulse')} aria-hidden />
            <span className="min-w-0 flex-1 text-text">{t.message}</span>
            {t.action && (
              <button
                className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-accent transition-colors duration-150 hover:bg-accent/10"
                onClick={() => {
                  t.action?.onClick()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              aria-label="Dismiss"
              className="shrink-0 rounded-lg p-1.5 text-muted transition-colors duration-150 hover:text-text"
              onClick={() => dismiss(t.id)}
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
