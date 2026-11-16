import { useCallback, useEffect, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { Button, Panel, Well, confirm, toast, toastError } from '@renderer/components/ui'
import { useApp } from '@renderer/store/app'
import { TRASH_DAYS, type TrashItem } from '@shared/dataSafety'

const DAY_MS = 86_400_000

const daysLeft = (t: TrashItem): number => Math.max(0, TRASH_DAYS - Math.floor((Date.now() - t.deletedAt) / DAY_MS))
const fmtDate = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

export function TrashPanel(): React.JSX.Element {
  const [items, setItems] = useState<TrashItem[] | null>(null)
  const refreshDecks = useApp((s) => s.refreshDecks)

  const load = useCallback(async (): Promise<void> => {
    try {
      setItems(await window.api.listTrash())
    } catch {
      setItems([])
    }
  }, [])
  useEffect(() => void load(), [load])

  const fail = (e: unknown, fallback: string): void => toastError(e, fallback)

  const restore = async (t: TrashItem): Promise<void> => {
    try {
      await window.api.restoreTrash(t.id)
      await refreshDecks()
      toast(`Restored ${t.label}`, { kind: 'success' })
    } catch (e) {
      fail(e, 'Could not restore')
    }
    await load()
  }

  const removeForever = async (t: TrashItem): Promise<void> => {
    const ok = await confirm({
      title: 'Delete forever?',
      message: `${t.label} will be permanently deleted. This cannot be undone.`,
      confirmLabel: 'Delete forever',
      danger: true
    })
    if (!ok) return
    try {
      await window.api.deleteTrashForever(t.id)
    } catch (e) {
      fail(e, 'Could not delete')
    }
    await load()
  }

  const empty = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Empty Trash?',
      message: 'Everything in Trash will be permanently deleted. This cannot be undone.',
      confirmLabel: 'Empty Trash',
      danger: true
    })
    if (!ok) return
    try {
      await window.api.emptyTrash()
    } catch (e) {
      fail(e, 'Could not empty Trash')
    }
    await load()
  }

  return (
    <Panel className="flex flex-col gap-4">
      <h3 className="text-base font-semibold">Trash</h3>
      <p className="text-sm text-muted">
        Deleted decks and cards stay here for {TRASH_DAYS} days, then are removed for good.
      </p>
      {items && items.length === 0 && <Well className="text-sm text-muted">Trash is empty.</Well>}
      {items && items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((t) => (
            <li key={t.id} className="neu-inset flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{t.label}</div>
                <div className="text-sm text-muted">
                  {t.kind === 'deck' ? `${t.cardCount} ${t.cardCount === 1 ? 'card' : 'cards'} · ` : ''}
                  Deleted {fmtDate(t.deletedAt)} · {daysLeft(t)} {daysLeft(t) === 1 ? 'day' : 'days'} left
                </div>
              </div>
              <Button size="sm" icon={<RotateCcw size={14} />} onClick={() => void restore(t)}>
                Restore
              </Button>
              <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => void removeForever(t)}>
                Delete forever
              </Button>
            </li>
          ))}
        </ul>
      )}
      {items && items.length > 0 && (
        <div>
          <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => void empty()}>
            Empty Trash
          </Button>
        </div>
      )}
    </Panel>
  )
}
