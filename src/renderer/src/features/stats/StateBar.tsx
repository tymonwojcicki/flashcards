import type { Stats } from '@shared/types'

const SEGMENTS = [
  { key: 'new', label: 'New', color: 'var(--easy)' },
  { key: 'learning', label: 'Learning', color: 'var(--hard)' },
  { key: 'review', label: 'Review', color: 'var(--good)' },
  { key: 'suspended', label: 'Suspended', color: 'var(--text-muted)' }
] as const

/** Horizontal stacked bar of card states plus a legend. */
export function StateBar({ totals }: { totals: Stats['totals'] }): React.JSX.Element {
  const sum = SEGMENTS.reduce((s, seg) => s + totals[seg.key], 0)
  return (
    <div className="flex flex-col gap-4">
      <div className="neu-inset h-6 w-full rounded-full p-1" role="img" aria-label="Card states">
        <div className="flex h-full w-full gap-0.5 overflow-hidden rounded-full">
          {SEGMENTS.map((seg) =>
            totals[seg.key] > 0 ? (
              <div
                key={seg.key}
                style={{ width: `${(totals[seg.key] / Math.max(1, sum)) * 100}%`, background: seg.color }}
                title={`${seg.label}: ${totals[seg.key]}`}
              />
            ) : null
          )}
        </div>
      </div>
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        {SEGMENTS.map((seg) => (
          <li key={seg.key} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: seg.color }} />
            <span className="text-muted">{seg.label}</span>
            <span className="font-semibold">{totals[seg.key]}</span>
            <span className="text-xs text-muted">{sum ? Math.round((totals[seg.key] / sum) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
