// Prop contract: { deckId: string; mode: StudyMode }. Rendered full-screen (sidebar hidden).
// Leave with useApp.getState().navigate({ name: 'decks' }).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  EyeOff,
  GraduationCap,
  MoreHorizontal,
  Pause,
  Pencil,
  Trophy,
  Undo2
} from 'lucide-react'
import { Rating } from '@shared/types'
import type { IntervalPreview, StudyMode, StudySession } from '@shared/types'
import { Button, DropdownMenu, EmptyState, IconButton, Kbd, toast } from '@renderer/components/ui'
import type { MenuEntry } from '@renderer/components/ui'
import { RichHtml } from '@renderer/lib/html'
import { deckPathLabel, relativeDue } from '@renderer/lib/format'
import { findDeck } from '@renderer/lib/decks'
import { useEffectiveKeys, useShortcut } from '@renderer/lib/shortcuts'
import type { ShortcutId } from '@renderer/lib/shortcuts'
import { useApp } from '@renderer/store/app'
import { QuickEditDialog } from '@renderer/features/study/QuickEditDialog'
import {
  applyNoteEdit,
  countdownLabel,
  makeQueue,
  pickNext,
  progressOf,
  pushFront,
  remainingCounts,
  removeById,
  requeueAfter,
  requeueByDue,
  studyAhead
} from '@renderer/features/study/queue'
import type { QueueItem } from '@renderer/features/study/queue'

interface HistoryEntry {
  sc: QueueItem['sc']
  rating: Rating
  durationMs: number
}

const MODE_LABEL: Record<StudyMode, string> = {
  mixed: 'Study',
  review: 'Review only',
  learn: 'Learning new cards',
  cram: 'Practice all',
  weak: 'Weak spots'
}

const RATINGS: { rating: Rating; label: string; id: ShortcutId; tone: string }[] = [
  { rating: Rating.Again, label: 'Again', id: 'study.again', tone: 'text-again' },
  { rating: Rating.Hard, label: 'Hard', id: 'study.hard', tone: 'text-hard' },
  { rating: Rating.Good, label: 'Good', id: 'study.good', tone: 'text-good' },
  { rating: Rating.Easy, label: 'Easy', id: 'study.easy', tone: 'text-easy' }
]

function RatingButton(props: {
  rating: Rating
  label: string
  id: ShortcutId
  tone: string
  interval?: string
  pressed: boolean
  onPick: (r: Rating) => void
}): React.JSX.Element {
  const keys = useEffectiveKeys(props.id)
  return (
    <button
      type="button"
      onClick={() => props.onPick(props.rating)}
      style={{ '--glow': `var(--${props.tone.replace('text-', '')})` } as React.CSSProperties}
      className={clsx(
        'flex min-w-[6.5rem] flex-1 flex-col items-center gap-0.5 rounded-2xl px-4 py-3 transition-all duration-100 select-none sm:flex-none sm:basis-32',
        props.pressed ? 'neu-glow-pressed scale-[0.97]' : 'neu-raised-sm neu-glow-hover hover:-translate-y-px active:neu-glow-pressed'
      )}
    >
      <span className={clsx('text-base font-semibold', props.tone)}>{props.label}</span>
      <span className="h-4 font-mono text-xs text-muted">{props.interval ?? ''}</span>
      <Kbd hotkey={keys} className="mt-1" />
    </button>
  )
}

function CountPill({ n, tone, label }: { n: number; tone: string; label: string }): React.JSX.Element {
  return (
    <span
      title={label}
      className={clsx('neu-inset font-mono rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums', tone, n === 0 && 'opacity-40')}
    >
      {n}
    </span>
  )
}

function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [enabled])
  return now
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

export default function StudyPage({ deckId, mode }: { deckId: string; mode: StudyMode }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const deckTree = useApp((s) => s.deckTree)

  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading')
  const [affects, setAffects] = useState(true)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const queueRef = useRef<QueueItem[]>([])
  const [total, setTotal] = useState(0)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [shownKey, setShownKey] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [stats, setStats] = useState({ answered: 0, again: 0, timeMs: 0 })
  const [pressed, setPressed] = useState<Rating | null>(null)
  const [intervals, setIntervals] = useState<IntervalPreview | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const history = useRef<HistoryEntry[]>([])
  const shownAt = useRef(Date.now())
  const busy = useRef(false)

  /** Replace the queue and choose which card to show next. */
  const commit = useCallback((q: QueueItem[]) => {
    queueRef.current = q
    setQueue(q)
    const pick = pickNext(q, Date.now())
    setCurrentId(pick.kind === 'card' ? q[pick.index].sc.card.id : null)
    setRevealed(false)
    setIntervals(null)
    shownAt.current = Date.now()
    setShownKey((k) => k + 1)
  }, [])

  // ---- load ----
  useEffect(() => {
    let cancelled = false
    setPhase('loading')
    history.current = []
    setStats({ answered: 0, again: 0, timeMs: 0 })
    window.api
      .getSession(deckId, mode)
      .then((s: StudySession) => {
        if (cancelled) return
        setAffects(s.affectsSchedule)
        setTotal(s.cards.length)
        commit(makeQueue(s.cards))
        setPhase('ready')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        toast(e instanceof Error ? e.message : 'Could not load session', { kind: 'error' })
        setPhase('error')
      })
    return () => {
      cancelled = true
    }
  }, [deckId, mode, commit])

  const curItem = useMemo(() => queue.find((q) => q.sc.card.id === currentId) ?? null, [queue, currentId])
  const cur = curItem?.sc ?? null
  const curCardId = cur?.card.id ?? null

  // ---- interval previews ----
  useEffect(() => {
    if (!curCardId || !affects) return
    let cancelled = false
    window.api
      .previewIntervals(curCardId)
      .then((p) => {
        if (!cancelled) setIntervals(p)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [curCardId, affects, shownKey])

  // ---- waiting for a learning step ----
  const waiting = phase === 'ready' && currentId === null && queue.length > 0
  const now = useNow(waiting)
  const waitPick = waiting ? pickNext(queue, now) : null
  useEffect(() => {
    if (waitPick && waitPick.kind === 'wait' && now >= waitPick.until) commit(queueRef.current)
  }, [waitPick, now, commit])

  // ---- actions ----
  const exit = (): void => navigate({ name: 'decks' })

  const reveal = (): void => {
    if (cur && !revealed) setRevealed(true)
  }

  const answer = async (rating: Rating): Promise<void> => {
    if (!cur || !revealed || busy.current) return
    if (!affects && rating !== Rating.Again && rating !== Rating.Good) return
    busy.current = true
    setPressed(rating)
    setTimeout(() => setPressed(null), 180)
    const durationMs = Math.min(Date.now() - shownAt.current, 5 * 60_000)
    try {
      let q: QueueItem[]
      if (affects) {
        const res = await window.api.answer(cur.card.id, rating, durationMs)
        q = res.requeue ? requeueByDue(queueRef.current, cur, res.card) : removeById(queueRef.current, cur.card.id)
      } else if (rating === Rating.Again) {
        q = requeueAfter(queueRef.current, cur, 3 + Math.floor(Math.random() * 3))
      } else {
        q = removeById(queueRef.current, cur.card.id)
      }
      history.current.push({ sc: cur, rating, durationMs })
      setStats((s) => ({
        answered: s.answered + 1,
        again: s.again + (rating === Rating.Again ? 1 : 0),
        timeMs: s.timeMs + durationMs
      }))
      commit(q)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save answer', { kind: 'error' })
    } finally {
      busy.current = false
    }
  }

  const undo = async (): Promise<void> => {
    if (busy.current) return
    if (history.current.length === 0) {
      toast('Nothing to undo')
      return
    }
    busy.current = true
    try {
      let idx = history.current.length - 1
      if (affects) {
        const restored = await window.api.undo()
        if (!restored) {
          toast('Nothing to undo')
          return
        }
        let found = -1
        for (let i = history.current.length - 1; i >= 0; i--) {
          if (history.current[i].sc.card.id === restored) {
            found = i
            break
          }
        }
        if (found < 0) {
          toast('Undone (reopen the session to see the card again)')
          return
        }
        idx = found
      }
      const [h] = history.current.splice(idx, 1)
      setStats((s) => ({
        answered: Math.max(0, s.answered - 1),
        again: Math.max(0, s.again - (h.rating === Rating.Again ? 1 : 0)),
        timeMs: Math.max(0, s.timeMs - h.durationMs)
      }))
      commit(pushFront(queueRef.current, h.sc))
      toast('Undone')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not undo', { kind: 'error' })
    } finally {
      busy.current = false
    }
  }

  const bury = async (): Promise<void> => {
    if (!cur || busy.current) return
    const id = cur.card.id
    try {
      await window.api.buryCard(id)
      commit(removeById(queueRef.current, id))
      toast('Card buried until tomorrow')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not bury card', { kind: 'error' })
    }
  }

  const suspend = async (): Promise<void> => {
    if (!cur || busy.current) return
    const sc = cur
    try {
      await window.api.setSuspended([sc.card.id], true)
      commit(removeById(queueRef.current, sc.card.id))
      toast('Card suspended', {
        action: {
          label: 'Undo',
          onClick: () => {
            void window.api
              .setSuspended([sc.card.id], false)
              .then(() => commit(pushFront(queueRef.current, sc)))
              .catch(() => toast('Could not unsuspend', { kind: 'error' }))
          }
        }
      })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not suspend card', { kind: 'error' })
    }
  }

  const ready = phase === 'ready' && !!cur
  useShortcut(
    'study.reveal',
    () => {
      if (!revealed) reveal()
      else void answer(Rating.Good)
    },
    { enabled: ready }
  )
  // Enter also reveals / answers Good (unless a control that handles Enter has focus).
  useEffect(() => {
    if (!ready) return
    // Ignore the very keypress that opened this page (e.g. Enter on a deck row bubbling up after mount).
    const since = performance.now()
    const onKey = (e: KeyboardEvent): void => {
      if (e.timeStamp < since) return
      if (e.key !== 'Enter' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A') return
      e.preventDefault()
      if (!revealed) reveal()
      else void answer(Rating.Good)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useShortcut('study.again', () => void answer(Rating.Again), { enabled: ready && revealed })
  useShortcut('study.hard', () => void answer(Rating.Hard), { enabled: ready && revealed && affects })
  useShortcut('study.good', () => void answer(Rating.Good), { enabled: ready && revealed })
  useShortcut('study.easy', () => void answer(Rating.Easy), { enabled: ready && revealed && affects })
  useShortcut('study.undo', () => void undo(), { enabled: phase === 'ready' })
  useShortcut('study.edit', () => setEditOpen(true), { enabled: ready })
  useShortcut('study.bury', () => void bury(), { enabled: ready })
  useShortcut('study.suspend', () => void suspend(), { enabled: ready })
  useShortcut('study.exit', exit)

  // ---- derived ----
  const deckNode = findDeck(deckTree, deckId)
  const pathLabel = deckNode ? deckPathLabel(deckNode.path) : (cur ? deckPathLabel(cur.deckPath) : '')
  const remaining = remainingCounts(queue)
  const progress = progressOf(total, queue.length)

  const moreItems: MenuEntry[] = [
    { label: 'Edit card', icon: <Pencil size={16} />, hotkey: 'E', onSelect: () => setEditOpen(true), disabled: !cur },
    { label: 'Bury until tomorrow', icon: <EyeOff size={16} />, hotkey: 'B', onSelect: () => void bury(), disabled: !cur },
    { label: 'Suspend card', icon: <Pause size={16} />, hotkey: 'S', onSelect: () => void suspend(), disabled: !cur },
    { type: 'separator' },
    { label: 'Undo last answer', icon: <Undo2 size={16} />, hotkey: 'Ctrl+Z', onSelect: () => void undo() }
  ]

  // ---- screens ----
  const topBar = (
    <header className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <IconButton label="Back to decks" hotkey="Escape" icon={<ArrowLeft size={18} />} onClick={exit} tooltipSide="bottom" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-text">{pathLabel || 'Study'}</div>
          <div className="text-xs text-muted">
            {affects ? MODE_LABEL[mode] : `${MODE_LABEL[mode]} — practice only, doesn't affect your schedule`}
          </div>
        </div>
        {phase === 'ready' && total > 0 && (
          <div className="flex items-center gap-1.5" aria-label="Cards remaining">
            <CountPill n={remaining.new} tone="text-easy" label="New" />
            <CountPill n={remaining.learning} tone="text-hard" label="Learning" />
            <CountPill n={remaining.review} tone="text-good" label="To review" />
          </div>
        )}
        <IconButton
          label="Undo last answer"
          hotkey="Ctrl+Z"
          icon={<Undo2 size={18} />}
          onClick={() => void undo()}
          disabled={phase !== 'ready' || history.current.length === 0}
          tooltipSide="bottom"
        />
        <DropdownMenu
          trigger={
            <button
              type="button"
              aria-label="More"
              className="neu-raised-sm inline-flex h-10 w-10 items-center justify-center rounded-full text-text hover:text-accent active:neu-pressed"
            >
              <MoreHorizontal size={18} />
            </button>
          }
          items={moreItems}
        />
      </div>
      <div className="neu-inset h-2 overflow-hidden rounded-full" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className="accent-fill accent-glow h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${progress * 100}%` }} />
      </div>
    </header>
  )

  const shell = (body: React.ReactNode): React.JSX.Element => (
    <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-[860px] flex-col gap-6">
      {topBar}
      <div className="flex flex-1 flex-col items-center justify-center">{body}</div>
      <QuickEditDialog
        open={editOpen}
        note={cur?.note ?? null}
        onClose={() => setEditOpen(false)}
        onSaved={(n) => {
          const q = applyNoteEdit(queueRef.current, n.id, n.front, n.back)
          queueRef.current = q
          setQueue(q)
        }}
      />
    </div>
  )

  if (phase === 'loading') {
    return shell(<div className="text-sm text-muted">Loading session…</div>)
  }
  if (phase === 'error') {
    return shell(
      <EmptyState
        icon={<GraduationCap size={32} />}
        title="Could not start the session"
        action={<Button variant="primary" onClick={exit}>Back to decks</Button>}
      />
    )
  }
  if (total === 0) {
    return shell(<EmptySession deckId={deckId} mode={mode} />)
  }
  if (queue.length === 0) {
    const againRate = stats.answered > 0 ? Math.round((stats.again / stats.answered) * 100) : 0
    return shell(
      <div className="anim-slide-up flex flex-col items-center gap-6 text-center">
        <div className="neu-raised flex h-24 w-24 items-center justify-center rounded-full text-good">
          <Trophy size={40} />
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-text">Session complete</h2>
          <p className="mt-1 text-sm text-muted">Reviews saved.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-4">
          {[
            ['Cards studied', String(stats.answered)],
            ['Time spent', formatDuration(stats.timeMs)],
            ['Again rate', `${againRate}%`]
          ].map(([k, v]) => (
            <div key={k} className="neu-inset min-w-[8rem] rounded-2xl px-5 py-3">
              <div className="font-display text-xl font-semibold tabular-nums text-text">{v}</div>
              <div className="text-xs text-muted">{k}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button variant="primary" size="lg" onClick={exit} hotkey="Escape">
            Back to decks
          </Button>
          {mode !== 'cram' && (
            <Button size="lg" onClick={() => navigate({ name: 'study', deckId, mode: 'cram' })}>
              Study more
            </Button>
          )}
        </div>
      </div>
    )
  }
  if (!cur) {
    const until = waitPick && waitPick.kind === 'wait' ? waitPick.until : now
    return shell(
      <div className="anim-fade-in flex flex-col items-center gap-5 text-center">
        <div className="neu-raised flex h-20 w-20 items-center justify-center rounded-full text-accent">
          <Clock size={32} />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-text">Next card in {countdownLabel(until - now)}</h2>
          <p className="mt-1 text-sm text-muted">No other cards are due.</p>
        </div>
        <Button
          size="lg"
          onClick={() => waitPick && waitPick.kind === 'wait' && commit(studyAhead(queueRef.current, waitPick.index))}
        >
          Study ahead
        </Button>
      </div>
    )
  }

  return shell(
    <div className="flex w-full flex-col items-center gap-8">
      <div
        key={shownKey}
        className="neu-hero anim-fade-in w-full max-w-[760px] rounded-[24px] p-8 text-text sm:p-10"
      >
        <RichHtml
          html={cur.question}
          className="text-[1.35rem] leading-relaxed [&_img]:max-h-[50vh] [&_img]:object-contain"
        />
        {revealed && (
          <div className="anim-slide-up">
            <hr className="my-6 border-0 border-t border-muted/30" />
            <RichHtml
              html={cur.answer}
              className="text-[1.35rem] leading-relaxed [&_img]:max-h-[50vh] [&_img]:object-contain"
            />
          </div>
        )}
      </div>

      {!revealed ? (
        <Button variant="accent" size="lg" hotkey="Space" onClick={reveal} className="min-w-[14rem]">
          Show answer
        </Button>
      ) : (
        <div className="anim-slide-up flex w-full max-w-[760px] flex-wrap justify-center gap-4">
          {RATINGS.filter((r) => affects || r.rating === Rating.Again || r.rating === Rating.Good).map((r) => (
            <RatingButton
              key={r.rating}
              {...r}
              label={!affects && r.rating === Rating.Good ? 'Got it' : r.label}
              interval={affects ? intervals?.[r.rating] : undefined}
              pressed={pressed === r.rating}
              onPick={(x) => void answer(x)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function EmptySession({ deckId, mode }: { deckId: string; mode: StudyMode }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const [nextDue, setNextDue] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api
      .browse({ deckId, limit: 5000 })
      .then(({ rows }) => {
        if (cancelled) return
        const t = Date.now()
        let best: number | null = null
        for (const r of rows) {
          if (r.suspended || r.state === 0 || r.due <= t) continue
          if (best === null || r.due < best) best = r.due
        }
        setNextDue(best)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [deckId])

  return (
    <EmptyState
      icon={<CheckCircle2 size={36} />}
      title="No cards due"
      text={
        nextDue
          ? `Next card is due ${relativeDue(nextDue)}.`
          : 'No cards are scheduled.'
      }
      action={
        <div className="flex flex-wrap justify-center gap-3">
          {mode !== 'learn' && (
            <Button variant="primary" onClick={() => navigate({ name: 'study', deckId, mode: 'learn' })}>
              Learn new cards
            </Button>
          )}
          {mode !== 'cram' && (
            <Button onClick={() => navigate({ name: 'study', deckId, mode: 'cram' })}>Practice all cards</Button>
          )}
          <Button variant="ghost" hotkey="Escape" onClick={() => navigate({ name: 'decks' })}>
            Back
          </Button>
        </div>
      }
    />
  )
}
