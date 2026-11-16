import { useEffect, useState } from 'react'
import { Download, RotateCcw } from 'lucide-react'
import { Button, Panel, Switch, toast } from '@renderer/components/ui'
import { getUsage, onUsageChange, resetUsage, setUsageEnabled, usageEnabled } from '@renderer/lib/usage'

const TOP = 15

/** Settings › Data: local click/shortcut counts, with export and reset. */
export function UsagePanel(): React.JSX.Element {
  const [, setTick] = useState(0)
  const [all, setAll] = useState(false)
  useEffect(() => onUsageChange(() => setTick((n) => n + 1)), [])

  const enabled = usageEnabled()
  const usage = getUsage()
  const rows = Object.entries(usage.counts).sort((a, b) => b[1] - a[1])
  const shown = all ? rows : rows.slice(0, TOP)
  const max = rows[0]?.[1] ?? 1
  const total = rows.reduce((s, [, n]) => s + n, 0)

  const exportFile = (): void => {
    const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), ...usage }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `flashcards-usage-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">Usage</h3>
          <p className="text-sm text-muted">
            Counts of buttons and shortcuts used on this device{enabled ? ` since ${new Date(usage.since).toLocaleDateString()}` : ''}.
            Stored only on this device and never sent anywhere. Card and deck text is not recorded. Turning this off deletes the
            counts.
          </p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-3 text-sm text-text">
          Record usage
          <Switch checked={enabled} onCheckedChange={(v) => setUsageEnabled(v)} aria-label="Record usage" />
        </label>
      </div>
      {!enabled ? null : rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing recorded yet.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {shown.map(([key, n]) => (
            <div key={key} className="grid grid-cols-[minmax(0,1fr)_8rem_3rem] items-center gap-3 text-sm">
              <span className="truncate text-text" title={key}>
                {key}
              </span>
              <span className="neu-inset h-2 overflow-hidden rounded-full">
                <span className="accent-fill block h-full rounded-full" style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span className="text-right font-mono text-xs text-muted tabular-nums">{n}</span>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1 text-xs text-muted">
            <span>{total} actions in total</span>
            {rows.length > TOP && (
              <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
                {all ? 'Show top 15' : `Show all ${rows.length}`}
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <Button icon={<Download size={16} />} disabled={rows.length === 0} onClick={exportFile}>
          Export usage
        </Button>
        <Button
          icon={<RotateCcw size={16} />}
          disabled={rows.length === 0}
          onClick={() => {
            resetUsage()
            toast('Usage counts cleared', { kind: 'info' })
          }}
        >
          Reset
        </Button>
      </div>
    </Panel>
  )
}
