import { useMemo, useState } from 'react'
import type { DayStats } from '@shared/types'
import { formatDay, isoDay, parseDay } from './dates'

const WEEKS = 26
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
}

/** GitHub-style review heatmap of the last ~26 weeks. */
export function Heatmap({ days }: { days: DayStats[] }): React.JSX.Element {
  const [hover, setHover] = useState<Cell | null>(null)

  const { cells, months, width, height, max } = useMemo(() => {
    const byDay = new Map(days.map((d) => [d.day, d.reviews]))
    const lastDay = days[days.length - 1]
    const last = lastDay ? parseDay(lastDay.day) : new Date()
    last.setHours(0, 0, 0, 0)
    const dow = (last.getDay() + 6) % 7 // Monday = 0
    const start = new Date(last)
    start.setDate(start.getDate() - dow - (WEEKS - 1) * 7)
    const out: Cell[] = []
    const monthLabels: { col: number; label: string }[] = []
    let lastMonth = -1
    let maxReviews = 0
    for (let col = 0; col < WEEKS; col++) {
      for (let row = 0; row < 7; row++) {
        const d = new Date(start)
        d.setDate(start.getDate() + col * 7 + row)
        if (d > last) continue
        const key = isoDay(d)
        const reviews = byDay.get(key) ?? 0
        maxReviews = Math.max(maxReviews, reviews)
        out.push({ key, col, row, date: d, reviews })
        if (row === 0 && d.getMonth() !== lastMonth) {
          lastMonth = d.getMonth()
          monthLabels.push({ col, label: d.toLocaleDateString(undefined, { month: 'short' }) })
        }
      }
    }
    return {
      cells: out,
      months: monthLabels,
      width: LEFT + WEEKS * (CELL + GAP),
      height: TOP + 7 * (CELL + GAP),
      max: maxReviews
    }
  }, [days])

  const opacity = (n: number): number => {
    if (n <= 0 || max <= 0) return 0
    const r = n / max
    return r <= 0.25 ? 0.3 : r <= 0.5 ? 0.5 : r <= 0.75 ? 0.75 : 1
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="h-5 text-sm text-muted" aria-live="polite">
        {hover ? (
          <>
            <span className="font-semibold text-text">{hover.reviews}</span>{' '}
            {hover.reviews === 1 ? 'review' : 'reviews'} · {formatDay(hover.date)}
          </>
        ) : (
          'Hover a day for details'
        )}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block max-w-full" role="img" aria-label="Review activity heatmap">
        <defs>
          <linearGradient id="hm-grad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: "var(--accent-1)" }} />
            <stop offset="1" style={{ stopColor: "var(--accent-2)" }} />
          </linearGradient>
        </defs>
        {months.filter((m, i) => !months[i + 1] || months[i + 1].col - m.col >= 3).map((m) => (
          <text key={m.col} x={LEFT + m.col * (CELL + GAP)} y={11} fontSize={10} fill="var(--text-muted)">
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
          const o = opacity(c.reviews)
          return (
            <g key={c.key} onMouseEnter={() => setHover(c)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={y} width={CELL} height={CELL} rx={4} fill="var(--shadow-dark)" opacity={0.3} />
              {o > 0 && <rect x={x} y={y} width={CELL} height={CELL} rx={4} fill="url(#hm-grad)" opacity={o} />}
              <title>{`${formatDay(c.date)}: ${c.reviews} reviews`}</title>
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
