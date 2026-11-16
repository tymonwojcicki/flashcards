import { describe, expect, it } from 'vitest'
import { CardState, DEFAULT_PRESET_CONFIG, type Deck, type Preset } from '../../shared/types'
import { inheritedPreset, selectToday, type Candidate, type QueueContext } from './todaysQueue'

const NOW = 1_000_000
const DAY_END = 2_000_000

let pos = 0
function card(id: string, over: Partial<Candidate> = {}): Candidate {
  return {
    id,
    note_id: 'n' + id,
    deck_id: 'd',
    state: CardState.New,
    due: 0,
    position: pos++,
    direction: 'fwd',
    suspended: 0,
    buried_until: null,
    ...over
  }
}
const ctx = (over: Partial<QueueContext['preset']> = {}, done = { new: 0, review: 0 }): QueueContext => ({
  preset: { ...DEFAULT_PRESET_CONFIG, ...over },
  done,
  dayEnd: DAY_END,
  now: NOW
})
const ids = (cs: Candidate[]) => cs.map((c) => c.id)

describe("Today's Queue selection", () => {
  it('applies daily limits after bury siblings', () => {
    // Five reverse pairs: with bury on, one card per note, so all five notes fit a limit of 5.
    const cards = [1, 2, 3, 4, 5].flatMap((i) => [
      card(`f${i}`, { note_id: `n${i}` }),
      card(`r${i}`, { note_id: `n${i}`, direction: 'rev' })
    ])
    expect(ids(selectToday(cards, ctx({ newPerDay: 5 })).new)).toEqual(['f1', 'f2', 'f3', 'f4', 'f5'])
    expect(selectToday(cards, ctx({ newPerDay: 5, burySiblings: false })).new).toHaveLength(5)
  })

  it('bury on: a learning card hides its note from review and new; a review hides its new sibling', () => {
    const cards = [
      card('l', { note_id: 'a', state: CardState.Learning, due: NOW }),
      card('ra', { note_id: 'a', state: CardState.Review, due: 0 }),
      card('rb', { note_id: 'b', state: CardState.Review, due: 0 }),
      card('nb', { note_id: 'b' })
    ]
    const q = selectToday(cards, ctx())
    expect([ids(q.learning), ids(q.review), ids(q.new)]).toEqual([['l'], ['rb'], []])
  })

  it('subtracts what was studied today from the limits', () => {
    const cards = [card('a'), card('b'), card('c'), card('r', { state: CardState.Review })]
    const q = selectToday(cards, ctx({ newPerDay: 3, reviewsPerDay: 1 }, { new: 2, review: 1 }))
    expect([ids(q.new), q.review]).toEqual([['a'], []])
    expect(selectToday(cards, ctx({ newPerDay: 3 }, { new: 9, review: 0 })).new).toEqual([])
  })

  it('excludes suspended and buried cards, but not ones whose burial ended', () => {
    const cards = [
      card('s', { suspended: 1 }),
      card('b', { buried_until: NOW + 1 }),
      card('ok', { buried_until: NOW }),
      card('rs', { state: CardState.Review, suspended: 1 }),
      card('lb', { state: CardState.Learning, due: NOW, buried_until: DAY_END })
    ]
    const q = selectToday(cards, ctx())
    expect([q.learning, q.review, ids(q.new)]).toEqual([[], [], ['ok']])
  })

  it('offers learning and reviews due before the study day ends, soonest first', () => {
    const cards = [
      card('l2', { state: CardState.Relearning, due: DAY_END - 1 }),
      card('l1', { state: CardState.Learning, due: NOW }),
      card('lx', { state: CardState.Learning, due: DAY_END }),
      card('r2', { state: CardState.Review, due: 5 }),
      card('r1', { state: CardState.Review, due: 1 }),
      card('rx', { state: CardState.Review, due: DAY_END })
    ]
    const q = selectToday(cards, ctx())
    expect([ids(q.learning), ids(q.review)]).toEqual([['l1', 'l2'], ['r1', 'r2']])
  })

  it('orders new cards by position then direction, or randomly', () => {
    const cards = [
      card('b-rev', { note_id: 'b', position: 2, direction: 'rev' }),
      card('b-fwd', { note_id: 'b', position: 2 }),
      card('a', { note_id: 'a', position: 1 })
    ]
    expect(ids(selectToday(cards, ctx({ burySiblings: false })).new)).toEqual(['a', 'b-fwd', 'b-rev'])

    const many = Array.from({ length: 50 }, (_, i) => card(`c${i}`, { position: i }))
    const random = ids(selectToday(many, ctx({ newOrder: 'random', newPerDay: 50 })).new)
    expect([...random].sort()).toEqual(ids(many).sort())
    expect(random).not.toEqual(ids(many)) // 1 in 50! chance of a false failure
  })
})

describe('preset inheritance', () => {
  const preset = (id: string): Preset => ({ id, name: id, config: DEFAULT_PRESET_CONFIG })
  const deck = (id: string, parentId: string | null, presetId: string | null): Deck => ({
    id,
    parentId,
    name: id,
    presetId,
    collapsed: false,
    createdAt: 0
  })
  const presets = new Map(['default', 'P', 'C'].map((id) => [id, preset(id)]))

  it("a parent deck uses its own preset; children inherit the nearest one; else the default", () => {
    const decks = new Map(
      [deck('root', null, 'P'), deck('mid', 'root', null), deck('leaf', 'mid', 'C'), deck('free', null, null)].map((d) => [
        d.id,
        d
      ])
    )
    expect(inheritedPreset(decks, presets, 'root').id).toBe('P')
    expect(inheritedPreset(decks, presets, 'mid').id).toBe('P')
    expect(inheritedPreset(decks, presets, 'leaf').id).toBe('C')
    expect(inheritedPreset(decks, presets, 'free').id).toBe('default')
  })
})
