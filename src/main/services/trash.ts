// 30-day Trash. Deleting a deck or notes first stores a JSON snapshot of every affected row
// (decks, notes, cards, review history) in the `trash` table, then deletes as usual.
// Restoring re-inserts the rows. Media files are never deleted, so images keep working.
import type { SqlValue } from 'sql.js'
import type { BaseCollection as Collection } from '../db/core'
import { newId, placeholders as ph } from '../db/core'
import { TRASH_DAYS, type TrashItem } from '../../shared/dataSafety'
import type { Id } from '../../shared/types'
import { deckPath, ensureDeckPath } from './decks'

type Row = Record<string, SqlValue>

interface Payload {
  decks: Row[] // parents before children
  notes: Row[]
  cards: Row[]
  review_log: Row[]
  /** Ids of the deleted deck's ancestors, nearest first (deck snapshots only). */
  ancestors: string[]
  /** Deck path of each note's deck at deletion time, so a missing deck can be recreated. */
  deckPaths: Record<string, string[]>
}

const DAY_MS = 86_400_000
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** Run a query for rows whose key column is in `ids`, in chunks (SQLite parameter limit). */
function rowsFor(col: Collection, table: string, key: string, ids: string[]): Row[] {
  const out: Row[] = []
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    out.push(...col.all<Row>(`SELECT * FROM ${table} WHERE ${key} IN (${ph(chunk.length)})`, chunk))
  }
  return out
}

function store(col: Collection, kind: 'deck' | 'notes', label: string, p: Payload, now: number): string {
  const id = newId()
  col.run('INSERT INTO trash(id,kind,label,card_count,deleted_at,payload) VALUES (?,?,?,?,?,?)', [
    id,
    kind,
    label,
    p.cards.length,
    now,
    JSON.stringify(p)
  ])
  return id
}

function snapshot(col: Collection, decks: Row[], noteIds: string[]): Omit<Payload, 'ancestors' | 'deckPaths'> {
  const notes = rowsFor(col, 'notes', 'id', noteIds)
  const cards = rowsFor(col, 'cards', 'note_id', noteIds)
  const review_log = rowsFor(
    col,
    'review_log',
    'card_id',
    cards.map((c) => c.id as string)
  )
  return { decks, notes, cards, review_log }
}

/** Move a deck and everything inside it to the Trash. Returns the trash id, or null if the deck doesn't exist. */
export function trashDeck(col: Collection, id: Id, now = Date.now()): string | null {
  return col.tx(() => {
    const deck = col.get<{ name: string }>('SELECT name FROM decks WHERE id = ?', [id])
    if (!deck) return null
    const decks = col.all<Row>(
      `WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT d.id FROM decks d JOIN t ON d.parent_id = t.id)
       SELECT d.* FROM decks d JOIN t ON t.id = d.id`,
      [id]
    )
    const noteIds = rowsFor(
      col,
      'notes',
      'deck_id',
      decks.map((d) => d.id as string)
    ).map((n) => n.id as string)
    const ancestors: string[] = []
    let parent = decks.find((d) => d.id === id)!.parent_id as string | null
    while (parent) {
      ancestors.push(parent)
      parent = col.get<{ parent_id: string | null }>('SELECT parent_id FROM decks WHERE id = ?', [parent])?.parent_id ?? null
    }
    const payload: Payload = { ...snapshot(col, decks, noteIds), ancestors, deckPaths: {} }
    const trashId = store(col, 'deck', `Deck "${deck.name}"`, payload, now)
    col.run('DELETE FROM decks WHERE id = ?', [id]) // FK cascades remove subdecks, notes, cards, logs
    return trashId
  })
}

/** Move notes (with their cards and history) to the Trash. Returns the trash id, or null if nothing was found. */
export function trashNotes(col: Collection, ids: Id[], now = Date.now()): string | null {
  if (!ids.length) return null
  return col.tx(() => {
    const snap = snapshot(col, [], ids)
    if (!snap.notes.length) return null
    const deckPaths: Record<string, string[]> = {}
    for (const n of snap.notes) {
      const d = n.deck_id as string
      deckPaths[d] ??= deckPath(col, d)
    }
    const trashId = store(col, 'notes', plural(snap.cards.length, 'card'), { ...snap, ancestors: [], deckPaths }, now)
    col.run(`DELETE FROM notes WHERE id IN (${ph(ids.length)})`, ids)
    return trashId
  })
}

export function listTrash(col: Collection): TrashItem[] {
  return col
    .all<{ id: string; kind: string; label: string; card_count: number; deleted_at: number }>(
      'SELECT id, kind, label, card_count, deleted_at FROM trash ORDER BY deleted_at DESC'
    )
    .map((r) => ({
      id: r.id,
      kind: r.kind as TrashItem['kind'],
      label: r.label,
      cardCount: r.card_count,
      deletedAt: r.deleted_at
    }))
}

function insertRows(col: Collection, table: string, rows: Row[]): void {
  for (const r of rows) {
    const keys = Object.keys(r)
    col.run(
      `INSERT INTO ${table}(${keys.join(',')}) VALUES (${ph(keys.length)})`,
      keys.map((k) => r[k])
    )
  }
}

export function restoreTrash(col: Collection, id: string): void {
  const row = col.get<{ payload: string }>('SELECT payload FROM trash WHERE id = ?', [id])
  if (!row) throw new Error('This item is no longer in the Trash.')
  const p = JSON.parse(row.payload) as Payload
  col.tx(() => {
    const exists = (table: string, key: string) => !!col.get(`SELECT 1 FROM ${table} WHERE id = ?`, [key])

    // Decks: the top deck goes under its nearest surviving ancestor (or the top level).
    if (p.decks.length) {
      const inSnap = new Set(p.decks.map((d) => d.id as string))
      const top = p.decks.find((d) => !inSnap.has(d.parent_id as string))!
      const parent = [top.parent_id as string | null, ...p.ancestors].find((a) => a && exists('decks', a)) ?? null
      top.parent_id = parent
      // A sibling with the same name already exists: keep both by renaming the restored one.
      const taken = (name: string) =>
        !!col.get(`SELECT 1 FROM decks WHERE name = ? COLLATE NOCASE AND ${parent ? 'parent_id = ?' : 'parent_id IS NULL'}`, parent ? [name, parent] : [name])
      if (taken(top.name as string)) {
        let name = `${top.name} (restored)`
        for (let i = 2; taken(name); i++) name = `${top.name} (restored ${i})`
        top.name = name
      }
      for (const d of p.decks) if (d.preset_id && !exists('presets', d.preset_id as string)) d.preset_id = null
      insertRows(col, 'decks', p.decks)
    }

    // Notes: if their deck is gone, recreate it from the saved path.
    const remap = new Map<string, string>()
    for (const n of p.notes) {
      const deckId = n.deck_id as string
      if (!remap.has(deckId)) {
        if (exists('decks', deckId)) remap.set(deckId, deckId)
        else {
          const path = (p.deckPaths[deckId] ?? []).filter((s) => !s.includes('::'))
          remap.set(deckId, ensureDeckPath(col, path.length ? path.join('::') : 'Restored')[0])
        }
      }
      n.deck_id = remap.get(deckId)!
    }
    insertRows(col, 'notes', p.notes)
    insertRows(col, 'cards', p.cards)
    insertRows(col, 'review_log', p.review_log)
    col.run('DELETE FROM trash WHERE id = ?', [id])
  })
}

export function deleteTrashForever(col: Collection, id: string): void {
  col.run('DELETE FROM trash WHERE id = ?', [id])
}

export function emptyTrash(col: Collection): void {
  col.run('DELETE FROM trash')
}

/** Remove entries older than 30 days. Returns how many were removed. */
export function purgeTrash(col: Collection, now = Date.now()): number {
  const cutoff = now - TRASH_DAYS * DAY_MS
  const n = col.get<{ n: number }>('SELECT COUNT(*) AS n FROM trash WHERE deleted_at < ?', [cutoff])!.n
  if (n) col.run('DELETE FROM trash WHERE deleted_at < ?', [cutoff])
  return n
}
