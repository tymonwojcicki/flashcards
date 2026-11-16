import { useEffect, useRef } from 'react'
import { useApp } from '@renderer/store/app'

export type ShortcutScope = 'global' | 'study' | 'creator' | 'decks' | 'browse'
export interface Shortcut {
  keys: string
  label: string
  scope: ShortcutScope
}

/** Single source of truth for every keyboard shortcut in the app. */
export const SHORTCUTS = {
  'app.search': { keys: 'Ctrl+K', label: 'Command palette', scope: 'global' },
  'app.toggleHints': { keys: 'Ctrl+/', label: 'Show / hide hotkey hints', scope: 'global' },
  'app.help': { keys: '?', label: 'Keyboard shortcuts', scope: 'global' },
  'nav.decks': { keys: 'Ctrl+1', label: 'Go to Decks', scope: 'global' },
  'nav.browse': { keys: 'Ctrl+2', label: 'Browse cards', scope: 'global' },
  'nav.add': { keys: 'Ctrl+3', label: 'Add cards', scope: 'global' },
  'nav.stats': { keys: 'Ctrl+4', label: 'Statistics', scope: 'global' },
  'nav.settings': { keys: 'Ctrl+,', label: 'Settings', scope: 'global' },
  'study.reveal': { keys: 'Space', label: 'Show answer', scope: 'study' },
  'study.again': { keys: '1', label: 'Again', scope: 'study' },
  'study.hard': { keys: '2', label: 'Hard', scope: 'study' },
  'study.good': { keys: '3', label: 'Good', scope: 'study' },
  'study.easy': { keys: '4', label: 'Easy', scope: 'study' },
  'study.undo': { keys: 'Ctrl+Z', label: 'Undo last answer', scope: 'study' },
  'study.edit': { keys: 'E', label: 'Edit card', scope: 'study' },
  'study.bury': { keys: 'B', label: 'Bury card until tomorrow', scope: 'study' },
  'study.suspend': { keys: 'S', label: 'Suspend card', scope: 'study' },
  'study.exit': { keys: 'Escape', label: 'Exit study', scope: 'study' },
  'creator.save': { keys: 'Ctrl+Enter', label: 'Save card', scope: 'creator' },
  'creator.switchField': { keys: 'Tab', label: 'Next field', scope: 'creator' },
  'creator.math': { keys: 'Ctrl+M', label: 'Insert math', scope: 'creator' },
  'creator.image': { keys: 'Ctrl+Shift+I', label: 'Insert image', scope: 'creator' },
  'creator.deck': { keys: 'Ctrl+D', label: 'Choose deck', scope: 'creator' },
  'creator.reverse': { keys: 'Ctrl+R', label: 'Toggle reverse card', scope: 'creator' },
  'deck.new': { keys: 'N', label: 'New deck', scope: 'decks' },
  'deck.study': { keys: 'Enter', label: 'Study selected deck', scope: 'decks' }
} as const satisfies Record<string, Shortcut>

export type ShortcutId = keyof typeof SHORTCUTS

export const SCOPE_LABELS: Record<ShortcutScope, string> = {
  global: 'Everywhere',
  decks: 'Decks',
  study: 'Studying',
  creator: 'Adding cards',
  browse: 'Browsing'
}

export function effectiveKeysFor(id: ShortcutId, overrides: Record<string, string>): string {
  return overrides[id] || SHORTCUTS[id].keys
}

/** Key combo for `id` with the user's overrides applied (non-reactive; use useEffectiveKeys in components). */
export function effectiveKeys(id: ShortcutId): string {
  return effectiveKeysFor(id, useApp.getState().prefs.shortcutOverrides)
}

/** Reactive version of effectiveKeys. */
export function useEffectiveKeys(id: ShortcutId): string {
  return useApp((s) => effectiveKeysFor(id, s.prefs.shortcutOverrides))
}

/** 'Ctrl+Enter' -> ['Ctrl', 'Enter'] */
export function formatKeys(keys: string): string[] {
  if (!keys) return []
  // Supports a literal "+" key written as "Ctrl++".
  const out: string[] = []
  let cur = ''
  for (const ch of keys) {
    if (ch === '+' && cur !== '') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

interface ParsedCombo {
  ctrl: boolean
  shift: boolean
  alt: boolean
  key: string
}

function parseCombo(keys: string): ParsedCombo {
  const combo: ParsedCombo = { ctrl: false, shift: false, alt: false, key: '' }
  for (const raw of formatKeys(keys)) {
    const p = raw.toLowerCase()
    if (p === 'ctrl' || p === 'cmd' || p === 'meta') combo.ctrl = true
    else if (p === 'shift') combo.shift = true
    else if (p === 'alt') combo.alt = true
    else combo.key = p === 'space' ? ' ' : p === 'esc' ? 'escape' : p
  }
  return combo
}

function matches(e: KeyboardEvent, keys: string): boolean {
  const c = parseCombo(keys)
  if (!c.key) return false
  if (e.key.toLowerCase() !== c.key) return false
  if ((e.ctrlKey || e.metaKey) !== c.ctrl) return false
  if (e.altKey !== c.alt) return false
  // Symbols like "?" inherently need Shift; only enforce Shift for letters/digits/named keys.
  const symbol = c.key.length === 1 && !/[a-z0-9]/.test(c.key) && c.key !== ' '
  if (!symbol && e.shiftKey !== c.shift) return false
  return true
}

function inEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export interface ShortcutOptions {
  /** Default true. */
  enabled?: boolean
  /** Fire even when typing in an input. Combos with Ctrl/Alt always do. */
  allowInInputs?: boolean
}

interface Entry {
  seq: number
  id: ShortcutId
  handler: { current: (e: KeyboardEvent) => void }
  opts: { current: ShortcutOptions }
}

const registry: Entry[] = []
let seqCounter = 0
let listening = false

function onKeyDown(e: KeyboardEvent): void {
  if (e.repeat || e.isComposing) return
  const overrides = useApp.getState().prefs.shortcutOverrides
  const editable = inEditable(e.target)
  const dialogOpen = !!document.querySelector('[role="dialog"], [role="alertdialog"]')
  const sorted = [...registry].sort((a, b) => b.seq - a.seq)
  for (const entry of sorted) {
    const opts = entry.opts.current
    if (opts.enabled === false) continue
    if (!matches(e, effectiveKeysFor(entry.id, overrides))) continue
    const modified = e.ctrlKey || e.metaKey || e.altKey
    if (editable && !opts.allowInInputs && !modified) continue
    // Plain-key shortcuts must not fire behind an open dialog (e.g. Escape, Space).
    if (dialogOpen && !opts.allowInInputs && !modified && !entry.id.startsWith('app.')) continue
    e.preventDefault()
    entry.handler.current(e)
    return
  }
}

/** Register a handler for a shortcut. The most recently mounted handler for the same combo wins. */
export function useShortcut(id: ShortcutId, handler: (e: KeyboardEvent) => void, opts: ShortcutOptions = {}): void {
  const handlerRef = useRef(handler)
  const optsRef = useRef(opts)
  handlerRef.current = handler
  optsRef.current = opts
  useEffect(() => {
    const entry: Entry = { seq: ++seqCounter, id, handler: handlerRef, opts: optsRef }
    registry.push(entry)
    if (!listening) {
      window.addEventListener('keydown', onKeyDown)
      listening = true
    }
    return () => {
      const i = registry.indexOf(entry)
      if (i >= 0) registry.splice(i, 1)
    }
  }, [id])
}
