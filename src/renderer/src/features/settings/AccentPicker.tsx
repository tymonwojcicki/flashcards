import { useRef } from 'react'
import clsx from 'clsx'
import { Check } from 'lucide-react'
import type { Accent } from '@shared/types'

const ACCENTS: { value: Accent; label: string; grad: string; glow: string }[] = [
  { value: 'ember', label: 'Ember', grad: 'linear-gradient(135deg,#fbbf24,#f97316 55%,#ea4a1f)', glow: 'rgb(249 100 30 / 0.55)' },
  { value: 'aqua', label: 'Aqua', grad: 'linear-gradient(135deg,#14b8a6,#22c5a0 55%,#4ade80)', glow: 'rgb(30 190 160 / 0.5)' },
  { value: 'iris', label: 'Iris', grad: 'linear-gradient(135deg,#4f46e5,#7c4af0 55%,#a78bfa)', glow: 'rgb(120 90 245 / 0.5)' },
  { value: 'rose', label: 'Rose', grad: 'linear-gradient(135deg,#fb7185,#f43f5e 55%,#e1306c)', glow: 'rgb(244 63 94 / 0.5)' }
]

/** Radio group of round gradient swatches. Arrow keys move the selection. */
export function AccentPicker({ value, onChange }: { value: Accent; onChange: (a: Accent) => void }): React.JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: React.KeyboardEvent, i: number): void => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const n = (i + d + ACCENTS.length) % ACCENTS.length
    onChange(ACCENTS[n].value)
    refs.current[n]?.focus()
  }
  return (
    <div role="radiogroup" aria-label="Accent colour" className="neu-inset inline-flex gap-4 rounded-2xl px-4 py-2.5">
      {ACCENTS.map((a, i) => {
        const on = a.value === value
        return (
          <button
            key={a.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={a.label}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(a.value)}
            onKeyDown={(e) => onKey(e, i)}
            className="group flex flex-col items-center gap-1.5 rounded-xl text-xs font-semibold"
          >
            <span
              className={clsx(
                'flex h-9 w-9 items-center justify-center rounded-full text-white transition-all duration-150',
                on ? 'ring-2 ring-offset-2 ring-offset-[var(--well)] scale-105' : 'opacity-85 group-hover:opacity-100 group-hover:scale-105'
              )}
              style={{
                background: a.grad,
                boxShadow: `${on ? `0 4px 16px ${a.glow}, ` : ''}inset 1px 1px 0 rgb(255 255 255 / 0.45), inset 0 -2px 4px rgb(0 0 0 / 0.15)`,
                ['--tw-ring-color' as string]: 'var(--text-muted)'
              }}
            >
              {on && <Check size={17} strokeWidth={3} style={{ filter: 'drop-shadow(0 1px 1px rgb(0 0 0 / 0.5))' }} />}
            </span>
            <span className={on ? 'text-text' : 'text-muted'}>{a.label}</span>
          </button>
        )
      })}
    </div>
  )
}
