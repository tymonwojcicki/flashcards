// Node/Electron persistence: debounced, atomic whole-file saves.
// Whole-file atomic writes (tmp + rename) are friendly to OneDrive/Dropbox,
// unlike SQLite journal/WAL files which cloud clients can corrupt.
import fs from 'node:fs'
import path from 'node:path'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { BaseCollection, DB_FILE } from './core'

export { DB_FILE, DEFAULT_PRESET_ID, newId } from './core'

let SQL: SqlJsStatic | null = null

function locateWasm(): string {
  // sql.js main entry is dist/sql-wasm.js; the wasm sits next to it.
  const p = path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm')
  const unpacked = p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
  return fs.existsSync(unpacked) ? unpacked : p
}

export async function loadSqlJs(wasmPath?: string): Promise<SqlJsStatic> {
  if (!SQL) {
    const wasmBinary = fs.readFileSync(wasmPath ?? locateWasm())
    SQL = await initSqlJs({ wasmBinary: wasmBinary as unknown as ArrayBuffer })
  }
  return SQL
}

export class Collection extends BaseCollection {
  /** mtime of the file as we last wrote/read it, to detect external changes. */
  private knownMtime = 0
  private memoryOnly = false

  get file(): string {
    return path.join(this.dir, DB_FILE)
  }

  static async open(dir: string): Promise<Collection> {
    const SQL = await loadSqlJs()
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, DB_FILE)
    const exists = fs.existsSync(file)
    const c = new Collection(SQL, dir, exists ? fs.readFileSync(file) : null)
    if (exists) c.knownMtime = fs.statSync(file).mtimeMs
    else {
      c.dirty = true
      c.saveNow()
    }
    return c
  }

  /** For tests: in-memory collection, never saved. */
  static async memory(wasmPath?: string): Promise<Collection> {
    const c = new Collection(await loadSqlJs(wasmPath), '')
    c.memoryOnly = true
    return c
  }

  protected override persist(bytes: Uint8Array): void {
    if (this.memoryOnly) return
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, bytes)
    fs.renameSync(tmp, this.file) // atomic replace on NTFS
    this.knownMtime = fs.statSync(this.file).mtimeMs
  }

  /** Force a write even if nothing changed (used before backups / folder moves). */
  override saveNow(): void {
    if (!this.memoryOnly && !this.readOnly && !fs.existsSync(this.file)) this.dirty = true
    void super.saveNow()
  }

  /** True if the file on disk was modified by someone else (e.g. a sync client) since we last read/wrote it. */
  changedOnDisk(): boolean {
    try {
      return Math.abs(fs.statSync(this.file).mtimeMs - this.knownMtime) > 1 // older mtimes count too: a sync client may restore a file
    } catch {
      return false
    }
  }

  /** Reload from disk, discarding the in-memory copy. */
  async reload(): Promise<void> {
    this.replaceBytes(fs.readFileSync(this.file))
    this.knownMtime = fs.statSync(this.file).mtimeMs
  }

  close(): void {
    this.saveNow()
    this.db.close()
  }
}
