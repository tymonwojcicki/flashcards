// Auto-update from GitHub Releases (installed NSIS build only; portable exe and dev are skipped).
import { app } from 'electron'
import electronUpdater from 'electron-updater'

export function initAutoUpdate(): void {
  if (!app.isPackaged || process.env['PORTABLE_EXECUTABLE_DIR']) return
  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', (e) => console.warn('[updater]', e?.message ?? e))
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((e) => console.warn('[updater]', e?.message ?? e))
  }, 5000)
}
