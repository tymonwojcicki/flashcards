import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { Collection } from '../db/collection'
import * as decks from './decks'
import * as notes from './notes'
import * as study from './study'
import * as trash from './trash'
import { autoBackupDue, onOpen } from './startup'
import { Rating } from '../../shared/types'

const WASM = path.resolve('node_modules/sql.js/dist/sql-wasm.wasm')
let col: Collection
beforeEach(async () => {
  col = await Collection.memory(WASM)
})

const count = (table: string) => col.get<{ n: number }>(`SELECT COUNT(*) n FROM ${table}`)!.n

describe('trash', () => {
  it('restores a deck subtree with notes and review history', async () => {
    const [leaf] = decks.ensureDeckPath(col, 'Economics::Micro')
    const n = notes.createNote(col, { deckId: leaf, front: 'q', back: 'a', tags: ['t'], reverse: true })
    const card = col.get<{ id: string }>('SELECT id FROM cards WHERE note_id = ?', [n.id])!.id
    await study.answer(col, card, Rating.Good, 1000)
    const before = { decks: count('decks'), notes: count('notes'), cards: count('cards'), log: count('review_log') }
    expect(before.log).toBe(1)

    const root = decks.getDeckTree(col)[0].id
    const tid = decks.deleteDeck(col, root)!
    expect([count('decks'), count('notes'), count('cards'), count('review_log')]).toEqual([0, 0, 0, 0])
    expect(trash.listTrash(col)).toMatchObject([{ id: tid, kind: 'deck', label: 'Deck "Economics"', cardCount: 2 }])

    trash.restoreTrash(col, tid)
    expect({ decks: count('decks'), notes: count('notes'), cards: count('cards'), log: count('review_log') }).toEqual(before)
    expect(trash.listTrash(col)).toHaveLength(0)
    const back = notes.getNote(col, n.id)!
    expect(back.tags).toEqual(['t'])
    expect(decks.deckPath(col, back.deckId)).toEqual(['Economics', 'Micro'])
    const stats = col.get<{ reps: number }>('SELECT reps FROM cards WHERE id = ?', [card])!
    expect(stats.reps).toBe(1)
  })

  it('restores notes, recreating a deleted deck', () => {
    const [d] = decks.ensureDeckPath(col, 'A::B')
    const keep = notes.createNote(col, { deckId: d, front: 'keep', back: 'x', tags: [], reverse: false })
    const gone = notes.createNote(col, { deckId: d, front: 'gone', back: 'x', tags: [], reverse: true })
    const tid = notes.deleteNotes(col, [gone.id])!
    expect(trash.listTrash(col)[0].label).toBe('2 cards')
    expect(notes.getNote(col, keep.id)).not.toBeNull()
    decks.deleteDeck(col, decks.getDeckTree(col)[0].id)
    trash.restoreTrash(col, tid)
    const n = notes.getNote(col, gone.id)!
    expect(decks.deckPath(col, n.deckId)).toEqual(['A', 'B'])
    expect(count('cards')).toBe(2)
  })

  it('attaches to the nearest surviving ancestor and renames on collision', () => {
    const [leaf] = decks.ensureDeckPath(col, 'A::B::C')
    const [b] = decks.ensureDeckPath(col, 'A::B')
    const tid = decks.deleteDeck(col, leaf)!
    const a = decks.getDeckTree(col)[0].id
    decks.deleteDeck(col, b) // B removed too
    decks.createDeck(col, 'C', a) // collides at the new location
    trash.restoreTrash(col, tid)
    const names = decks.allDecks(col).map((d) => d.name).sort()
    expect(names).toContain('C (restored)')
    expect(decks.getDeck(col, leaf)!.parentId).toBe(a)
  })

  it('delete forever, empty and 30-day purge', () => {
    const [d] = decks.ensureDeckPath(col, 'X')
    const mk = (t: number) => {
      const n = notes.createNote(col, { deckId: d, front: 'q', back: 'a', tags: [], reverse: false })
      return trash.trashNotes(col, [n.id], t)!
    }
    const now = Date.now()
    const old = mk(now - 31 * 86_400_000)
    const fresh = mk(now - 29 * 86_400_000)
    expect(trash.purgeTrash(col, now)).toBe(1)
    expect(trash.listTrash(col).map((t) => t.id)).toEqual([fresh])
    expect(() => trash.restoreTrash(col, old)).toThrow()
    trash.deleteTrashForever(col, fresh)
    expect(trash.listTrash(col)).toHaveLength(0)
    mk(now)
    trash.emptyTrash(col)
    expect(trash.listTrash(col)).toHaveLength(0)
  })
})

describe('sample deck', () => {
  it('is created once for an empty collection', () => {
    onOpen(col)
    const names = decks.allDecks(col).map((d) => d.name).sort()
    expect(names).toEqual(['Basics', 'Math', 'Sample deck'])
    expect(count('notes')).toBe(9)
    // user deletes it: not seeded again
    decks.deleteDeck(col, decks.getDeckTree(col)[0].id)
    onOpen(col)
    expect(count('decks')).toBe(0)
  })

  it('is never created for an existing collection', () => {
    decks.createDeck(col, 'Mine', null)
    onOpen(col)
    expect(decks.allDecks(col).map((d) => d.name)).toEqual(['Mine'])
    expect(col.getMeta('sample_seeded')).toBe('1')
  })
})

describe('automatic backup downloads', () => {
  it('is due after 7 days only when there are notes and it is enabled', () => {
    const [d] = decks.ensureDeckPath(col, 'X')
    const t0 = Date.now()
    expect(autoBackupDue(col, t0)).toBe(false) // no notes
    notes.createNote(col, { deckId: d, front: 'q', back: 'a', tags: [], reverse: false })
    expect(autoBackupDue(col, t0)).toBe(false) // first run records a start time
    expect(autoBackupDue(col, t0 + 6 * 86_400_000)).toBe(false)
    expect(autoBackupDue(col, t0 + 7 * 86_400_000)).toBe(true)
    expect(autoBackupDue(col, t0 + 8 * 86_400_000)).toBe(false)
    col.setMeta('auto_backup_off', '1')
    expect(autoBackupDue(col, t0 + 30 * 86_400_000)).toBe(false)
  })

  it('validates and restores backup bytes', () => {
    decks.createDeck(col, 'Old', null)
    const bytes = col.exportBytes()
    decks.createDeck(col, 'New', null)
    expect(() => col.validateBytes(new Uint8Array(200))).toThrow('not a Flashcards backup')
    col.restoreFrom(bytes)
    expect(decks.allDecks(col).map((d) => d.name)).toEqual(['Old'])
  })
})
