import { forwardRef, useId } from 'react'
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import clsx from 'clsx'
import * as RSelect from '@radix-ui/react-select'
import * as RSwitch from '@radix-ui/react-switch'
import * as RSlider from '@radix-ui/react-slider'
import { Check, ChevronDown } from 'lucide-react'
import { playSound } from '@renderer/lib/sound'

const FIELD_BASE =
  'neu-inset w-full rounded-2xl border border-transparent bg-bg px-4 text-sm text-text placeholder:text-muted/80 transition-shadow duration-150 focus-visible:border-accent disabled:opacity-50'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref
) {
  return <input ref={ref} className={clsx(FIELD_BASE, 'h-10', className)} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 4, ...rest },
  ref
) {
  return <textarea ref={ref} rows={rows} className={clsx(FIELD_BASE, 'resize-y py-2.5', className)} {...rest} />
})

export interface FieldProps {
  label: string
  hint?: ReactNode
  /** Control; receives nothing automatically - pass `htmlFor` ids yourself or wrap a single control. */
  children: ReactNode
  htmlFor?: string
  className?: string
}

/** Label + hint + control. Pass `htmlFor` matching the control's id for label association. */
export function Field({ label, hint, children, htmlFor, className }: FieldProps): React.JSX.Element {
  return (
    <div className={clsx('flex flex-col gap-2', className)}>
      <label htmlFor={htmlFor} className="text-sm font-semibold text-text">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  )
}

export interface SelectOption {
  value: string
  label: ReactNode
}

export interface SelectProps {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  id?: string
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

export function Select({ value, onValueChange, options, placeholder, id, disabled, className, ...rest }: SelectProps): React.JSX.Element {
  return (
    <RSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RSelect.Trigger
        id={id}
        aria-label={rest['aria-label']}
        className={clsx(
          FIELD_BASE,
          'inline-flex h-10 items-center justify-between gap-2 text-left data-[placeholder]:text-muted',
          className
        )}
      >
        <RSelect.Value placeholder={placeholder} />
        <RSelect.Icon>
          <ChevronDown size={16} className="text-muted" />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={8}
          className="anim-menu neu-raised z-[80] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-2xl p-1.5"
        >
          <RSelect.Viewport>
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-pointer items-center rounded-xl py-2 pr-8 pl-3 text-sm text-text outline-none select-none data-[highlighted]:bg-accent/12 data-[highlighted]:text-accent"
              >
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                <RSelect.ItemIndicator className="absolute right-2.5">
                  <Check size={14} />
                </RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  )
}

export interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  id?: string
  disabled?: boolean
  'aria-label'?: string
  className?: string
}

export function Switch({ checked, onCheckedChange, id, disabled, className, ...rest }: SwitchProps): React.JSX.Element {
  return (
    <RSwitch.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={rest['aria-label']}
      className={clsx(
        'group neu-inset neu-switch relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150 disabled:opacity-50',
        'data-[state=checked]:bg-accent/25',
        className
      )}
    >
      <RSwitch.Thumb className="neu-raised-sm neu-switch-thumb block h-[1.15rem] w-[1.15rem] translate-x-[3px] rounded-full transition-all duration-200 ease-[var(--ease-out)] will-change-transform data-[state=checked]:translate-x-[1.35rem] data-[state=checked]:neu-accent group-active:w-[1.288rem] group-active:data-[state=checked]:translate-x-[1.212rem]" />
    </RSwitch.Root>
  )
}

export interface SliderProps {
  value: number
  onValueChange: (value: number) => void
  min: number
  max: number
  step?: number
  disabled?: boolean
  'aria-label'?: string
  className?: string
  /** false = no detent ticks (e.g. the volume slider, which plays its own preview). */
  sound?: boolean
  /** Called when the user releases the thumb (or after a keyboard step). */
  onValueCommit?: (value: number) => void
}

let lastTick = 0

export function Slider({
  value,
  onValueChange,
  onValueCommit,
  min,
  max,
  step = 1,
  disabled,
  className,
  sound = true,
  ...rest
}: SliderProps): React.JSX.Element {
  return (
    <RSlider.Root
      value={[value]}
      onValueCommit={onValueCommit ? (v) => onValueCommit(v[0] ?? min) : undefined}
      onValueChange={(v) => {
        const next = v[0] ?? min
        if (sound && next !== value) {
          const now = Date.now()
          if (now - lastTick > 45) {
            lastTick = now
            playSound('tick')
          }
        }
        onValueChange(next)
      }}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={clsx('relative flex h-6 w-full touch-none items-center select-none', className)}
    >
      <RSlider.Track className="neu-inset relative h-2.5 grow rounded-full">
        <RSlider.Range className="accent-fill absolute h-full rounded-full bg-accent/60 shadow-[0_0_10px_var(--accent-glow)]" />
      </RSlider.Track>
      <RSlider.Thumb
        aria-label={rest['aria-label']}
        className="neu-raised-sm block h-5 w-5 rounded-full transition-transform duration-150 hover:scale-110 active:scale-95"
      />
    </RSlider.Root>
  )
}

/** Generates a stable id for pairing Field + control. */
export function useFieldId(): string {
  return useId()
}
