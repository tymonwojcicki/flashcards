// Platform-neutral collection core: in-memory SQLite (sql.js) + query helpers + dirty tracking.
// Persistence is supplied by subclasses (Node file system in Electron, File System Access / IndexedDB on the web).
// IMPORTANT: no Node or DOM imports in this file — it is shared by the Electron main process and the web build.
import type { Database, SqlJsStatic, SqlValue } from 'sql.js'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema'
import { DEFAULT_PRESET_CONFIG } from '../../shared/types'

export const DB_FILE = 'collection.db'
export const DEFAULT_PRESET_ID = 'default'

export const newId = (): string => globalThis.crypto.randomUUID()

/** "?,?,?" for an IN (...) list of n values. */
export const placeholders = (n: number): string => Array(n).fill('?').join(',')

type Row = Record<string, SqlValue>

export class BaseCollection {
  db: Database
  /** Folder (Electron) or a display label (web). Used for media paths in Electron only. */
  dir: string
  readOnly = false
  onChange: (() => void) | null = null
  protected dirty = false
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private txDepth = 0
  /** Debounce before writing to storage. */
  protected saveDelay = 800

  constructor(
    protected SQL: SqlJsStatic,
    dir: string,
    bytes?: Uint8Array | null
  ) {
    this.dir = dir
    this.db = bytes ? new SQL.Database(bytes) : new SQL.Database()
    this.migrate()
  }

  protected migrate(): void {
    this.db.run('PRAGMA foreign_keys = ON;')
    this.db.exec(SCHEMA_SQL)
    const v = this.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', ['schema_version'])
    if (!v) {
      this.db.run('INSERT INTO meta(key,value) VALUES (?,?)', ['schema_version', String(SCHEMA_VERSION)])
      this.db.run('INSERT INTO meta(key,value) VALUES (?,?)', ['created', String(Date.now())])
    }
    if (!this.get('SELECT id FROM presets WHERE id = ?', [DEFAULT_PRESET_ID])) {
      this.db.run('INSERT INTO presets(id,name,config) VALUES (?,?,?)', [
        DEFAULT_PRESET_ID,
        'Default',
        JSON.stringify(DEFAULT_PRESET_CONFIG)
      ])
    }
    // future migrations: if (Number(v.value) < 2) {...}
  }

  /** Replace the in-memory database with new bytes (e.g. after a sync client updated the file). */
  protected replaceBytes(bytes: Uint8Array): void {
    const old = this.db
    this.db = new this.SQL.Database(bytes)
    old.close()
    this.migrate()
    this.dirty = false
  }

  /** Throws unless `bytes` is a Flashcards collection (SQLite file with the required tables). */
  validateBytes(bytes: Uint8Array): void {
    const bad = new Error('This file is not a Flashcards backup.')
    const header = 'SQLite format 3\u0000'
    if (bytes.length < 100 || [...header].some((ch, i) => bytes[i] !== ch.charCodeAt(0))) throw bad
    let probe: Database | null = null
    try {
      probe = new this.SQL.Database(bytes)
      const names = new Set(
        (probe.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values ?? []).map((r) => String(r[0]))
      )
      for (const t of ['meta', 'presets', 'decks', 'notes', 'cards', 'review_log']) if (!names.has(t)) throw bad
    } catch {
      throw bad
    } finally {
      probe?.close()
    }
  }

  /** Replace everything with a validated backup and queue it for saving. */
  restoreFrom(bytes: Uint8Array): void {
    this.assertWritable()
    this.validateBytes(bytes)
    this.replaceBytes(bytes)
    this.markDirty()
  }

  // ---------- query helpers ----------
  all<T = Row>(sql: string, params: SqlValue[] = []): T[] {
    const stmt = this.db.prepare(sql)
    try {
      stmt.bind(params)
      const out: T[] = []
      // Same objects as getAsObject(), which re-reads the column names on every row (2.5x slower on 20k rows).
      const cols = stmt.getColumnNames()
      while (stmt.step()) {
        const v = stmt.get()
        const o: Row = {}
        for (let i = 0; i < cols.length; i++) o[cols[i]] = v[i]
        out.push(o as T)
      }
      return out
    } finally {
      stmt.free()
    }
  }

  get<T = Row>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.all<T>(sql, params)[0]
  }

  /** Execute a write. Marks the collection dirty. */
  run(sql: string, params: SqlValue[] = []): void {
    this.assertWritable()
    this.db.run(sql, params)
    this.markDirty()
  }

  /** Run fn in a transaction. Nested calls use savepoints. */
  tx<T>(fn: () => T): T {
    this.assertWritable()
    const sp = `sp${this.txDepth}`
    this.db.run(this.txDepth === 0 ? 'BEGIN' : `SAVEPOINT ${sp}`)
    this.txDepth++
    const outer = this.txDepth === 1
    try {
      const r = fn()
      this.db.run(outer ? 'COMMIT' : `RELEASE ${sp}`)
      return r
    } catch (e) {
      this.db.run(outer ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`)
      throw e
    } finally {
      this.txDepth--
    }
  }

  getMeta(key: string): string | undefined {
    return this.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])?.value
  }

  setMeta(key: string, value: string): void {
    this.run('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
      key,
      value
    ])
  }

  protected assertWritable(): void {
    if (this.readOnly) throw new Error('The collection is open read-only (it is in use on another device).')
  }

  // ---------- persistence ----------
  /** Serialise the database. */
  exportBytes(): Uint8Array {
    const data = this.db.export()
    // db.export() can reset pragmas on some sql.js versions; re-enable FK enforcement.
    this.db.run('PRAGMA foreign_keys = ON;')
    return data
  }

  markDirty(): void {
    this.dirty = true
    this.onChange?.()
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.autoSave(), this.saveDelay)
  }

  /** Timer-driven save: a failed write (cloud folder locked, disk full) is retried, never thrown into the event loop. */
  private autoSave(): void {
    const retry = (e: unknown): void => {
      console.error('[collection] save failed, will retry', e)
      this.dirty = true
      if (!this.saveTimer) this.saveTimer = setTimeout(() => this.autoSave(), 5000)
    }
    try {
      void Promise.resolve(this.saveNow()).catch(retry)
    } catch (e) {
      retry(e)
    }
  }

  /** Subclasses persist `exportBytes()`. */
  protected persist(_bytes: Uint8Array): void | Promise<void> {}

  saveNow(): void | Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.readOnly || !this.dirty) return
    this.dirty = false
    try {
      return this.persist(this.exportBytes())
    } catch (e) {
      this.dirty = true // not written: keep it pending
      throw e
    }
  }

  get hasUnsavedChanges(): boolean {
    return this.dirty
  }
}
