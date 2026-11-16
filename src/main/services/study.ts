import type { SqlValue } from 'sql.js'
import type { BaseCollection as Collection } from '../db/core'
import { newId } from '../db/core'
import {
  CardState,
  Rating,
  type AnswerResult,
  type DayStats,
  type Id,
  type IntervalPreview,
  type Stats,
  type StudyCard,
  type StudyMode,
  type StudySession
} from '../../shared/types'
import { deckPath, getCollectionSettings, resolvePreset, subtreeIds } from './decks'
import { toCard, toNote, type CardRow } from './notes'
import { preview, retrievability, reviewCard, reviveCard, serializeCard } from './scheduler'
import { dayKey, dayStart, nextDayStart } from './time'

const ph = (n: number) => Array(n).fill('?').join(',')

type JoinedRow = CardRow & {
  deck_id: string
  front: string
  back: string
  tags: string
  created_at: number
  updated_at: number
}

const SELECT_JOINED = `SELECT c.*, n.deck_id, n.front, n.back, n.tags, n.created_at, n.updated_at
  FROM cards c JOIN notes n ON n.id = c.note_id`

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Evenly interleave `b` into `a`. */
function interleave<T>(a: T[], b: T[]): T[] {
  if (!a.length) return b
  if (!b.length) return a
  const out: T[] = []
  const step = (a.length + b.length) / b.length
  let bi = 0
  for (let i = 0, ai = 0; ai < a.length || bi < b.length; i++) {
    if (bi < b.length && (ai >= a.length || Math.floor((bi + 1) * step) - 1 <= i)) out.push(b[bi++])
    else out.push(a[ai++])
  }
  return out
}

function toStudyCard(col: Collection, r: JoinedRow, pathCache: Map<string, string[]>): StudyCard {
  if (!pathCache.has(r.deck_id)) pathCache.set(r.deck_id, deckPath(col, r.deck_id))
  const note = toNote({ ...r, id: r.note_id })
  const rev = r.direction === 'rev'
  return {
    card: toCard(r),
    note,
    deckPath: pathCache.get(r.deck_id)!,
    question: rev ? note.back : note.front,
    answer: rev ? note.front : note.back
  }
}

export async function getSession(col: Collection, deckId: Id, mode: StudyMode, now = Date.now()): Promise<StudySession> {
  const ids = subtreeIds(col, deckId)
  const cfg = resolvePreset(col, deckId).config
  const settings = getCollectionSettings(col)
  const start = dayStart(now, settings.dayStartHour)
  const end = nextDayStart(now, settings.dayStartHour)
  const inDecks = `n.deck_id IN (${ph(ids.length)})`
  const avail = `c.suspended = 0 AND (c.buried_until IS NULL OR c.buried_until <= ?)`
  const q = (extra: string, params: SqlValue[], order: string, limit?: number) =>
    col.all<JoinedRow>(
      `${SELECT_JOINED} WHERE ${inDecks} AND ${avail} AND ${extra} ORDER BY ${order}${limit !== undefined ? ' LIMIT ' + Math.max(0, limit) : ''}`,
      [...ids, now, ...params]
    )
  const pathCache = new Map<string, string[]>()
  const wrap = (rows: JoinedRow[]) => rows.map((r) => toStudyCard(col, r, pathCache))

  if (mode === 'cram') {
    return { mode, deckId, affectsSchedule: false, cards: wrap(shuffle(q('1=1', [], 'c.position'))) }
  }
  if (mode === 'weak') {
    const rows = q('c.state != 0', [], 'c.lapses DESC')
    const scored: [number, JoinedRow][] = []
    for (const r of rows) {
      const ret = (await retrievability(cfg, reviveCard(r.fsrs, r.due), new Date(now))) ?? 1
      const score = ret - Math.min(r.lapses, 5) * 0.05
      if (r.lapses >= 2 || ret < 0.85) scored.push([score, r])
    }
    scored.sort((a, b) => a[0] - b[0])
    return { mode, deckId, affectsSchedule: false, cards: wrap(shuffle(scored.slice(0, 50).map(([, r]) => r))) }
  }

  const done = col.get<{ nd: number | null; rd: number | null }>(
    `SELECT SUM(l.state = 0) AS nd, SUM(l.state = 2) AS rd
     FROM review_log l JOIN cards c ON c.id = l.card_id JOIN notes n ON n.id = c.note_id
     WHERE ${inDecks} AND l.ts >= ?`,
    [...ids, start]
  )!
  const learning = mode === 'learn' ? [] : q('c.state IN (1,3) AND c.due < ?', [end], 'c.due')
  const reviews = mode === 'learn' ? [] : q('c.state = 2 AND c.due < ?', [end], 'c.due', cfg.reviewsPerDay - (done.rd ?? 0))
  let fresh =
    mode === 'review'
      ? []
      : q('c.state = 0', [], cfg.newOrder === 'random' ? 'RANDOM()' : 'c.position, c.direction', cfg.newPerDay - (done.nd ?? 0))

  let rv = reviews
  if (cfg.burySiblings) {
    // Only one card per note in new/review queues (learning cards always shown).
    const seen = new Set(learning.map((r) => r.note_id))
    const dedupe = (rows: JoinedRow[]) =>
      rows.filter((r) => (seen.has(r.note_id) ? false : (seen.add(r.note_id), true)))
    rv = dedupe(reviews)
    fresh = dedupe(fresh)
  }
  return {
    mode,
    deckId,
    affectsSchedule: true,
    cards: wrap([...learning, ...interleave(rv, fresh)])
  }
}

// ---------------- answering & undo ----------------
interface UndoEntry {
  rows: CardRow[]
  logId: string
}
const undoStack: UndoEntry[] = []

function getCardRow(col: Collection, id: Id): CardRow & { deck_id: string } {
  const r = col.get<CardRow & { deck_id: string }>(
    'SELECT c.*, n.deck_id FROM cards c JOIN notes n ON n.id = c.note_id WHERE c.id = ?',
    [id]
  )
  if (!r) throw new Error('Card not found')
  return r
}

export async function answer(
  col: Collection,
  cardId: Id,
  rating: Rating,
  durationMs: number,
  now = Date.now()
): Promise<AnswerResult> {
  const row = getCardRow(col, cardId)
  const cfg = resolvePreset(col, row.deck_id).config
  const { card: next, revlog } = await reviewCard(cfg, reviveCard(row.fsrs, row.due), rating, new Date(now))
  const settings = getCollectionSettings(col)
  const end = nextDayStart(now, settings.dayStartHour)
  const logId = newId()

  const { deck_id: _d, ...plainRow } = row
  const siblings = cfg.burySiblings
    ? col.all<CardRow>('SELECT * FROM cards WHERE note_id = ? AND id != ? AND state IN (0,2) AND suspended = 0', [
        row.note_id,
        cardId
      ])
    : []

  col.tx(() => {
    col.run(
      `UPDATE cards SET state = ?, due = ?, stability = ?, difficulty = ?, scheduled_days = ?, fsrs = ?,
         reps = ?, lapses = ?, last_review = ? WHERE id = ?`,
      [
        next.state,
        next.dueAt.getTime(),
        next.stability ?? 0,
        next.difficulty ?? 0,
        next.scheduledDays ?? 0,
        serializeCard(next),
        next.reps ?? row.reps + 1,
        next.lapses ?? row.lapses,
        now,
        cardId
      ]
    )
    col.run(
      `INSERT INTO review_log(id,card_id,rating,state,due,stability,difficulty,scheduled_days,revlog,review_ms,ts)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        logId,
        cardId,
        rating,
        row.state,
        row.due,
        row.stability,
        row.difficulty,
        row.scheduled_days,
        JSON.stringify(revlog),
        Math.min(Math.max(0, Math.round(durationMs)), 600_000),
        now
      ]
    )
    for (const s of siblings) col.run('UPDATE cards SET buried_until = ? WHERE id = ?', [end, s.id])
  })

  undoStack.push({ rows: [plainRow as CardRow, ...siblings], logId })
  if (undoStack.length > 50) undoStack.shift()

  const updated = toCard(getCardRow(col, cardId))
  return {
    card: updated,
    requeue: (updated.state === CardState.Learning || updated.state === CardState.Relearning) && updated.due < end
  }
}

export function undo(col: Collection): Id | null {
  const e = undoStack.pop()
  if (!e) return null
  col.tx(() => {
    for (const r of e.rows) {
      col.run(
        `UPDATE cards SET state=?, due=?, stability=?, difficulty=?, scheduled_days=?, fsrs=?, reps=?, lapses=?,
           last_review=?, suspended=?, buried_until=? WHERE id=?`,
        [
          r.state,
          r.due,
          r.stability,
          r.difficulty,
          r.scheduled_days,
          r.fsrs,
          r.reps,
          r.lapses,
          r.last_review,
          r.suspended,
          r.buried_until,
          r.id
        ]
      )
    }
    col.run('DELETE FROM review_log WHERE id = ?', [e.logId])
  })
  return e.rows[0].id
}

export function clearUndo(): void {
  undoStack.length = 0
}

export async function previewIntervals(col: Collection, cardId: Id, now = Date.now()): Promise<IntervalPreview> {
  const row = getCardRow(col, cardId)
  const cfg = resolvePreset(col, row.deck_id).config
  return preview(cfg, reviveCard(row.fsrs, row.due), new Date(now))
}

export function buryCard(col: Collection, cardId: Id): void {
  const end = nextDayStart(Date.now(), getCollectionSettings(col).dayStartHour)
  col.run('UPDATE cards SET buried_until = ? WHERE id = ?', [end, cardId])
}

// ---------------- stats ----------------
export function getStats(col: Collection, deckId: Id | null, now = Date.now()): Stats {
  const { dayStartHour } = getCollectionSettings(col)
  const ids = deckId ? subtreeIds(col, deckId) : null
  const deckFilter = ids ? `AND n.deck_id IN (${ph(ids.length)})` : ''
  const dp: SqlValue[] = ids ?? []
  const yearAgo = now - 366 * 86_400_000

  const logs = col.all<{ ts: number; rating: number; state: number; review_ms: number }>(
    `SELECT l.ts, l.rating, l.state, l.review_ms FROM review_log l
     JOIN cards c ON c.id = l.card_id JOIN notes n ON n.id = c.note_id
     WHERE l.ts >= ? ${deckFilter} ORDER BY l.ts`,
    [yearAgo, ...dp]
  )
  const byDay = new Map<string, DayStats>()
  for (const l of logs) {
    const k = dayKey(l.ts, dayStartHour)
    const d = byDay.get(k) ?? { day: k, reviews: 0, again: 0, newCards: 0, timeMs: 0 }
    d.reviews++
    if (l.rating === Rating.Again) d.again++
    if (l.state === CardState.New) d.newCards++
    d.timeMs += l.review_ms
    byDay.set(k, d)
  }

  const forecast: { day: string; due: number }[] = []
  const due = col.all<{ due: number }>(
    `SELECT c.due FROM cards c JOIN notes n ON n.id = c.note_id
     WHERE c.state != 0 AND c.suspended = 0 ${deckFilter}`,
    dp
  )
  const fmap = new Map<string, number>()
  const today = dayKey(now, dayStartHour)
  for (const { due: d } of due) {
    const k = d < now ? today : dayKey(d, dayStartHour)
    fmap.set(k, (fmap.get(k) ?? 0) + 1)
  }
  let cursor = dayStart(now, dayStartHour)
  for (let i = 0; i < 30; i++) {
    const k = dayKey(cursor + 3_600_000, dayStartHour)
    forecast.push({ day: k, due: fmap.get(k) ?? 0 })
    cursor = nextDayStart(cursor + 3_600_000, dayStartHour)
  }

  const t = col.get<{ cards: number; n: number; l: number; r: number; s: number }>(
    `SELECT COUNT(*) AS cards, SUM(c.state = 0 AND c.suspended = 0) AS n, SUM(c.state IN (1,3) AND c.suspended = 0) AS l,
       SUM(c.state = 2 AND c.suspended = 0) AS r, SUM(c.suspended) AS s
     FROM cards c JOIN notes n ON n.id = c.note_id WHERE 1=1 ${deckFilter}`,
    dp
  )!

  const monthAgo = now - 30 * 86_400_000
  const recent = logs.filter((l) => l.ts >= monthAgo && l.state === CardState.Review)
  const retention30d = recent.length ? recent.filter((l) => l.rating > Rating.Again).length / recent.length : null

  let streak = 0
  let c = dayStart(now, dayStartHour)
  if (!byDay.has(dayKey(c + 1, dayStartHour))) c -= 86_400_000 // allow today not yet studied
  while (byDay.has(dayKey(c + 3_600_000, dayStartHour))) {
    streak++
    c -= 86_400_000
  }

  return {
    days: [...byDay.values()],
    forecast,
    totals: { cards: t.cards ?? 0, new: t.n ?? 0, learning: t.l ?? 0, review: t.r ?? 0, suspended: t.s ?? 0 },
    retention30d,
    streak
  }
}
