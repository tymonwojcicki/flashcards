// Data Folder Session: owns the data folder's lifecycle on top of the storage seam (DataStore):
// opening a collection, the device lock and its heartbeat, going read-only when the lock is lost,
// backups, conflict files, startup state, switching folder and restore. Clears undo whenever the
// collection's contents change underneath it.
// IMPORTANT: no Node or DOM imports — shared by every platform.
import type { SqlJsStatic } from 'sql.js'
import { BaseCollection, DB_FILE } from '../db/core'
import { BACKUP_DIR, backupsToDelete, isConflictName, isForeignLock, isTakenOver, stamp } from './backupCore'
import { MEDIA_DIR } from './mediaCore'
import { clearUndo } from './study'
import { onOpen } from './startup'
import type { MainEvent } from '../../shared/api'
import type { LockStatus, StartupState } from '../../shared/types'

/** Paths are like "collection.db", "media/abc.png", "backups/x.db". */
export interface DataStore {
  /** Only a folder has a lock, backups and conflict files; browser storage has none of them. */
  kind: 'folder' | 'browser'
  label: string
  read(path: string): Promise<Uint8Array | null>
  write(path: string, bytes: Uint8Array | string): Promise<void>
  remove(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  /** File names directly inside a sub-folder ('' = root). */
  list(dir: string): Promise<{ name: string; modified: number; size: number }[]>
  modified(path: string): Promise<number | null>
}

export const LOCK_FILE = 'app.lock'
export const HEARTBEAT_MS = 60_000
export const BACKUP_EVERY_MS = 30 * 60_000

interface LockData {
  device: string
  pid: number
  heartbeat: number
  since: number
}

/** A collection saved to a DataStore. */
export class StoreCollection extends BaseCollection {
  protected override saveDelay = 250
  knownModified = 0
  private chain: Promise<void> = Promise.resolve()
  constructor(
    SQL: SqlJsStatic,
    public store: DataStore,
    bytes: Uint8Array | null
  ) {
    super(SQL, store.label, bytes)
  }

  protected override persist(bytes: Uint8Array): Promise<void> {
    // Serialise writes so an older snapshot never overwrites a newer one.
    // A failed write must not poison the chain (later saves would be skipped) and must stay pending.
    this.chain = this.chain
      .catch(() => {})
      .then(async () => {
        try {
          await this.store.write(DB_FILE, bytes)
          this.knownModified = (await this.store.modified(DB_FILE)) ?? Date.now()
        } catch (e) {
          console.error('[data folder] save failed', e)
          this.dirty = true // retried by the next change, or when the app is hidden / closed
        }
      })
    return this.chain
  }

  /** Resolves once every write started so far has finished. */
  settled(): Promise<void> {
    return this.chain
  }

  async flush(): Promise<void> {
    await this.saveNow()
    await this.chain
  }

  async changedOnDisk(): Promise<boolean> {
    const m = await this.store.modified(DB_FILE)
    return m !== null && Math.abs(m - this.knownModified) > 1
  }

  async reload(): Promise<void> {
    const bytes = await this.store.read(DB_FILE)
    if (bytes) this.replaceBytes(bytes)
    this.knownModified = (await this.store.modified(DB_FILE)) ?? 0
  }
}

export interface DataFolderOptions {
  sql: () => Promise<SqlJsStatic>
  /** This device's name, written into the lock. */
  device: () => string
  emit: (e: MainEvent) => void
}

export class DataFolderSession {
  col!: StoreCollection
  store!: DataStore
  lockStatus: LockStatus = { kind: 'ok' }
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private backupTimer: ReturnType<typeof setInterval> | null = null
  private changedSinceBackup = false

  constructor(private opts: DataFolderOptions) {}

  private get folder(): boolean {
    return this.store?.kind === 'folder'
  }

  /** Open the collection in `store`, taking the lock unless another device holds it. */
  async open(store: DataStore): Promise<void> {
    this.release()
    this.store = store
    clearUndo()
    const bytes = await store.read(DB_FILE)
    this.col = new StoreCollection(await this.opts.sql(), store, bytes)
    this.col.knownModified = (await store.modified(DB_FILE)) ?? 0
    if (!bytes) {
      this.col.markDirty()
      await this.col.flush()
    }
    this.col.onChange = () => {
      this.changedSinceBackup = true
      this.opts.emit('collection-changed')
    }
    const foreign = await this.foreignLock()
    if (foreign) {
      this.col.readOnly = true
      this.lockStatus = { kind: 'locked', device: foreign.device, since: foreign.since }
    } else {
      await this.takeLock()
      // takeLock may already have found a takeover and gone read-only.
      if (!this.col.readOnly) {
        await this.backup()
        onOpen(this.col)
        this.changedSinceBackup = false
      }
    }
    // Keep rolling backups while the app stays open.
    if (this.backupTimer) clearInterval(this.backupTimer)
    this.backupTimer = setInterval(() => {
      if (this.changedSinceBackup && !this.col.readOnly) {
        this.changedSinceBackup = false
        void this.backup()
      }
    }, BACKUP_EVERY_MS)
  }

  // ----- lock -----
  private async readLock(): Promise<LockData | null> {
    if (!this.folder) return null
    try {
      const raw = await this.store.read(LOCK_FILE)
      return raw ? (JSON.parse(new TextDecoder().decode(raw)) as LockData) : null
    } catch {
      return null
    }
  }

  private async foreignLock(): Promise<LockData | null> {
    const l = await this.readLock()
    return l && isForeignLock(l, this.opts.device()) ? l : null
  }

  private async takeLock(): Promise<void> {
    this.col.readOnly = false
    this.lockStatus = { kind: 'ok' }
    if (!this.folder) return
    const since = Date.now()
    const write = async (): Promise<boolean> => {
      const current = await this.readLock()
      if (current && isTakenOver(current, this.opts.device(), since)) {
        // Another device pressed "Open anyway": stop writing so we don't overwrite its changes.
        this.stopHeartbeat()
        this.col.readOnly = true
        this.lockStatus = { kind: 'readonly', device: current.device }
        this.opts.emit('lock-lost')
        return false
      }
      const data: LockData = { device: this.opts.device(), pid: 0, heartbeat: Date.now(), since }
      await this.store.write(LOCK_FILE, JSON.stringify(data)).catch(() => {})
      return true
    }
    if (await write()) this.heartbeat = setInterval(write, HEARTBEAT_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  /** Stop the heartbeat and remove our lock (if we hold it). */
  release(): void {
    this.stopHeartbeat()
    if (this.folder && this.col && !this.col.readOnly) void this.store.remove(LOCK_FILE)
  }

  /** Release the lock and stop every timer. */
  dispose(): void {
    this.release()
    if (this.backupTimer) clearInterval(this.backupTimer)
    this.backupTimer = null
  }

  /** "Open anyway": take the lock from the other device, picking up its latest changes first. */
  async forceUnlock(): Promise<StartupState> {
    if (await this.col.changedOnDisk()) await this.reload()
    await this.takeLock()
    return this.startupState()
  }

  /** "Open read-only": keep the other device's lock and don't write. */
  async openReadOnly(): Promise<StartupState> {
    const device = this.lockStatus.kind === 'locked' ? this.lockStatus.device : 'another device'
    this.col.readOnly = true
    this.lockStatus = { kind: 'readonly', device }
    return this.startupState()
  }

  // ----- backups (folder only) -----
  /** Copy the collection into backups/ and prune. Returns the backup path, or null without a folder. */
  async backup(): Promise<string | null> {
    if (!this.folder) return null
    await this.col.flush()
    const bytes = await this.store.read(DB_FILE)
    if (!bytes) return null
    const name = `${BACKUP_DIR}/collection-${stamp()}.db`
    await this.store.write(name, bytes)
    for (const f of backupsToDelete((await this.store.list(BACKUP_DIR)).map((f) => f.name))) {
      await this.store.remove(`${BACKUP_DIR}/${f}`)
    }
    return name
  }

  // ----- conflicts -----
  async conflicts(): Promise<StartupState['conflicts']> {
    if (!this.folder) return []
    return (await this.store.list(''))
      .filter((f) => isConflictName(f.name, DB_FILE))
      .map((f) => ({ file: f.name, modified: f.modified, size: f.size }))
  }

  /** "use" replaces the collection with the conflict copy (after a backup); either way the copy moves to backups/. */
  async resolveConflict(file: string, action: 'use' | 'discard'): Promise<StartupState> {
    const bytes = await this.store.read(file)
    if (bytes && action === 'use') {
      await this.backup()
      await this.store.write(DB_FILE, bytes)
      await this.reload()
    }
    if (bytes) await this.store.write(`${BACKUP_DIR}/conflict-${Date.now()}-${file}`, bytes)
    await this.store.remove(file)
    this.opts.emit('collection-reloaded')
    return this.startupState()
  }

  async startupState(): Promise<StartupState> {
    return {
      dataDir: this.folder ? `${this.store.label} (folder)` : 'This browser only',
      lock: this.lockStatus,
      conflicts: await this.conflicts(),
      readOnly: this.col.readOnly
    }
  }

  // ----- switching folder -----
  /** Switch to `target`. Copies the current collection and media there if it has no collection. */
  async switchTo(target: DataStore): Promise<StartupState> {
    if (!(await target.exists(DB_FILE))) {
      await this.col.flush()
      await target.write(DB_FILE, this.col.exportBytes())
      for (const f of await this.store.list(MEDIA_DIR)) {
        const b = await this.store.read(`${MEDIA_DIR}/${f.name}`)
        if (b) await target.write(`${MEDIA_DIR}/${f.name}`, b)
      }
    }
    await this.col.flush()
    await this.open(target)
    this.opts.emit('collection-reloaded')
    return this.startupState()
  }

  // ----- external changes, restore -----
  private async reload(): Promise<void> {
    await this.col.reload()
    clearUndo()
  }

  /** Pick up changes another device synced into the folder. */
  async checkExternalChanges(): Promise<void> {
    if (!this.col) return
    await this.col.settled() // our own in-flight write must not look like an external change
    if (this.col.hasUnsavedChanges || !(await this.col.changedOnDisk())) return
    await this.reload()
    this.opts.emit('collection-reloaded')
  }

  /**
   * Replace the collection with a validated backup. A safety backup of the current data is made first;
   * without a folder, `safetyCopy` gets the current bytes instead.
   */
  async restore(bytes: Uint8Array, safetyCopy: (current: Uint8Array) => void): Promise<void> {
    this.col.validateBytes(bytes)
    await this.col.flush()
    if (!(await this.backup())) safetyCopy(this.col.exportBytes())
    this.col.restoreFrom(bytes)
    await this.col.flush()
    clearUndo()
    onOpen(this.col)
  }
}
