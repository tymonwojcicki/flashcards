// Pure helpers for the settings screens.

export const STEP_RE = /^\d+(\.\d+)?[smhd]$/

export function parseSteps(text: string): { steps: string[]; invalid: string[] } {
  const tokens = text
    .split(/[\s,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  return { steps: tokens.filter((t) => STEP_RE.test(t)), invalid: tokens.filter((t) => !STEP_RE.test(t)) }
}

/** Rough relative review workload versus 90% retention (exponential forgetting model). */
export function workloadMultiplier(retention: number): number {
  return Math.log(0.9) / Math.log(Math.min(0.99, Math.max(0.7, retention)))
}

export function formatYears(days: number): string {
  const y = days / 365
  if (y < 1) return `${Math.round(days / 30)} months`
  return `${y.toFixed(1)} years`
}

export const DEFAULT_PRESET_ID = 'default'
