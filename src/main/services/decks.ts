import type { BaseCollection as Collection } from '../db/core'
import { DEFAULT_PRESET_ID, newId } from '../db/core'
import {
  DEFAULT_COLLECTION_SETTINGS,
  DEFAULT_PRESET_CONFIG,
  type CollectionSettings,
  type Deck,
  type DeckCounts,
  type DeckNode,
  type Id,
  type Preset,
  type PresetConfig
} from '../../shared/types'
import { dayStart, nextDayStart } from './time'
import { doneTodayByDeck, inheritedPreset, isAvailable, learnAheadMsOf, selectToday, SELECT_CANDIDATES, type Candidate } from './todaysQueue'
import { trashDeck } from './trash'

interface DeckRow {
  id: string
  parent_id: string | null
  name: string
  preset_id: string | null
  collapsed: number
  created_at: number
}

const toDeck = (r: DeckRow): Deck => ({
  id: r.id,
  parentId: r.parent_id,
  name: r.name,
  presetId: r.preset_id,
  collapsed: !!r.collapsed,
  createdAt: r.created_at
})

// ---------------- collection settings ----------------
export function getCollectionSettings(col: Collection): CollectionSettings {
  const raw = col.getMeta('settings')
  return { ...DEFAULT_COLLECTION_SETTINGS, ...(raw ? JSON.parse(raw) : {}) }
}

export function setCollectionSettings(col: Collection, patch: Partial<CollectionSettings>): CollectionSettings {
  const next = { ...getCollectionSettings(col), ...patch }
  col.setMeta('settings', JSON.stringify(next))
  return next
}

// ---------------- presets ----------------
const toPreset = (r: { id: string; name: string; config: string }): Preset => ({
  id: r.id,
  name: r.name,
  config: { ...DEFAULT_PRESET_CONFIG, ...JSON.parse(r.config) }
})

export function listPresets(col: Collection): Preset[] {
  return col
    .all<{ id: string; name: string; config: string }>('SELECT * FROM presets ORDER BY id = ? DESC, name', [
      DEFAULT_PRESET_ID
    ])
    .map(toPreset)
}

export function getPreset(col: Collection, id: Id): Preset | undefined {
  const r = col.get<{ id: string; name: string; config: string }>('SELECT * FROM presets WHERE id = ?', [id])
  return r && toPreset(r)
}

export function createPreset(col: Collection, name: string, config?: PresetConfig): Preset {
  const id = newId()
  col.run('INSERT INTO presets(id,name,config) VALUES (?,?,?)', [id, name, JSON.stringify(config ?? DEFAULT_PRESET_CONFIG)])
  return getPreset(col, id)!
}

export function updatePreset(col: Collection, id: Id, patch: { name?: string; config?: Partial<PresetConfig> }): Preset {
  const p = getPreset(col, id)
  if (!p) throw new Error('Preset not found')
  const config = { ...p.config, ...patch.config }
  col.run('UPDATE presets SET name = ?, config = ? WHERE id = ?', [patch.name ?? p.name, JSON.stringify(config), id])
  return getPreset(col, id)!
}

export function deletePreset(col: Collection, id: Id): void {
  if (id === DEFAULT_PRESET_ID) throw new Error('The default preset cannot be deleted')
  col.tx(() => {
    col.run('UPDATE decks SET preset_id = NULL WHERE preset_id = ?', [id])
    col.run('DELETE FROM presets WHERE id = ?', [id])
  })
}

// ---------------- decks ----------------
export function allDecks(col: Collection): Deck[] {
  return col.all<DeckRow>('SELECT * FROM decks ORDER BY name COLLATE NOCASE').map(toDeck)
}

export function getDeck(col: Collection, id: Id): Deck | undefined {
  const r = col.get<DeckRow>('SELECT * FROM decks WHERE id = ?', [id])
  return r && toDeck(r)
}

/** Ids of the deck and all its descendants. */
export function subtreeIds(col: Collection, id: Id): Id[] {
  return col
    .all<{ id: string }>(
      `WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT d.id FROM decks d JOIN t ON d.parent_id = t.id)
       SELECT id FROM t`,
      [id]
    )
    .map((r) => r.id)
}

export function deckPath(col: Collection, id: Id): string[] {
  const out: string[] = []
  let cur = getDeck(col, id)
  while (cur) {
    out.unshift(cur.name)
    cur = cur.parentId ? getDeck(col, cur.parentId) : undefined
  }
  return out
}

/** Resolve the effective preset by walking up the tree. */
export function resolvePreset(col: Collection, deckId: Id): Preset {
  const decks = new Map(allDecks(col).map((d) => [d.id, d]))
  return inheritedPreset(decks, new Map(listPresets(col).map((p) => [p.id, p])), deckId)
}

export function createDeck(col: Collection, name: string, parentId: Id | null): Deck {
  const clean = name.trim()
  if (!clean) throw new Error('Deck name cannot be empty')
  const id = newId()
  col.run('INSERT INTO decks(id,parent_id,name,preset_id,collapsed,created_at) VALUES (?,?,?,?,0,?)', [
    id,
    parentId,
    clean,
    null,
    Date.now()
  ])
  return getDeck(col, id)!
}

/** The deck-path rule: "A :: B::C" -> ["A", "B", "C"]. Parts are trimmed; empty parts are dropped. */
export function deckPathParts(pathStr: string): string[] {
  return pathStr
    .split('::')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** SQLite's NOCASE: folds ASCII letters only. */
const nocase = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase())

const findChild = (col: Collection, parent: Id | null, name: string): Id | undefined =>
  col.get<{ id: string }>(
    `SELECT id FROM decks WHERE name = ? COLLATE NOCASE AND ${parent ? 'parent_id = ?' : 'parent_id IS NULL'}`,
    parent ? [name, parent] : [name]
  )?.id

/** "A::B::C" -> deck id, creating missing decks. Existing decks match case-insensitively. Returns [id, createdCount]. */
export function ensureDeckPath(col: Collection, pathStr: string, rootParent: Id | null = null): [Id, number] {
  const parts = deckPathParts(pathStr)
  if (!parts.length) throw new Error('Empty deck path')
  let parent = rootParent
  let created = 0
  for (const name of parts) {
    const existing = findChild(col, parent, name)
    if (existing) parent = existing
    else {
      parent = createDeck(col, name, parent).id
      created++
    }
  }
  return [parent!, created]
}

/**
 * Dry run of ensureDeckPath from the top level: returns a function that says how many decks a
 * path would create, remembering the paths it has already counted. Reads only.
 */
export function deckPathPlanner(col: Collection): (pathStr: string) => number {
  const planned = new Set<string>()
  return (pathStr) => {
    const parts = deckPathParts(pathStr)
    if (!parts.length) throw new Error('Empty deck path')
    let parent: Id | null = null
    let missing = false
    let created = 0
    parts.forEach((name, i) => {
      const existing = missing ? undefined : findChild(col, parent, name)
      if (existing) return void (parent = existing)
      missing = true // below a missing deck everything is new
      const key = parts.slice(0, i + 1).map(nocase).join('::')
      if (!planned.has(key)) {
        planned.add(key)
        created++
      }
    })
    return created
  }
}

/**
 * Create a deck path ("A::B::C") under `parentId` in one transaction: all missing decks or none.
 * Expands collapsed ancestors so the deepest deck is visible. Returns its id.
 */
export function createDeckPath(col: Collection, pathStr: string, parentId: Id | null): Id {
  return col.tx(() => {
    const [id] = ensureDeckPath(col, pathStr, parentId)
    for (let cur = getDeck(col, id)?.parentId; cur; ) {
      const d = getDeck(col, cur)
      if (d?.collapsed) setDeckCollapsed(col, d.id, false)
      cur = d?.parentId
    }
    return id
  })
}

export function renameDeck(col: Collection, id: Id, name: string): void {
  if (!name.trim()) throw new Error('Deck name cannot be empty')
  col.run('UPDATE decks SET name = ? WHERE id = ?', [name.trim(), id])
}

export function moveDeck(col: Collection, id: Id, newParentId: Id | null): void {
  if (newParentId && subtreeIds(col, id).includes(newParentId)) throw new Error('Cannot move a deck inside itself')
  col.run('UPDATE decks SET parent_id = ? WHERE id = ?', [newParentId, id])
}

/** Moves the deck, its sub-decks and cards to the Trash. Returns the trash id (for Undo). */
export function deleteDeck(col: Collection, id: Id): string | null {
  return trashDeck(col, id)
}

export function setDeckCollapsed(col: Collection, id: Id, collapsed: boolean): void {
  col.run('UPDATE decks SET collapsed = ? WHERE id = ?', [collapsed ? 1 : 0, id])
}

export function setDeckPreset(col: Collection, id: Id, presetId: Id | null): void {
  col.run('UPDATE decks SET preset_id = ? WHERE id = ?', [presetId, id])
}

// ---------------- tree with counts ----------------
export function getDeckTree(col: Collection, now = Date.now()): DeckNode[] {
  const { dayStartHour, learnAheadMinutes } = getCollectionSettings(col)
  const dayEnd = nextDayStart(now, dayStartHour)
  const learnAheadMs = learnAheadMsOf(learnAheadMinutes)
  const decks = allDecks(col)

  const cardsByDeck = new Map<string, Candidate[]>()
  for (const c of col.all<Candidate>(SELECT_CANDIDATES)) {
    if (!cardsByDeck.has(c.deck_id)) cardsByDeck.set(c.deck_id, [])
    cardsByDeck.get(c.deck_id)!.push(c)
  }
  const doneByDeck = doneTodayByDeck(col, dayStart(now, dayStartHour))

  const byParent = new Map<string | null, Deck[]>()
  for (const d of decks) {
    const k = d.parentId
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(d)
  }
  const presets = new Map(listPresets(col).map((p) => [p.id, p]))
  const byId = new Map(decks.map((d) => [d.id, d]))

  // shortcut: re-runs the selection over each deck's whole subtree (cards x depth); fine to ~20k cards
  // and 100 decks, beyond that group rows by deck once and add the groups up the tree.
  type Subtree = { cards: Candidate[]; done: { new: number; review: number } }
  const build = (d: Deck, path: string[], depth: number): [DeckNode, Subtree] => {
    const kids = (byParent.get(d.id) ?? []).map((k) => build(k, [...path, d.name], depth + 1))
    const own = doneByDeck.get(d.id)
    const sub: Subtree = { cards: [...(cardsByDeck.get(d.id) ?? [])], done: { new: own?.new ?? 0, review: own?.review ?? 0 } }
    for (const [, k] of kids) {
      for (const c of k.cards) sub.cards.push(c)
      sub.done.new += k.done.new
      sub.done.review += k.done.review
    }
    const q = selectToday(sub.cards, { preset: inheritedPreset(byId, presets, d.id).config, done: sub.done, dayEnd, learnAheadMs, now })
    const counts: DeckCounts = {
      new: q.new.length,
      learning: q.learning.length,
      review: q.review.length,
      total: sub.cards.filter((c) => isAvailable(c, now)).length
    }
    return [{ ...d, path: [...path, d.name], depth, children: kids.map(([n]) => n), counts }, sub]
  }

  return (byParent.get(null) ?? []).map((d) => build(d, [], 0)[0])
}
