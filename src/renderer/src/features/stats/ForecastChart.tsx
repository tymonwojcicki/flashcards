import { useEffect, useRef, useState } from 'react'
import { formatDay, parseDay, shortDay } from './dates'

const MIN_W = 320
const H = 210
const LEFT = 34
const TOP = 10
const BOTTOM = 24

function niceMax(n: number): number {
  if (n <= 4) return 4
  if (n <= 10) return Math.ceil(n / 2) * 2
  const pow = 10 ** Math.floor(Math.log10(n))
  for (const m of [1, 2, 5, 10]) if (n <= m * pow) return m * pow
  return n
}

/** Bar chart of cards due per day for the next 30 days. */
export function ForecastChart({ forecast }: { forecast: { day: string; due: number }[] }): React.JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(600)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(MIN_W, Math.round(el.clientWidth))))
    ro.observe(el)
    setW(Math.max(MIN_W, Math.round(el.clientWidth)))
    return () => ro.disconnect()
  }, [])
  const top = niceMax(Math.max(0, ...forecast.map((f) => f.due)))
  const plotW = W - LEFT - 4
  const plotH = H - TOP - BOTTOM
  const slot = plotW / Math.max(1, forecast.length)
  const barW = Math.max(3, slot - 4)
  const ticks = [0, top / 2, top]
  const h = hover !== null ? forecast[hover] : undefined

  return (
    <div ref={wrapRef} className="flex flex-col gap-2">
      <div className="h-5 text-sm text-muted" aria-live="polite">
        {h ? (
          <>
            <span className="font-semibold text-text">{h.due}</span> {h.due === 1 ? 'card' : 'cards'} due ·{' '}
            {formatDay(parseDay(h.day))}
          </>
        ) : (
          'Hover a bar for details'
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label="Due forecast for the next 30 days">
        <defs>
          <linearGradient id="fc-grad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" style={{ stopColor: "var(--accent-1)" }} />
            <stop offset="1" style={{ stopColor: "var(--accent-2)" }} />
          </linearGradient>
        </defs>
        {ticks.map((t) => {
          const y = TOP + plotH - (t / top) * plotH
          return (
            <g key={t}>
              <line x1={LEFT} x2={W - 4} y1={y} y2={y} stroke="var(--shadow-dark)" strokeOpacity={0.5} strokeDasharray="3 4" />
              <text x={LEFT - 6} y={y + 3} fontSize={10} textAnchor="end" fill="var(--text-muted)">
                {Math.round(t)}
              </text>
            </g>
          )
        })}
        {forecast.map((f, i) => {
          const bh = f.due > 0 ? Math.max((f.due / top) * plotH, 2) : 0
          const x = LEFT + i * slot + (slot - barW) / 2
          return (
            <g key={f.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={LEFT + i * slot} y={TOP} width={slot} height={plotH + BOTTOM} fill="transparent" />
              <rect
                x={x}
                y={TOP + plotH - bh}
                width={barW}
                height={bh}
                rx={Math.min(4, barW / 2)}
                fill="url(#fc-grad)"
                opacity={hover === null || hover === i ? 1 : 0.5}
              />
              {i % 5 === 0 && (
                <text x={x + barW / 2} y={H - 8} fontSize={10} textAnchor="middle" fill="var(--text-muted)">
                  {i === 0 ? 'Today' : shortDay(parseDay(f.day))}
                </text>
              )}
              <title>{`${formatDay(parseDay(f.day))}: ${f.due} due`}</title>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
