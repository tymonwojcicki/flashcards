// Local usage counter: how often each button / menu item / shortcut is used.
// Stored only in this browser/app profile (localStorage). Nothing is sent anywhere; the user can
// export the counts as a JSON file from Settings › Data.
import { useApp } from '@renderer/store/app'

const KEY = 'flashcards.usage.v1'

export interface UsageData {
  since: string
  counts: Record<string, number>
}

let data: UsageData | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

function load(): UsageData {
  if (data) return data
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as UsageData) : null
    if (parsed && typeof parsed.counts === 'object') data = parsed
  } catch {
    /* storage unavailable */
  }
  data ??= { since: new Date().toISOString(), counts: {} }
  return data
}

function save(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(load()))
    } catch {
      /* storage unavailable */
    }
  }, 1000)
}

export function recordUsage(key: string): void {
  const d = load()
  d.counts[key] = (d.counts[key] ?? 0) + 1
  save()
  for (const l of listeners) l()
}

export function getUsage(): UsageData {
  return load()
}

export function resetUsage(): void {
  data = { since: new Date().toISOString(), counts: {} }
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    /* storage unavailable */
  }
  for (const l of listeners) l()
}

export function onUsageChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

// ---- click capture ----

/** Clickable controls we count. Rows/options (cards, list items) are skipped: their text is user content. */
const CONTROL = 'button, a[href], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="tab"], [role="switch"]'

/** Visible label of a control, without key badges, digits normalised ("Import 12 cards" → "Import # cards"). */
function labelOf(el: Element): string {
  const aria = el.getAttribute('aria-label')
  let text = ''
  if (aria) text = aria
  else {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement?.closest('kbd')) continue
      text += n.textContent ?? ''
    }
  }
  text = text.replace(/\s+/g, ' ').replace(/\d+/g, '#').trim()
  return text.length > 48 ? text.slice(0, 47) + '…' : text
}

/** Menu triggers open on pointerdown (Radix), so the click never reaches them: count those on pointerdown. */
function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const el = (e.target as Element | null)?.closest(CONTROL)
  if (el?.hasAttribute('aria-haspopup')) count(el)
}

function onClick(e: MouseEvent): void {
  const el = (e.target as Element | null)?.closest(CONTROL)
  if (el && !el.hasAttribute('aria-haspopup')) count(el)
}

function count(el: Element): void {
  if (el.closest('[role="listbox"], [role="option"], .ProseMirror, [data-no-usage]')) return
  const label = el.getAttribute('data-usage') ?? labelOf(el)
  if (!label) return
  recordUsage(`${page()} · ${label}`)
}

function page(): string {
  return useApp.getState().route.name
}

let installed = false
/** Start counting clicks (idempotent). */
export function installUsageTracking(): void {
  if (installed) return
  installed = true
  document.addEventListener('click', onClick, { capture: true })
  document.addEventListener('pointerdown', onPointerDown, { capture: true })
}
