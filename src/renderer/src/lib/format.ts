/** "A › B › C" */
export function deckPathLabel(path: string[]): string {
  return path.join(' › ')
}

export function plural(n: number, word: string, pluralWord?: string): string {
  return `${n} ${n === 1 ? word : (pluralWord ?? word + 's')}`
}

/** Human label for a due timestamp relative to now, e.g. "in 3 days", "5 minutes ago", "now". */
export function relativeDue(ms: number, now: number = Date.now()): string {
  const diff = ms - now
  const abs = Math.abs(diff)
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (abs < min) return 'now'
  let text: string
  if (abs < hour) text = plural(Math.round(abs / min), 'minute')
  else if (abs < day) text = plural(Math.round(abs / hour), 'hour')
  else if (abs < 30 * day) text = plural(Math.round(abs / day), 'day')
  else if (abs < 365 * day) text = plural(Math.round(abs / (30 * day)), 'month')
  else text = plural(Math.round((abs / (365 * day)) * 10) / 10, 'year')
  return diff < 0 ? `${text} ago` : `in ${text}`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
