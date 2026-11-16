import fs from 'node:fs'
import path from 'node:path'
import { DB_FILE } from '../db/collection'
import { BACKUP_DIR, backupsToDelete, isConflictName, stamp } from './backupCore'

export { BACKUP_DIR }

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

/** Keep the newest backups plus one per recent day (rules in backupCore). */
export function prune(dir: string): void {
  for (const f of backupsToDelete(fs.readdirSync(dir))) fs.rmSync(path.join(dir, f), { force: true })
}

/**
 * Cloud clients create conflicted copies like "collection-DESKTOP-1.db" or
 * "collection (1).db". List them so the user can choose.
 */
export function findConflicts(dataDir: string): { file: string; modified: number; size: number }[] {
  try {
    return fs
      .readdirSync(dataDir)
      .filter((f) => isConflictName(f, DB_FILE))
      .map((f) => {
        const st = fs.statSync(path.join(dataDir, f))
        return { file: f, modified: st.mtimeMs, size: st.size }
      })
  } catch {
    return []
  }
}
