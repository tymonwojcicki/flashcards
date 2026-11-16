// Prop contract: no props. Reads decks from useApp().deckTree.
import { useEffect, useState } from 'react'
import { hasLaunchFile, onLaunchFile, takeLaunchFile } from '@renderer/lib/launchFile'
import { FileUp, Layers, Plus, Upload } from 'lucide-react'
import type { DeckNode, Id } from '@shared/types'
import { Button, EmptyState, Panel, toast } from '@renderer/components/ui'
import { useApp } from '@renderer/store/app'
import { useShortcut } from '@renderer/lib/shortcuts'
import { plural } from '@renderer/lib/format'
import { DeckTree } from '@renderer/features/decks/DeckTree'
import { ExportDeckDialog, MoveDeckDialog, NewDeckDialog, ProgressChoiceDialog } from '@renderer/features/decks/DeckDialogs'
import { createDeckPath } from '@renderer/features/decks/actions'

export default function DecksPage(): React.JSX.Element {
  const tree = useApp((s) => s.deckTree)
  const navigate = useApp((s) => s.navigate)
  const refreshDecks = useApp((s) => s.refreshDecks)

  const [newOpen, setNewOpen] = useState(false)
  const [newParent, setNewParent] = useState<DeckNode | null>(null)
  const [moving, setMoving] = useState<DeckNode | null>(null)
  const [importAsk, setImportAsk] = useState(false)
  const [exportAsk, setExportAsk] = useState<DeckNode | null>(null)
  const [focusId, setFocusId] = useState<Id | null>(null)

  const totals = tree.reduce(
    (a, d) => ({
      due: a.due + d.counts.learning + d.counts.review,
      fresh: a.fresh + d.counts.new
    }),
    { due: 0, fresh: 0 }
  )

  const openNew = (parent: DeckNode | null = null): void => {
    setNewParent(parent)
    setNewOpen(true)
  }
  useShortcut('deck.new', () => openNew(null), { enabled: !newOpen })

  // A .fdeck file opened from Windows: go straight to the import question.
  useEffect(() => {
    const ask = (): void => {
      if (hasLaunchFile()) setImportAsk(true)
    }
    ask()
    return onLaunchFile(ask)
  }, [])

  const fail = (e: unknown, fallback: string): void => {
    toast(e instanceof Error ? e.message : fallback, { kind: 'error' })
  }

  const create = async (name: string, parentId: Id | null): Promise<void> => {
    try {
      const id = await createDeckPath(useApp.getState().deckTree, name, parentId)
      await refreshDecks()
      setNewOpen(false)
      if (id) setFocusId(id)
      toast('Deck created', { kind: 'success' })
    } catch (e) {
      fail(e, 'Could not create deck')
      await refreshDecks()
    }
  }

  const move = async (deck: DeckNode, parentId: Id | null): Promise<void> => {
    try {
      await window.api.moveDeck(deck.id, parentId)
      await refreshDecks()
      setMoving(null)
      toast(`Moved "${deck.name}"`, { kind: 'success' })
    } catch (e) {
      fail(e, 'Could not move deck')
    }
  }

  const doImport = async (includeProgress: boolean): Promise<void> => {
    setImportAsk(false)
    try {
      const r = await window.api.importDeckFile(null, includeProgress)
      if (!r) return
      await refreshDecks()
      toast(`Imported ${plural(r.cards, 'card')} (${plural(r.decksCreated, 'new deck')})`, { kind: 'success' })
    } catch (e) {
      fail(e, 'Import failed')
    }
  }

  const doExport = async (deck: DeckNode, format: 'fdeck' | 'csv', includeProgress: boolean): Promise<void> => {
    try {
      const path = await window.api.exportDeck(deck.id, format, includeProgress)
      setExportAsk(null)
      if (path) toast(`Exported "${deck.name}"`, { kind: 'success' })
    } catch (e) {
      fail(e, 'Export failed')
    }
  }

  const subtitle =
    totals.due + totals.fresh === 0 ? 'Nothing due today' : `${totals.due} due · ${totals.fresh} new`

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-text">Decks</h1>
          <p className="text-sm text-muted">{tree.length > 0 ? subtitle : 'No decks'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button icon={<Upload size={16} />} onClick={() => navigate({ name: 'import' })}>
            Import
          </Button>
          <Button icon={<FileUp size={16} />} onClick={() => setImportAsk(true)}>
            Import deck file
          </Button>
          <Button variant="primary" icon={<Plus size={16} />} hotkey="N" onClick={() => openNew(null)}>
            New deck
          </Button>
        </div>
      </header>

      {tree.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Layers size={32} />}
            title="No decks"
            text="Create a deck or import cards from a CSV file."
            action={
              <div className="flex flex-wrap justify-center gap-3">
                <Button variant="primary" size="lg" icon={<Plus size={18} />} onClick={() => openNew(null)}>
                  New deck
                </Button>
                <Button size="lg" icon={<Upload size={18} />} onClick={() => navigate({ name: 'import' })}>
                  Import CSV
                </Button>
              </div>
            }
          />
        </Panel>
      ) : (
        <Panel className="p-3">
          <DeckTree
            tree={tree}
            focusId={focusId}
            onAddSub={(d) => openNew(d)}
            onMove={setMoving}
            onExport={setExportAsk}
          />
        </Panel>
      )}

      <NewDeckDialog open={newOpen} parent={newParent} onClose={() => setNewOpen(false)} onCreate={create} />
      <MoveDeckDialog deck={moving} tree={tree} onClose={() => setMoving(null)} onMove={move} />
      <ProgressChoiceDialog
        open={importAsk}
        title="Import deck file"
        description="Include the scheduling progress stored in the file (due dates, memory strength), or import the cards as new?"
        onClose={() => {
          takeLaunchFile()
          setImportAsk(false)
        }}
        onChoose={(p) => void doImport(p)}
      />
      <ExportDeckDialog deck={exportAsk} onClose={() => setExportAsk(null)} onExport={doExport} />
    </div>
  )
}
