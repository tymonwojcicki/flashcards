import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseCollection } from '../db/core'
import { Collection, loadSqlJs } from '../db/collection'
import * as decks from './decks'
import * as notes from './notes'
import { createSampleDeck } from './startup'
import { backupsToDelete, isConflictName, isForeignLock, safeFileName } from './backupCore'

const WASM = path.resolve('node_modules/sql.js/dist/sql-wasm.wasm')
let col: Collection

beforeEach(async () => {
  col = await Collection.memory(WASM)
})

const add = (deckId: string, front: string, tags: string[] = []) =>
  notes.createNote(col, { deckId, front, back: 'a', tags, reverse: false })

describe('browse search', () => {
  it('treats % and _ literally', () => {
    const d = decks.createDeck(col, 'D', null).id
    add(d, '100% sure', ['snake_case'])
    add(d, '100 sure', ['snakeXcase'])
    expect(notes.browse(col, { search: '100%' }).total).toBe(1)
    expect(notes.browse(col, { search: '_' }).total).toBe(1)
    expect(notes.browse(col, { tag: 'snake_case' }).total).toBe(1)
  })
})

describe('transactions and saving', () => {
  it('rolls a nested failure back to its savepoint only', () => {
    const d = decks.createDeck(col, 'D', null).id
    col.tx(() => {
      add(d, 'kept')
      expect(() =>
        col.tx(() => {
          add(d, 'dropped')
          throw new Error('boom')
        })
      ).toThrow('boom')
    })
    expect(notes.browse(col, {}).rows.map((r) => r.front)).toEqual(['kept'])
    // depth bookkeeping is intact: a new top-level transaction still works
    col.tx(() => add(d, 'later'))
    expect(notes.browse(col, {}).total).toBe(2)
  })

  it('keeps data pending when a save fails, and writes it on the next attempt', async () => {
    const SQL = await loadSqlJs(WASM)
    const written: number[] = []
    class Flaky extends BaseCollection {
      fail = true
      protected override saveDelay = 5
      protected override persist(bytes: Uint8Array): void {
        if (this.fail) throw new Error('disk locked')
        written.push(bytes.length)
      }
    }
    const c = new Flaky(SQL, '')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    c.setMeta('k', 'v')
    expect(() => c.saveNow()).toThrow('disk locked')
    expect(c.hasUnsavedChanges).toBe(true)
    c.fail = false
    c.saveNow()
    expect(c.hasUnsavedChanges).toBe(false)
    expect(written).toHaveLength(1)
    err.mockRestore()
  })
})

describe('presets and sample deck', () => {
  it('deletes a preset and detaches its decks together', () => {
    const p = decks.createPreset(col, 'Fast')
    const d = decks.createDeck(col, 'D', null).id
    decks.setDeckPreset(col, d, p.id)
    decks.deletePreset(col, p.id)
    expect(decks.getDeck(col, d)!.presetId).toBeNull()
  })

  it('resolves inherited presets in the deck tree', () => {
    const p = decks.createPreset(col, 'Small', { ...decks.getPreset(col, 'default')!.config, newPerDay: 1 })
    const [leaf] = decks.ensureDeckPath(col, 'A::B')
    const root = decks.getDeckTree(col)[0].id
    decks.setDeckPreset(col, root, p.id)
    add(leaf, 'x')
    add(leaf, 'y')
    expect(decks.getDeckTree(col)[0].children[0].counts.new).toBe(1)
  })

  it('keeps the LaTeX of the sample deck intact', () => {
    createSampleDeck(col)
    const html = notes.browse(col, { search: 'quadratic' }).rows[0].back
    expect(html).toContain(String.raw`\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`)
  })
})

describe('data folder rules', () => {
  it('keeps recent and daily backups, ignores other files', () => {
    const names = ['notes.txt']
    for (let i = 0; i < 15; i++) names.push(`collection-20260110-${100000 + i}.db`) // one busy day
    for (let d = 1; d <= 3; d++) names.push(`collection-2026010${d}-090000.db`, `collection-2026010${d}-080000.db`)
    const del = backupsToDelete(names)
    expect(del).not.toContain('notes.txt')
    // 10 newest of the busy day, plus the newest backup of each of the 3 older days
    expect(names.length - 1 - del.length).toBe(13)
    expect(del).toContain('collection-2026010' + 3 + '-080000.db')
    expect(del).not.toContain('collection-20260103-090000.db')
  })

  it('detects conflict copies and foreign locks', () => {
    expect(isConflictName('collection (1).db', 'collection.db')).toBe(true)
    expect(isConflictName('collection.db', 'collection.db')).toBe(false)
    const lock = { device: 'B', heartbeat: 1_000_000 }
    expect(isForeignLock(lock, 'A', 1_000_000 + 60_000)).toBe(true)
    expect(isForeignLock(lock, 'B', 1_000_000)).toBe(false)
    expect(isForeignLock(lock, 'A', 1_000_000 + 10 * 60_000)).toBe(false)
    expect(safeFileName('a/b:c')).toBe('a_b_c')
    expect(safeFileName('***')).toBe('_')
    expect(safeFileName('')).toBe('deck')
  })
})
