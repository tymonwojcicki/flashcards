import { create } from 'zustand'
import clsx from 'clsx'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'

export interface ToastOptions {
  kind?: 'info' | 'success' | 'error'
  action?: { label: string; onClick: () => void }
}

interface ToastItem extends ToastOptions {
  id: number
  message: string
}

const useToasts = create<{ items: ToastItem[] }>(() => ({ items: [] }))
let nextId = 1

function dismiss(id: number): void {
  useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) }))
}

/** Show a transient message (auto-dismisses after 4s). */
export function toast(message: string, opts: ToastOptions = {}): void {
  const id = nextId++
  useToasts.setState((s) => ({ items: [...s.items.slice(-3), { id, message, ...opts }] }))
  setTimeout(() => dismiss(id), 4000)
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
            className="anim-slide-up neu-raised pointer-events-auto flex items-center gap-3 rounded-2xl py-3 pr-2 pl-4 text-sm"
          >
            <Icon size={18} className={clsx('shrink-0', TONE[kind])} aria-hidden />
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
