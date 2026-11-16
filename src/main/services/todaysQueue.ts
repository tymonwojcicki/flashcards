import type { BaseCollection as Collection } from '../db/core'
import { DEFAULT_PRESET_ID, placeholders as ph } from '../db/core'
import { CardState, type Deck, type Id, type Preset, type PresetConfig } from '../../shared/types'
import { allDecks, getCollectionSettings, listPresets, subtreeIds } from './decks'
import { dayStart, nextDayStart } from './time'

/** Today's Queue: the cards a deck offers for scheduled study now. */

/** The columns the selection needs; enough to load the whole collection cheaply. */
export interface Candidate {
  id: string
  note_id: string
  deck_id: string
  state: number
  due: number
  position: number
  direction: 'fwd' | 'rev'
  suspended: number
  buried_until: number | null
}

export const SELECT_CANDIDATES = `SELECT c.id, c.note_id, n.deck_id, c.state, c.due, c.position, c.direction,
  c.suspended, c.buried_until FROM cards c JOIN notes n ON n.id = c.note_id`

export interface QueueContext {
  preset: PresetConfig
  /** New and review cards already studied today in this deck's subtree. */
  done: { new: number; review: number }
  /** End of the current study day. */
  dayEnd: number
  /** Learning cards are offered once due within this many ms of now. */
  learnAheadMs: number
  now: number
}

/** In the order offered. */
export interface TodaysQueue<T> {
  learning: T[]
  review: T[]
  new: T[]
}

export const isAvailable = (c: Candidate, now: number): boolean =>
  !c.suspended && (c.buried_until === null || c.buried_until <= now)

export function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function selectToday<T extends Candidate>(cards: T[], { preset, done, dayEnd, learnAheadMs, now }: QueueContext): TodaysQueue<T> {
  const open = cards.filter((c) => isAvailable(c, now))
  const byDue = (a: T, b: T) => a.due - b.due
  const learningToday = open.filter(
    (c) => (c.state === CardState.Learning || c.state === CardState.Relearning) && c.due < dayEnd
  )
  const learning = learningToday.filter((c) => c.due <= now + learnAheadMs).sort(byDue)
  let review = open.filter((c) => c.state === CardState.Review && c.due < dayEnd).sort(byDue)
  let fresh = open.filter((c) => c.state === CardState.New)
  if (preset.newOrder === 'random') shuffle(fresh)
  else fresh.sort((a, b) => a.position - b.position || (a.direction < b.direction ? -1 : a.direction > b.direction ? 1 : 0))

  if (preset.burySiblings) {
    // One card per note in new/review (learning cards always shown), before the limits: otherwise
    // a reverse pair would use two slots for the one card shown. A learning card held back by
    // learn-ahead still claims its note: it comes back later today.
    const seen = new Set(learningToday.map((c) => c.note_id))
    const dedupe = (rows: T[]) => rows.filter((c) => (seen.has(c.note_id) ? false : (seen.add(c.note_id), true)))
    review = dedupe(review)
    fresh = dedupe(fresh)
  }
  return {
    learning,
    review: review.slice(0, Math.max(0, preset.reviewsPerDay - done.review)),
    new: fresh.slice(0, Math.max(0, preset.newPerDay - done.new))
  }
}

/** The deck's own preset, else the nearest ancestor's, else the default. */
export function inheritedPreset(decks: Map<Id, Deck>, presets: Map<Id, Preset>, deckId: Id): Preset {
  for (let cur = decks.get(deckId); cur; cur = cur.parentId ? decks.get(cur.parentId) : undefined) {
    const p = cur.presetId ? presets.get(cur.presetId) : undefined
    if (p) return p
  }
  return presets.get(DEFAULT_PRESET_ID)!
}

/** Cards studied today per deck (not subtree), counted by the state they were in. */
export function doneTodayByDeck(col: Collection, start: number, deckIds?: Id[]): Map<Id, { new: number; review: number }> {
  const inDecks = deckIds ? `AND n.deck_id IN (${ph(deckIds.length)})` : ''
  const rows = col.all<{ deck_id: string; nd: number; rd: number }>(
    `SELECT n.deck_id, SUM(l.state = 0) AS nd, SUM(l.state = 2) AS rd
     FROM review_log l JOIN cards c ON c.id = l.card_id JOIN notes n ON n.id = c.note_id
     WHERE l.ts >= ? ${inDecks} GROUP BY n.deck_id`,
    [start, ...(deckIds ?? [])]
  )
  return new Map(rows.map((r) => [r.deck_id, { new: r.nd, review: r.rd }]))
}

export const learnAheadMsOf = (minutes: number): number => Math.max(0, minutes) * 60_000

export function loadTodaysQueue(col: Collection, deckId: Id, now: number): TodaysQueue<Candidate> {
  const ids = subtreeIds(col, deckId)
  const { dayStartHour, learnAheadMinutes } = getCollectionSettings(col)
  const cards = col.all<Candidate>(`${SELECT_CANDIDATES} WHERE n.deck_id IN (${ph(ids.length)})`, ids)
  const done = { new: 0, review: 0 }
  for (const d of doneTodayByDeck(col, dayStart(now, dayStartHour), ids).values()) {
    done.new += d.new
    done.review += d.review
  }
  const decks = new Map(allDecks(col).map((d) => [d.id, d]))
  const presets = new Map(listPresets(col).map((p) => [p.id, p]))
  return selectToday(cards, {
    preset: inheritedPreset(decks, presets, deckId).config,
    done,
    dayEnd: nextDayStart(now, dayStartHour),
    learnAheadMs: learnAheadMsOf(learnAheadMinutes),
    now
  })
}
