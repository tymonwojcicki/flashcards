import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Input } from '@renderer/components/ui'
import { playSound } from '@renderer/lib/sound'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
}

/** Neumorphic segmented control (radio group semantics). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className
}: {
  value: T
  onChange: (v: T) => void
  options: SegmentedOption<T>[]
  label: string
  className?: string
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} className={clsx('neu-inset inline-flex gap-1 rounded-2xl p-1', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              if (!active) playSound('select')
              onChange(o.value)
            }}
            className={clsx(
              'inline-flex h-8 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition-all duration-150',
              active ? 'neu-raised-sm text-accent' : 'text-muted hover:text-text'
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** A settings row: title + explanation on the left, control on the right. */
export function SettingRow({
  title,
  desc,
  children,
  stacked,
  id
}: {
  title: string
  desc?: ReactNode
  children: ReactNode
  stacked?: boolean
  id?: string
}): React.JSX.Element {
  return (
    <div
      id={id}
      className={clsx('flex gap-4 py-4', stacked ? 'flex-col' : 'flex-col sm:flex-row sm:items-center sm:justify-between')}
    >
      <div className="min-w-0 sm:max-w-md">
        <div className="text-sm font-semibold">{title}</div>
        {desc && <p className="mt-0.5 text-xs text-muted">{desc}</p>}
      </div>
      <div className={clsx('shrink-0', !stacked && 'sm:w-72')}>{children}</div>
    </div>
  )
}

/** Integer input that only commits valid values within [min, max]. */
export function NumberField({
  value,
  onCommit,
  min,
  max,
  suffix,
  'aria-label': ariaLabel
}: {
  value: number
  onCommit: (n: number) => void
  min: number
  max: number
  suffix?: string
  'aria-label': string
}): React.JSX.Element {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const n = Number(text)
  const invalid = text.trim() === '' || !Number.isInteger(n) || n < min || n > max
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        inputMode="numeric"
        aria-label={ariaLabel}
        aria-invalid={invalid}
        className={clsx('w-32', invalid && 'border-danger')}
        value={text}
        min={min}
        max={max}
        onChange={(e) => {
          setText(e.target.value)
          const v = Number(e.target.value)
          if (e.target.value.trim() !== '' && Number.isInteger(v) && v >= min && v <= max) onCommit(v)
        }}
        onBlur={() => invalid && setText(String(value))}
      />
      {suffix && <span className="text-xs text-muted">{suffix}</span>}
    </div>
  )
}
