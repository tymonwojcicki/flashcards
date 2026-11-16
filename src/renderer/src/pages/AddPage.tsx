import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Check, Pencil, Plus, Save, Trash2, X } from 'lucide-react'
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

  const saveRef = useRef(save)
  saveRef.current = save
  useShortcut('creator.save', () => void saveRef.current(), { allowInInputs: true })
  useShortcut('creator.deck', () => deckInput.current?.focus(), { allowInInputs: true })
  useShortcut('creator.reverse', () => void setPrefs({ creatorReverse: !reverse }), { allowInInputs: true, enabled: !editing })

  const deckOptionsTree: DeckNode[] = useMemo(() => deckTree, [deckTree])

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 pt-5 pb-10">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="relative z-30 flex flex-col gap-2">
            <div className="flex items-center justify-between">
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
            <div className="neu-inset flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-sm">
              <span className="flex items-center gap-2 font-semibold text-accent">
                <Pencil size={15} /> Editing card
              </span>
              <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={cancelEdit}>
                Cancel edit
              </Button>
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
            />
          </div>
          <CardField
            label="Back"
            value={back}
            onChange={setBack}
            placeholder="Answer…"
            onSubmit={() => void save()}
            editorRef={backEditor}
          />

          <TagInput tags={tags} onChange={setTags} suggestions={allTags} />

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
            <span className="text-xs text-muted">{session.length === 0 ? 'Math: write LaTeX between $ signs.' : plural(session.length, 'card')}</span>
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
                    onDoubleClick={() => startEdit(e)}
                    className={clsx(
                      'group grid items-center gap-3 px-4 py-2.5 text-sm',
                      SESSION_COLS,
                      i < session.length - 1 && 'border-b border-text/[0.06]',
                      e.noteId === lastAddedId && 'anim-item-in',
                      editing?.noteId === e.noteId
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
                    <span className="flex justify-end gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
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
    </div>
  )
}
