// Pure CSV/TSV parsing helpers for the import wizard (no DOM / React).
import Papa from 'papaparse'
import type { ImportRow } from '@shared/types'

export type ColumnRole = 'front' | 'back' | 'deck' | 'tags' | 'ignore'

export const DELIMITERS = [
  { value: '\t', label: 'Tab' },
  { value: ',', label: 'Comma' },
  { value: ';', label: 'Semicolon' },
  { value: '|', label: 'Pipe' }
] as const

const HEADER_CELL = /^\s*(front|back|question|answer|deck|tags?|term|definition)\s*$/i

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** Parse text with a given delimiter. Blank lines are dropped. */
export function parseTable(text: string, delimiter: string): string[][] {
  const res = Papa.parse<string[]>(stripBom(text), {
    delimiter,
    skipEmptyLines: 'greedy',
    header: false
  })
  return res.data.filter((r) => Array.isArray(r))
}

/** Pick the delimiter that yields the most consistent multi-column table. */
export function detectDelimiter(text: string): string {
  const sample = stripBom(text).split(/\r?\n/).slice(0, 40).join('\n')
  let best = ','
  let bestScore = -1
  let bestCols = 0
  for (const { value } of DELIMITERS) {
    const res = Papa.parse<string[]>(sample, { delimiter: value, skipEmptyLines: 'greedy', preview: 20 })
    const rows = res.data
    if (rows.length === 0) continue
    const counts = new Map<number, number>()
    for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1)
    let modal = 0
    let modalN = 0
    for (const [cols, n] of counts) {
      if (n > modalN || (n === modalN && cols > modal)) {
        modal = cols
        modalN = n
      }
    }
    if (modal < 2) continue
    if (modalN > bestScore || (modalN === bestScore && modal > bestCols)) {
      best = value
      bestScore = modalN
      bestCols = modal
    }
  }
  return best
}

/** True when the first row looks like column names. */
export function guessHeader(firstRow: string[] | undefined): boolean {
  if (!firstRow) return false
  return firstRow.some((c) => HEADER_CELL.test(c))
}

function roleForHeader(name: string): ColumnRole {
  const n = name.trim().toLowerCase()
  if (n === 'front' || n === 'question' || n === 'term') return 'front'
  if (n === 'back' || n === 'answer' || n === 'definition') return 'back'
  if (n === 'deck') return 'deck'
  if (n === 'tag' || n === 'tags') return 'tags'
  return 'ignore'
}

/** Initial column roles from header names, or Front/Back for the first two columns. */
export function guessRoles(header: string[] | null, colCount: number): ColumnRole[] {
  const roles: ColumnRole[] = Array.from({ length: colCount }, () => 'ignore')
  if (header) {
    const used = new Set<ColumnRole>()
    header.forEach((h, i) => {
      if (i >= colCount) return
      const r = roleForHeader(h)
      if (r !== 'ignore' && !used.has(r)) {
        roles[i] = r
        used.add(r)
      }
    })
    if (!used.has('front')) {
      const i = roles.findIndex((r) => r === 'ignore')
      if (i >= 0) roles[i] = 'front'
    }
    if (!used.has('back')) {
      const i = roles.findIndex((r) => r === 'ignore')
      if (i >= 0) roles[i] = 'back'
    }
  } else {
    if (colCount > 0) roles[0] = 'front'
    if (colCount > 1) roles[1] = 'back'
  }
  return roles
}

export function splitTags(s: string): string[] {
  return s
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/**
 * Map table rows into ImportRow[] using column roles (first column per role wins).
 * Rows with an empty front are kept: the import (and its preview) decides what is skipped.
 */
export function mapRows(table: string[][], hasHeader: boolean, roles: ColumnRole[]): ImportRow[] {
  const fi = roles.indexOf('front')
  const bi = roles.indexOf('back')
  const di = roles.indexOf('deck')
  const ti = roles.indexOf('tags')
  const rows: ImportRow[] = []
  for (const r of hasHeader ? table.slice(1) : table) {
    const front = fi >= 0 ? (r[fi] ?? '').trim() : ''
    const row: ImportRow = { front, back: bi >= 0 ? (r[bi] ?? '').trim() : '' }
    const deck = di >= 0 ? (r[di] ?? '').trim() : ''
    if (deck) row.deckPath = deck
    const tags = ti >= 0 ? splitTags(r[ti] ?? '') : []
    if (tags.length) row.tags = tags
    rows.push(row)
  }
  return rows
}

/** Directory of a file path (handles / and backslash); null when unknown. */
export function dirName(path: string | null | undefined): string | null {
  if (!path) return null
  const i = Math.max(path.lastIndexOf(String.fromCharCode(92)), path.lastIndexOf('/'))
  return i > 0 ? path.slice(0, i) : null
}
