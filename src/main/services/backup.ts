import fs from 'node:fs'
import path from 'node:path'
import { DB_FILE } from '../db/collection'

export const BACKUP_DIR = 'backups'
const KEEP_RECENT = 10
const KEEP_DAILY = 7

const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** Copy collection.db into backups/ and prune. Returns the backup path. */
export function backup(dataDir: string): string | null {
  const src = path.join(dataDir, DB_FILE)
  if (!fs.existsSync(src)) return null
  const dir = path.join(dataDir, BACKUP_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, `collection-${stamp()}.db`)
  fs.copyFileSync(src, out)
  prune(dir)
  return out
}

/** Keep the newest KEEP_RECENT backups plus the newest backup of each of the last KEEP_DAILY days. */
export function prune(dir: string): void {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^collection-\d{8}-\d{6}\.db$/.test(f))
    .sort()
    .reverse() // newest first
  const keep = new Set(files.slice(0, KEEP_RECENT))
  const days = new Set<string>()
  for (const f of files) {
    const day = f.slice(11, 19)
    if (!days.has(day) && days.size < KEEP_DAILY) {
      days.add(day)
      keep.add(f)
    }
  }
  for (const f of files) if (!keep.has(f)) fs.rmSync(path.join(dir, f), { force: true })
}

/**
 * Cloud clients create conflicted copies like "collection-DESKTOP-1.db" or
 * "collection (1).db". List them so the user can choose.
 */
export function findConflicts(dataDir: string): { file: string; modified: number; size: number }[] {
  try {
    return fs
      .readdirSync(dataDir)
      .filter((f) => f !== DB_FILE && /^collection.*\.db$/i.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(dataDir, f))
        return { file: f, modified: st.mtimeMs, size: st.size }
      })
  } catch {
    return []
  }
}
