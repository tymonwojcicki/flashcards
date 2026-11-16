import type { SqlValue } from 'sql.js'
import type { BaseCollection as Collection } from '../db/core'
import { newId } from '../db/core'
import { CardState, type BrowseQuery, type BrowseRow, type Card, type Id, type Note } from '../../shared/types'
import { deckPath, getCollectionSettings, subtreeIds } from './decks'
import { nextDayStart } from './time'
import { trashNotes } from './trash'

// Tags are stored space-delimited with surrounding spaces: " a b c " (enables LIKE '% a %').
export const encodeTags = (tags: string[]): string => {
  const clean = [...new Set(tags.map((t) => t.trim().replace(/\s+/g, '_')).filter(Boolean))]
  return clean.length ? ` ${clean.join(' ')} ` : ''
}
export const decodeTags = (s: string): string[] => s.split(' ').filter(Boolean)

interface NoteRow {
  id: string
  deck_id: string
  front: string
  back: string
  tags: string
  created_at: number
  updated_at: number
}

export const toNote = (r: NoteRow): Note => ({
  id: r.id,
  deckId: r.deck_id,
  front: r.front,
  back: r.back,
  tags: decodeTags(r.tags),
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

export interface CardRow {
  id: string
  note_id: string
  direction: 'fwd' | 'rev'
  state: number
  due: number
  stability: number
  difficulty: number
  scheduled_days: number
  fsrs: string | null
  reps: number
  lapses: number
  last_review: number | null
  suspended: number
  buried_until: number | null
  position: number
}

export const toCard = (r: CardRow): Card => ({
  id: r.id,
  noteId: r.note_id,
  direction: r.direction,
  state: r.state as CardState,
  due: r.due,
  stability: r.stability,
  difficulty: r.difficulty,
  scheduledDays: r.scheduled_days,
  reps: r.reps,
  lapses: r.lapses,
  lastReview: r.last_review,
  suspended: !!r.suspended,
  buriedUntil: r.buried_until
})

function nextPosition(col: Collection): number {
  return (col.get<{ p: number | null }>('SELECT MAX(position) AS p FROM cards')?.p ?? 0) + 1
}

export function insertCard(col: Collection, noteId: Id, direction: 'fwd' | 'rev', position: number, now: number): Id {
  const id = newId()
  col.run('INSERT INTO cards(id,note_id,direction,state,due,position) VALUES (?,?,?,0,?,?)', [
    id,
    noteId,
    direction,
    now,
    position
  ])
  return id
}

export function createNote(
  col: Collection,
  input: { deckId: Id; front: string; back: string; tags: string[]; reverse: boolean },
  now = Date.now()
): Note {
  const id = newId()
  col.tx(() => {
    col.run('INSERT INTO notes(id,deck_id,front,back,tags,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', [
      id,
      input.deckId,
      input.front,
      input.back,
      encodeTags(input.tags),
      now,
      now
    ])
    const pos = nextPosition(col)
    insertCard(col, id, 'fwd', pos, now)
    if (input.reverse) insertCard(col, id, 'rev', pos, now)
  })
  return getNote(col, id)!
}

export function getNote(col: Collection, id: Id): Note | null {
  const r = col.get<NoteRow>('SELECT * FROM notes WHERE id = ?', [id])
  return r ? toNote(r) : null
}

export function updateNote(
  col: Collection,
  id: Id,
  patch: { front?: string; back?: string; tags?: string[]; deckId?: Id }
): Note {
  const n = getNote(col, id)
  if (!n) throw new Error('Note not found')
  col.run('UPDATE notes SET front = ?, back = ?, tags = ?, deck_id = ?, updated_at = ? WHERE id = ?', [
    patch.front ?? n.front,
    patch.back ?? n.back,
    encodeTags(patch.tags ?? n.tags),
    patch.deckId ?? n.deckId,
    Date.now(),
    id
  ])
  return getNote(col, id)!
}

const placeholders = (n: number) => Array(n).fill('?').join(',')

/** Moves the notes and their cards to the Trash. Returns the trash id (for Undo). */
export function deleteNotes(col: Collection, ids: Id[]): string | null {
  return trashNotes(col, ids)
}

export function moveNotes(col: Collection, ids: Id[], deckId: Id): void {
  if (!ids.length) return
  col.run(`UPDATE notes SET deck_id = ?, updated_at = ? WHERE id IN (${placeholders(ids.length)})`, [
    deckId,
    Date.now(),
    ...ids
  ])
}

export function setSuspended(col: Collection, cardIds: Id[], suspended: boolean): void {
  if (!cardIds.length) return
  col.run(`UPDATE cards SET suspended = ? WHERE id IN (${placeholders(cardIds.length)})`, [suspended ? 1 : 0, ...cardIds])
}

export function addTags(col: Collection, noteIds: Id[], tags: string[]): void {
  col.tx(() => {
    for (const id of noteIds) {
      const n = getNote(col, id)
      if (n) col.run('UPDATE notes SET tags = ?, updated_at = ? WHERE id = ?', [encodeTags([...n.tags, ...tags]), Date.now(), id])
    }
  })
}

export function resetCards(col: Collection, cardIds: Id[]): void {
  if (!cardIds.length) return
  col.run(
    `UPDATE cards SET state = 0, due = ?, stability = 0, difficulty = 0, scheduled_days = 0, fsrs = NULL,
       reps = 0, lapses = 0, last_review = NULL, buried_until = NULL WHERE id IN (${placeholders(cardIds.length)})`,
    [Date.now(), ...cardIds]
  )
}

export function listTags(col: Collection, deckId?: Id | null): string[] {
  const set = new Set<string>()
  let sql = "SELECT DISTINCT tags FROM notes WHERE tags != ''"
  const params: SqlValue[] = []
  if (deckId) {
    const ids = subtreeIds(col, deckId)
    sql += ` AND deck_id IN (${placeholders(ids.length)})`
    params.push(...ids)
  }
  for (const r of col.all<{ tags: string }>(sql, params))
    decodeTags(r.tags).forEach((t) => set.add(t))
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** Strip HTML tags for searching/display. */
export const stripHtml = (s: string): string =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export function browse(col: Collection, q: BrowseQuery): { rows: BrowseRow[]; total: number } {
  const where: string[] = []
  const params: SqlValue[] = []
  if (q.deckId) {
    const ids = subtreeIds(col, q.deckId)
    where.push(`n.deck_id IN (${placeholders(ids.length)})`)
    params.push(...ids)
  }
  if (q.search?.trim()) {
    for (const term of q.search.trim().split(/\s+/)) {
      where.push('(n.front LIKE ? OR n.back LIKE ? OR n.tags LIKE ?)')
      const like = `%${term}%`
      params.push(like, like, like)
    }
  }
  if (q.tag) {
    where.push('n.tags LIKE ?')
    params.push(`% ${q.tag} %`)
  }
  if (q.state === 'suspended') where.push('c.suspended = 1')
  else if (q.state === 'due') {
    where.push('c.state != 0 AND c.due < ? AND c.suspended = 0')
    params.push(nextDayStart(Date.now(), getCollectionSettings(col).dayStartHour))
  } else if (q.state !== undefined) {
    where.push('c.state = ?')
    params.push(q.state)
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = col.get<{ n: number }>(`SELECT COUNT(*) AS n FROM cards c JOIN notes n ON n.id = c.note_id ${w}`, params)!.n
  const rows = col.all<CardRow & { deck_id: string; front: string; back: string; tags: string; updated_at: number }>(
    `SELECT c.*, n.deck_id, n.front, n.back, n.tags, n.updated_at
     FROM cards c JOIN notes n ON n.id = c.note_id ${w}
     ORDER BY n.updated_at DESC, c.direction LIMIT ? OFFSET ?`,
    [...params, q.limit ?? 200, q.offset ?? 0]
  )
  const pathCache = new Map<string, string[]>()
  return {
    total,
    rows: rows.map((r) => {
      if (!pathCache.has(r.deck_id)) pathCache.set(r.deck_id, deckPath(col, r.deck_id))
      return {
        cardId: r.id,
        noteId: r.note_id,
        deckId: r.deck_id,
        deckPath: pathCache.get(r.deck_id)!,
        front: r.front,
        back: r.back,
        tags: decodeTags(r.tags),
        direction: r.direction,
        state: r.state as CardState,
        due: r.due,
        reps: r.reps,
        lapses: r.lapses,
        suspended: !!r.suspended,
        updatedAt: r.updated_at
      }
    })
  }
}
