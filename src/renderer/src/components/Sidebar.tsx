import { useState } from 'react'
import clsx from 'clsx'
import {
  BarChart3,
  Keyboard,
  Layers,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PlusCircle,
  Search,
  Settings,
  Sun
} from 'lucide-react'
import { useApp, resolveTheme } from '@renderer/store/app'
import type { Route } from '@renderer/store/app'
import { dueTotal } from '@renderer/lib/decks'
import { useEffectiveKeys } from '@renderer/lib/shortcuts'
import type { ShortcutId } from '@renderer/lib/shortcuts'
import { IconButton, Kbd, Switch, Tooltip } from '@renderer/components/ui'

interface NavItem {
  route: Route
  label: string
  icon: React.ReactNode
  shortcut: ShortcutId
}

const NAV: NavItem[] = [
  { route: { name: 'decks' }, label: 'Decks', icon: <Layers size={19} />, shortcut: 'nav.decks' },
  { route: { name: 'add' }, label: 'Add cards', icon: <PlusCircle size={19} />, shortcut: 'nav.add' },
  { route: { name: 'browse' }, label: 'Browse', icon: <Search size={19} />, shortcut: 'nav.browse' },
  { route: { name: 'stats' }, label: 'Stats', icon: <BarChart3 size={19} />, shortcut: 'nav.stats' },
  { route: { name: 'settings' }, label: 'Settings', icon: <Settings size={19} />, shortcut: 'nav.settings' }
]

function NavButton({ item, collapsed, badge }: { item: NavItem; collapsed: boolean; badge?: number }): React.JSX.Element {
  const route = useApp((s) => s.route)
  const navigate = useApp((s) => s.navigate)
  const keys = useEffectiveKeys(item.shortcut)
  const active = route.name === item.route.name
  const btn = (
    <button
      onClick={() => navigate(item.route)}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={clsx(
        'relative flex h-11 w-full items-center gap-3 rounded-2xl px-4 text-sm font-semibold transition-all duration-150',
        collapsed && 'justify-center px-0',
        active ? 'neu-pressed text-accent' : 'text-muted hover:text-text hover:bg-text/5'
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="accent-fill absolute top-2.5 bottom-2.5 left-1 w-[3px] rounded-full shadow-[0_0_10px_2px_var(--accent-glow)]"
        />
      )}
      {item.icon}
      {!collapsed && (
        <>
          <span className="flex-1 text-left whitespace-nowrap">{item.label}</span>
          {badge ? (
            <span className="accent-fill accent-glow font-mono rounded-full bg-accent px-2.5 py-0.5 text-[0.7rem] leading-none font-bold text-accent-contrast tabular-nums">
              {badge > 999 ? '999+' : badge}
            </span>
          ) : null}
          <Kbd hotkey={keys} className="shrink-0" />
        </>
      )}
      {collapsed && badge ? <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-accent accent-fill accent-glow" /> : null}
    </button>
  )
  return collapsed ? (
    <Tooltip content={item.label} hotkey={keys} side="right">
      {btn}
    </Tooltip>
  ) : (
    btn
  )
}

export function Sidebar(): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar-collapsed') === '1'
    } catch {
      return false
    }
  })
  const deckTree = useApp((s) => s.deckTree)
  const showHints = useApp((s) => s.prefs.showHotkeyHints)
  const theme = useApp((s) => resolveTheme(s.prefs.theme))
  const toggleHints = useApp((s) => s.toggleHints)
  const toggleTheme = useApp((s) => s.toggleTheme)
  const setHelpOpen = useApp((s) => s.setHelpOpen)
  const setPaletteOpen = useApp((s) => s.setPaletteOpen)
  const due = deckTree.reduce((sum, d) => sum + dueTotal(d), 0)

  const toggleCollapsed = (): void => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('sidebar-collapsed', c ? '0' : '1')
      } catch {
        /* ignore */
      }
      return !c
    })
  }

  return (
    <nav
      aria-label="Main"
      className={clsx(
        'neu-raised m-4 mr-0 flex shrink-0 flex-col rounded-[24px] p-3 transition-[width] duration-150',
        collapsed ? 'w-[4.5rem]' : 'w-[17rem]'
      )}
    >
      <div className={clsx('flex items-center gap-3 px-1.5 pt-1 pb-4', collapsed && 'justify-center px-0')}>
        <div className="neu-raised-sm flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-accent">
          <Layers size={20} strokeWidth={2.4} />
        </div>
        {!collapsed && <span className="font-display flex-1 text-base font-bold tracking-tight">Flashcards</span>}
        {!collapsed && (
          <IconButton
            label="Collapse sidebar"
            icon={<PanelLeftClose size={16} />}
            size="sm"
            variant="ghost"
            tooltipSide="right"
            onClick={toggleCollapsed}
          />
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {NAV.map((item) => (
          <NavButton key={item.route.name} item={item} collapsed={collapsed} badge={item.route.name === 'decks' ? due : undefined} />
        ))}
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-2 pt-3">
        {collapsed ? (
          <>
            <IconButton label="Expand sidebar" icon={<PanelLeftOpen size={17} />} size="sm" variant="ghost" tooltipSide="right" onClick={toggleCollapsed} />
            <IconButton label="Command palette" icon={<Search size={17} />} size="sm" variant="ghost" tooltipSide="right" onClick={() => setPaletteOpen(true)} />
            <IconButton label="Keyboard shortcuts" icon={<Keyboard size={17} />} size="sm" variant="ghost" tooltipSide="right" onClick={() => setHelpOpen(true)} />
            <IconButton
              label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              icon={theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
              size="sm"
              variant="ghost"
              tooltipSide="right"
              onClick={toggleTheme}
            />
          </>
        ) : (
          <>
            <button
              onClick={() => setPaletteOpen(true)}
              className="neu-inset flex h-10 items-center gap-2 rounded-2xl px-3 text-sm text-muted transition-colors duration-150 hover:text-text"
            >
              <Search size={15} />
              <span className="flex-1 text-left">Search…</span>
              <Kbd hotkey="Ctrl+K" />
            </button>
            <div className="flex items-center justify-between rounded-2xl px-2 py-1">
              <label htmlFor="hint-switch" className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-muted">
                <Keyboard size={15} />
                Hotkey hints
              </label>
              <Switch id="hint-switch" checked={showHints} onCheckedChange={() => toggleHints()} />
            </div>
            <div className="flex items-center justify-between px-1">
              <IconButton
                label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                icon={theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                size="sm"
                variant="ghost"
                onClick={toggleTheme}
              />
              <IconButton label="Keyboard shortcuts" icon={<Keyboard size={16} />} hotkey="?" size="sm" variant="ghost" onClick={() => setHelpOpen(true)} />
            </div>
          </>
        )}
      </div>
    </nav>
  )
}
