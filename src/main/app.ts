// Owns the open collection, lock, prefs and data-folder lifecycle.
import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { Collection, DB_FILE } from './db/collection'
import { foreignLock, Lock } from './services/lock'
import { backup, BACKUP_DIR, findConflicts } from './services/backup'
import { PrefsStore } from './services/prefs'
import { MEDIA_DIR } from './services/media'
import { clearUndo } from './services/study'
import { onOpen } from './services/startup'
import type { LockStatus, StartupState } from '../shared/types'
import type { MainEvent } from '../shared/api'

const BACKUP_EVERY_MS = 30 * 60_000

class AppState {
  prefs!: PrefsStore
  col!: Collection
  lock: Lock | null = null
  lockStatus: LockStatus = { kind: 'ok' }
  private backupTimer: NodeJS.Timeout | null = null
  private changedSinceBackup = false

  get dataDir(): string {
    return this.prefs.get().dataDir ?? path.join(app.getPath('userData'), 'data')
  }

  async init(): Promise<void> {
    this.prefs = new PrefsStore(path.join(app.getPath('userData'), 'prefs.json'))
    await this.openDir(this.dataDir)
    this.backupTimer = setInterval(() => {
      if (this.changedSinceBackup && !this.col.readOnly) {
        this.col.saveNow()
        backup(this.col.dir)
        this.changedSinceBackup = false
      }
    }, BACKUP_EVERY_MS)
  }

  private async openDir(dir: string): Promise<void> {
    fs.mkdirSync(dir, { recursive: true })
    const foreign = foreignLock(dir)
    this.col = await Collection.open(dir)
    this.col.onChange = () => {
      this.changedSinceBackup = true
      this.emit('collection-changed')
    }
    clearUndo()
    if (foreign) {
      this.col.readOnly = true
      this.lockStatus = { kind: 'locked', device: foreign.device, since: foreign.since }
    } else {
      this.takeLock()
      backup(dir)
      onOpen(this.col)
    }
  }

  private takeLock(): void {
    this.lock?.release()
    this.lock = new Lock(this.col.dir)
    this.lock.acquire()
    this.col.readOnly = false
    this.lockStatus = { kind: 'ok' }
  }

  startupState(): StartupState {
    return {
      dataDir: this.col.dir,
      lock: this.lockStatus,
      conflicts: findConflicts(this.col.dir),
      readOnly: this.col.readOnly
    }
  }

  async forceUnlock(): Promise<StartupState> {
    if (this.col.changedOnDisk()) await this.col.reload()
    this.takeLock()
    backup(this.col.dir)
    return this.startupState()
  }

  openReadOnly(): StartupState {
    const device = this.lockStatus.kind === 'locked' ? this.lockStatus.device : 'another device'
    this.col.readOnly = true
    this.lockStatus = { kind: 'readonly', device }
    return this.startupState()
  }

  async resolveConflict(file: string, action: 'use' | 'discard'): Promise<StartupState> {
    const dir = this.col.dir
    const src = path.join(dir, path.basename(file))
    if (!fs.existsSync(src)) return this.startupState()
    const bdir = path.join(dir, BACKUP_DIR)
    fs.mkdirSync(bdir, { recursive: true })
    if (action === 'use') {
      this.col.saveNow()
      backup(dir)
      fs.copyFileSync(src, path.join(dir, DB_FILE))
      await this.col.reload()
      clearUndo()
    }
    fs.renameSync(src, path.join(bdir, `conflict-${Date.now()}-${path.basename(file)}`))
    this.emit('collection-reloaded')
    return this.startupState()
  }

  /** Switch to a new data folder. Copies current data if the target has no collection. */
  async switchDataDir(target: string): Promise<StartupState> {
    if (path.resolve(target) === path.resolve(this.col.dir)) return this.startupState()
    const hasCollection = fs.existsSync(path.join(target, DB_FILE))
    if (!this.col.readOnly) this.col.saveNow()
    if (!hasCollection) {
      fs.mkdirSync(target, { recursive: true })
      fs.copyFileSync(this.col.file, path.join(target, DB_FILE))
      const media = path.join(this.col.dir, MEDIA_DIR)
      if (fs.existsSync(media)) fs.cpSync(media, path.join(target, MEDIA_DIR), { recursive: true })
    }
    this.shutdown()
    this.prefs.set({ dataDir: target })
    await this.openDir(target)
    this.emit('collection-reloaded')
    return this.startupState()
  }

  /** Called when the window gains focus: pick up changes synced from another PC. */
  async checkExternalChanges(): Promise<void> {
    if (!this.col || this.col.hasUnsavedChanges || !this.col.changedOnDisk()) return
    await this.col.reload()
    clearUndo()
    this.emit('collection-reloaded')
  }

  emit(event: MainEvent): void {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('event', event)
  }

  shutdown(): void {
    try {
      if (!this.col.readOnly) this.col.saveNow()
      this.col.close()
    } catch (e) {
      console.error('Failed to save collection on shutdown', e)
    }
    this.lock?.release()
    this.lock = null
  }

  dispose(): void {
    if (this.backupTimer) clearInterval(this.backupTimer)
    this.shutdown()
  }
}

export const state = new AppState()
