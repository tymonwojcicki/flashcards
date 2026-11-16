import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  BarChart3,
  Captions,
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
  { route: { name: 'browse' }, label: 'Browse', icon: <Search size={19} />, shortcut: 'nav.browse' },
  { route: { name: 'add' }, label: 'Add cards', icon: <PlusCircle size={19} />, shortcut: 'nav.add' },
  { route: { name: 'stats' }, label: 'Stats', icon: <BarChart3 size={19} />, shortcut: 'nav.stats' }
]

const SETTINGS_ITEM: NavItem = {
  route: { name: 'settings' },
  label: 'Settings',
  icon: <Settings size={19} />,
  shortcut: 'nav.settings'
}

function NavButton({ item, collapsed, badge }: { item: NavItem; collapsed: boolean; badge?: number }): React.JSX.Element {
  const route = useApp((s) => s.route)
  const navigate = useApp((s) => s.navigate)
  const keys = useEffectiveKeys(item.shortcut)
  const active = route.name === item.route.name
  const btn = (
    <button
      data-sound={active ? 'none' : 'nav'}
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

/** Same grid as NavButton (px-4, 19px icon, gap-3) so icons, labels and right edges line up. */
function ToggleRow(props: { id: string; icon: React.ReactNode; label: string; checked: boolean; onChange: () => void }): React.JSX.Element {
  return (
    <div className="flex h-11 items-center gap-3 rounded-2xl px-4 text-muted">
      {props.icon}
      <label htmlFor={props.id} className="flex-1 cursor-pointer whitespace-nowrap">
        {props.label}
      </label>
      <Switch id={props.id} checked={props.checked} onCheckedChange={() => props.onChange()} />
    </div>
  )
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }): React.JSX.Element {
  const helpKeys = useEffectiveKeys('app.help')
  const deckTree = useApp((s) => s.deckTree)
  const showHints = useApp((s) => s.prefs.showHotkeyHints)
  const theme = useApp((s) => resolveTheme(s.prefs.theme))
  const toggleHints = useApp((s) => s.toggleHints)
  const toggleTheme = useApp((s) => s.toggleTheme)
  const setHelpOpen = useApp((s) => s.setHelpOpen)
  const due = deckTree.reduce((sum, d) => sum + dueTotal(d), 0)

  const [hover, setHover] = useState(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(leaveTimer.current), [])
  const floating = collapsed && hover
  const compact = collapsed && !hover

  const onEnter = (): void => {
    clearTimeout(leaveTimer.current)
    setHover(true)
  }
  const onLeave = (): void => {
    clearTimeout(leaveTimer.current)
    leaveTimer.current = setTimeout(() => setHover(false), 150)
  }

  const toggleCollapsed = (): void => {
    onToggle()
    setHover(false)
  }

  return (
    <div
      className={clsx(
        'relative m-4 mr-0 shrink-0 transition-[width] duration-150',
        collapsed ? 'w-[4.5rem]' : 'w-[17rem]'
      )}
      onMouseEnter={collapsed ? onEnter : undefined}
      onMouseLeave={collapsed ? onLeave : undefined}
    >
      {/* Collapsed: the hover area runs from the screen's left edge (and full height) to the rail's right edge. */}
      {collapsed && <div aria-hidden className="absolute -top-4 -bottom-4 -left-4 right-0" />}
      <nav
        aria-label="Main"
        data-floating={floating || undefined}
        className={clsx(
          'neu-raised absolute inset-y-0 left-0 flex flex-col rounded-[24px] p-3 transition-[width] duration-150',
          compact ? 'w-[4.5rem]' : 'w-[17rem]',
          floating && 'z-40'
        )}
      >
        <div className={clsx('flex items-center gap-3 px-1.5 pt-1 pb-4', compact && 'justify-center px-0')}>
          <div className="neu-raised-sm flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-accent">
            <Layers size={20} strokeWidth={2.4} />
          </div>
          {!compact && <span className="font-display flex-1 text-base font-bold tracking-tight">Flashcards</span>}
          {!compact && (
            <IconButton
              label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              icon={collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              size="sm"
              variant="ghost"
              tooltipSide="right"
              onClick={toggleCollapsed}
            />
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          {NAV.map((item) => (
            <NavButton key={item.route.name} item={item} collapsed={compact} badge={item.route.name === 'decks' ? due : undefined} />
          ))}
        </div>

        <div className="flex-1" />

        <div className={clsx('flex flex-col gap-2 pt-3', compact && 'items-center')}>
          <NavButton item={SETTINGS_ITEM} collapsed={compact} />
          {compact ? (
            <>
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
                onClick={() => setHelpOpen(true)}
                className="flex h-11 w-full items-center gap-3 rounded-2xl px-4 text-sm font-semibold text-muted transition-all duration-150 hover:bg-text/5 hover:text-text"
              >
                <Keyboard size={19} />
                <span className="flex-1 text-left whitespace-nowrap">Shortcuts</span>
                <Kbd hotkey={helpKeys} className="shrink-0" />
              </button>
              <ToggleRow id="hint-switch" icon={<Captions size={19} />} label="Hotkey hints" checked={showHints} onChange={toggleHints} />
              <ToggleRow
                id="theme-switch"
                icon={theme === 'dark' ? <Moon size={19} /> : <Sun size={19} />}
                label="Dark mode"
                checked={theme === 'dark'}
                onChange={toggleTheme}
              />
            </>
          )}
        </div>
      </nav>
    </div>
  )
}
