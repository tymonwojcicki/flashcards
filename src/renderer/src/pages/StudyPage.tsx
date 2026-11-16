// Prop contract: { deckId: string; mode: StudyMode }. Rendered full-screen (sidebar hidden).
// Leave with useApp.getState().navigate({ name: 'decks' }).
import { useEffect, useState, useSyncExternalStore } from 'react'
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
import { Button, DropdownMenu, EmptyState, IconButton, Kbd, toast, toastError } from '@renderer/components/ui'
import type { MenuEntry } from '@renderer/components/ui'
import { RichHtml } from '@renderer/lib/html'
import { deckPathLabel, relativeDue } from '@renderer/lib/format'
import { findDeck } from '@renderer/lib/decks'
import { useEffectiveKeys, useShortcut } from '@renderer/lib/shortcuts'
import type { ShortcutId } from '@renderer/lib/shortcuts'
import { useApp } from '@renderer/store/app'
import { playSound } from '@renderer/lib/sound'
import type { SoundName } from '@renderer/lib/sound'
import { QuickEditDialog } from '@renderer/features/study/QuickEditDialog'
import { countdownLabel } from '@renderer/features/study/queue'
import { StudySessionRunner } from '@renderer/features/study/session'
import type { SessionBackend, SessionSnapshot } from '@renderer/features/study/session'

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

const RATING_SOUND: Record<Rating, SoundName> = {
  [Rating.Again]: 'again',
  [Rating.Hard]: 'hard',
  [Rating.Good]: 'good',
  [Rating.Easy]: 'easy'
}

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

const noSubscribe = (): (() => void) => () => undefined
const noSnapshot = (): null => null

function useSnapshot(runner: StudySessionRunner | null): SessionSnapshot | null {
  return useSyncExternalStore(runner?.subscribe ?? noSubscribe, runner?.getSnapshot ?? noSnapshot)
}

const backend: SessionBackend = {
  answer: (cardId, rating, durationMs) => window.api.answer(cardId, rating, durationMs),
  undo: () => window.api.undo()
}

export default function StudyPage({ deckId, mode }: { deckId: string; mode: StudyMode }): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const deckTree = useApp((s) => s.deckTree)

  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading')
  const [runner, setRunner] = useState<StudySessionRunner | null>(null)
  const snap = useSnapshot(runner)
  const [pressed, setPressed] = useState<Rating | null>(null)
  const [intervals, setIntervals] = useState<IntervalPreview | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  // ---- load ----
  useEffect(() => {
    let cancelled = false
    setPhase('loading')
    setRunner(null)
    window.api
      .getSession(deckId, mode)
      .then((s: StudySession) => {
        if (cancelled) return
        setRunner(new StudySessionRunner(s, backend))
        setPhase('ready')
        if (s.cards.length > 0) playSound('start')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        toastError(e, 'Could not load session')
        setPhase('error')
      })
    return () => {
      cancelled = true
    }
  }, [deckId, mode])

  const affects = snap?.affectsSchedule ?? true
  const cur = snap?.current ?? null
  const curCardId = cur?.card.id ?? null
  const shownKey = snap?.shownKey ?? 0
  const revealed = snap?.revealed ?? false
  const total = snap?.total ?? 0
  const queueLength = snap?.queue.length ?? 0

  // ---- interval previews ----
  useEffect(() => {
    setIntervals(null)
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
  const waiting = phase === 'ready' && !cur && queueLength > 0
  const now = useNow(waiting)
  useEffect(() => {
    if (waiting) runner?.next()
  }, [waiting, now, runner])

  // ---- actions ----
  const exit = (): void => navigate({ name: 'decks' })

  const finished = snap?.finished ?? false
  useEffect(() => {
    if (finished) playSound('complete')
  }, [finished])

  const reveal = (): void => {
    if (runner?.reveal()) playSound('reveal')
  }

  const answer = async (rating: Rating): Promise<void> => {
    if (!runner?.canAnswer(rating)) return
    playSound(RATING_SOUND[rating])
    setPressed(rating)
    setTimeout(() => setPressed(null), 180)
    try {
      await runner.answer(rating)
    } catch (e) {
      toastError(e, 'Could not save answer')
    }
  }

  const undo = async (): Promise<void> => {
    if (!runner) return
    try {
      const r = await runner.undo()
      if (r.kind === 'nothing') toast('Nothing to undo')
      else if (r.kind === 'elsewhere') toast('Undone (reopen the session to see the card again)')
      else if (r.kind === 'undone') {
        playSound('undo')
        toast('Undone')
      }
    } catch (e) {
      toastError(e, 'Could not undo')
    }
  }

  const bury = async (): Promise<void> => {
    if (!runner || !cur) return
    const id = cur.card.id
    try {
      await window.api.buryCard(id)
      runner.remove(id)
      toast('Card buried until tomorrow')
    } catch (e) {
      toastError(e, 'Could not bury card')
    }
  }

  const suspend = async (): Promise<void> => {
    if (!runner || !cur) return
    const sc = cur
    try {
      await window.api.setSuspended([sc.card.id], true)
      runner.remove(sc.card.id)
      toast('Card suspended', {
        action: {
          label: 'Undo',
          onClick: () => {
            void window.api
              .setSuspended([sc.card.id], false)
              .then(() => runner.restore(sc))
              .catch(() => toast('Could not unsuspend', { kind: 'error' }))
          }
        }
      })
    } catch (e) {
      toastError(e, 'Could not suspend card')
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
  const remaining = snap?.remaining ?? { new: 0, learning: 0, review: 0 }
  const progress = snap?.progress ?? 0
  const doneCount = snap?.doneCount ?? 0
  const stats = snap?.stats ?? { answered: 0, again: 0, timeMs: 0 }

  const exitKeys = useEffectiveKeys('study.exit')
  const undoKeys = useEffectiveKeys('study.undo')
  const revealKeys = useEffectiveKeys('study.reveal')
  const editKeys = useEffectiveKeys('study.edit')
  const buryKeys = useEffectiveKeys('study.bury')
  const suspendKeys = useEffectiveKeys('study.suspend')

  const moreItems: MenuEntry[] = [
    { label: 'Edit card', icon: <Pencil size={16} />, hotkey: editKeys, onSelect: () => setEditOpen(true), disabled: !cur },
    { label: 'Bury until tomorrow', icon: <EyeOff size={16} />, hotkey: buryKeys, onSelect: () => void bury(), disabled: !cur },
    { label: 'Suspend card', icon: <Pause size={16} />, hotkey: suspendKeys, onSelect: () => void suspend(), disabled: !cur },
    { type: 'separator' },
    { label: 'Undo last answer', icon: <Undo2 size={16} />, hotkey: undoKeys, onSelect: () => void undo() }
  ]

  // ---- screens ----
  const topBar = (
    <header className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <IconButton label="Back to decks" hotkey={exitKeys} icon={<ArrowLeft size={18} />} onClick={exit} tooltipSide="bottom" />
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
          hotkey={undoKeys}
          icon={<Undo2 size={18} />}
          onClick={() => void undo()}
          disabled={phase !== 'ready' || !snap?.canUndo}
          tooltipSide="bottom"
        />
        <DropdownMenu
          trigger={
            <button
              type="button"
              aria-label="More"
              className="neu-raised-sm inline-flex h-10 w-10 items-center justify-center rounded-full btn-neutral active:neu-pressed"
            >
              <MoreHorizontal size={18} />
            </button>
          }
          items={moreItems}
        />
      </div>
      <div className="flex items-center gap-3">
        <div
          className="neu-inset h-2 flex-1 overflow-hidden rounded-full"
          role="progressbar"
          aria-label="Session progress"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="accent-fill accent-glow h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <span className="font-mono shrink-0 text-xs text-muted tabular-nums" title="Cards finished this session">
          {doneCount} / {total}
        </span>
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
        onSaved={(n) => runner?.editNote(n.id, n.front, n.back)}
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
  if (queueLength === 0) {
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
          <Button variant="primary" size="lg" onClick={exit} hotkey={exitKeys}>
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
    const until = snap?.waitUntil ?? now
    return shell(
      <div className="anim-fade-in flex flex-col items-center gap-5 text-center">
        <div className="neu-raised flex h-20 w-20 items-center justify-center rounded-full text-accent">
          <Clock size={32} />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-text">Next card in {countdownLabel(until - now)}</h2>
          <p className="mt-1 text-sm text-muted">No other cards are due.</p>
        </div>
        <Button size="lg" onClick={() => runner?.studyAhead()}>
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
        <Button variant="accent" size="lg" hotkey={revealKeys} onClick={reveal} className="min-w-[14rem]">
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
  const exitKeys = useEffectiveKeys('study.exit')
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
          <Button variant="ghost" hotkey={exitKeys} onClick={() => navigate({ name: 'decks' })}>
            Back
          </Button>
        </div>
      }
    />
  )
}
