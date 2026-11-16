import type { ReactNode, RefObject } from 'react'
import clsx from 'clsx'
import * as RDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** false = cannot be dismissed with Esc / outside click / close button. */
  dismissible?: boolean
  /** Element to focus when opened (default: first focusable). */
  initialFocus?: RefObject<HTMLElement | null>
  className?: string
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  dismissible = true,
  initialFocus,
  className
}: DialogProps): React.JSX.Element {
  return (
    <RDialog.Root open={open} onOpenChange={(o) => (dismissible || o) && onOpenChange(o)}>
      <RDialog.Portal>
        <RDialog.Overlay className="anim-fade-in fixed inset-0 z-50 bg-bg/60 backdrop-blur-sm" />
        <RDialog.Content
          onEscapeKeyDown={(e) => !dismissible && e.preventDefault()}
          onPointerDownOutside={(e) => !dismissible && e.preventDefault()}
          onInteractOutside={(e) => !dismissible && e.preventDefault()}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            if (initialFocus?.current) {
              initialFocus.current.focus()
              return
            }
            // Focus the first text field if any; otherwise the panel itself (no ring on the close button).
            const panel = e.currentTarget as HTMLElement
            const field = panel.querySelector<HTMLElement>(
              'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), [contenteditable="true"]'
            )
            ;(field ?? panel).focus()
          }}
          tabIndex={-1}
          className={clsx(
            'anim-pop-in neu-raised outline-none focus:outline-none focus-visible:outline-none fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 flex max-h-[85vh] w-[min(32rem,calc(100vw-2rem))] flex-col rounded-[24px] p-6',
            className
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <RDialog.Title className="text-lg font-semibold text-text">{title}</RDialog.Title>
            {dismissible && (
              <RDialog.Close
                aria-label="Close"
                className="-mt-1 -mr-2 rounded-full p-2 text-muted transition-colors duration-150 hover:text-text"
              >
                <X size={18} />
              </RDialog.Close>
            )}
          </div>
          {description ? (
            <RDialog.Description className="mt-1.5 text-sm text-muted">{description}</RDialog.Description>
          ) : (
            <RDialog.Description className="sr-only">{title}</RDialog.Description>
          )}
          {children && <div className="mt-5 min-h-0 flex-1 overflow-y-auto p-1 -m-1">{children}</div>}
          {footer && <div className="mt-6 flex flex-wrap items-center justify-end gap-3">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}
