// A running study session: the queue, answering, undo, picking the next card, and the waiting
// screen's timing and stats. Pure (no DOM / React); the backend is passed in. Unit tested in
// session.test.ts. The study page subscribes to snapshots and only renders and handles keys.
import { Rating } from '@shared/types'
import type { AnswerResult, Id, StudyCard, StudySession } from '@shared/types'
import {
  applyNoteEdit,
  makeQueue,
  pickNext,
  pushFront,
  remainingCounts,
  removeById,
  requeueAfter,
  requeueByDue,
  sessionProgress,
  studyAhead
} from './queue'
import type { QueueItem, Remaining } from './queue'

/** The backend calls a session needs. Only used when the session affects the schedule. */
export interface SessionBackend {
  answer(cardId: Id, rating: Rating, durationMs: number): Promise<AnswerResult>
  /** Undo the last answer; returns the id of the card restored, or null. */
  undo(): Promise<Id | null>
}

export interface SessionStats {
  answered: number
  again: number
  timeMs: number
}

export interface SessionSnapshot {
  affectsSchedule: boolean
  /** Cards in the session when it started. */
  total: number
  queue: QueueItem[]
  /** The card being shown, or null while waiting or when the queue is empty. */
  current: StudyCard | null
  /** Bumps every time a card is (re)shown, even the same card again. */
  shownKey: number
  revealed: boolean
  /** Set while no card may be shown yet: when the soonest one becomes available. */
  waitUntil: number | null
  /** Queue emptied after at least one answer. */
  finished: boolean
  canUndo: boolean
  stats: SessionStats
  remaining: Remaining
  progress: number
  doneCount: number
}

export type UndoResult =
  /** The card is shown again. */
  | { kind: 'undone' }
  | { kind: 'nothing' }
  /** The backend undid an answer from outside this session. */
  | { kind: 'elsewhere' }
  /** Another answer or undo was in flight. */
  | { kind: 'busy' }

export interface SessionOptions {
  clock?: () => number
  /** 0..1, for where a practice-mode "Again" goes back into the queue. */
  random?: () => number
}

/** Longest time counted for one answer. */
export const MAX_ANSWER_MS = 5 * 60_000

interface HistoryEntry {
  sc: StudyCard
  rating: Rating
  durationMs: number
}

export class StudySessionRunner {
  private readonly affects: boolean
  private readonly learnAheadMs: number
  private readonly total: number
  private readonly clock: () => number
  private readonly random: () => number
  private queue: QueueItem[] = []
  private currentId: string | null = null
  private shownKey = 0
  private shownAt = 0
  private revealed = false
  private history: HistoryEntry[] = []
  private stats: SessionStats = { answered: 0, again: 0, timeMs: 0 }
  private busy = false
  private snapshot!: SessionSnapshot
  private listeners = new Set<() => void>()

  constructor(
    session: StudySession,
    private readonly backend: SessionBackend,
    opts: SessionOptions = {}
  ) {
    this.affects = session.affectsSchedule
    this.learnAheadMs = session.learnAheadMs
    this.total = session.cards.length
    this.clock = opts.clock ?? Date.now
    this.random = opts.random ?? Math.random
    this.commit(makeQueue(session.cards))
  }

  getSnapshot = (): SessionSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Ratings this session accepts: practice modes only take Again and Good ("Got it"). */
  accepts(rating: Rating): boolean {
    return this.affects || rating === Rating.Again || rating === Rating.Good
  }

  /** Whether answer(rating) would be taken right now. */
  canAnswer(rating: Rating): boolean {
    return !!this.currentCard() && this.revealed && !this.busy && this.accepts(rating)
  }

  reveal(): boolean {
    if (!this.currentCard() || this.revealed) return false
    this.revealed = true
    this.publish()
    return true
  }

  /** Answer the shown card. Resolves false if nothing was answered (not revealed, busy, …). */
  async answer(rating: Rating): Promise<boolean> {
    const cur = this.currentCard()
    if (!cur || !this.canAnswer(rating)) return false
    this.busy = true
    const durationMs = Math.min(this.clock() - this.shownAt, MAX_ANSWER_MS)
    try {
      let q: QueueItem[]
      if (this.affects) {
        const res = await this.backend.answer(cur.card.id, rating, durationMs)
        q = res.requeue ? requeueByDue(this.queue, cur, res.card) : removeById(this.queue, cur.card.id)
      } else if (rating === Rating.Again) {
        q = requeueAfter(this.queue, cur, 3 + Math.floor(this.random() * 3))
      } else {
        q = removeById(this.queue, cur.card.id)
      }
      this.history.push({ sc: cur, rating, durationMs })
      this.stats = {
        answered: this.stats.answered + 1,
        again: this.stats.again + (rating === Rating.Again ? 1 : 0),
        timeMs: this.stats.timeMs + durationMs
      }
      this.commit(q)
      return true
    } finally {
      this.busy = false
    }
  }

  /** Undo the last answer and show that card again. Stays in step with the backend's undo. */
  async undo(): Promise<UndoResult> {
    if (this.busy) return { kind: 'busy' }
    if (this.history.length === 0) return { kind: 'nothing' }
    this.busy = true
    try {
      let idx = this.history.length - 1
      if (this.affects) {
        const restored = await this.backend.undo()
        if (!restored) return { kind: 'nothing' }
        idx = this.history.map((h) => h.sc.card.id).lastIndexOf(restored)
        if (idx < 0) return { kind: 'elsewhere' }
      }
      const [h] = this.history.splice(idx, 1)
      this.stats = {
        answered: Math.max(0, this.stats.answered - 1),
        again: Math.max(0, this.stats.again - (h.rating === Rating.Again ? 1 : 0)),
        timeMs: Math.max(0, this.stats.timeMs - h.durationMs)
      }
      this.commit(pushFront(this.queue, h.sc))
      return { kind: 'undone' }
    } finally {
      this.busy = false
    }
  }

  /** While waiting, show the next card once one may be shown. Call as time passes. */
  next(): void {
    if (this.currentId !== null || this.queue.length === 0) return
    if (pickNext(this.queue, this.clock(), this.learnAheadMs).kind === 'card') this.commit(this.queue)
  }

  /** While waiting, show the soonest card right away. */
  studyAhead(): void {
    if (this.currentId !== null) return
    const pick = pickNext(this.queue, this.clock(), this.learnAheadMs)
    if (pick.kind === 'wait') this.commit(studyAhead(this.queue, pick.index))
  }

  /** Take a card out of the session (buried or suspended). */
  remove(cardId: Id): void {
    this.commit(removeById(this.queue, cardId))
  }

  /** Put a removed card back at the front (e.g. undoing a suspend). */
  restore(sc: StudyCard): void {
    this.commit(pushFront(this.queue, sc))
  }

  /** A note was edited: update its queued cards without changing what is shown. */
  editNote(noteId: Id, front: string, back: string): void {
    this.queue = applyNoteEdit(this.queue, noteId, front, back)
    this.publish()
  }

  private currentCard(): StudyCard | null {
    return this.queue.find((q) => q.sc.card.id === this.currentId)?.sc ?? null
  }

  /** Replace the queue and choose which card to show next. */
  private commit(q: QueueItem[]): void {
    this.queue = q
    const now = this.clock()
    const pick = pickNext(q, now, this.learnAheadMs)
    this.currentId = pick.kind === 'card' ? q[pick.index].sc.card.id : null
    this.revealed = false
    this.shownAt = now
    this.shownKey++
    this.publish()
  }

  private publish(): void {
    const current = this.currentCard()
    const pick = current ? null : pickNext(this.queue, this.clock(), this.learnAheadMs)
    const { fraction, done } = sessionProgress(
      this.total,
      this.queue,
      new Set(this.history.map((h) => h.sc.card.id))
    )
    this.snapshot = {
      affectsSchedule: this.affects,
      total: this.total,
      queue: this.queue,
      current,
      shownKey: this.shownKey,
      revealed: this.revealed,
      waitUntil: pick?.kind === 'wait' ? pick.until : null,
      finished: this.total > 0 && this.queue.length === 0 && this.stats.answered > 0,
      canUndo: this.history.length > 0,
      stats: this.stats,
      remaining: remainingCounts(this.queue),
      progress: fraction,
      doneCount: done
    }
    for (const l of this.listeners) l()
  }
}
