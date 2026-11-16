/** Start of the current "study day" (local time), which begins at `dayStartHour`. */
export function dayStart(now: number, dayStartHour: number): number {
  const d = new Date(now)
  d.setHours(dayStartHour, 0, 0, 0)
  if (d.getTime() > now) d.setDate(d.getDate() - 1)
  return d.getTime()
}

export function nextDayStart(now: number, dayStartHour: number): number {
  const d = new Date(dayStart(now, dayStartHour))
  d.setDate(d.getDate() + 1)
  return d.getTime()
}

/** Local YYYY-MM-DD of the study day containing `ts`. */
export function dayKey(ts: number, dayStartHour: number): string {
  const d = new Date(dayStart(ts, dayStartHour))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
