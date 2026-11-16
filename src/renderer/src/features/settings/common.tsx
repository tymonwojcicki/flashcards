import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Info } from 'lucide-react'
import { Input, Tooltip } from '@renderer/components/ui'

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
  className,
  fill
}: {
  value: T
  onChange: (v: T) => void
  options: SegmentedOption<T>[]
  label: string
  className?: string
  /** Stretch to the container width with equal-width options. */
  fill?: boolean
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={clsx('neu-inset gap-1 rounded-2xl p-1', fill ? 'flex w-full' : 'inline-flex', className)}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={clsx(
              'inline-flex h-8 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition-all duration-150',
              fill && 'flex-1',
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

/** Small (i) button that shows an explanation on hover or keyboard focus. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <Tooltip content={<span className="block max-w-80 text-xs leading-relaxed font-normal text-text">{children}</span>}>
      <button
        type="button"
        aria-label={`About ${label}`}
        data-sound="none"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-text focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
      >
        <Info size={14} />
      </button>
    </Tooltip>
  )
}

/**
 * A settings row: title (+ optional short `desc` line, or longer `info` behind an (i) tip) on the
 * left, control on the right in a fixed-width, right-aligned column.
 */
export function SettingRow({
  title,
  desc,
  info,
  children,
  stacked,
  id
}: {
  title: string
  desc?: ReactNode
  info?: ReactNode
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
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          {title}
          {info && <InfoTip label={title}>{info}</InfoTip>}
        </div>
        {desc && <p className="mt-0.5 text-xs text-muted">{desc}</p>}
      </div>
      <div className={clsx('shrink-0', !stacked && 'flex sm:min-w-64 sm:justify-end')}>{children}</div>
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
  /** Unit shown inside the field, e.g. "days". */
  suffix?: string
  'aria-label': string
}): React.JSX.Element {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const n = Number(text)
  const invalid = text.trim() === '' || !Number.isInteger(n) || n < min || n > max
  return (
    <div className="relative w-36">
      <Input
        type="number"
        inputMode="numeric"
        aria-label={ariaLabel}
        aria-invalid={invalid}
        className={clsx('w-full [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none', suffix && 'pr-16', invalid && 'border-danger')}
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
      {suffix && (
        <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-xs text-muted">{suffix}</span>
      )}
    </div>
  )
}
