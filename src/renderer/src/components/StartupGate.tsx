import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useApp } from '@renderer/store/app'
import { Button, Dialog, toast } from '@renderer/components/ui'
import { formatBytes, formatDateTime } from '@renderer/lib/format'
import type { StartupState } from '@shared/types'

/** Blocking dialogs for a locked collection and for sync-conflict copies. Mount once. */
export function StartupGate(): React.JSX.Element | null {
  const startup = useApp((s) => s.startup)
  const setStartup = useApp((s) => s.setStartup)
  const refreshDecks = useApp((s) => s.refreshDecks)
  const [busy, setBusy] = useState(false)
  if (!startup) return null

  const run = async (fn: () => Promise<StartupState>): Promise<void> => {
    setBusy(true)
    try {
      setStartup(await fn())
      await refreshDecks()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong', { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const locked = startup.lock.kind === 'locked' ? startup.lock : null
  const conflictsOpen = !locked && startup.conflicts.length > 0

  return (
    <>
      <Dialog
        open={!!locked}
        onOpenChange={() => undefined}
        dismissible={false}
        title={`Flashcards is open on ${locked?.device ?? 'another device'}`}
        description={locked ? `Since ${formatDateTime(locked.since)}.` : undefined}
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => void run(() => window.api.openReadOnly())}>
              Read-only
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void run(() => window.api.forceUnlock())}>
              Open anyway
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-muted">
          <p>
            Your collection is shared through a synced folder, and it looks like another device is using it right now.
          </p>
          <p>
            <strong className="text-text">Read-only</strong> lets you look around safely without changing anything.{' '}
            <strong className="text-text">Open anyway</strong> takes over, but if the other device is still running, edits
            made on both sides can overwrite each other and be lost.
          </p>
        </div>
      </Dialog>

      <Dialog
        open={conflictsOpen}
        onOpenChange={() => undefined}
        dismissible={false}
        title="Conflicting copies found"
        description="Your sync service saved more than one version of the collection. Pick which to keep."
        className="w-[min(36rem,calc(100vw-2rem))]"
      >
        <ul className="flex flex-col gap-3">
          {startup.conflicts.map((c) => (
            <li key={c.file} className="neu-inset flex flex-wrap items-center gap-3 rounded-2xl p-4">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-text">{c.file}</div>
                <div className="text-xs text-muted">
                  Modified {formatDateTime(c.modified)} · {formatBytes(c.size)}
                </div>
              </div>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => window.api.resolveConflict(c.file, 'discard'))}>
                Discard
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void run(() => window.api.resolveConflict(c.file, 'use'))}>
                Use this copy
              </Button>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted">Using a copy backs up your current collection first.</p>
      </Dialog>
    </>
  )
}

export function ReadOnlyBanner(): React.JSX.Element | null {
  const readOnly = useApp((s) => s.startup?.readOnly)
  if (!readOnly) return null
  return (
    <div
      role="alert"
      className="mx-4 mt-4 flex items-center gap-3 rounded-2xl bg-warning/15 px-4 py-2.5 text-sm font-medium text-warning"
    >
      <AlertTriangle size={17} className="shrink-0" />
      Read-only mode: changes won't be saved. Restart the app to edit.
    </div>
  )
}
