// Node file-system DataStore (Electron main process): a data folder on disk.
// Operations are synchronous inside async methods, so a call made while quitting (e.g. removing the lock)
// has finished before the promise is even returned.
// Whole-file atomic writes (tmp + rename) are friendly to OneDrive/Dropbox,
// unlike SQLite journal/WAL files which cloud clients can corrupt.
import fs from 'node:fs'
import path from 'node:path'
import type { DataStore } from './dataFolder'

export class NodeStore implements DataStore {
  kind = 'folder' as const
  constructor(readonly root: string) {}
  /** The folder's full path (also the collection's `dir`, used for media paths). */
  get label(): string {
    return this.root
  }

  private abs(p: string): string {
    return path.join(this.root, ...p.split('/'))
  }

  async read(p: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(fs.readFileSync(this.abs(p)))
    } catch {
      return null
    }
  }

  async write(p: string, bytes: Uint8Array | string): Promise<void> {
    const file = this.abs(p)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, bytes)
    fs.renameSync(tmp, file) // atomic replace on NTFS
  }

  async remove(p: string): Promise<void> {
    fs.rmSync(this.abs(p), { force: true })
  }

  async exists(p: string): Promise<boolean> {
    return fs.existsSync(this.abs(p))
  }

  async list(dir: string): Promise<{ name: string; modified: number; size: number }[]> {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(this.abs(dir), { withFileTypes: true })
    } catch {
      return []
    }
    return entries
      .filter((e) => e.isFile())
      .map((e) => {
        const st = fs.statSync(path.join(this.abs(dir), e.name))
        return { name: e.name, modified: st.mtimeMs, size: st.size }
      })
  }

  async modified(p: string): Promise<number | null> {
    try {
      return fs.statSync(this.abs(p)).mtimeMs
    } catch {
      return null
    }
  }
}
