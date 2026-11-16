import { describe, expect, it } from 'vitest'
import { CardState } from '@shared/types'
import type { Card, StudyCard } from '@shared/types'
import {
  applyNoteEdit,
  countdownLabel,
  makeQueue,
  pickNext,
  progressOf,
  pushFront,
  remainingCounts,
  requeueAfter,
  requeueByDue,
  studyAhead
} from './queue'

function card(id: string, over: Partial<Card> = {}): Card {
  return {
    id,
    noteId: 'n' + id,
    direction: 'fwd',
    state: CardState.New,
    due: 0,
    stability: 0,
    difficulty: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    lastReview: null,
    suspended: false,
    buriedUntil: null,
    ...over
  }
}
function sc(id: string, over: Partial<Card> = {}): StudyCard {
  const c = card(id, over)
  return {
    card: c,
    note: { id: c.noteId, deckId: 'd', front: 'f' + id, back: 'b' + id, tags: [], createdAt: 0, updatedAt: 0 },
    deckPath: ['D'],
    question: 'f' + id,
    answer: 'b' + id
  }
}
const ids = (q: { sc: StudyCard }[]): string[] => q.map((x) => x.sc.card.id)

describe('queue', () => {
  it('picks first ready card, waits otherwise, empty when none', () => {
    const q = makeQueue([sc('a'), sc('b')])
    expect(pickNext(q, 1000)).toEqual({ kind: 'card', index: 0 })
    expect(pickNext([], 0)).toEqual({ kind: 'empty' })
    const w = requeueByDue(makeQueue([sc('a')]), sc('a'), card('a', { state: CardState.Learning, due: 5000 }))
    expect(pickNext(w, 1000)).toEqual({ kind: 'wait', until: 5000, index: 0 })
    expect(pickNext(w, 5000)).toEqual({ kind: 'card', index: 0 })
  })

  it('requeueByDue orders by due and skips ahead of not-yet-due cards', () => {
    let q = makeQueue([sc('a'), sc('b'), sc('c')])
    q = requeueByDue(q, sc('a'), card('a', { due: 9000, state: CardState.Learning }))
    expect(ids(q)).toEqual(['b', 'c', 'a'])
    q = requeueByDue(q, sc('b'), card('b', { due: 4000, state: CardState.Learning }))
    expect(ids(q)).toEqual(['c', 'b', 'a'])
    expect(pickNext(q, 1000)).toEqual({ kind: 'card', index: 0 })
    q = requeueByDue(q, sc('c'), card('c', { due: 6000, state: CardState.Learning }))
    expect(ids(q)).toEqual(['b', 'c', 'a'])
    expect(pickNext(q, 1000).kind).toBe('wait')
  })

  it('requeueAfter reinserts several positions later', () => {
    const q = makeQueue(['a', 'b', 'c', 'd', 'e'].map((i) => sc(i)))
    expect(ids(requeueAfter(q, sc('a'), 3))).toEqual(['b', 'c', 'd', 'a', 'e'])
    expect(ids(requeueAfter(makeQueue([sc('a'), sc('b')]), sc('a'), 4))).toEqual(['b', 'a'])
  })

  it('pushFront and studyAhead', () => {
    const q = makeQueue([sc('a'), sc('b')])
    expect(ids(pushFront(q, sc('b')))).toEqual(['b', 'a'])
    expect(ids(pushFront(q, sc('z')))).toEqual(['z', 'a', 'b'])
    const w = requeueByDue(makeQueue([sc('a')]), sc('a'), card('a', { due: 9000 }))
    expect(pickNext(studyAhead(w, 0), 0)).toEqual({ kind: 'card', index: 0 })
  })

  it('counts and progress', () => {
    const q = makeQueue([
      sc('a'),
      sc('b', { state: CardState.Learning }),
      sc('c', { state: CardState.Relearning }),
      sc('d', { state: CardState.Review })
    ])
    expect(remainingCounts(q)).toEqual({ new: 1, learning: 2, review: 1 })
    expect(progressOf(4, 1)).toBeCloseTo(0.75)
    expect(progressOf(0, 0)).toBe(1)
  })

  it('applyNoteEdit swaps for reverse cards', () => {
    const q = makeQueue([sc('a'), sc('b', { direction: 'rev' })])
    const r = applyNoteEdit(q, 'nb', 'F', 'B')
    expect(r[1].sc.question).toBe('B')
    expect(r[1].sc.answer).toBe('F')
    expect(r[0].sc.question).toBe('fa')
  })

  it('countdownLabel', () => {
    expect(countdownLabel(45_000)).toBe('45s')
    expect(countdownLabel(185_000)).toBe('3m 05s')
  })
})
