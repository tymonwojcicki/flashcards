// Platform-neutral collection core: in-memory SQLite (sql.js) + query helpers + dirty tracking.
// Persistence is supplied by subclasses (Node file system in Electron, File System Access / IndexedDB on the web).
// IMPORTANT: no Node or DOM imports in this file — it is shared by the Electron main process and the web build.
import type { Database, SqlJsStatic, SqlValue } from 'sql.js'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema'
import { DEFAULT_PRESET_CONFIG } from '../../shared/types'

export const DB_FILE = 'collection.db'
export const DEFAULT_PRESET_ID = 'default'

export const newId = (): string => globalThis.crypto.randomUUID()

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

  // ---------- query helpers ----------
  all<T = Row>(sql: string, params: SqlValue[] = []): T[] {
    const stmt = this.db.prepare(sql)
    try {
      stmt.bind(params)
      const out: T[] = []
      while (stmt.step()) out.push(stmt.getAsObject() as T)
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
    try {
      const r = fn()
      this.txDepth--
      this.db.run(this.txDepth === 0 ? 'COMMIT' : `RELEASE ${sp}`)
      return r
    } catch (e) {
      this.txDepth--
      this.db.run(this.txDepth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`)
      throw e
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
    this.saveTimer = setTimeout(() => void this.saveNow(), this.saveDelay)
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
    return this.persist(this.exportBytes())
  }

  get hasUnsavedChanges(): boolean {
    return this.dirty
  }
}
