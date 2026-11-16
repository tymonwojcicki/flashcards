// Node side of the collection: loading sql.js from disk, and in-memory collections for tests.
// Saving to a data folder is the Data Folder Session's job (services/dataFolder.ts + services/nodeStore.ts).
import fs from 'node:fs'
import path from 'node:path'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { BaseCollection } from './core'

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

/** For tests: an in-memory collection, never saved. */
export class Collection extends BaseCollection {
  static async memory(wasmPath?: string): Promise<Collection> {
    return new Collection(await loadSqlJs(wasmPath), '')
  }
}
