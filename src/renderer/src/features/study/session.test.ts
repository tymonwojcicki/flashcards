import { describe, expect, it } from 'vitest'
import { CardState, Rating } from '@shared/types'
import type { AnswerResult, Card, StudyCard, StudyMode } from '@shared/types'
import { MAX_ANSWER_MS, StudySessionRunner } from './session'
import type { SessionBackend } from './session'

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

/**
 * A fake backend with its own undo stack, like the real one. `plan` says what an answer does:
 * a due time to come back at (learning step), or nothing (card done for today).
 */
function fakeBackend(plan: (cardId: string, rating: Rating) => number | null = () => null) {
  const answers: { cardId: string; rating: Rating; durationMs: number }[] = []
  const stack: string[] = []
  const backend: SessionBackend & { answers: typeof answers; stack: string[] } = {
    answers,
    stack,
    async answer(cardId, rating, durationMs): Promise<AnswerResult> {
      answers.push({ cardId, rating, durationMs })
      stack.push(cardId)
      const due = plan(cardId, rating)
      return due === null
        ? { card: card(cardId, { state: CardState.Review, due: 1e12 }), requeue: false }
        : { card: card(cardId, { state: CardState.Learning, due }), requeue: true }
    },
    async undo() {
      return stack.pop() ?? null
    }
  }
  return backend
}

function start(
  cards: StudyCard[],
  opts: { mode?: StudyMode; learnAheadMs?: number; backend?: SessionBackend; random?: () => number } = {}
) {
  const mode = opts.mode ?? 'mixed'
  const clock = { now: 1_000 }
  const backend = opts.backend ?? fakeBackend()
  const runner = new StudySessionRunner(
    { mode, deckId: 'd', cards, affectsSchedule: mode !== 'cram' && mode !== 'weak', learnAheadMs: opts.learnAheadMs ?? 0 },
    backend,
    { clock: () => clock.now, random: opts.random ?? (() => 0) }
  )
  const shown = (): string | null => runner.getSnapshot().current?.card.id ?? null
  const answer = async (rating: Rating, afterMs = 0): Promise<boolean> => {
    clock.now += afterMs
    runner.reveal()
    return runner.answer(rating)
  }
  return { runner, clock, shown, answer }
}

describe('StudySessionRunner', () => {
  it('shows cards in order and finishes when the queue empties', async () => {
    const { runner, shown, answer } = start([sc('a'), sc('b')])
    expect(shown()).toBe('a')
    await answer(Rating.Good)
    expect(shown()).toBe('b')
    expect(runner.getSnapshot().finished).toBe(false)
    await answer(Rating.Good)
    expect(shown()).toBeNull()
    expect(runner.getSnapshot()).toMatchObject({ finished: true, waitUntil: null, progress: 1, doneCount: 2 })
  })

  it('only answers a revealed card', async () => {
    const backend = fakeBackend()
    const { runner, shown } = start([sc('a')], { backend })
    expect(await runner.answer(Rating.Good)).toBe(false)
    expect(backend.answers).toEqual([])
    expect(runner.reveal()).toBe(true)
    expect(runner.reveal()).toBe(false)
    expect(runner.getSnapshot().revealed).toBe(true)
    expect(await runner.answer(Rating.Good)).toBe(true)
    expect(shown()).toBeNull()
  })

  it('a learning step brings the card back later, waiting when nothing else is ready', async () => {
    const backend = fakeBackend((id) => (id === 'a' ? 61_000 : null))
    const { runner, clock, shown, answer } = start([sc('a'), sc('b')], { backend })
    await answer(Rating.Again)
    expect(shown()).toBe('b')
    await answer(Rating.Good)
    expect(shown()).toBeNull()
    expect(runner.getSnapshot()).toMatchObject({ waitUntil: 61_000, finished: false })
    expect(runner.getSnapshot().remaining).toEqual({ new: 0, learning: 1, review: 0 })

    clock.now = 30_000
    runner.next()
    expect(shown()).toBeNull()
    clock.now = 61_000
    runner.next()
    expect(shown()).toBe('a')
    expect(runner.getSnapshot().waitUntil).toBeNull()
  })

  it('studying ahead shows the waiting card now', async () => {
    const backend = fakeBackend(() => 600_000)
    const { runner, shown, answer } = start([sc('a')], { backend })
    await answer(Rating.Again)
    expect(shown()).toBeNull()
    runner.studyAhead()
    expect(shown()).toBe('a')
    expect(runner.getSnapshot().revealed).toBe(false)
  })

  it('learn-ahead shows a waiting card early only within the limit', async () => {
    const backend = fakeBackend(() => 1_000 + 120_000)
    const near = start([sc('a')], { backend, learnAheadMs: 180_000 })
    await near.answer(Rating.Again)
    expect(near.shown()).toBe('a')

    const far = start([sc('a')], { backend: fakeBackend(() => 1_000 + 300_000), learnAheadMs: 180_000 })
    await far.answer(Rating.Again)
    expect(far.shown()).toBeNull()
    expect(far.runner.getSnapshot().waitUntil).toBe(301_000)
  })

  it('undo restores the previous card and its stats, in step with the backend', async () => {
    const backend = fakeBackend()
    const { runner, shown, answer } = start([sc('a'), sc('b'), sc('c')], { backend })
    await answer(Rating.Again, 4_000)
    await answer(Rating.Good, 2_000)
    expect(shown()).toBe('c')
    expect(runner.getSnapshot().stats).toEqual({ answered: 2, again: 1, timeMs: 6_000 })

    expect(await runner.undo()).toEqual({ kind: 'undone' })
    expect(shown()).toBe('b')
    expect(runner.getSnapshot().revealed).toBe(false)
    expect(runner.getSnapshot().stats).toEqual({ answered: 1, again: 1, timeMs: 4_000 })
    expect(backend.stack).toEqual(['a'])

    expect(await runner.undo()).toEqual({ kind: 'undone' })
    expect(shown()).toBe('a')
    expect(runner.getSnapshot()).toMatchObject({ canUndo: false, stats: { answered: 0, again: 0, timeMs: 0 } })
    expect(await runner.undo()).toEqual({ kind: 'nothing' })
  })

  it('undo after the session finished brings it back', async () => {
    const { runner, shown, answer } = start([sc('a')])
    await answer(Rating.Good)
    expect(runner.getSnapshot().finished).toBe(true)
    await runner.undo()
    expect(shown()).toBe('a')
    expect(runner.getSnapshot().finished).toBe(false)
  })

  it('undo of a card answered outside this session is reported, not shown', async () => {
    const backend = fakeBackend()
    const { runner, shown, answer } = start([sc('a'), sc('b')], { backend })
    await answer(Rating.Good)
    backend.stack.push('elsewhere')
    expect(await runner.undo()).toEqual({ kind: 'elsewhere' })
    expect(shown()).toBe('b')
    expect(runner.getSnapshot().stats.answered).toBe(1)
  })

  it('undo when the backend has nothing to undo', async () => {
    const backend = fakeBackend()
    const { runner, answer } = start([sc('a'), sc('b')], { backend })
    await answer(Rating.Good)
    backend.stack.length = 0
    expect(await runner.undo()).toEqual({ kind: 'nothing' })
  })

  it('times each answer from when the card was shown, capped', async () => {
    const backend = fakeBackend()
    const { runner, answer } = start([sc('a'), sc('b')], { backend })
    await answer(Rating.Good, 7_000)
    await answer(Rating.Good, MAX_ANSWER_MS + 60_000)
    expect(backend.answers.map((a) => a.durationMs)).toEqual([7_000, MAX_ANSWER_MS])
    expect(runner.getSnapshot().stats.timeMs).toBe(7_000 + MAX_ANSWER_MS)
  })

  it('progress gives half credit to answered cards still in the queue', async () => {
    const backend = fakeBackend((id) => (id === 'a' ? 1e9 : null))
    const { runner, answer } = start([sc('a'), sc('b')], { backend })
    await answer(Rating.Again)
    expect(runner.getSnapshot()).toMatchObject({ progress: 0.25, doneCount: 0 })
    await answer(Rating.Good)
    expect(runner.getSnapshot()).toMatchObject({ progress: 0.75, doneCount: 1 })
  })

  it('ignores a second answer while one is saving', async () => {
    let release!: () => void
    const backend = fakeBackend()
    const slow: SessionBackend = {
      answer: (...args) => new Promise((r) => (release = () => r(backend.answer(...args)))),
      undo: () => backend.undo()
    }
    const { runner, shown } = start([sc('a'), sc('b')], { backend: slow })
    runner.reveal()
    const first = runner.answer(Rating.Good)
    expect(await runner.answer(Rating.Good)).toBe(false)
    expect(await runner.undo()).toEqual({ kind: 'busy' })
    release()
    expect(await first).toBe(true)
    expect(shown()).toBe('b')
  })

  it('a failed answer keeps the card shown', async () => {
    const backend: SessionBackend = { answer: () => Promise.reject(new Error('disk')), undo: async () => null }
    const { runner, shown } = start([sc('a')], { backend })
    runner.reveal()
    await expect(runner.answer(Rating.Good)).rejects.toThrow('disk')
    expect(shown()).toBe('a')
    expect(runner.getSnapshot().stats.answered).toBe(0)
  })

  it('bury/suspend remove a card; restore puts it back in front', () => {
    const { runner, shown } = start([sc('a'), sc('b')])
    runner.remove('a')
    expect(shown()).toBe('b')
    runner.restore(sc('a'))
    expect(shown()).toBe('a')
  })

  it('a note edit updates the shown card without re-showing it', () => {
    const { runner } = start([sc('a')])
    runner.reveal()
    const key = runner.getSnapshot().shownKey
    runner.editNote('na', 'F', 'B')
    expect(runner.getSnapshot()).toMatchObject({ shownKey: key, revealed: true, current: { question: 'F', answer: 'B' } })
  })

  it('notifies subscribers on every change', async () => {
    const { runner, answer } = start([sc('a'), sc('b')])
    let calls = 0
    const off = runner.subscribe(() => calls++)
    await answer(Rating.Good)
    expect(calls).toBe(2) // reveal + answer
    off()
    await answer(Rating.Good)
    expect(calls).toBe(2)
  })

  describe.each(['cram', 'weak'] as const)('%s (practice) mode', (mode) => {
    it('never calls the backend and only takes Again and Good', async () => {
      const backend = fakeBackend()
      const { runner, shown, answer } = start([sc('a'), sc('b')], { mode, backend })
      expect(runner.getSnapshot().affectsSchedule).toBe(false)
      expect(await answer(Rating.Hard)).toBe(false)
      expect(await answer(Rating.Easy)).toBe(false)
      expect(shown()).toBe('a')
      await answer(Rating.Good)
      expect(shown()).toBe('b')
      expect(backend.answers).toEqual([])
    })

    it('Again puts the card a few cards later', async () => {
      const cards = ['a', 'b', 'c', 'd', 'e'].map((i) => sc(i))
      const { runner, shown, answer } = start(cards, { mode, random: () => 0 })
      await answer(Rating.Again)
      expect(runner.getSnapshot().queue.map((q) => q.sc.card.id)).toEqual(['b', 'c', 'd', 'a', 'e'])
      expect(shown()).toBe('b')
    })

    it('undo is local and restores the card', async () => {
      const backend = fakeBackend()
      const { runner, shown, answer } = start([sc('a'), sc('b')], { mode, backend })
      await answer(Rating.Good)
      expect(await runner.undo()).toEqual({ kind: 'undone' })
      expect(shown()).toBe('a')
      expect(backend.answers).toEqual([])
    })
  })

  describe.each(['mixed', 'review', 'learn'] as const)('%s mode', (mode) => {
    it('answers through the backend with every rating', async () => {
      const backend = fakeBackend()
      const { answer } = start([sc('a'), sc('b'), sc('c'), sc('d')], { mode, backend })
      for (const r of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) expect(await answer(r)).toBe(true)
      expect(backend.answers.map((a) => a.cardId)).toEqual(['a', 'b', 'c', 'd'])
    })
  })
})
