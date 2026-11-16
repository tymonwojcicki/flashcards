import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import { Kbd } from './Kbd'
import { Tooltip } from './Tooltip'

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  /** Key combo shown as a Kbd hint when hotkey hints are enabled, e.g. "Ctrl+Enter". */
  hotkey?: string
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'neu-raised-sm btn-shine active:neu-pressed',
  accent:
    'bg-accent text-accent-contrast neu-accent btn-fill active:brightness-95 active:neu-accent-pressed',
  secondary: 'neu-raised-sm btn-shine active:neu-pressed',
  ghost: 'btn-ghost btn-shine active:neu-pressed',
  danger: 'neu-raised-sm text-danger hover:bg-danger/10 active:neu-pressed'
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-2 rounded-xl px-4 text-[0.8125rem]',
  md: 'h-10 gap-2.5 rounded-2xl px-5 text-sm',
  lg: 'h-12 gap-3 rounded-2xl px-7 text-base'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, hotkey, className, children, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center font-bold whitespace-nowrap transition-all duration-150 select-none active:scale-[0.97]',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...rest}
    >
      {icon}
      {variant === 'primary' || variant === 'secondary' || variant === 'ghost' ? <span className="btn-label">{children}</span> : children}
      {hotkey && <Kbd hotkey={hotkey} tone={variant === 'accent' ? 'onAccent' : 'default'} className="ml-1.5" />}
    </button>
  )
})

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Required: used as aria-label and tooltip. */
  label: string
  icon: ReactNode
  hotkey?: string
  size?: ButtonSize
  variant?: 'raised' | 'ghost'
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}

const ICON_SIZES: Record<ButtonSize, string> = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-12 w-12' }

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, hotkey, size = 'md', variant = 'raised', tooltipSide, className, type = 'button', ...rest },
  ref
) {
  return (
    <Tooltip content={label} hotkey={hotkey} side={tooltipSide}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        className={clsx(
          'inline-flex shrink-0 items-center justify-center rounded-full text-text transition-all duration-150 select-none active:scale-[0.97]',
          'disabled:pointer-events-none disabled:opacity-50',
          variant === 'raised'
            ? 'neu-raised-sm btn-neutral active:neu-pressed'
            : 'btn-ghost active:neu-pressed',
          ICON_SIZES[size],
          className
        )}
        {...rest}
      >
        {icon}
      </button>
    </Tooltip>
  )
})
