// Pure session-queue logic (no DOM / React). Unit tested in queue.test.ts.
import { CardState } from '@shared/types'
import type { Card, StudyCard } from '@shared/types'

export interface QueueItem {
  sc: StudyCard
  /** Earliest time (ms) this card may be shown. 0 = immediately. */
  notBefore: number
}

export type Pick =
  | { kind: 'card'; index: number }
  | { kind: 'wait'; until: number; index: number }
  | { kind: 'empty' }

export function makeQueue(cards: StudyCard[]): QueueItem[] {
  return cards.map((sc) => ({ sc, notBefore: 0 }))
}

/** First card that may be shown now; otherwise the soonest waiting card; otherwise empty. */
export function pickNext(queue: QueueItem[], now: number): Pick {
  if (queue.length === 0) return { kind: 'empty' }
  const ready = queue.findIndex((q) => q.notBefore <= now)
  if (ready >= 0) return { kind: 'card', index: ready }
  let best = 0
  for (let i = 1; i < queue.length; i++) if (queue[i].notBefore < queue[best].notBefore) best = i
  return { kind: 'wait', until: queue[best].notBefore, index: best }
}

export function removeById(queue: QueueItem[], cardId: string): QueueItem[] {
  return queue.filter((q) => q.sc.card.id !== cardId)
}

/** Remove the card and reinsert it (with its updated scheduling) ordered by its new due time. */
export function requeueByDue(queue: QueueItem[], sc: StudyCard, newCard: Card): QueueItem[] {
  const rest = removeById(queue, sc.card.id)
  const item: QueueItem = { sc: { ...sc, card: newCard }, notBefore: newCard.due }
  let at = rest.length
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].notBefore > newCard.due) {
      at = i
      break
    }
  }
  return [...rest.slice(0, at), item, ...rest.slice(at)]
}

/** Remove the card and reinsert it `offset` positions later (cram / weak "Again"). */
export function requeueAfter(queue: QueueItem[], sc: StudyCard, offset: number): QueueItem[] {
  const idx = queue.findIndex((q) => q.sc.card.id === sc.card.id)
  const rest = removeById(queue, sc.card.id)
  const base = idx < 0 ? 0 : idx
  const at = Math.min(rest.length, base + Math.max(1, offset))
  return [...rest.slice(0, at), { sc, notBefore: 0 }, ...rest.slice(at)]
}

/** Put a card back at the front, immediately available (undo). Removes any existing copy. */
export function pushFront(queue: QueueItem[], sc: StudyCard): QueueItem[] {
  return [{ sc, notBefore: 0 }, ...removeById(queue, sc.card.id)]
}

/** Make a waiting card available right now and move it to the front ("Study ahead"). */
export function studyAhead(queue: QueueItem[], index: number): QueueItem[] {
  if (index < 0 || index >= queue.length) return queue
  const item = { ...queue[index], notBefore: 0 }
  return [item, ...queue.filter((_, i) => i !== index)]
}

export interface Remaining {
  new: number
  learning: number
  review: number
}

export function remainingCounts(queue: QueueItem[]): Remaining {
  const r: Remaining = { new: 0, learning: 0, review: 0 }
  for (const { sc } of queue) {
    const s = sc.card.state
    if (s === CardState.New) r.new++
    else if (s === CardState.Review) r.review++
    else r.learning++
  }
  return r
}

/** 0..1 progress given the initial session size. */
export function progressOf(total: number, queueLength: number): number {
  if (total <= 0) return 1
  return Math.max(0, Math.min(1, (total - queueLength) / total))
}

/** Replace question/answer HTML of every queued card of a note (after an edit). */
export function applyNoteEdit(queue: QueueItem[], noteId: string, front: string, back: string): QueueItem[] {
  return queue.map((q) => {
    if (q.sc.note.id !== noteId) return q
    const rev = q.sc.card.direction === 'rev'
    return {
      ...q,
      sc: {
        ...q.sc,
        note: { ...q.sc.note, front, back },
        question: rev ? back : front,
        answer: rev ? front : back
      }
    }
  })
}

/** "3m 05s", "45s" style countdown label. */
export function countdownLabel(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}
