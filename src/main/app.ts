// Desktop app state: per-device prefs and the Data Folder Session on a folder on disk.
// The data folder's lifecycle (lock, backups, conflicts, switching) lives in the session.
import os from 'node:os'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { loadSqlJs } from './db/collection'
import { DataFolderSession } from './services/dataFolder'
import { NodeStore } from './services/nodeStore'
import { PrefsStore } from './services/prefs'
import type { StartupState } from '../shared/types'
import type { MainEvent } from '../shared/api'

class AppState {
  prefs!: PrefsStore
  readonly session = new DataFolderSession({
    sql: () => loadSqlJs(),
    device: () => os.hostname(),
    emit: (e) => this.emit(e)
  })

  get col() {
    return this.session.col
  }

  get dataDir(): string {
    return this.prefs.get().dataDir ?? path.join(app.getPath('userData'), 'data')
  }

  async init(): Promise<void> {
    this.prefs = new PrefsStore(path.join(app.getPath('userData'), 'prefs.json'))
    await this.session.open(new NodeStore(this.dataDir))
  }

  /** Switch to a new data folder. Copies current data if the target has no collection. */
  async switchDataDir(target: string): Promise<StartupState> {
    if (path.resolve(target) === path.resolve(this.col.dir)) return this.session.startupState()
    const state = await this.session.switchTo(new NodeStore(target))
    this.prefs.set({ dataDir: target })
    return state
  }

  emit(event: MainEvent): void {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('event', event)
  }

  /** Save pending changes, release the lock and stop every timer. */
  async dispose(): Promise<void> {
    try {
      await this.col?.flush()
    } catch (e) {
      console.error('Failed to save collection on shutdown', e)
    }
    await this.session.dispose()
  }
}

export const state = new AppState()
