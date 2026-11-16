// A simple lock file so two PCs don't edit the synced collection at the same time.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isForeignLock } from './backupCore'

export const LOCK_FILE = 'app.lock'
const HEARTBEAT_MS = 60_000

interface LockData {
  device: string
  pid: number
  heartbeat: number
  since: number
}

const device = (): string => os.hostname()

export function readLock(dir: string): LockData | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, LOCK_FILE), 'utf8')) as LockData
  } catch {
    return null
  }
}

/** Returns the foreign lock if another device holds a fresh lock, else null. */
export function foreignLock(dir: string, now = Date.now()): LockData | null {
  const l = readLock(dir)
  if (!l) return null
  // Same PC (e.g. after a crash) or a stale lock: safe to take over.
  return isForeignLock(l, device(), now) ? l : null
}

export class Lock {
  private timer: NodeJS.Timeout | null = null
  private since = Date.now()
  constructor(private dir: string) {}

  acquire(): void {
    this.since = Date.now()
    this.write()
    this.timer = setInterval(() => this.write(), HEARTBEAT_MS)
  }

  private write(): void {
    const data: LockData = { device: device(), pid: process.pid, heartbeat: Date.now(), since: this.since }
    try {
      fs.writeFileSync(path.join(this.dir, LOCK_FILE), JSON.stringify(data))
    } catch {
      /* folder may be temporarily unavailable */
    }
  }

  release(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const l = readLock(this.dir)
    if (l && l.device === device() && l.pid === process.pid) {
      try {
        fs.unlinkSync(path.join(this.dir, LOCK_FILE))
      } catch {
        /* ignore */
      }
    }
  }
}
