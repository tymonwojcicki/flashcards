import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Collection, DB_FILE, loadSqlJs } from '../db/collection'
import { DataFolderSession, HEARTBEAT_MS, BACKUP_EVERY_MS, LOCK_FILE, type DataStore } from './dataFolder'
import { NodeStore } from './nodeStore'
import { BACKUP_DIR, STALE_MS } from './backupCore'
import { MEDIA_DIR } from './mediaCore'
import * as decks from './decks'
import * as notes from './notes'
import * as study from './study'
import { Rating } from '../../shared/types'
import type { MainEvent } from '../../shared/api'

const WASM = path.resolve('node_modules/sql.js/dist/sql-wasm.wasm')
const ME = 'THIS-PC'

/** A DataStore the tests can look inside. */
interface TestStore extends DataStore {
  /** File names in a sub-folder. */
  names(dir: string): string[]
  lock(): { device: string; heartbeat: number; since: number } | null
  /** Another device writes the lock file. */
  setLock(device: string, heartbeat: number, since: number): void
}

/** A DataStore kept in memory. */
class MemoryStore implements TestStore {
  files = new Map<string, { bytes: Uint8Array; modified: number }>()
  constructor(
    public kind: 'folder' | 'browser' = 'folder',
    public label = 'Synced (folder)'
  ) {}
  async read(p: string) {
    return this.files.get(p)?.bytes ?? null
  }
  async write(p: string, b: Uint8Array | string) {
    this.files.set(p, { bytes: typeof b === 'string' ? new TextEncoder().encode(b) : b.slice(), modified: Date.now() })
  }
  async remove(p: string) {
    this.files.delete(p)
  }
  async exists(p: string) {
    return this.files.has(p)
  }
  async list(dir: string) {
    const prefix = dir ? `${dir}/` : ''
    return [...this.files]
      .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
      .map(([k, v]) => ({ name: k.slice(prefix.length), modified: v.modified, size: v.bytes.length }))
  }
  async modified(p: string) {
    return this.files.get(p)?.modified ?? null
  }
  names(dir: string) {
    return [...this.files.keys()].filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1))
  }
  lock() {
    const b = this.files.get(LOCK_FILE)?.bytes
    return b ? JSON.parse(new TextDecoder().decode(b)) : null
  }
  setLock(device: string, heartbeat: number, since: number) {
    void this.write(LOCK_FILE, JSON.stringify({ device, pid: 1, heartbeat, since }))
  }
}

/** The desktop app's store: a real folder on disk. */
class NodeTestStore extends NodeStore implements TestStore {
  constructor() {
    super(fs.mkdtempSync(path.join(os.tmpdir(), 'fc-folder-')))
  }
  names(dir: string) {
    const d = path.join(this.root, dir)
    return fs.existsSync(d) ? fs.readdirSync(d) : []
  }
  lock() {
    const f = path.join(this.root, LOCK_FILE)
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null
  }
  setLock(device: string, heartbeat: number, since: number) {
    fs.writeFileSync(path.join(this.root, LOCK_FILE), JSON.stringify({ device, pid: 1, heartbeat, since }))
  }
}

const ADAPTERS: { name: string; folder: (label?: string) => TestStore }[] = [
  { name: 'in-memory', folder: (label) => new MemoryStore('folder', label && `${label} (folder)`) },
  { name: 'Node file-system', folder: () => new NodeTestStore() }
]

let events: MainEvent[]
let session: DataFolderSession
const newSession = () =>
  new DataFolderSession({ sql: () => loadSqlJs(WASM), device: () => ME, emit: (e) => events.push(e) })

/** A collection made on another device, with one note "front". */
async function otherCollection(front: string): Promise<Uint8Array> {
  const c = await Collection.memory(WASM)
  const [d] = decks.ensureDeckPath(c, 'Other')
  notes.createNote(c, { deckId: d, front, back: 'b', tags: [], reverse: false })
  return c.exportBytes()
}
const fronts = () => session.col.all<{ front: string }>('SELECT front FROM notes').map((n) => n.front)

/** Answer one card so the undo stack has an entry. */
async function answerOne(): Promise<void> {
  const [d] = decks.ensureDeckPath(session.col, 'Mine')
  notes.createNote(session.col, { deckId: d, front: 'q', back: 'a', tags: [], reverse: false })
  const s = await study.getSession(session.col, d, 'mixed')
  await study.answer(session.col, s.cards[0].card.id, Rating.Good, 1000)
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 5, 1, 12) })
  events = []
  study.clearUndo()
  session = newSession()
})
afterEach(() => {
  session.dispose()
  vi.useRealTimers()
})

describe.each(ADAPTERS)('$name store', ({ folder }) => {
  describe('open', () => {
    it('with no lock: takes the lock, backs up, seeds the sample deck and stays writable', async () => {
      const store = folder()
      await session.open(store)
      expect(session.col.readOnly).toBe(false)
      expect(store.lock()).toMatchObject({ device: ME })
      expect(store.names(BACKUP_DIR)).toHaveLength(1)
      expect(decks.getDeckTree(session.col).map((d) => d.name)).toEqual(['Sample deck'])
      expect(await session.startupState()).toEqual({
        dataDir: store.label,
        lock: { kind: 'ok' },
        conflicts: [],
        readOnly: false
      })
    })

    it('in browser storage: no lock and no backups', async () => {
      const store = new MemoryStore('browser', 'This browser only')
      await session.open(store)
      expect(session.col.readOnly).toBe(false)
      expect(store.lock()).toBeNull()
      expect(await session.backup()).toBeNull()
      expect(store.names(BACKUP_DIR)).toEqual([])
      expect((await session.startupState()).dataDir).toBe('This browser only')
    })

    it('with a foreign lock: opens read-only and leaves the folder alone', async () => {
      const store = folder()
      await store.write(DB_FILE, await otherCollection('theirs'))
      const since = Date.now() - 5000
      store.setLock('OTHER-PC', Date.now(), since)
      await session.open(store)
      expect(session.col.readOnly).toBe(true)
      expect(session.lockStatus).toEqual({ kind: 'locked', device: 'OTHER-PC', since })
      expect(store.lock()).toMatchObject({ device: 'OTHER-PC' })
      expect(store.names(BACKUP_DIR)).toEqual([])
      expect(() => decks.createDeck(session.col, 'X', null)).toThrow(/read-only/)
    })

    it('with a foreign lock and no collection yet: checks the lock first and writes nothing', async () => {
      const store = folder()
      store.setLock('OTHER-PC', Date.now(), Date.now())
      await session.open(store)
      expect(session.col.readOnly).toBe(true)
      expect(await store.exists(DB_FILE)).toBe(false)
      await vi.advanceTimersByTimeAsync(BACKUP_EVERY_MS)
      expect(await store.exists(DB_FILE)).toBe(false)
    })

    it('takes over a stale foreign lock', async () => {
      const store = folder()
      store.setLock('OTHER-PC', Date.now() - STALE_MS - 1, Date.now() - STALE_MS - 1)
      await session.open(store)
      expect(session.col.readOnly).toBe(false)
      expect(store.lock()).toMatchObject({ device: ME })
    })

    it('finds the lock already lost at open: read-only, no backup', async () => {
      const store = folder()
      // Stale heartbeat, but taken after we start (clock ahead on the other PC).
      store.setLock('OTHER-PC', Date.now() - STALE_MS - 1, Date.now() + 60_000)
      await session.open(store)
      expect(session.col.readOnly).toBe(true)
      expect(session.lockStatus).toEqual({ kind: 'readonly', device: 'OTHER-PC' })
      expect(events).toContain('lock-lost')
      expect(store.names(BACKUP_DIR)).toEqual([])
    })
  })

  describe('locked by another device', () => {
    let store: TestStore
    beforeEach(async () => {
      store = folder()
      await store.write(DB_FILE, await otherCollection('old'))
      store.setLock('OTHER-PC', Date.now(), Date.now() - 1000)
      await session.open(store)
    })

    it('"Open anyway" picks up their latest changes, takes the lock and becomes writable', async () => {
      vi.advanceTimersByTime(5000)
      await store.write(DB_FILE, await otherCollection('newer'))
      const state = await session.forceUnlock()
      expect(state).toMatchObject({ lock: { kind: 'ok' }, readOnly: false })
      expect(fronts()).toEqual(['newer'])
      expect(store.lock()).toMatchObject({ device: ME })
      decks.createDeck(session.col, 'Mine', null)
    })

    it('"Open anyway" backs up their data before this device writes', async () => {
      expect(store.names(BACKUP_DIR)).toEqual([])
      await session.forceUnlock()
      const names = store.names(BACKUP_DIR)
      expect(names).toHaveLength(1)
      const backup = await Collection.memory(WASM)
      backup.restoreFrom((await store.read(`${BACKUP_DIR}/${names[0]}`))!)
      expect(backup.all<{ front: string }>('SELECT front FROM notes').map((n) => n.front)).toEqual(['old'])
    })

    it('"Open read-only" keeps their lock and stays read-only', async () => {
      const state = await session.openReadOnly()
      expect(state).toMatchObject({ lock: { kind: 'readonly', device: 'OTHER-PC' }, readOnly: true })
      vi.advanceTimersByTime(HEARTBEAT_MS * 2)
      expect(store.lock()).toMatchObject({ device: 'OTHER-PC' })
      session.release()
      expect(store.lock()).toMatchObject({ device: 'OTHER-PC' })
    })
  })

  describe('lock lost during use', () => {
    it('goes read-only, tells the app and stops the heartbeat', async () => {
      const store = folder()
      await session.open(store)
      vi.advanceTimersByTime(1000)
      store.setLock('OTHER-PC', Date.now(), Date.now())
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)
      expect(session.col.readOnly).toBe(true)
      expect(session.lockStatus).toEqual({ kind: 'readonly', device: 'OTHER-PC' })
      expect(events).toContain('lock-lost')
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 3)
      expect(store.lock()).toMatchObject({ device: 'OTHER-PC' })
      // Releasing must not delete the other device's lock.
      session.release()
      expect(store.lock()).toMatchObject({ device: 'OTHER-PC' })
    })

    it('keeps the heartbeat going while nobody else takes the lock', async () => {
      const store = folder()
      await session.open(store)
      const first = store.lock()!.heartbeat
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS)
      expect(store.lock()!.heartbeat).toBeGreaterThan(first)
      session.release()
      expect(store.lock()).toBeNull()
    })
  })

  describe('conflicts', () => {
    let store: TestStore
    beforeEach(async () => {
      store = folder()
      await session.open(store)
      await session.col.flush()
      vi.advanceTimersByTime(1000)
      await store.write('collection (1).db', await otherCollection('conflicted'))
    })

    it('lists conflict copies in the startup state', async () => {
      expect((await session.startupState()).conflicts).toMatchObject([{ file: 'collection (1).db' }])
    })

    it('"use" replaces the collection after a backup and clears undo', async () => {
      await answerOne()
      const before = store.names(BACKUP_DIR).length
      const state = await session.resolveConflict('collection (1).db', 'use')
      expect(fronts()).toEqual(['conflicted'])
      expect(state.conflicts).toEqual([])
      expect(store.names(BACKUP_DIR).some((n) => /^conflict-\d+-collection \(1\)\.db$/.test(n))).toBe(true)
      expect(store.names(BACKUP_DIR).filter((n) => n.startsWith('collection-')).length).toBe(before + 1)
      expect(study.undo(session.col)).toBeNull()
      expect(events).toContain('collection-reloaded')
    })

    it('"discard" keeps the collection and moves the copy into backups', async () => {
      await session.resolveConflict('collection (1).db', 'discard')
      expect(fronts()).not.toContain('conflicted')
      expect(await store.exists('collection (1).db')).toBe(false)
      expect(store.names(BACKUP_DIR).some((n) => n.startsWith('conflict-'))).toBe(true)
    })

    it('a copy that is already gone changes nothing', async () => {
      await store.remove('collection (1).db')
      const before = store.names(BACKUP_DIR)
      const state = await session.resolveConflict('collection (1).db', 'use')
      expect(state.conflicts).toEqual([])
      expect(fronts()).not.toContain('conflicted')
      expect(store.names(BACKUP_DIR)).toEqual(before)
      expect(events).not.toContain('collection-reloaded')
    })

    it('refuses a file that is not a conflict copy', async () => {
      await expect(session.resolveConflict('../elsewhere.db', 'use')).rejects.toThrow(/Not a conflict copy/)
      await expect(session.resolveConflict(LOCK_FILE, 'discard')).rejects.toThrow(/Not a conflict copy/)
      expect(store.lock()).toMatchObject({ device: ME })
    })
  })

  describe('switching folder', () => {
    it('copies the collection and media into an empty folder and moves the lock', async () => {
      const from = folder('Old')
      await session.open(from)
      decks.createDeck(session.col, 'Mine', null)
      await from.write(`${MEDIA_DIR}/a.png`, new Uint8Array([1, 2, 3]))
      await answerOne()
      const to = folder('New')
      const state = await session.switchTo(to)
      expect(state).toMatchObject({ dataDir: to.label, lock: { kind: 'ok' }, readOnly: false })
      expect(decks.getDeckTree(session.col).map((d) => d.name)).toContain('Mine')
      expect(await to.read(`${MEDIA_DIR}/a.png`)).toEqual(new Uint8Array([1, 2, 3]))
      expect(to.lock()).toMatchObject({ device: ME })
      expect(from.lock()).toBeNull()
      expect(study.undo(session.col)).toBeNull()
      expect(events).toContain('collection-reloaded')
    })

    it('opens the collection already in the target folder', async () => {
      await session.open(folder('Old'))
      const to = folder('New')
      await to.write(DB_FILE, await otherCollection('there'))
      await session.switchTo(to)
      expect(fronts()).toEqual(['there'])
    })
  })

  describe('backups', () => {
    it('prunes to the newest backups plus one per recent day', async () => {
      const store = folder()
      const old = Array.from({ length: 15 }, (_, i) => `collection-20250101-0000${String(i).padStart(2, '0')}.db`)
      for (const n of old) await store.write(`${BACKUP_DIR}/${n}`, 'x')
      await session.open(store) // backs up once
      const kept = store.names(BACKUP_DIR)
      expect(kept).toHaveLength(10)
      expect(kept).toContain('collection-20260601-120000.db')
      expect(kept).not.toContain(old[0])
      expect(kept).toContain(old[14])
    })

    it('backs up every 30 minutes while there are changes', async () => {
      const store = folder()
      await session.open(store)
      await vi.advanceTimersByTimeAsync(BACKUP_EVERY_MS)
      expect(store.names(BACKUP_DIR)).toHaveLength(1) // nothing changed
      decks.createDeck(session.col, 'Mine', null)
      await vi.advanceTimersByTimeAsync(BACKUP_EVERY_MS)
      expect(store.names(BACKUP_DIR)).toHaveLength(2)
    })
  })

  describe('contents changing underneath', () => {
    it('reloads changes synced from another device and clears undo', async () => {
      const store = folder()
      await session.open(store)
      await answerOne()
      await session.col.flush()
      vi.advanceTimersByTime(1000)
      await store.write(DB_FILE, await otherCollection('synced'))
      await session.checkExternalChanges()
      expect(fronts()).toEqual(['synced'])
      expect(study.undo(session.col)).toBeNull()
      expect(events).toContain('collection-reloaded')
    })

    it('ignores its own writes', async () => {
      const store = folder()
      await session.open(store)
      await answerOne()
      await session.col.flush()
      await session.checkExternalChanges()
      expect(events).not.toContain('collection-reloaded')
      expect(study.undo(session.col)).not.toBeNull()
    })

    it('restore makes a safety backup, replaces the collection and clears undo', async () => {
      const store = folder()
      await session.open(store)
      await answerOne()
      vi.advanceTimersByTime(1000) // backup names are per second
      const safety = vi.fn()
      await session.restore(await otherCollection('restored'), safety)
      expect(fronts()).toContain('restored')
      expect(store.names(BACKUP_DIR)).toHaveLength(2)
      expect(safety).not.toHaveBeenCalled()
      expect(study.undo(session.col)).toBeNull()
    })

    it('restore without a folder hands the current data to the safety copy', async () => {
      await session.open(new MemoryStore('browser', 'This browser only'))
      const safety = vi.fn()
      await session.restore(await otherCollection('restored'), safety)
      expect(safety).toHaveBeenCalledWith(expect.any(Uint8Array))
    })

    it('restore rejects a file that is not a backup, without touching anything', async () => {
      const store = folder()
      await session.open(store)
      const safety = vi.fn()
      await expect(session.restore(new Uint8Array(200), safety)).rejects.toThrow(/not a Flashcards backup/)
      expect(store.names(BACKUP_DIR)).toHaveLength(1)
    })
  })
})
