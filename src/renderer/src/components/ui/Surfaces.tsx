import { forwardRef } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'

export type PanelProps = HTMLAttributes<HTMLDivElement>

/** Raised neumorphic surface container. */
export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel({ className, ...rest }, ref) {
  return <div ref={ref} className={clsx('neu-raised rounded-[20px] p-5', className)} {...rest} />
})

/** Inset well (for inputs, content areas, grouped controls). */
export const Well = forwardRef<HTMLDivElement, PanelProps>(function Well({ className, ...rest }, ref) {
  return <div ref={ref} className={clsx('neu-inset rounded-[16px] p-4', className)} {...rest} />
})

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  text?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, text, action, className }: EmptyStateProps): React.JSX.Element {
  return (
    <div className={clsx('flex flex-col items-center justify-center gap-3 px-6 py-16 text-center', className)}>
      {icon && (
        <div className="neu-raised mb-2 flex h-20 w-20 items-center justify-center rounded-full text-accent">{icon}</div>
      )}
      <h2 className="text-xl font-semibold text-text">{title}</h2>
      {text && <p className="max-w-md text-sm text-muted">{text}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
