import { useState } from 'react'
import { Cloud, DatabaseBackup, FolderOpen, FolderSync } from 'lucide-react'
import { Button, Panel, Well, toast } from '@renderer/components/ui'
import { useApp } from '@renderer/store/app'

export function DataTab(): React.JSX.Element {
  const startup = useApp((s) => s.startup)
  const [busy, setBusy] = useState(false)

  const change = async (): Promise<void> => {
    try {
      const res = await window.api.chooseDataDir()
      if (!res) return
      useApp.getState().setStartup(res)
      await useApp.getState().refreshDecks()
      toast(`Data folder changed to ${res.dataDir}`, { kind: 'success' })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change folder', { kind: 'error' })
    }
  }

  const backup = async (): Promise<void> => {
    setBusy(true)
    try {
      const path = await window.api.backupNow()
      toast(`Backup saved: ${path}`, { kind: 'success' })
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Backup failed', { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Panel className="flex flex-col gap-4">
        <h3 className="text-base font-semibold">Data folder</h3>
        <Well className="break-all font-mono text-sm">{startup?.dataDir ?? '…'}</Well>
        <div className="flex flex-wrap gap-3">
          <Button icon={<FolderSync size={16} />} onClick={() => void change()}>
            Change folder…
          </Button>
          <Button icon={<FolderOpen size={16} />} onClick={() => void window.api.openDataDir()}>
            Open folder
          </Button>
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
        <p className="text-sm text-muted">
          Automatic backups are saved in the <code className="rounded bg-bg px-1">backups</code> folder inside your data
          folder.
        </p>
        <div>
          <Button variant="primary" icon={<DatabaseBackup size={16} />} disabled={busy} onClick={() => void backup()}>
            {busy ? 'Backing up…' : 'Back up now'}
          </Button>
        </div>
      </Panel>

      <Panel className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">Export</h3>
        <p className="text-sm text-muted">
          To export, open a deck menu on the Decks screen and choose Export. Formats: .fdeck file
          (with or without progress) and CSV.
        </p>
      </Panel>
    </div>
  )
}
