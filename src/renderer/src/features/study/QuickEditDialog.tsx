import { useEffect, useRef, useState } from 'react'
import type { Note } from '@shared/types'
import { Button, Dialog, Field, Textarea, toast } from '@renderer/components/ui'

export interface QuickEditDialogProps {
  open: boolean
  note: Note | null
  onClose: () => void
  onSaved: (note: Note) => void
}

/** Minimal raw-HTML editor for a note's two faces (a richer editor can replace this later). */
export function QuickEditDialog({ open, note, onClose, onSaved }: QuickEditDialogProps): React.JSX.Element {
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [saving, setSaving] = useState(false)
  const frontRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open && note) {
      setFront(note.front)
      setBack(note.back)
    }
  }, [open, note])

  const save = async (): Promise<void> => {
    if (!note || saving) return
    setSaving(true)
    try {
      const updated = await window.api.updateNote(note.id, { front, back })
      onSaved(updated)
      toast('Card updated', { kind: 'success' })
      onClose()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save', { kind: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Edit card"
      description="Content is HTML. Math can be written as $x^2$."
      initialFocus={frontRef}
      className="w-[min(40rem,calc(100vw-2rem))]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" hotkey="Ctrl+Enter" disabled={saving} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div
        className="flex flex-col gap-4"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void save()
          }
        }}
      >
        <Field label="Front" htmlFor="qe-front">
          <Textarea id="qe-front" ref={frontRef} rows={5} value={front} onChange={(e) => setFront(e.target.value)} />
        </Field>
        <Field label="Back" htmlFor="qe-back">
          <Textarea id="qe-back" rows={5} value={back} onChange={(e) => setBack(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  )
}
