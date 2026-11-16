import { useMemo, useState } from 'react'
import type { DayStats } from '@shared/types'
import { formatDay, isoDay, parseDay } from './dates'

const CELL = 14
const GAP = 3
const LEFT = 28
const TOP = 18
const DAY_LABELS: Record<number, string> = { 0: 'Mon', 2: 'Wed', 4: 'Fri' }

interface Cell {
  key: string
  col: number
  row: number
  date: Date
  reviews: number
  future: boolean
}

/**
 * GitHub-style review heatmap for the days from `from` to `to` (inclusive, "YYYY-MM-DD").
 * Days after `today` are drawn faded.
 */
export function Heatmap({ days, from, to, today }: { days: DayStats[]; from: string; to: string; today: string }): React.JSX.Element {
  const [hover, setHover] = useState<Cell | null>(null)

  const { cells, months, width, height, max } = useMemo(() => {
    const byDay = new Map(days.map((d) => [d.day, d.reviews]))
    const first = parseDay(from)
    const last = parseDay(to)
    const start = new Date(first)
    start.setDate(start.getDate() - ((first.getDay() + 6) % 7)) // back to Monday
    const out: Cell[] = []
    const monthLabels: { col: number; label: string }[] = []
    let lastMonth = -1
    let maxReviews = 0
    let col = 0
    for (const d = new Date(start); d <= last; d.setDate(d.getDate() + 1)) {
      const row = (d.getDay() + 6) % 7
      if (row === 0 && d > start) col++
      if (d < first) continue
      const key = isoDay(d)
      const reviews = byDay.get(key) ?? 0
      maxReviews = Math.max(maxReviews, reviews)
      out.push({ key, col, row, date: new Date(d), reviews, future: key > today })
      const isFirst = out.length === 1
      if (d.getMonth() !== lastMonth && (row === 0 || d.getDate() === 1 || isFirst)) {
        lastMonth = d.getMonth()
        const labelCol = row === 0 || isFirst ? col : col + 1
        monthLabels.push({ col: labelCol, label: d.toLocaleDateString(undefined, { month: 'short' }) })
      }
    }
    const weeks = col + 1
    return {
      cells: out,
      months: monthLabels,
      width: LEFT + weeks * (CELL + GAP),
      height: TOP + 7 * (CELL + GAP),
      max: maxReviews
    }
  }, [days, from, to, today])

  const opacity = (n: number): number => {
    if (n <= 0 || max <= 0) return 0
    const r = n / max
    return r <= 0.25 ? 0.3 : r <= 0.5 ? 0.5 : r <= 0.75 ? 0.75 : 1
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="h-5 text-sm text-muted" aria-live="polite">
        {hover ? (
          hover.future ? (
            formatDay(hover.date)
          ) : (
            <>
              <span className="font-semibold text-text">{hover.reviews}</span> {hover.reviews === 1 ? 'review' : 'reviews'} ·{' '}
              {formatDay(hover.date)}
            </>
          )
        ) : (
          'Hover a day for details'
        )}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block h-auto max-w-full" role="img" aria-label="Review activity heatmap">
        <defs>
          <linearGradient id="hm-grad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: 'var(--accent-1)' }} />
            <stop offset="1" style={{ stopColor: 'var(--accent-2)' }} />
          </linearGradient>
        </defs>
        {months
          .filter((m, i) => !months[i + 1] || months[i + 1].col - m.col >= 3)
          .map((m) => (
            <text key={`${m.col}-${m.label}`} x={LEFT + m.col * (CELL + GAP)} y={11} fontSize={10} fill="var(--text-muted)">
              {m.label}
            </text>
          ))}
        {Object.entries(DAY_LABELS).map(([row, label]) => (
          <text key={row} x={0} y={TOP + Number(row) * (CELL + GAP) + CELL - 3} fontSize={10} fill="var(--text-muted)">
            {label}
          </text>
        ))}
        {cells.map((c) => {
          const x = LEFT + c.col * (CELL + GAP)
          const y = TOP + c.row * (CELL + GAP)
          const o = c.future ? 0 : opacity(c.reviews)
          return (
            <g key={c.key} onMouseEnter={() => setHover(c)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={y} width={CELL} height={CELL} rx={4} fill="var(--shadow-dark)" opacity={c.future ? 0.1 : 0.3} />
              {o > 0 && <rect x={x} y={y} width={CELL} height={CELL} rx={4} fill="url(#hm-grad)" opacity={o} />}
              <title>{c.future ? formatDay(c.date) : `${formatDay(c.date)}: ${c.reviews} reviews`}</title>
            </g>
          )
        })}
      </svg>
      <div className="flex items-center justify-end gap-1.5 text-xs text-muted">
        Less
        {[0, 0.3, 0.5, 0.75, 1].map((o) => (
          <svg key={o} width={12} height={12} aria-hidden="true">
            <rect width={12} height={12} rx={3} fill="var(--shadow-dark)" opacity={0.3} />
            {o > 0 && <rect width={12} height={12} rx={3} fill="url(#hm-grad)" opacity={o} />}
          </svg>
        ))}
        More
      </div>
    </div>
  )
}
