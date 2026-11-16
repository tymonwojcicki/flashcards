import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { FolderInput, Pause, Pencil, Play, RotateCcw, Search, Tag, Trash2, X } from 'lucide-react'
import { CardState } from '@shared/types'
import type { BrowseQuery, BrowseRow, Id } from '@shared/types'
import { Button, EmptyState, Input, Panel, Select, confirm, toast } from '@renderer/components/ui'
import { useApp } from '@renderer/store/app'
import { deckPathLabel, plural } from '@renderer/lib/format'
import { RichHtml } from '@renderer/lib/html'
import { DeckCombobox } from '@renderer/features/editor/DeckCombobox'
import { plainText } from '@renderer/features/browse/text'
import { MoveDialog, TagsDialog } from '@renderer/features/browse/BulkDialogs'

const PAGE = 200
// Narrow tables show the deck under the front text; wide ones get a Deck column.
const COLS =
  'grid-cols-[minmax(0,1fr)_5.75rem_4.5rem_5.25rem] @4xl:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_5.75rem_5rem_5.25rem]'

// Dot colours match the state badges in the table.
function StateLabel({ dot, text }: { dot?: string; text: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-2">
      {dot && <span aria-hidden="true" className={clsx('inline-block size-2 shrink-0 rounded-full', dot)} />}
      {text}
    </span>
  )
}

const STATE_OPTIONS = [
  { value: 'all', label: <StateLabel text="All states" /> },
  { value: 'new', label: <StateLabel dot="bg-easy" text="New" /> },
  { value: 'learning', label: <StateLabel dot="bg-hard" text="Learning" /> },
  { value: 'review', label: <StateLabel dot="bg-good" text="Review" /> },
  { value: 'due', label: <StateLabel dot="bg-again" text="Due" /> },
  { value: 'suspended', label: <StateLabel dot="bg-muted" text="Suspended" /> }
]

function stateQuery(v: string): BrowseQuery['state'] {
  switch (v) {
    case 'new':
      return CardState.New
    case 'learning':
      return CardState.Learning
    case 'review':
      return CardState.Review
    case 'due':
      return 'due'
    case 'suspended':
      return 'suspended'
    default:
      return undefined
  }
}

const BADGE = 'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[0.7rem] leading-4 font-semibold whitespace-nowrap'

function StateBadge({ row }: { row: BrowseRow }): React.JSX.Element {
  if (row.suspended)
    return (
      <span className={clsx(BADGE, 'bg-text/10 text-muted')}>
        <Pause size={11} /> Suspended
      </span>
    )
  const map: Record<number, [string, string]> = {
    [CardState.New]: ['New', 'bg-easy/15 text-easy'],
    [CardState.Learning]: ['Learning', 'bg-hard/15 text-hard'],
    [CardState.Review]: ['Review', 'bg-good/15 text-good'],
    [CardState.Relearning]: ['Relearning', 'bg-hard/15 text-hard']
  }
  const [label, cls] = map[row.state] ?? ['?', '']
  return <span className={clsx(BADGE, cls)}>{label}</span>
}

/** Short relative due text: "in 3 d", "overdue 2 d", "—" for new cards. */
function dueInfo(row: BrowseRow, now: number = Date.now()): { text: string; overdue: boolean } {
  if (row.state === CardState.New) return { text: '—', overdue: false }
  const diff = row.due - now
  const abs = Math.abs(diff)
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  let amount: string
  if (abs < min) return { text: 'now', overdue: false }
  if (abs < hour) amount = `${Math.round(abs / min)} min`
  else if (abs < day) amount = `${Math.round(abs / hour)} h`
  else if (abs < 60 * day) amount = `${Math.round(abs / day)} d`
  else if (abs < 365 * day) amount = `${Math.round(abs / (30 * day))} mo`
  else amount = `${Math.round((abs / (365 * day)) * 10) / 10} y`
  return diff < 0 ? { text: `overdue ${amount}`, overdue: true } : { text: `in ${amount}`, overdue: false }
}

function dueLabel(row: BrowseRow): string {
  return dueInfo(row).text
}

export default function BrowsePage({ deckId: propDeckId }: { deckId?: string }): React.JSX.Element {
  const deckTree = useApp((s) => s.deckTree)
  const refreshDecks = useApp((s) => s.refreshDecks)
  const navigate = useApp((s) => s.navigate)

  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [deckId, setDeckId] = useState<Id | null>(propDeckId ?? null)
  const [stateFilter, setStateFilter] = useState('all')
  const [tag, setTag] = useState('all')
  const [allTags, setAllTags] = useState<string[]>([])
  const [rows, setRows] = useState<BrowseRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<Id>>(new Set())
  const [focusedId, setFocusedId] = useState<Id | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)

  const anchor = useRef<Id | null>(null)
  const req = useRef(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchText.trim()), 200)
    return () => clearTimeout(t)
  }, [searchText])

  const loadTags = useCallback(() => {
    window.api.listTags(deckId).then(
      (list) => {
        setAllTags(list)
        setTag((t) => (t === 'all' || list.includes(t) ? t : 'all'))
      },
      () => {}
    )
  }, [deckId])
  useEffect(loadTags, [loadTags])

  const query = useMemo<BrowseQuery>(
    () => ({
      deckId: deckId ?? undefined,
      search: search || undefined,
      tag: tag === 'all' ? undefined : tag,
      state: stateQuery(stateFilter)
    }),
    [deckId, search, tag, stateFilter]
  )

  const reload = useCallback(
    async (limit: number = PAGE) => {
      const token = ++req.current
      setLoading(true)
      try {
        const res = await window.api.browse({ ...query, limit, offset: 0 })
        if (token !== req.current) return
        setRows(res.rows)
        setTotal(res.total)
        const ids = new Set(res.rows.map((r) => r.cardId))
        setSelected((s) => {
          const next = new Set([...s].filter((id) => ids.has(id)))
          return next.size === s.size ? s : next
        })
        setFocusedId((f) => (f && ids.has(f) ? f : null))
      } catch (e) {
        if (token === req.current)
          toast(e instanceof Error ? e.message : 'Could not load cards', {
            kind: 'error'
          })
      } finally {
        if (token === req.current) setLoading(false)
      }
    },
    [query]
  )

  useEffect(() => {
    void reload(PAGE)
  }, [reload])

  async function loadMore(): Promise<void> {
    const token = ++req.current
    setLoading(true)
    try {
      const res = await window.api.browse({
        ...query,
        limit: PAGE,
        offset: rowsRef.current.length
      })
      if (token !== req.current) return
      setRows((r) => [...r, ...res.rows])
      setTotal(res.total)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load cards', {
        kind: 'error'
      })
    } finally {
      if (token === req.current) setLoading(false)
    }
  }

  const afterMutation = useCallback(async () => {
    await reload(Math.max(PAGE, rowsRef.current.length))
    loadTags()
    void refreshDecks()
  }, [reload, loadTags, refreshDecks])

  // Ctrl+F focuses the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const focusedRow = rows.find((r) => r.cardId === focusedId) ?? null
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.cardId)), [rows, selected])
  const noteIds = useMemo(() => [...new Set(selectedRows.map((r) => r.noteId))], [selectedRows])
  const cardIds = useMemo(() => selectedRows.map((r) => r.cardId), [selectedRows])
  const allSuspended = selectedRows.length > 0 && selectedRows.every((r) => r.suspended)

  function selectRange(toId: Id, additive: boolean): void {
    const a = rows.findIndex((r) => r.cardId === (anchor.current ?? toId))
    const b = rows.findIndex((r) => r.cardId === toId)
    if (a < 0 || b < 0) return
    const [lo, hi] = a < b ? [a, b] : [b, a]
    const ids = rows.slice(lo, hi + 1).map((r) => r.cardId)
    setSelected((s) => new Set(additive ? [...s, ...ids] : ids))
  }

  function onRowClick(row: BrowseRow, e: React.MouseEvent): void {
    listRef.current?.focus()
    setFocusedId(row.cardId)
    if (e.shiftKey && anchor.current) selectRange(row.cardId, e.ctrlKey || e.metaKey)
    else if (e.ctrlKey || e.metaKey) {
      anchor.current = row.cardId
      setSelected((s) => {
        const n = new Set(s)
        if (n.has(row.cardId)) n.delete(row.cardId)
        else n.add(row.cardId)
        return n
      })
    } else {
      anchor.current = row.cardId
      setSelected(new Set([row.cardId]))
    }
  }

  function move(delta: number, extend: boolean): void {
    if (rows.length === 0) return
    const cur = rows.findIndex((r) => r.cardId === focusedId)
    const idx = Math.max(0, Math.min(rows.length - 1, cur < 0 ? (delta > 0 ? 0 : rows.length - 1) : cur + delta))
    const id = rows[idx]?.cardId
    if (!id) return
    setFocusedId(id)
    if (extend) {
      if (!anchor.current) anchor.current = rows[Math.max(cur, 0)]?.cardId ?? id
      selectRange(id, false)
    } else {
      anchor.current = id
      setSelected(new Set([id]))
    }
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLElement>(`[data-card="${id}"]`)?.scrollIntoView({ block: 'nearest' })
    )
  }

  function onListKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(1, e.shiftKey)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1, e.shiftKey)
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setSelected(new Set(rows.map((r) => r.cardId)))
    } else if (e.key === 'Enter' && focusedRow) {
      e.preventDefault()
      navigate({ name: 'add', editNoteId: focusedRow.noteId })
    } else if (e.key === 'Delete') {
      e.preventDefault()
      void deleteSelected()
    } else if (e.key === 'Escape') {
      setSelected(new Set())
    }
  }

  function targets(): BrowseRow[] {
    return selectedRows.length > 0 ? selectedRows : focusedRow ? [focusedRow] : []
  }

  async function run(fn: () => Promise<unknown>, okMsg?: string): Promise<void> {
    try {
      await fn()
      await afterMutation()
      if (okMsg) toast(okMsg, { kind: 'success' })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong', {
        kind: 'error'
      })
    }
  }

  async function deleteSelected(): Promise<void> {
    const t = targets()
    if (t.length === 0) return
    const ids = [...new Set(t.map((r) => r.noteId))]
    const ok = await confirm({
      title: `Delete ${plural(ids.length, 'note')}?`,
      message: `This permanently deletes ${plural(ids.length, 'note')} including both the forward and reverse cards of each. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    await run(() => window.api.deleteNotes(ids), 'Deleted')
  }

  async function resetSelected(): Promise<void> {
    const t = targets()
    if (t.length === 0) return
    const ok = await confirm({
      title: `Reset progress of ${plural(t.length, 'card')}?`,
      message: 'The cards become new again and all their review history for scheduling is lost.',
      confirmLabel: 'Reset',
      danger: true
    })
    if (!ok) return
    await run(() => window.api.resetCards(t.map((r) => r.cardId)), 'Progress reset')
  }

  async function toggleSuspend(): Promise<void> {
    const t = targets()
    if (t.length === 0) return
    const suspend = !t.every((r) => r.suspended)
    await run(() =>
      window.api.setSuspended(
        t.map((r) => r.cardId),
        suspend
      )
    )
  }

  const multi = selected.size > 1
  const hasFilters = !!(search || deckId || tag !== 'all' || stateFilter !== 'all')

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
          <Input
            ref={searchRef}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search cards…"
            aria-label="Search cards"
            className="pl-10"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                listRef.current?.focus()
                move(1, false)
              } else if (e.key === 'Escape') {
                setSearchText('')
              }
            }}
          />
        </div>
        <DeckCombobox
          tree={deckTree}
          value={deckId}
          onChange={setDeckId}
          allowAll
          className="w-[220px] shrink-0"
          label="Deck filter"
        />
        <div className="w-[180px] shrink-0">
          <Select
            value={stateFilter}
            onValueChange={setStateFilter}
            options={STATE_OPTIONS}
            aria-label="State filter"
          />
        </div>
        <div className="w-[180px] shrink-0">
          <Select
            value={tag}
            onValueChange={setTag}
            options={[{ value: 'all', label: 'All tags' }, ...allTags.map((t) => ({ value: t, label: t }))]}
            aria-label="Tag filter"
          />
        </div>
      </div>

      {multi && (
        <div className="anim-slide-up neu-raised-sm flex flex-wrap items-center gap-2 rounded-2xl px-4 py-2">
          <span className="mr-2 text-sm font-semibold text-text">{selected.size} selected</span>
          <Button size="sm" icon={<FolderInput size={14} />} onClick={() => setMoveOpen(true)}>
            Move to deck…
          </Button>
          <Button size="sm" icon={<Tag size={14} />} onClick={() => setTagsOpen(true)}>
            Add tags…
          </Button>
          <Button
            size="sm"
            icon={allSuspended ? <Play size={14} /> : <Pause size={14} />}
            onClick={() => void toggleSuspend()}
          >
            {allSuspended ? 'Unsuspend' : 'Suspend'}
          </Button>
          <Button size="sm" icon={<RotateCcw size={14} />} onClick={() => void resetSelected()}>
            Reset
          </Button>
          <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => void deleteSelected()}>
            Delete
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            icon={<X size={14} />}
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-5">
        <div className="@container neu-inset flex min-w-0 flex-1 flex-col overflow-hidden rounded-[20px] bg-bg">
          <div
            className={clsx(
              'sticky top-0 z-10 grid shrink-0 gap-3 border-b border-text/10 bg-bg px-4 py-2.5 text-[0.68rem] font-semibold tracking-wider text-muted uppercase',
              COLS
            )}
          >
            <span>Front</span>
            <span className="hidden @4xl:block">Deck</span>
            <span>State</span>
            <span className="text-right">Due</span>
            <span className="text-right whitespace-nowrap" title="Reviews / lapses">
              Reps / Lapses
            </span>
          </div>
          <div
            ref={listRef}
            tabIndex={0}
            role="listbox"
            aria-multiselectable="true"
            aria-label="Cards"
            onKeyDown={onListKeyDown}
            className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--accent)_55%,transparent)]"
          >
            {rows.length === 0 && !loading && (
              <EmptyState
                icon={<Search size={28} />}
                title={hasFilters ? 'No cards match' : 'No cards yet'}
                text={
                  hasFilters
                    ? 'No cards match the current search and filters. Edit the search or reset a filter.'
                    : 'Use Add cards to create your first card. It will be listed here.'
                }
                action={
                  !hasFilters && (
                    <Button variant="primary" onClick={() => navigate({ name: 'add' })}>
                      Add cards
                    </Button>
                  )
                }
              />
            )}
            {rows.map((r, idx) => {
              const sel = selected.has(r.cardId)
              const foc = focusedId === r.cardId
              const due = dueInfo(r)
              const front = plainText(r.front)
              const deckFull = deckPathLabel(r.deckPath)
              return (
                <div
                  key={r.cardId}
                  data-card={r.cardId}
                  style={{ '--i': idx } as React.CSSProperties}
                  role="option"
                  aria-selected={sel}
                  onClick={(e) => onRowClick(r, e)}
                  onDoubleClick={() => navigate({ name: 'add', editNoteId: r.noteId })}
                  className={clsx(
                    'anim-row grid cursor-default items-center gap-3 border-b border-text/[0.06] px-4 py-3 text-sm select-none',
                    COLS,
                    sel
                      ? 'bg-accent/10 shadow-[inset_3px_0_0_var(--accent)]'
                      : clsx('hover:bg-accent/[0.05] hover:shadow-[inset_3px_0_0_color-mix(in_srgb,var(--accent)_45%,transparent)]', foc && 'shadow-[inset_3px_0_0_color-mix(in_srgb,var(--accent)_45%,transparent)]'),
                    r.suspended && 'opacity-70'
                  )}
                >
                  <span className="min-w-0" title={front}>
                    <span className="block truncate font-medium text-text">
                      {r.direction === 'rev' && (
                        <span className="mr-1.5 text-xs text-muted" title="Reverse card">
                          ↺
                        </span>
                      )}
                      {front || <span className="text-muted">(empty)</span>}
                    </span>
                    <span className="block truncate text-[0.68rem] text-muted @4xl:hidden" title={deckFull}>
                      {r.deckPath[r.deckPath.length - 1]}
                    </span>
                  </span>
                  <span className="hidden min-w-0 @4xl:block" title={deckFull}>
                    <span className="block truncate text-xs text-muted">{deckFull}</span>
                    {r.tags.length > 0 && (
                      <span className="block truncate text-[0.68rem] text-muted/80" title={r.tags.join(', ')}>
                        {r.tags.join(' · ')}
                      </span>
                    )}
                  </span>
                  <span>
                    <StateBadge row={r} />
                  </span>
                  <span
                    className={clsx(
                      'truncate text-right font-mono text-xs tabular-nums',
                      due.overdue ? 'font-semibold text-again' : 'text-muted'
                    )}
                    title={r.state === CardState.New ? 'Not studied yet' : new Date(r.due).toLocaleString()}
                  >
                    {due.text}
                  </span>
                  <span className="text-right font-mono text-xs text-muted tabular-nums" title={`${plural(r.reps, 'review')}, ${plural(r.lapses, 'lapse')}`}>
                    {r.reps}
                    <span className="opacity-50"> / </span>
                    <span className={r.lapses >= 3 ? 'font-bold text-again' : undefined}>{r.lapses}</span>
                  </span>
                </div>
              )
            })}
            {rows.length < total && (
              <div className="flex justify-center p-3">
                <Button size="sm" disabled={loading} onClick={() => void loadMore()}>
                  Load more ({total - rows.length} left)
                </Button>
              </div>
            )}
          </div>
          <div className="shrink-0 border-t border-shadow-dark/40 px-4 py-1.5 text-xs text-muted">
            {loading && rows.length === 0
              ? 'Loading…'
              : `${plural(total, 'card')}${selected.size ? ` · ${selected.size} selected` : ''}`}
          </div>
        </div>

        <Panel className="hidden w-[300px] shrink-0 flex-col gap-4 overflow-y-auto lg:flex">
          {focusedRow ? (
            <>
              <div>
                <div className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Front</div>
                <RichHtml html={focusedRow.front} className="text-base text-text" />
              </div>
              <div className="neu-inset h-px rounded-full" />
              <div>
                <div className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Back</div>
                {plainText(focusedRow.back) || /<img|data-math/.test(focusedRow.back) ? (
                  <RichHtml html={focusedRow.back} className="text-base text-text" />
                ) : (
                  <span className="text-sm text-muted">(empty)</span>
                )}
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted">Deck</dt>
                <dd className="text-text">{deckPathLabel(focusedRow.deckPath)}</dd>
                <dt className="text-muted">Direction</dt>
                <dd className="text-text">{focusedRow.direction === 'fwd' ? 'Front → Back' : 'Back → Front'}</dd>
                <dt className="text-muted">State</dt>
                <dd>
                  <StateBadge row={focusedRow} />
                </dd>
                <dt className="text-muted">Due</dt>
                <dd className="text-text">{dueLabel(focusedRow)}</dd>
                <dt className="text-muted">Reviews</dt>
                <dd className="text-text">
                  {focusedRow.reps} ({plural(focusedRow.lapses, 'lapse')})
                </dd>
                {focusedRow.tags.length > 0 && (
                  <>
                    <dt className="text-muted">Tags</dt>
                    <dd className="text-text">{focusedRow.tags.join(', ')}</dd>
                  </>
                )}
              </dl>
              <div className="mt-auto flex flex-wrap gap-2">
                <Button
                  size="sm"
                  icon={<Pencil size={14} />}
                  onClick={() => navigate({ name: 'add', editNoteId: focusedRow.noteId })}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  icon={focusedRow.suspended ? <Play size={14} /> : <Pause size={14} />}
                  onClick={() => void run(() => window.api.setSuspended([focusedRow.cardId], !focusedRow.suspended))}
                >
                  {focusedRow.suspended ? 'Unsuspend' : 'Suspend'}
                </Button>
                <Button
                  size="sm"
                  icon={<RotateCcw size={14} />}
                  onClick={async () => {
                    const ok = await confirm({
                      title: 'Reset progress?',
                      message: 'This card becomes new again.',
                      confirmLabel: 'Reset',
                      danger: true
                    })
                    if (ok) void run(() => window.api.resetCards([focusedRow.cardId]), 'Progress reset')
                  }}
                >
                  Reset
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  icon={<Trash2 size={14} />}
                  onClick={async () => {
                    const ok = await confirm({
                      title: 'Delete this note?',
                      message: 'Deleting a note deletes both its forward and reverse cards. This cannot be undone.',
                      confirmLabel: 'Delete',
                      danger: true
                    })
                    if (ok) void run(() => window.api.deleteNotes([focusedRow.noteId]), 'Deleted')
                  }}
                >
                  Delete
                </Button>
              </div>
            </>
          ) : (
            <p className="m-auto text-center text-sm text-muted">Select a card to preview it.</p>
          )}
        </Panel>
      </div>

      <MoveDialog
        open={moveOpen}
        onOpenChange={setMoveOpen}
        tree={deckTree}
        count={noteIds.length}
        onMove={(id) => {
          setMoveOpen(false)
          void run(() => window.api.moveNotes(noteIds, id), 'Moved')
        }}
      />
      <TagsDialog
        open={tagsOpen}
        onOpenChange={setTagsOpen}
        suggestions={allTags}
        count={noteIds.length}
        onAdd={(tags) => {
          setTagsOpen(false)
          void run(() => window.api.addTags(noteIds, tags), 'Tags added')
        }}
      />
    </div>
  )
}
