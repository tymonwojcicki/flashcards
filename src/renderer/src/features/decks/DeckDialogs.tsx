import { useEffect, useMemo, useRef, useState } from 'react'
import type { DeckNode, Id } from '@shared/types'
import clsx from 'clsx'
import { Button, Dialog, Field, Input, Select, Switch } from '@renderer/components/ui'
import { deckPathLabel } from '@renderer/lib/format'
import { flattenDecks } from '@renderer/lib/decks'
import { subtreeIds } from './actions'

export function NewDeckDialog(props: {
  open: boolean
  parent: DeckNode | null
  onClose: () => void
  onCreate: (name: string, parentId: Id | null) => Promise<void>
}): React.JSX.Element {
  const { open, parent, onClose, onCreate } = props
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setName('')
  }, [open])

  const submit = async (): Promise<void> => {
    if (!name.replace(/:/g, '').trim() || busy) return
    setBusy(true)
    try {
      await onCreate(name, parent?.id ?? null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={parent ? `New sub-deck in "${parent.name}"` : 'New deck'}
      initialFocus={ref}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" hotkey="Enter" disabled={!name.trim() || busy} onClick={() => void submit()}>
            Create
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field
          label="Deck name"
          htmlFor="new-deck-name"
          hint="Tip: use :: to create nested decks, e.g. Economics::Micro"
        >
          <Input
            id="new-deck-name"
            ref={ref}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Spanish::Verbs"
            autoComplete="off"
          />
        </Field>
      </form>
    </Dialog>
  )
}

const TOP = '__top__'

export function MoveDeckDialog(props: {
  deck: DeckNode | null
  tree: DeckNode[]
  onClose: () => void
  onMove: (deck: DeckNode, parentId: Id | null) => Promise<void>
}): React.JSX.Element {
  const { deck, tree, onClose, onMove } = props
  const [target, setTarget] = useState(TOP)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (deck) setTarget(deck.parentId ?? TOP)
  }, [deck])

  const options = useMemo(() => {
    const banned = deck ? subtreeIds(deck) : new Set<Id>()
    return [
      { value: TOP, label: 'Top level' },
      ...flattenDecks(tree)
        .filter((d) => !banned.has(d.id))
        .map((d) => ({ value: d.id, label: deckPathLabel(d.path) }))
    ]
  }, [tree, deck])

  const unchanged = !!deck && target === (deck.parentId ?? TOP)

  return (
    <Dialog
      open={!!deck}
      onOpenChange={(o) => !o && onClose()}
      title={deck ? `Move "${deck.name}"` : 'Move deck'}
      description="Choose the new parent deck."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={unchanged || busy}
            onClick={async () => {
              if (!deck) return
              setBusy(true)
              try {
                await onMove(deck, target === TOP ? null : target)
              } finally {
                setBusy(false)
              }
            }}
          >
            Move
          </Button>
        </>
      }
    >
      <Field label="Move to" htmlFor="move-target">
        <Select id="move-target" value={target} onValueChange={setTarget} options={options} />
      </Field>
    </Dialog>
  )
}

/** Asks whether scheduling progress should be included in an import. */
export function ProgressChoiceDialog(props: {
  open: boolean
  title: string
  description: string
  onClose: () => void
  onChoose: (includeProgress: boolean) => void
}): React.JSX.Element {
  const { open, title, description, onClose, onChoose } = props
  const withRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      initialFocus={withRef}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onChoose(false)}>Cards only</Button>
          <Button ref={withRef} variant="primary" onClick={() => onChoose(true)}>
            Include progress
          </Button>
        </>
      }
    />
  )
}

type ExportFormat = 'fdeck' | 'csv'

const FORMATS: { value: ExportFormat; label: string; hint: string }[] = [
  { value: 'fdeck', label: 'Flashcards deck (.fdeck)', hint: 'For sharing or backup, includes images.' },
  { value: 'csv', label: 'CSV', hint: 'For spreadsheets.' }
]

export function ExportDeckDialog(props: {
  deck: DeckNode | null
  onClose: () => void
  onExport: (deck: DeckNode, format: ExportFormat, includeProgress: boolean) => Promise<void>
}): React.JSX.Element {
  const { deck, onClose, onExport } = props
  const [format, setFormat] = useState<ExportFormat>('fdeck')
  const [progress, setProgress] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (deck) {
      setFormat('fdeck')
      setProgress(false)
    }
  }, [deck])

  return (
    <Dialog
      open={!!deck}
      onOpenChange={(o) => !o && onClose()}
      title={deck ? `Export "${deck.name}"` : 'Export'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              if (!deck) return
              setBusy(true)
              try {
                await onExport(deck, format, format === 'fdeck' && progress)
              } finally {
                setBusy(false)
              }
            }}
          >
            Export
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div role="radiogroup" aria-label="Format" className="neu-inset flex flex-col gap-1 rounded-2xl p-1.5">
          {FORMATS.map((f) => {
            const on = format === f.value
            return (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setFormat(f.value)}
                className={clsx(
                  'flex flex-col rounded-xl px-4 py-2.5 text-left transition-all duration-150',
                  on ? 'neu-raised-sm text-accent' : 'text-text hover:bg-text/5'
                )}
              >
                <span className="text-sm font-semibold">{f.label}</span>
                <span className="text-xs text-muted">{f.hint}</span>
              </button>
            )
          })}
        </div>
        {format === 'fdeck' && (
          <label className="flex items-center justify-between gap-4 px-1 text-sm text-text">
            <span>Include review progress</span>
            <Switch checked={progress} onCheckedChange={setProgress} aria-label="Include review progress" />
          </label>
        )}
      </div>
    </Dialog>
  )
}
