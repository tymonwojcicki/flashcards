import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import * as RDialog from '@radix-ui/react-dialog'
import {
  BarChart3,
  CornerDownLeft,
  GraduationCap,
  Keyboard,
  Layers,
  Moon,
  Palette,
  PlusCircle,
  Search,
  Settings,
  Upload
} from 'lucide-react'
import { useApp } from '@renderer/store/app'
import { flattenDecks } from '@renderer/lib/decks'
import { deckPathLabel } from '@renderer/lib/format'
import { SHORTCUTS } from '@renderer/lib/shortcuts'
import type { ShortcutId } from '@renderer/lib/shortcuts'
import { Kbd } from '@renderer/components/ui'

interface Command {
  id: string
  label: string
  /** Secondary text, e.g. the deck path. */
  detail?: string
  icon: React.ReactNode
  hotkey?: string
  run: () => void
}

/** Subsequence fuzzy match; returns a score (higher = better) or -1 for no match. */
function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0
  const idx = t.indexOf(q)
  if (idx >= 0) return 1000 - idx - t.length * 0.1
  let ti = 0
  let score = 0
  let prev = -2
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return -1
    score += found === prev + 1 ? 5 : 1
    prev = found
    ti = found + 1
  }
  return score - t.length * 0.05
}

export function CommandPalette(): React.JSX.Element {
  const open = useApp((s) => s.paletteOpen)
  const setOpen = useApp((s) => s.setPaletteOpen)
  const deckTree = useApp((s) => s.deckTree)
  const navigate = useApp((s) => s.navigate)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const st = useApp.getState
    const sc = (id: ShortcutId): string => SHORTCUTS[id].keys
    const statics: Command[] = [
      { id: 'go-decks', label: 'Go to Decks', icon: <Layers size={17} />, hotkey: sc('nav.decks'), run: () => navigate({ name: 'decks' }) },
      { id: 'go-add', label: 'Add cards', icon: <PlusCircle size={17} />, hotkey: sc('nav.add'), run: () => navigate({ name: 'add' }) },
      { id: 'go-browse', label: 'Browse cards', icon: <Search size={17} />, hotkey: sc('nav.browse'), run: () => navigate({ name: 'browse' }) },
      { id: 'go-stats', label: 'Statistics', icon: <BarChart3 size={17} />, hotkey: sc('nav.stats'), run: () => navigate({ name: 'stats' }) },
      { id: 'go-settings', label: 'Settings', icon: <Settings size={17} />, hotkey: sc('nav.settings'), run: () => navigate({ name: 'settings' }) },
      { id: 'import', label: 'Import CSV / deck file', icon: <Upload size={17} />, run: () => navigate({ name: 'import' }) },
      { id: 'theme', label: 'Toggle light / dark theme', icon: <Moon size={17} />, run: () => st().toggleTheme() },
      { id: 'accent', label: 'Change accent colour', icon: <Palette size={17} />, run: () => st().cycleAccent() },
      { id: 'hints', label: 'Toggle hotkey hints', icon: <Keyboard size={17} />, hotkey: sc('app.toggleHints'), run: () => st().toggleHints() },
      { id: 'help', label: 'Show keyboard shortcuts', icon: <Keyboard size={17} />, hotkey: sc('app.help'), run: () => st().setHelpOpen(true) }
    ]
    const decks: Command[] = flattenDecks(deckTree).flatMap((d) => {
      const path = deckPathLabel(d.path)
      return [
        { id: `study-${d.id}`, label: 'Study', detail: path, icon: <GraduationCap size={17} />, run: () => navigate({ name: 'study', deckId: d.id, mode: 'mixed' }) },
        { id: `add-${d.id}`, label: 'Add cards to', detail: path, icon: <PlusCircle size={17} />, run: () => navigate({ name: 'add', deckId: d.id }) },
        { id: `browse-${d.id}`, label: 'Browse', detail: path, icon: <Search size={17} />, run: () => navigate({ name: 'browse', deckId: d.id }) }
      ]
    })
    return [...statics, ...decks]
  }, [deckTree, navigate])

  const results = useMemo(() => {
    const q = query.trim()
    if (!q) return commands.filter((c) => !c.detail).slice(0, 50)
    return commands
      .map((c) => ({ c, s: fuzzy(q, c.detail ? `${c.label} ${c.detail}` : c.label) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50)
      .map((r) => r.c)
  }, [commands, query])

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (c: Command | undefined): void => {
    if (!c) return
    setOpen(false)
    // Let the dialog close (and release focus) before the action runs.
    setTimeout(c.run, 0)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(results[active])
    }
  }

  return (
    <RDialog.Root open={open} onOpenChange={setOpen}>
      <RDialog.Portal>
        <RDialog.Overlay className="anim-fade-in fixed inset-0 z-50 bg-bg/60 backdrop-blur-sm" />
        <RDialog.Content
          aria-describedby={undefined}
          className="anim-fade-in neu-raised fixed top-[18%] left-1/2 z-50 flex max-h-[60vh] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 flex-col rounded-[24px] p-4"
        >
          <RDialog.Title className="sr-only">Command palette</RDialog.Title>
          <div className="neu-inset flex items-center gap-3 rounded-2xl px-4">
            <Search size={18} className="text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search decks and commands…"
              aria-label="Search decks and commands"
              className="h-12 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
            />
          </div>
          <ul ref={listRef} role="listbox" className="mt-3 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1">
            {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No matches</li>}
            {results.map((c, i) => (
              <li
                key={c.id}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => run(c)}
                className={clsx(
                  'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors duration-100',
                  i === active ? 'bg-accent/14 text-accent' : 'text-text'
                )}
              >
                <span className={i === active ? 'text-accent' : 'text-muted'}>{c.icon}</span>
                <span className="font-medium">{c.label}</span>
                {c.detail && <span className="min-w-0 flex-1 truncate text-muted">{c.detail}</span>}
                {!c.detail && <span className="flex-1" />}
                {c.hotkey && <Kbd hotkey={c.hotkey} />}
                {i === active && <CornerDownLeft size={14} className="shrink-0 text-muted" />}
              </li>
            ))}
          </ul>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}
