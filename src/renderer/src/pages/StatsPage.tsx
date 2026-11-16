// Prop contract: { deckId?: string (limit stats to a deck subtree) }
import { useEffect, useMemo, useState } from 'react'
import { BarChart3, CalendarClock, CheckCircle2, Flame, Layers, Target } from 'lucide-react'
import { EmptyState, Field, Panel, Select, toast } from '@renderer/components/ui'
import { useApp } from '@renderer/store/app'
import { flattenDecks } from '@renderer/lib/decks'
import { plural } from '@renderer/lib/format'
import { Heatmap } from '@renderer/features/stats/Heatmap'
import { ForecastChart } from '@renderer/features/stats/ForecastChart'
import { StateBar } from '@renderer/features/stats/StateBar'
import type { Stats } from '@shared/types'

const ALL = '__all__'

function Tile({
  icon,
  label,
  value,
  sub
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
}): React.JSX.Element {
  return (
    <div className="neu-raised flex min-w-0 flex-col gap-1 rounded-[20px] p-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted">
        <span className="text-accent">{icon}</span>
        {label}
      </div>
      <div className="font-display text-3xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  )
}

export default function StatsPage({ deckId }: { deckId?: string }): React.JSX.Element {
  const deckTree = useApp((s) => s.deckTree)
  const flat = useMemo(() => flattenDecks(deckTree), [deckTree])
  const [filter, setFilter] = useState<string>(deckId ?? ALL)
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api
      .getStats(filter === ALL ? null : filter)
      .then((s) => {
        if (!cancelled) setStats(s)
      })
      .catch((e: unknown) => toast(e instanceof Error ? e.message : 'Could not load statistics', { kind: 'error' }))
    return () => {
      cancelled = true
    }
  }, [filter, deckTree])

  const options = [
    { value: ALL, label: 'All decks' },
    ...flat.map((d) => ({ value: d.id, label: `${'  '.repeat(d.depth)}${d.name}` }))
  ]

  const header = (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <h1 className="text-2xl font-bold">Statistics</h1>
      <Field label="Deck" className="w-64">
        <Select aria-label="Deck filter" value={filter} onValueChange={setFilter} options={options} />
      </Field>
    </header>
  )

  if (!stats) {
    return <div className="mx-auto flex max-w-5xl flex-col gap-6">{header}</div>
  }

  const today = stats.days[stats.days.length - 1]
  const totalReviews = stats.days.reduce((s, d) => s + d.reviews, 0)
  const t = stats.totals

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      {header}

      {t.cards === 0 ? (
        <EmptyState
          icon={<BarChart3 size={32} />}
          title="No cards yet"
          text="Statistics appear after cards are added and studied."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 min-[900px]:grid-cols-3 min-[1100px]:grid-cols-5">
            <Tile icon={<CalendarClock size={14} />} label="Due today" value={String(stats.forecast[0]?.due ?? 0)} />
            <Tile icon={<CheckCircle2 size={14} />} label="Reviews today" value={String(today?.reviews ?? 0)} />
            <Tile
              icon={<Flame size={14} />}
              label="Streak"
              value={String(stats.streak)}
              sub={stats.streak === 1 ? 'day' : 'days'}
            />
            <Tile
              icon={<Target size={14} />}
              label="Retention (30d)"
              value={stats.retention30d === null ? '–' : `${Math.round(stats.retention30d * 100)}%`}
              sub={stats.retention30d === null ? 'not enough reviews' : 'answered not Again'}
            />
            <Tile
              icon={<Layers size={14} />}
              label="Total cards"
              value={String(t.cards)}
              sub={`${t.new} new · ${t.learning} learning · ${t.review} review · ${t.suspended} susp.`}
            />
          </div>

          <Panel className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Review activity</h2>
            {totalReviews === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                No reviews recorded.
              </p>
            ) : (
              <>
                <p className="text-xs text-muted">
                  {plural(totalReviews, 'review')} in the last year
                </p>
                <Heatmap days={stats.days} />
              </>
            )}
          </Panel>

          <Panel className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Due forecast, next 30 days</h2>
            <ForecastChart forecast={stats.forecast} />
          </Panel>

          <Panel className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Card states</h2>
            <StateBar totals={t} />
          </Panel>
        </>
      )}
    </div>
  )
}
