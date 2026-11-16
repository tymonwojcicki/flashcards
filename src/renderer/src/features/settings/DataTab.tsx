import { useEffect, useState } from 'react'
import { AlertTriangle, Cloud, DatabaseBackup, FolderOpen, FolderSync, Upload } from 'lucide-react'
import { Button, Panel, Switch, Well, confirm, toast, toastError } from '@renderer/components/ui'
import { useApp } from '@renderer/store/app'
import { UsagePanel } from './UsagePanel'

/** Running inside the Electron desktop app (not the web/PWA build). */
const IS_DESKTOP = /\bElectron\//.test(navigator.userAgent)
import { TrashPanel } from './TrashPanel'
import { SettingRow } from './common'
import type { AutoBackupState } from '@shared/dataSafety'

export function DataTab(): React.JSX.Element {
  const startup = useApp((s) => s.startup)
  const [busy, setBusy] = useState(false)
  const noFolders = !('showDirectoryPicker' in window)
  const [auto, setAuto] = useState<AutoBackupState | null>(null)
  useEffect(() => {
    window.api.getAutoBackup().then(setAuto, () => {})
  }, [])

  const setAutoEnabled = async (enabled: boolean): Promise<void> => {
    setAuto((a) => (a ? { ...a, enabled } : a))
    try {
      await window.api.setAutoBackup(enabled)
    } catch (e) {
      toastError(e, 'Could not save setting')
    }
  }

  const restore = async (): Promise<void> => {
    setBusy(true)
    try {
      const name = await window.api.pickBackup()
      if (!name) return
      const ok = await confirm({
        title: 'Restore from backup?',
        message: `Replace all current data with ${name}? Your current data is backed up first.`,
        confirmLabel: 'Restore',
        danger: true
      })
      if (!ok) return
      await window.api.restoreBackup()
      await useApp.getState().refreshDecks()
      toast('Backup restored', { kind: 'success' })
    } catch (e) {
      toastError(e, 'Could not restore the backup')
    } finally {
      setBusy(false)
    }
  }

  const change = async (): Promise<void> => {
    try {
      const res = await window.api.chooseDataDir()
      if (!res) return
      useApp.getState().setStartup(res)
      await useApp.getState().refreshDecks()
      toast(`Data folder changed to ${res.dataDir}`, { kind: 'success' })
    } catch (e) {
      toastError(e, 'Could not change folder')
    }
  }

  const backup = async (): Promise<void> => {
    setBusy(true)
    try {
      const path = await window.api.backupNow()
      toast(`Backup saved: ${path}`, { kind: 'success' })
    } catch (e) {
      toastError(e, 'Backup failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Panel className="flex flex-col gap-4">
        <h3 className="text-base font-semibold">Data folder</h3>
        <Well className="break-all font-mono text-sm">{startup?.dataDir ?? '…'}</Well>
        {noFolders && (
          <div role="alert" className="neu-inset flex gap-3 rounded-2xl border border-danger/40 p-4 text-sm">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-danger" />
            <p>
              This browser can't open folders, so your data is stored in this browser only. To sync with a folder, use
              Chrome or Edge on a computer.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <Button icon={<FolderSync size={16} />} disabled={noFolders} onClick={() => void change()}>
            Change folder…
          </Button>
          {/* Browsers can't open a file-explorer window; only the desktop app can. */}
          {IS_DESKTOP && <Button icon={<FolderOpen size={16} />} onClick={() => void window.api.openDataDir()}>
            Open folder
          </Button>}
        </div>
        <div className="neu-inset flex gap-3 rounded-2xl p-4 text-sm">
          <Cloud size={20} className="mt-0.5 shrink-0 text-accent" />
          <p>
            <b>Sync between PCs:</b> choose a folder inside OneDrive, Dropbox or Google Drive on every PC. Only use the
            app on one PC at a time. Flashcards warns you if it is open elsewhere.
          </p>
        </div>
      </Panel>

      <Panel className="flex flex-col gap-4">
        <h3 className="text-base font-semibold">Backups</h3>
        {auto?.available ? (
          <p className="text-sm text-muted">
            Your data is stored in this browser only and is lost if you clear site data. Keep backup files somewhere
            safe.
          </p>
        ) : (
          <p className="text-sm text-muted">
            Automatic backups are saved in the <code className="rounded bg-bg px-1">backups</code> folder inside your
            data folder.
          </p>
        )}
        {auto?.available && (
          <SettingRow
            title="Automatic backup downloads"
            desc="Downloads a backup file to your Downloads folder when the last one is a week old."
          >
            <Switch
              aria-label="Automatic backup downloads"
              checked={auto.enabled}
              onCheckedChange={(v) => void setAutoEnabled(v)}
            />
          </SettingRow>
        )}
        <div className="flex flex-wrap gap-3">
          <Button icon={<DatabaseBackup size={16} />} disabled={busy} onClick={() => void backup()}>
            {busy ? 'Working…' : 'Back up now'}
          </Button>
          <Button icon={<Upload size={16} />} disabled={busy} onClick={() => void restore()}>
            Restore from backup…
          </Button>
        </div>
      </Panel>

      <TrashPanel />

      <Panel className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">Export</h3>
        <p className="text-sm text-muted">
          To export, open a deck menu on the Decks screen and choose Export. Formats: deck file
          (.fdeck, includes images, with or without progress) and CSV (text only).
        </p>
      </Panel>

      <UsagePanel />
    </div>
  )
}
