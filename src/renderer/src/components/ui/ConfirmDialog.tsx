import { useRef } from 'react'
import type { ReactNode } from 'react'
import { create } from 'zustand'
import { Button } from './Button'
import { Dialog } from './Dialog'

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Controlled confirm dialog. Cancel is focused first for danger actions. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger,
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onCancel()}
      title={title}
      description={message}
      initialFocus={danger ? cancelRef : confirmRef}
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button ref={confirmRef} variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  )
}

interface Pending extends ConfirmOptions {
  resolve: (v: boolean) => void
}
const useConfirmStore = create<{ pending: Pending | null }>(() => ({ pending: null }))

/** Imperative confirm. Requires <DialogHost /> mounted once. */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().pending?.resolve(false)
    useConfirmStore.setState({ pending: { ...opts, resolve } })
  })
}

export function DialogHost(): React.JSX.Element {
  const pending = useConfirmStore((s) => s.pending)
  const close = (v: boolean): void => {
    pending?.resolve(v)
    useConfirmStore.setState({ pending: null })
  }
  const { resolve: _r, ...opts } = pending ?? { title: '' }
  void _r
  return <ConfirmDialog {...opts} open={!!pending} onConfirm={() => close(true)} onCancel={() => close(false)} />
}
