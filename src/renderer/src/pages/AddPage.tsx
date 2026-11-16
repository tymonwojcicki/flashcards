import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Check, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { RichHtml } from '@renderer/lib/html'
import type { Editor } from '@tiptap/react'
import type { DeckNode, Id } from '@shared/types'
import { Button, IconButton, Kbd, Switch, toast } from '@renderer/components/ui'
import { useApp } from '@renderer/store/app'
import { useShortcut, useEffectiveKeys } from '@renderer/lib/shortcuts'
import { findDeck } from '@renderer/lib/decks'
import { deckPathLabel, plural } from '@renderer/lib/format'
import { plainText } from '@renderer/features/browse/text'
import { CardField } from '@renderer/features/editor/CardField'
import { DeckCombobox } from '@renderer/features/editor/DeckCombobox'
import { TagInput } from '@renderer/features/editor/TagInput'
import '@renderer/features/editor/editor.css'

interface SessionEntry {
  noteId: Id
  deckId: Id
  deckLabel: string
  front: string
  back: string
  tags: string[]
  reverse: boolean
}

const SESSION_COLS = 'grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_4.5rem]'

function hasContent(html: string): boolean {
  if (/<img\b|data-math/i.test(html)) return true
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0
}

export default function AddPage({ deckId: propDeckId, editNoteId }: { deckId?: string; editNoteId?: string }): React.JSX.Element {
  const deckTree = useApp((s) => s.deckTree)
  const prefs = useApp((s) => s.prefs)
  const setPrefs = useApp((s) => s.setPrefs)
  const refreshDecks = useApp((s) => s.refreshDecks)
  const navigate = useApp((s) => s.navigate)
  const saveKeys = useEffectiveKeys('creator.save')
  const deckKeys = useEffectiveKeys('creator.deck')
  const reverseKeys = useEffectiveKeys('creator.reverse')
  const frontKeys = useEffectiveKeys('creator.focusFront')
  const backKeys = useEffectiveKeys('creator.focusBack')
  const tagsKeys = useEffectiveKeys('creator.focusTags')

  const [deckId, setDeckId] = useState<Id | null>(null)
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [session, setSession] = useState<SessionEntry[]>([])
  const [editing, setEditing] = useState<{ noteId: Id; fromProps: boolean } | null>(null)
  const [shake, setShake] = useState(false)
  const [flash, setFlash] = useState(0)
  const [lastAddedId, setLastAddedId] = useState<Id | null>(null)
  const [busy, setBusy] = useState(false)

  const frontEditor = useRef<Editor | null>(null)
  const backEditor = useRef<Editor | null>(null)
  const deckInput = useRef<HTMLInputElement>(null)
  const tagInput = useRef<HTMLInputElement>(null)
  const draft = useRef<{ front: string; back: string; tags: string[] } | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const reverse = prefs.creatorReverse
  const tagsRef = useRef(tags)
  tagsRef.current = tags

  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => void refreshDecks(), 350)
  }, [refreshDecks])
  useEffect(() => () => clearTimeout(refreshTimer.current), [])

  const loadTags = useCallback(() => {
    window.api.listTags().then(setAllTags, () => {})
  }, [])
  useEffect(loadTags, [loadTags])

  // Initial deck: prop -> last used -> first deck.
  useEffect(() => {
    if (deckId && findDeck(deckTree, deckId)) return
    if (editNoteId) return
    const cand = [propDeckId, prefs.lastDeckId].find((id) => id && findDeck(deckTree, id))
    const first = deckTree[0]?.id
    const pick = cand ?? first ?? null
    if (pick) setDeckId(pick)
  }, [deckTree, deckId, propDeckId, prefs.lastDeckId, editNoteId])

  // Edit an existing note given by route.
  useEffect(() => {
    if (!editNoteId) {
      setEditing((e) => (e?.fromProps ? null : e))
      return
    }
    let cancelled = false
    window.api.getNote(editNoteId).then(
      (note) => {
        if (cancelled) return
        if (!note) {
          toast('That card no longer exists', { kind: 'error' })
          navigate({ name: 'browse' })
          return
        }
        setEditing({ noteId: note.id, fromProps: true })
        setDeckId(note.deckId)
        setFront(note.front)
        setBack(note.back)
        setTags(note.tags)
        setTimeout(() => frontEditor.current?.commands.focus('end'), 50)
      },
      (e) => toast(e instanceof Error ? e.message : 'Could not load card', { kind: 'error' })
    )
    return () => {
      cancelled = true
    }
  }, [editNoteId, navigate])

  const focusFront = useCallback(() => {
    setTimeout(() => frontEditor.current?.commands.focus('end'), 0)
  }, [])

  function pickDeck(id: Id | null): void {
    setDeckId(id)
    if (id) void setPrefs({ lastDeckId: id })
  }

  function failShake(): void {
    setShake(false)
    requestAnimationFrame(() => setShake(true))
    setTimeout(() => setShake(false), 400)
  }

  function leaveEdit(): void {
    const d = draft.current
    draft.current = null
    setEditing(null)
    setFront(d?.front ?? '')
    setBack(d?.back ?? '')
    setTags(d?.tags ?? tagsRef.current)
    focusFront()
  }

  async function save(): Promise<void> {
    if (busy) return
    if (!hasContent(front)) {
      failShake()
      toast('The front of the card is empty', { kind: 'error' })
      frontEditor.current?.commands.focus()
      return
    }
    if (!deckId) {
      toast('Choose a deck first', { kind: 'error' })
      deckInput.current?.focus()
      return
    }
    setBusy(true)
    try {
      const deckLabel = deckPathLabel(findDeck(deckTree, deckId)?.path ?? [])
      if (editing) {
        await window.api.updateNote(editing.noteId, { front, back, tags, deckId })
        scheduleRefresh()
        loadTags()
        if (editing.fromProps) {
          navigate({ name: 'browse' })
          return
        }
        setSession((list) =>
          list.map((e) => (e.noteId === editing.noteId ? { ...e, front, back, tags, deckId, deckLabel } : e))
        )
        setLastAddedId(editing.noteId)
        leaveEdit()
        return
      }
      const note = await window.api.createNote({ deckId, front, back, tags, reverse })
      setSession((list) => [
        { noteId: note.id, deckId, deckLabel, front, back, tags, reverse },
        ...list
      ])
      setLastAddedId(note.id)
      setFlash((n) => n + 1)
      setFront('')
      setBack('')
      focusFront()
      scheduleRefresh()
      loadTags()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save card', { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  function startEdit(entry: SessionEntry): void {
    if (!editing) draft.current = { front, back, tags }
    setEditing({ noteId: entry.noteId, fromProps: false })
    setDeckId(entry.deckId)
    setFront(entry.front)
    setBack(entry.back)
    setTags(entry.tags)
    focusFront()
  }

  function cancelEdit(): void {
    if (editing?.fromProps) navigate({ name: 'browse' })
    else leaveEdit()
  }

  async function removeEntry(entry: SessionEntry): Promise<void> {
    try {
      await window.api.deleteNotes([entry.noteId])
      setSession((list) => list.filter((e) => e.noteId !== entry.noteId))
      if (editing?.noteId === entry.noteId) leaveEdit()
      scheduleRefresh()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not delete card', { kind: 'error' })
    }
  }

  // Preview drawer for a row of the session table. The last entry is kept so the panel keeps its
  // content while it slides out.
  const [previewId, setPreviewId] = useState<Id | null>(null)
  const lastPreview = useRef<SessionEntry | null>(null)
  const previewEntry = session.find((e) => e.noteId === previewId) ?? null
  if (previewEntry) lastPreview.current = previewEntry
  const shown = previewEntry ?? lastPreview.current
  useEffect(() => {
    if (!previewEntry) return
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape' || ev.defaultPrevented) return
      const t = ev.target as HTMLElement | null
      if (t?.closest('input, textarea, [contenteditable="true"], [role="dialog"]')) return
      setPreviewId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewEntry])

  const saveRef = useRef(save)
  saveRef.current = save
  useShortcut('creator.save', () => void saveRef.current(), { allowInInputs: true })
  useShortcut('creator.deck', () => deckInput.current?.focus(), { allowInInputs: true })
  useShortcut('creator.focusFront', () => frontEditor.current?.commands.focus('end'), { allowInInputs: true })
  useShortcut('creator.focusBack', () => backEditor.current?.commands.focus('end'), { allowInInputs: true })
  useShortcut('creator.focusTags', () => tagInput.current?.focus(), { allowInInputs: true })
  useShortcut('creator.reverse', () => void setPrefs({ creatorReverse: !reverse }), { allowInInputs: true, enabled: !editing })

  const deckOptionsTree: DeckNode[] = useMemo(() => deckTree, [deckTree])

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 pt-5 pb-10">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="relative z-30 flex flex-col gap-2">
            <div className="flex min-h-8 items-center gap-2">
              <label className="text-sm font-semibold text-text" onClick={() => deckInput.current?.focus()}>
                Deck
              </label>
              <Kbd hotkey={deckKeys} />
            </div>
            <DeckCombobox
              tree={deckOptionsTree}
              value={deckId}
              onChange={pickDeck}
              allowNew
              onCreated={() => void refreshDecks()}
              inputRef={deckInput}
              onDone={focusFront}
              label="Deck"
            />
          </div>

          {editing && (
            <div className="neu-inset flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-accent">
              <Pencil size={15} /> Editing card
            </div>
          )}

          <div className={clsx(shake && 'anim-shake')}>
            <CardField
              label="Front"
              value={front}
              onChange={setFront}
              placeholder="Question, term or prompt…"
              autoFocus
              onSubmit={() => void save()}
              editorRef={frontEditor}
              hotkey={frontKeys}
            />
          </div>
          <CardField
            label="Back"
            value={back}
            onChange={setBack}
            placeholder="Answer…"
            onSubmit={() => void save()}
            editorRef={backEditor}
            hotkey={backKeys}
          />

          <TagInput tags={tags} onChange={setTags} suggestions={allTags} hotkey={tagsKeys} inputRef={tagInput} />

          <div className="flex flex-wrap items-center justify-between gap-4">
            {!editing ? (
              <label className="flex cursor-pointer items-center gap-3 text-sm text-text select-none">
                <Switch
                  checked={reverse}
                  onCheckedChange={(v) => void setPrefs({ creatorReverse: v })}
                  aria-label="Also create reverse card"
                />
                Also create reverse card
                <Kbd hotkey={reverseKeys} />
              </label>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-3">
              {flash > 0 && !editing && (
                <span key={flash} className="anim-added-flash flex items-center gap-1 text-sm font-semibold text-success">
                  <Check size={16} className="anim-pulse" /> Added
                </span>
              )}
              {editing && (
                <Button size="lg" onClick={cancelEdit}>
                  Cancel
                </Button>
              )}
              <Button
                variant="primary"
                size="lg"
                icon={editing ? <Save size={18} /> : <Plus size={18} />}
                hotkey={saveKeys}
                disabled={busy}
                onClick={() => void save()}
              >
                {editing ? 'Save changes' : 'Add card'}
              </Button>
            </div>
          </div>
        </div>

        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-text">This session</h2>
            {session.length > 0 && <span className="text-xs text-muted">{plural(session.length, 'card')}</span>}
          </div>
          <div className="neu-inset overflow-hidden rounded-[20px] bg-bg">
            <div className={clsx('grid gap-3 border-b border-text/10 px-4 py-2.5 text-[0.68rem] font-semibold tracking-wider text-muted uppercase', SESSION_COLS)}>
              <span>Front</span>
              <span>Back</span>
              <span>Deck</span>
              <span />
            </div>
            {session.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">Cards you add are listed here.</p>
            ) : (
              session.map((e, i) => {
                const front = plainText(e.front) || (hasContent(e.front) ? '(image or math)' : '')
                const back = plainText(e.back) || (hasContent(e.back) ? '(image or math)' : '')
                return (
                  <div
                    key={e.noteId}
                    onClick={() => setPreviewId((id) => (id === e.noteId ? null : e.noteId))}
                    onDoubleClick={() => startEdit(e)}
                    className={clsx(
                      'group grid cursor-default items-center gap-3 px-4 py-2.5 text-sm select-none',
                      SESSION_COLS,
                      i < session.length - 1 && 'border-b border-text/[0.06]',
                      e.noteId === lastAddedId && 'anim-item-in',
                      editing?.noteId === e.noteId || previewId === e.noteId
                        ? 'bg-accent/10 shadow-[inset_3px_0_0_var(--accent)]'
                        : 'hover:bg-accent/[0.05]'
                    )}
                  >
                    <span className="truncate font-medium text-text" title={front}>
                      {e.reverse && (
                        <span className="mr-1.5 text-xs text-muted" title="Also creates a reverse card">
                          ↺
                        </span>
                      )}
                      {front}
                    </span>
                    <span className="truncate text-muted" title={back}>
                      {back}
                    </span>
                    <span className="truncate text-xs text-muted" title={e.deckLabel}>
                      {e.deckLabel}
                    </span>
                    <span
                      className="flex justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100"
                      onClick={(ev) => ev.stopPropagation()}
                      onDoubleClick={(ev) => ev.stopPropagation()}
                    >
                      <IconButton size="sm" variant="ghost" label="Edit" icon={<Pencil size={14} />} onClick={() => startEdit(e)} />
                      <IconButton size="sm" variant="ghost" label="Delete" icon={<Trash2 size={14} />} onClick={() => void removeEntry(e)} />
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>

      <aside
        aria-label="Card preview"
        aria-hidden={!previewEntry}
        className={clsx(
          'neu-raised fixed top-4 right-4 bottom-4 z-40 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-4 overflow-y-auto rounded-[24px] bg-bg p-5',
          'transition-[translate,opacity] ease-[var(--ease-out)]',
          previewEntry
            ? 'translate-x-0 opacity-100 duration-250'
            : 'pointer-events-none invisible translate-x-[calc(100%+2rem)] opacity-0 duration-200'
        )}
      >
        {shown && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text">Card</h2>
              <IconButton size="sm" variant="ghost" label="Close preview" icon={<X size={16} />} onClick={() => setPreviewId(null)} />
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Front</div>
              <RichHtml html={shown.front} className="text-base text-text" />
            </div>
            <div className="neu-inset h-px rounded-full" />
            <div>
              <div className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Back</div>
              {hasContent(shown.back) ? (
                <RichHtml html={shown.back} className="text-base text-text" />
              ) : (
                <span className="text-sm text-muted">(empty)</span>
              )}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted">Deck</dt>
              <dd className="text-text">{shown.deckLabel}</dd>
              <dt className="text-muted">Reverse card</dt>
              <dd className="text-text">{shown.reverse ? 'Yes' : 'No'}</dd>
              {shown.tags.length > 0 && (
                <>
                  <dt className="text-muted">Tags</dt>
                  <dd className="text-text">{shown.tags.join(', ')}</dd>
                </>
              )}
            </dl>
            <div className="mt-auto flex flex-wrap gap-2">
              <Button
                size="sm"
                icon={<Pencil size={14} />}
                onClick={() => {
                  startEdit(shown)
                  setPreviewId(null)
                }}
              >
                Edit
              </Button>
              <Button
                size="sm"
                icon={<Trash2 size={14} />}
                onClick={() => {
                  setPreviewId(null)
                  void removeEntry(shown)
                }}
              >
                Delete
              </Button>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}
