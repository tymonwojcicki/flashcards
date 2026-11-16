// Platform-neutral rules shared by the Electron (fs) and web (File System Access) data folders:
// backup naming/retention, conflict-copy detection, lock staleness and file-name cleanup.
// IMPORTANT: no Node or DOM imports.
export const BACKUP_DIR = 'backups'
export const KEEP_RECENT = 10
export const KEEP_DAILY = 7
/** A lock older than this is considered stale (device crashed or went offline). */
export const STALE_MS = 3 * 60_000

const BACKUP_NAME = /^collection-\d{8}-\d{6}\.db$/

/** Local YYYYMMDD-HHMMSS, used in backup file names. */
export const stamp = (d = new Date()): string => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** Which of the given files to delete: keep the newest KEEP_RECENT plus the newest of each of the last KEEP_DAILY days. */
export function backupsToDelete(names: string[]): string[] {
  const files = names.filter((f) => BACKUP_NAME.test(f)).sort().reverse() // newest first
  const keep = new Set(files.slice(0, KEEP_RECENT))
  const days = new Set<string>()
  for (const f of files) {
    const day = f.slice(11, 19)
    if (!days.has(day) && days.size < KEEP_DAILY) {
      days.add(day)
      keep.add(f)
    }
  }
  return files.filter((f) => !keep.has(f))
}

/** Cloud clients create conflicted copies like "collection-DESKTOP-1.db" or "collection (1).db". */
export const isConflictName = (name: string, dbFile: string): boolean => name !== dbFile && /^collection.*\.db$/i.test(name)

/** True if `lock` is a fresh lock held by a device other than `thisDevice`. */
export const isForeignLock = (lock: { device: string; heartbeat: number }, thisDevice: string, now = Date.now()): boolean =>
  lock.device !== thisDevice && now - lock.heartbeat <= STALE_MS

/** Another device took the lock after we did (e.g. "Open anyway"), so we must stop writing. */
export const isTakenOver = (lock: { device: string; since: number } | null, thisDevice: string, mySince: number): boolean =>
  !!lock && lock.device !== thisDevice && lock.since > mySince

/** Make a string safe to use as a file name. */
export const safeFileName = (s: string): string => s.replace(/[<>:"/\|?*]+/g, '_').slice(0, 80) || 'deck'
