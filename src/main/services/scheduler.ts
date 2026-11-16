// Thin wrapper over ts-fsrs v6 (FSRS-7). Converts between our DB rows and ts-fsrs cards.
import { DefaultScheduler, Rating as FRating } from 'ts-fsrs'
import type { PresetConfig, IntervalPreview } from '../../shared/types'
import { Rating } from '../../shared/types'

// ts-fsrs's scheduler type is deeply generic; we only use a small surface.
/* eslint-disable @typescript-eslint/no-explicit-any */
type FsrsCard = Record<string, any> & { dueAt: Date; lastReviewAt: Date | null; state: number }
type Scheduler = {
  newCard(o: { now: Date }): FsrsCard
  review(o: { card: FsrsCard; grade: number; now: Date }): { card: FsrsCard; revlog: Record<string, any> }
  preview(o: { card: FsrsCard; now: Date }): Iterable<{ grade: number; card: FsrsCard }>
  model: { forgettingCurve(card: FsrsCard, elapsedDays: number): number }
}

const cache = new Map<string, Promise<Scheduler>>()

export function getScheduler(cfg: PresetConfig): Promise<Scheduler> {
  const key = JSON.stringify(cfg)
  let s = cache.get(key)
  if (!s) {
    const base = {
      allowModelOverride: false, // respect user's learning steps
      desiredRetention: cfg.desiredRetention,
      enableShortTerm: true,
      learningSteps: cfg.learningSteps,
      relearningSteps: cfg.relearningSteps,
      enableFuzz: cfg.enableFuzz,
      maximumInterval: cfg.maximumInterval
    }
    s = (DefaultScheduler as any)(cfg.weights ? { ...base, weights: cfg.weights } : base).catch(() =>
      (DefaultScheduler as any)(base)
    ) as Promise<Scheduler>
    cache.set(key, s)
  }
  return s
}

export function reviveCard(json: string | null | undefined, fallbackDue: number): FsrsCard | null {
  if (!json) return null
  const c = JSON.parse(json)
  return { ...c, dueAt: new Date(c.dueAt ?? fallbackDue), lastReviewAt: c.lastReviewAt ? new Date(c.lastReviewAt) : null }
}

export function serializeCard(c: FsrsCard): string {
  return JSON.stringify(c)
}

export async function reviewCard(
  cfg: PresetConfig,
  stored: FsrsCard | null,
  rating: Rating,
  now: Date
): Promise<{ card: FsrsCard; revlog: Record<string, any> }> {
  const s = await getScheduler(cfg)
  const card = stored ?? s.newCard({ now })
  now = clampNow(card, now)
  return s.review({ card, grade: rating as unknown as FRating, now })
}

export async function preview(cfg: PresetConfig, stored: FsrsCard | null, now: Date): Promise<IntervalPreview> {
  const s = await getScheduler(cfg)
  const card = stored ?? s.newCard({ now })
  now = clampNow(card, now)
  const out = {} as IntervalPreview
  for (const p of s.preview({ card, now })) {
    out[p.grade as Rating] = formatInterval(p.card.dueAt.getTime() - now.getTime())
  }
  return out
}

export async function retrievability(cfg: PresetConfig, stored: FsrsCard | null, now: Date): Promise<number | null> {
  if (!stored || !stored.lastReviewAt) return null
  const s = await getScheduler(cfg)
  const days = (now.getTime() - stored.lastReviewAt.getTime()) / 86_400_000
  return s.model.forgettingCurve(stored, Math.max(0, days))
}

/** Guard against clock skew between synced PCs: never review "before" the last review. */
function clampNow(card: FsrsCard, now: Date): Date {
  return card.lastReviewAt && card.lastReviewAt.getTime() > now.getTime() ? new Date(card.lastReviewAt) : now
}

export function formatInterval(ms: number): string {
  const min = ms / 60_000
  if (min < 1) return '<1m'
  if (min < 60) return `${Math.round(min)}m`
  const h = min / 60
  if (h < 24) return `${Math.round(h)}h`
  const d = h / 24
  if (d < 30) return `${Math.round(d)}d`
  if (d < 365) return `${+(d / 30).toFixed(1)}mo`
  return `${+(d / 365).toFixed(1)}y`
}

/** Validates "1m", "10m", "1h", "2d" step strings. */
export function isValidStep(s: string): boolean {
  return /^\d+(\.\d+)?[smhd]$/.test(s.trim())
}
