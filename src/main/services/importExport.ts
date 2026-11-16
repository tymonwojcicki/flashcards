// Platform-neutral import/export (works on bytes/strings; file I/O is done by the caller).
import JSZip from 'jszip'
import type { BaseCollection as Collection } from '../db/core'
import { newId, placeholders } from '../db/core'
import type { Id, ImportResult, ImportRow, ImportTarget } from '../../shared/types'
import { createDeck, deckPathPlanner, ensureDeckPath, getDeck, subtreeIds } from './decks'
import { createNote, encodeTags, decodeTags, insertCard } from './notes'
import { base64ToBytes, referencedMedia, saveMedia, type MediaPort } from './mediaCore'

const FDECK_VERSION = 1

/** Resolves a relative image path from a CSV (e.g. "images/x.png") to a media URL, or null. */
export type ImageResolver = (src: string) => Promise<string | null>

const IMG_RE = /<img\b([^>]*?)src=["']([^"']+)["']/gi

/** Rewrite <img src> to media:// URLs: data URIs are stored; relative paths go through `resolve`. */
async function importImages(html: string, port: MediaPort, resolve: ImageResolver | null): Promise<string> {
  const matches = [...html.matchAll(IMG_RE)]
  if (!matches.length) return html
  const replacements = new Map<string, string>()
  for (const m of matches) {
    const src = m[2]
    if (replacements.has(src) || /^media:/i.test(src)) continue
    try {
      const data = /^data:image\/([\w+]+);base64,(.+)$/i.exec(src)
      if (data) replacements.set(src, await saveMedia(port, base64ToBytes(data[2]), data[1]))
      else if (!/^https?:/i.test(src) && resolve) {
        const url = await resolve(src)
        if (url) replacements.set(src, url)
      }
    } catch {
      /* leave unchanged */
    }
  }
  return html.replace(IMG_RE, (whole, pre, src: string) =>
    replacements.has(src) ? `<img${pre}src="${replacements.get(src)}"` : whole
  )
}

/** Plain-text cells: escape and convert newlines to <br>. HTML cells are kept as-is. */
export function cellToHtml(s: string): string {
  const t = s.trim()
  if (/<[a-z][\s\S]*>/i.test(t)) return t
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>')
}

/**
 * The import rules, shared by importRows and previewImport: rows with an empty front are skipped,
 * a row's deck path wins, other rows go to the target (or "Imported" when there is none).
 * `resolve` turns a deck path into [deck, decksCreated]; `add` stores one row.
 * Returns the result and the deck that rows without a deck path went to.
 */
function walkRows<D>(
  rows: ImportRow[],
  target: ImportTarget,
  resolve: (path: string) => [D, number],
  add: (row: ImportRow, deck: D) => void
): [ImportResult, D | undefined] {
  const res: ImportResult = { notes: 0, cards: 0, decksCreated: 0, skipped: 0 }
  const use = (path: string): D => {
    const [deck, created] = resolve(path)
    res.decksCreated += created
    return deck
  }
  let fallback: D | undefined
  if (target && 'newDeck' in target) fallback = use(target.newDeck)
  else if (target) fallback = target.deckId as D
  for (const r of rows) {
    if (!r.front?.trim()) {
      res.skipped++
      continue
    }
    const deck = r.deckPath?.trim() ? use(r.deckPath) : (fallback ??= use('Imported'))
    add(r, deck)
    res.notes++
    res.cards++
  }
  return [res, fallback]
}

/** What importRows would do with these rows, without writing anything. */
export function previewImport(col: Collection, rows: ImportRow[], target: ImportTarget): ImportResult {
  const plan = deckPathPlanner(col)
  return walkRows(rows, target, (path) => [null, plan(path)], () => {})[0]
}

export async function importRows(
  col: Collection,
  rows: ImportRow[],
  target: ImportTarget,
  port: MediaPort,
  resolveImage: ImageResolver | null = null
): Promise<ImportResult> {
  // Async image work first, then a single synchronous transaction.
  const prepared: ImportRow[] = []
  for (const r of rows) {
    const front = r.front?.trim() ?? ''
    prepared.push({
      ...r,
      front: front ? await importImages(cellToHtml(front), port, resolveImage) : '',
      back: await importImages(cellToHtml(r.back ?? ''), port, resolveImage)
    })
  }
  return col.tx(() => {
    const [res, deckId] = walkRows<Id>(
      prepared,
      target,
      (path) => ensureDeckPath(col, path),
      (r, d) => void createNote(col, { deckId: d, front: r.front, back: r.back, tags: r.tags ?? [], reverse: false })
    )
    return deckId ? { ...res, deckId } : res
  })
}

// ---------------- .fdeck (zip) ----------------
interface FDeck {
  version: number
  app: 'flashcards'
  rootDeckId: string
  decks: { id: string; parentId: string | null; name: string }[]
  notes: { id: string; deckId: string; front: string; back: string; tags: string[]; createdAt: number }[]
  cards: {
    noteId: string
    direction: 'fwd' | 'rev'
    state?: number
    due?: number
    stability?: number
    difficulty?: number
    scheduledDays?: number
    fsrs?: string | null
    reps?: number
    lapses?: number
    lastReview?: number | null
    position: number
  }[]
}

interface CardExportRow {
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
  position: number
}

export async function exportFdeck(
  col: Collection,
  deckId: Id,
  includeProgress: boolean,
  port: MediaPort
): Promise<Uint8Array> {
  const ids = subtreeIds(col, deckId)
  const ph = placeholders(ids.length)
  const decks = col.all<{ id: string; parent_id: string | null; name: string }>(
    `SELECT id, parent_id, name FROM decks WHERE id IN (${ph})`,
    ids
  )
  const notes = col.all<{ id: string; deck_id: string; front: string; back: string; tags: string; created_at: number }>(
    `SELECT id, deck_id, front, back, tags, created_at FROM notes WHERE deck_id IN (${ph})`,
    ids
  )
  const cards = col.all<CardExportRow>(
    `SELECT c.* FROM cards c JOIN notes n ON n.id = c.note_id WHERE n.deck_id IN (${ph})`,
    ids
  )

  const data: FDeck = {
    version: FDECK_VERSION,
    app: 'flashcards',
    rootDeckId: deckId,
    decks: decks.map((d) => ({ id: d.id, parentId: d.id === deckId ? null : d.parent_id, name: d.name })),
    notes: notes.map((n) => ({
      id: n.id,
      deckId: n.deck_id,
      front: n.front,
      back: n.back,
      tags: decodeTags(n.tags),
      createdAt: n.created_at
    })),
    cards: cards.map((c) =>
      includeProgress
        ? {
            noteId: c.note_id,
            direction: c.direction,
            state: c.state,
            due: c.due,
            stability: c.stability,
            difficulty: c.difficulty,
            scheduledDays: c.scheduled_days,
            fsrs: c.fsrs,
            reps: c.reps,
            lapses: c.lapses,
            lastReview: c.last_review,
            position: c.position
          }
        : { noteId: c.note_id, direction: c.direction, position: c.position }
    )
  }
  const zip = new JSZip()
  zip.file('deck.json', JSON.stringify(data))
  const media = new Set(notes.flatMap((n) => [...referencedMedia(n.front), ...referencedMedia(n.back)]))
  for (const m of media) {
    const bytes = await port.read(m)
    if (bytes) zip.file(`media/${m}`, bytes)
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

export async function importFdeck(
  col: Collection,
  bytes: Uint8Array,
  parentId: Id | null,
  includeProgress: boolean,
  port: MediaPort
): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(bytes)
  const json = await zip.file('deck.json')?.async('string')
  if (!json) throw new Error('Not a valid .fdeck file (deck.json missing)')
  const data = JSON.parse(json) as FDeck
  if (data.app !== 'flashcards') throw new Error('Not a Flashcards deck file')

  // Copy media first (content-addressed names stay the same).
  for (const name of Object.keys(zip.files).filter((n) => n.startsWith('media/') && !zip.files[n].dir)) {
    const file = name.slice('media/'.length)
    if (/^[a-f0-9]{32}\.[a-z]+$/.test(file)) await port.write(file, await zip.file(name)!.async('uint8array'))
  }

  const res: ImportResult = { notes: 0, cards: 0, decksCreated: 0, skipped: 0 }
  if (parentId && !getDeck(col, parentId)) parentId = null
  col.tx(() => {
    const deckMap = new Map<string, string>()
    // Create decks parent-first.
    const pending = [...data.decks]
    let guard = 0
    while (pending.length && guard++ < 100_000) {
      const d = pending.shift()!
      const parent = d.parentId === null ? parentId : deckMap.get(d.parentId)
      if (d.parentId !== null && parent === undefined) {
        pending.push(d)
        continue
      }
      deckMap.set(d.id, createDeck(col, d.name, parent ?? null).id)
      res.decksCreated++
    }
    const noteMap = new Map<string, string>()
    const now = Date.now()
    for (const n of data.notes) {
      const deckId = deckMap.get(n.deckId)
      if (!deckId) {
        res.skipped++
        continue
      }
      const id = newId()
      col.run('INSERT INTO notes(id,deck_id,front,back,tags,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', [
        id,
        deckId,
        n.front,
        n.back,
        encodeTags(n.tags),
        n.createdAt ?? now,
        now
      ])
      noteMap.set(n.id, id)
      res.notes++
    }
    const basePos = (col.get<{ p: number | null }>('SELECT MAX(position) AS p FROM cards')?.p ?? 0) + 1
    for (const c of data.cards) {
      const noteId = noteMap.get(c.noteId)
      if (!noteId) continue
      const cardId = insertCard(col, noteId, c.direction, basePos + (c.position ?? 0), now)
      if (includeProgress && c.state !== undefined) {
        col.run(
          `UPDATE cards SET state=?, due=?, stability=?, difficulty=?, scheduled_days=?, fsrs=?, reps=?, lapses=?, last_review=? WHERE id=?`,
          [
            c.state,
            c.due ?? now,
            c.stability ?? 0,
            c.difficulty ?? 0,
            c.scheduledDays ?? 0,
            c.fsrs ?? null,
            c.reps ?? 0,
            c.lapses ?? 0,
            c.lastReview ?? null,
            cardId
          ]
        )
      }
      res.cards++
    }
  })
  return res
}

// ---------------- CSV export ----------------
const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`

export function exportCsv(col: Collection, deckId: Id): string {
  const ids = subtreeIds(col, deckId)
  const ph = placeholders(ids.length)
  const rows = col.all<{ deck_id: string; front: string; back: string; tags: string }>(
    `SELECT deck_id, front, back, tags FROM notes WHERE deck_id IN (${ph}) ORDER BY created_at`,
    ids
  )
  const paths = new Map<string, string>()
  const pathOf = (id: string): string => {
    if (!paths.has(id)) {
      const d = getDeck(col, id)
      paths.set(id, d?.parentId && ids.includes(d.parentId) ? `${pathOf(d.parentId)}::${d.name}` : (d?.name ?? ''))
    }
    return paths.get(id)!
  }
  const lines = ['front,back,deck,tags']
  for (const r of rows) lines.push([r.front, r.back, pathOf(r.deck_id), decodeTags(r.tags).join(' ')].map(csvCell).join(','))
  return '﻿' + lines.join('\r\n')
}
