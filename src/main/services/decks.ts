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
  let cur = getDeck(col, deckId)
  while (cur) {
    if (cur.presetId) {
      const p = getPreset(col, cur.presetId)
      if (p) return p
    }
    cur = cur.parentId ? getDeck(col, cur.parentId) : undefined
  }
  return getPreset(col, DEFAULT_PRESET_ID)!
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

/** "A::B::C" -> deck id, creating missing decks. Returns [id, createdCount]. */
export function ensureDeckPath(col: Collection, pathStr: string, rootParent: Id | null = null): [Id, number] {
  const parts = pathStr
    .split('::')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!parts.length) throw new Error('Empty deck path')
  let parent = rootParent
  let created = 0
  for (const name of parts) {
    const existing = col.get<{ id: string }>(
      `SELECT id FROM decks WHERE name = ? COLLATE NOCASE AND ${parent ? 'parent_id = ?' : 'parent_id IS NULL'}`,
      parent ? [name, parent] : [name]
    )
    if (existing) parent = existing.id
    else {
      parent = createDeck(col, name, parent).id
      created++
    }
  }
  return [parent!, created]
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
interface RawCounts {
  new: number
  learning: number
  review: number
  total: number
  newDone: number
  reviewDone: number
}

export function getDeckTree(col: Collection, now = Date.now()): DeckNode[] {
  const settings = getCollectionSettings(col)
  const start = dayStart(now, settings.dayStartHour)
  const end = nextDayStart(now, settings.dayStartHour)
  const decks = allDecks(col)

  const raw = new Map<string, RawCounts>()
  const blank = (): RawCounts => ({ new: 0, learning: 0, review: 0, total: 0, newDone: 0, reviewDone: 0 })
  for (const r of col.all<{ deck_id: string; n: number; l: number; r: number; t: number }>(
    `SELECT n.deck_id,
       SUM(c.state = 0) AS n,
       SUM(c.state IN (1,3) AND c.due < ?) AS l,
       SUM(c.state = 2 AND c.due < ?) AS r,
       COUNT(*) AS t
     FROM cards c JOIN notes n ON n.id = c.note_id
     WHERE c.suspended = 0 AND (c.buried_until IS NULL OR c.buried_until <= ?)
     GROUP BY n.deck_id`,
    [end, end, now]
  )) {
    raw.set(r.deck_id, { ...blank(), new: r.n, learning: r.l, review: r.r, total: r.t })
  }
  for (const r of col.all<{ deck_id: string; nd: number; rd: number }>(
    `SELECT n.deck_id, SUM(l.state = 0) AS nd, SUM(l.state = 2) AS rd
     FROM review_log l JOIN cards c ON c.id = l.card_id JOIN notes n ON n.id = c.note_id
     WHERE l.ts >= ? GROUP BY n.deck_id`,
    [start]
  )) {
    const c = raw.get(r.deck_id) ?? blank()
    c.newDone = r.nd
    c.reviewDone = r.rd
    raw.set(r.deck_id, c)
  }

  const byParent = new Map<string | null, Deck[]>()
  for (const d of decks) {
    const k = d.parentId
    if (!byParent.has(k)) byParent.set(k, [])
    byParent.get(k)!.push(d)
  }

  // Resolve presets in memory (one query) instead of walking the tree with queries per deck.
  const presets = new Map(listPresets(col).map((p) => [p.id, p.config]))
  const byId = new Map(decks.map((d) => [d.id, d]))
  const presetFor = (id: string): PresetConfig => {
    for (let cur = byId.get(id); cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      const cfg = cur.presetId ? presets.get(cur.presetId) : undefined
      if (cfg) return cfg
    }
    return presets.get(DEFAULT_PRESET_ID)!
  }

  const build = (d: Deck, path: string[], depth: number): [DeckNode, RawCounts] => {
    const kids = (byParent.get(d.id) ?? []).map((k) => build(k, [...path, d.name], depth + 1))
    const sum = { ...(raw.get(d.id) ?? blank()) }
    for (const [, kc] of kids) {
      sum.new += kc.new
      sum.learning += kc.learning
      sum.review += kc.review
      sum.total += kc.total
      sum.newDone += kc.newDone
      sum.reviewDone += kc.reviewDone
    }
    const cfg = presetFor(d.id)
    const counts: DeckCounts = {
      new: Math.max(0, Math.min(sum.new, cfg.newPerDay - sum.newDone)),
      learning: sum.learning,
      review: Math.max(0, Math.min(sum.review, cfg.reviewsPerDay - sum.reviewDone)),
      total: sum.total
    }
    return [{ ...d, path: [...path, d.name], depth, children: kids.map(([n]) => n), counts }, sum]
  }

  return (byParent.get(null) ?? []).map((d) => build(d, [], 0)[0])
}
