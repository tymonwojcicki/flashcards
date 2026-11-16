import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  BookOpen,
  ChevronRight,
  ChevronDown,
  Download,
  FolderInput,
  FolderPlus,
  GraduationCap,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  Zap
} from 'lucide-react'
import type { DeckNode, Id, StudyMode } from '@shared/types'
import { ContextMenu, DropdownMenu, IconButton, Input, Kbd, confirm, toast } from '@renderer/components/ui'
import type { MenuEntry } from '@renderer/components/ui'
import { useApp } from '@renderer/store/app'
import { useEffectiveKeys } from '@renderer/lib/shortcuts'
import { plural } from '@renderer/lib/format'
import { flattenDecks } from '@renderer/lib/decks'
import { canMoveTo } from './actions'

export interface DeckTreeProps {
  tree: DeckNode[]
  onAddSub: (deck: DeckNode) => void
  onMove: (deck: DeckNode) => void
  onExport: (deck: DeckNode) => void
  /** Increment to focus the tree (e.g. after creating a deck). */
  focusId?: Id | null
}

function Pill({ n, tone, label }: { n: number; tone: string; label: string }): React.JSX.Element {
  return (
    <span
      title={`${n} ${label}`}
      className={clsx(
        'font-mono inline-flex h-6 w-12 items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums transition-opacity',
        n === 0 ? 'neu-flat opacity-40' : 'neu-inset',
        tone
      )}
    >
      {n}
    </span>
  )
}

export function DeckTree({ tree, onAddSub, onMove, onExport, focusId }: DeckTreeProps): React.JSX.Element {
  const navigate = useApp((s) => s.navigate)
  const refreshDecks = useApp((s) => s.refreshDecks)
  const setPrefs = useApp((s) => s.setPrefs)
  const studyKey = useEffectiveKeys('deck.study')

  const [override, setOverride] = useState<Record<Id, boolean>>({})
  const [focused, setFocused] = useState<Id | null>(null)
  const [renaming, setRenaming] = useState<Id | null>(null)
  const [renameText, setRenameText] = useState('')
  const [dragId, setDragId] = useState<Id | null>(null)
  const [dropId, setDropId] = useState<Id | 'top' | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Server state caught up: drop optimistic overrides.
  useEffect(() => setOverride({}), [tree])

  const isCollapsed = (d: DeckNode): boolean => override[d.id] ?? d.collapsed

  const rows = useMemo(() => {
    const out: DeckNode[] = []
    const walk = (nodes: DeckNode[], hidden: boolean): void => {
      for (const n of nodes) {
        if (!hidden) out.push(n)
        walk(n.children, hidden || (override[n.id] ?? n.collapsed))
      }
    }
    walk(tree, false)
    return out
  }, [tree, override])

  const byId = useMemo(() => new Map(flattenDecks(tree).map((d) => [d.id, d])), [tree])

  const focusRow = (id: Id): void => {
    setFocused(id)
    requestAnimationFrame(() => {
      containerRef.current?.querySelector<HTMLElement>(`[data-row-id="${id}"]`)?.focus()
    })
  }

  useEffect(() => {
    if (focusId && byId.has(focusId)) focusRow(focusId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId])

  const fail = (e: unknown, fallback: string): void => {
    toast(e instanceof Error ? e.message : fallback, { kind: 'error' })
  }

  const setCollapsed = async (d: DeckNode, collapsed: boolean): Promise<void> => {
    setOverride((o) => ({ ...o, [d.id]: collapsed }))
    try {
      await window.api.setDeckCollapsed(d.id, collapsed)
      await refreshDecks()
    } catch (e) {
      fail(e, 'Could not update deck')
    }
  }

  const study = (d: DeckNode, mode: StudyMode = 'mixed'): void => {
    void setPrefs({ lastDeckId: d.id })
    navigate({ name: 'study', deckId: d.id, mode })
  }

  const startRename = (d: DeckNode): void => {
    setRenaming(d.id)
    setRenameText(d.name)
  }

  const commitRename = async (d: DeckNode): Promise<void> => {
    const name = renameText.trim()
    setRenaming(null)
    focusRow(d.id)
    if (!name || name === d.name) return
    try {
      await window.api.renameDeck(d.id, name)
      await refreshDecks()
    } catch (e) {
      fail(e, 'Could not rename deck')
    }
  }

  const remove = async (d: DeckNode): Promise<void> => {
    const ok = await confirm({
      title: `Delete "${d.name}"?`,
      message: `This permanently deletes the deck${d.children.length ? ', its sub-decks,' : ''} and ${plural(d.counts.total, 'card')}. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    try {
      await window.api.deleteDeck(d.id)
      await refreshDecks()
      toast(`Deleted "${d.name}"`, { kind: 'success' })
    } catch (e) {
      fail(e, 'Could not delete deck')
    }
  }

  const reparent = async (id: Id, parentId: Id | null): Promise<void> => {
    const deck = byId.get(id)
    if (!deck || !canMoveTo(tree, deck, parentId)) return
    try {
      await window.api.moveDeck(id, parentId)
      if (parentId) {
        const p = byId.get(parentId)
        if (p?.collapsed) await window.api.setDeckCollapsed(parentId, false)
      }
      await refreshDecks()
      toast(`Moved "${deck.name}"`, { kind: 'success' })
    } catch (e) {
      fail(e, 'Could not move deck')
    }
  }

  const manageItems = (d: DeckNode): MenuEntry[] => [
    { label: 'Browse cards', icon: <Search size={16} />, onSelect: () => navigate({ name: 'browse', deckId: d.id }) },
    { label: 'Add sub-deck', icon: <FolderPlus size={16} />, onSelect: () => onAddSub(d) },
    { label: 'Rename', icon: <Pencil size={16} />, hotkey: 'F2', onSelect: () => startRename(d) },
    { label: 'Move to…', icon: <FolderInput size={16} />, onSelect: () => onMove(d) },
    {
      label: 'Deck options',
      icon: <Settings2 size={16} />,
      onSelect: () => navigate({ name: 'settings', tab: 'scheduling', deckId: d.id })
    },
    { label: 'Export…', icon: <Download size={16} />, onSelect: () => onExport(d) },
    { type: 'separator' },
    { label: 'Delete', icon: <Trash2 size={16} />, danger: true, onSelect: () => void remove(d) }
  ]

  const studyItems = (d: DeckNode): MenuEntry[] => [
    { label: 'Study', icon: <GraduationCap size={16} />, description: 'Due reviews and new cards', onSelect: () => study(d, 'mixed') },
    { label: 'Review only', icon: <RotateCcw size={16} />, description: 'Due reviews, no new cards', onSelect: () => study(d, 'review') },
    { label: 'Learn new', icon: <Sparkles size={16} />, description: 'New cards only', onSelect: () => study(d, 'learn') },
    {
      label: 'Practice all',
      icon: <Zap size={16} />,
      description: "Every card. Doesn't change your schedule.",
      onSelect: () => study(d, 'cram')
    },
    {
      label: 'Weak spots',
      icon: <Target size={16} />,
      description: "Cards you often forget. Doesn't change your schedule.",
      onSelect: () => study(d, 'weak')
    }
  ]

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT') return
    const rowEl = target.closest<HTMLElement>('[data-row-id]')
    if (!rowEl || rowEl !== target) return // keys on inner buttons keep native behaviour
    const id = rowEl.dataset.rowId as Id
    const i = rows.findIndex((r) => r.id === id)
    const d = rows[i]
    if (!d) return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (rows[i + 1]) focusRow(rows[i + 1].id)
        break
      case 'ArrowUp':
        e.preventDefault()
        if (rows[i - 1]) focusRow(rows[i - 1].id)
        break
      case 'ArrowRight':
        e.preventDefault()
        if (d.children.length > 0) {
          if (isCollapsed(d)) void setCollapsed(d, false)
          else focusRow(d.children[0].id)
        }
        break
      case 'ArrowLeft':
        e.preventDefault()
        if (d.children.length > 0 && !isCollapsed(d)) void setCollapsed(d, true)
        else if (d.parentId) focusRow(d.parentId)
        break
      case 'F2':
        e.preventDefault()
        startRename(d)
        break
      case 'Delete':
        e.preventDefault()
        void remove(d)
        break
      default:
        if (e.key === studyKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault()
          study(d)
        }
    }
  }

  const dragging = dragId ? byId.get(dragId) : null
  const validDrop = (target: Id | null): boolean => !!dragging && canMoveTo(tree, dragging, target)

  const renderNode = (d: DeckNode, level: number): React.JSX.Element => {
    const hasKids = d.children.length > 0
    const collapsed = isCollapsed(d)
    const isFocused = (focused ?? rows[0]?.id) === d.id
    const isDrop = dropId === d.id
    const isRenaming = renaming === d.id
    const reveal = isFocused
      ? 'opacity-100'
      : 'pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100'
    return (
      <div key={d.id} role="none">
        <ContextMenu items={manageItems(d)}>
          <div
            role="treeitem"
            aria-level={level + 1}
            aria-expanded={hasKids ? !collapsed : undefined}
            aria-selected={isFocused}
            data-row-id={d.id}
            tabIndex={isFocused ? 0 : -1}
            draggable={!isRenaming}
            onFocus={(e) => {
              if (e.target === e.currentTarget) setFocused(d.id)
            }}
            onClick={() => setFocused(d.id)}
            onDoubleClick={() => study(d)}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', d.id)
              e.dataTransfer.effectAllowed = 'move'
              setDragId(d.id)
            }}
            onDragEnd={() => {
              setDragId(null)
              setDropId(null)
            }}
            onDragOver={(e) => {
              if (!dragId) return
              if (validDrop(d.id)) {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (dropId !== d.id) setDropId(d.id)
              } else if (dropId === d.id) setDropId(null)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null) && dropId === d.id) setDropId(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              const id = dragId
              setDragId(null)
              setDropId(null)
              if (id && validDrop(d.id)) void reparent(id, d.id)
            }}
            style={{ marginLeft: level * 20 }}
            className={clsx(
              'group relative my-1 flex items-center gap-2 rounded-2xl py-2 pr-2 pl-2 transition-shadow duration-150',
              isFocused ? 'neu-pressed' : 'hover:bg-text/[0.04]',
              isDrop && 'ring-2 ring-accent',
              dragId === d.id && 'opacity-50'
            )}
          >
            {level > 0 && (
              <span aria-hidden className="pointer-events-none absolute top-0 -left-[11px] h-full w-px bg-muted/25" />
            )}
            <button
              type="button"
              tabIndex={-1}
              aria-label={collapsed ? 'Expand' : 'Collapse'}
              onClick={(e) => {
                e.stopPropagation()
                if (hasKids) void setCollapsed(d, !collapsed)
              }}
              className={clsx(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-text',
                !hasKids && 'invisible'
              )}
            >
              <ChevronRight size={16} className={clsx('transition-transform duration-150', !collapsed && 'rotate-90')} />
            </button>

            {isRenaming ? (
              <Input
                autoFocus
                value={renameText}
                className="h-8 max-w-sm flex-1"
                onChange={(e) => setRenameText(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={() => void commitRename(d)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.currentTarget.blur()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setRenameText(d.name)
                    setRenaming(null)
                    focusRow(d.id)
                  }
                }}
              />
            ) : (
              <span className="min-w-0 flex-1 truncate text-[0.95rem] font-medium text-text">{d.name}</span>
            )}

            <div className="flex shrink-0 items-center gap-1.5">
              <Pill n={d.counts.new} tone="text-easy" label="new" />
              <Pill n={d.counts.learning} tone="text-hard" label="learning" />
              <Pill n={d.counts.review} tone="text-good" label="to review" />
            </div>
            <span className="font-mono w-20 shrink-0 text-right text-xs text-muted tabular-nums">
              {plural(d.counts.total, 'card')}
            </span>

            {/* Hover/focus actions float over the end of the name column so the count columns never move. */}
            <div
              className={clsx(
                'absolute top-1/2 right-[18.75rem] flex -translate-y-1/2 items-center gap-1.5 rounded-xl py-1 pr-1 pl-8 transition-opacity duration-150',
                'bg-[linear-gradient(to_right,transparent,var(--bg)_2rem)]',
                reveal
              )}
            >
            <button
              type="button"
              title="Add cards to this deck"
              onClick={(e) => {
                e.stopPropagation()
                navigate({ name: 'add', deckId: d.id })
              }}
              className={clsx(
                'inline-flex h-8 shrink-0 items-center gap-1 rounded-xl px-2.5 text-xs font-bold whitespace-nowrap text-muted transition-colors duration-150 hover:bg-text/5 hover:text-accent active:neu-pressed',
                reveal
              )}
            >
              <Plus size={14} />
              Add cards
            </button>

            <div
              className={clsx(
                'neu-accent inline-flex h-8 shrink-0 items-stretch rounded-xl bg-accent text-accent-contrast transition-all duration-150',
                reveal
              )}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  study(d)
                }}
                className="inline-flex items-center gap-1.5 rounded-l-xl pr-3 pl-3.5 text-[0.8125rem] font-semibold transition-all duration-150 hover:brightness-110 active:brightness-95"
              >
                <Play size={13} fill="currentColor" />
                Study
                {isFocused && <Kbd hotkey={studyKey} tone="onAccent" className="ml-0.5" />}
              </button>
              <span aria-hidden className="my-1.5 w-px bg-accent-contrast/25" />
              <DropdownMenu
                items={studyItems(d)}
                trigger={
                  <button
                    type="button"
                    aria-label={`Study modes for ${d.name}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex w-7 items-center justify-center rounded-r-xl transition-all duration-150 hover:brightness-110 active:brightness-95"
                  >
                    <ChevronDown size={15} />
                  </button>
                }
              />
            </div>
            </div>

            <DropdownMenu
              trigger={
                <button
                  type="button"
                  aria-label={`Actions for ${d.name}`}
                  tabIndex={-1}
                  onClick={(e) => e.stopPropagation()}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:text-accent active:neu-pressed"
                >
                  <MoreHorizontal size={18} />
                </button>
              }
              items={manageItems(d)}
            />
          </div>
        </ContextMenu>
        {hasKids && !collapsed && <div role="group">{d.children.map((c) => renderNode(c, level + 1))}</div>}
      </div>
    )
  }

  return (
    <div>
      {tree.length > 0 && (
        <div aria-hidden className="flex items-center gap-2 px-2 pb-1 text-[0.7rem] font-semibold text-muted">
          <span className="w-6 shrink-0" />
          <span className="flex-1">Deck</span>
          <div className="flex shrink-0 items-center gap-1.5 text-center">
            <span className="w-12 text-easy">New</span>
            <span className="w-12 text-hard">Learning</span>
            <span className="w-12 text-good">Due</span>
          </div>
          <span className="w-20 shrink-0 text-right">Total</span>
          <span className="w-8 shrink-0" />
        </div>
      )}
      <div ref={containerRef} role="tree" aria-label="Decks" onKeyDown={onKeyDown}>
        {tree.map((d) => renderNode(d, 0))}
      </div>
      {dragId && (
        <div
          onDragOver={(e) => {
            if (validDrop(null)) {
              e.preventDefault()
              if (dropId !== 'top') setDropId('top')
            }
          }}
          onDragLeave={() => dropId === 'top' && setDropId(null)}
          onDrop={(e) => {
            e.preventDefault()
            const id = dragId
            setDragId(null)
            setDropId(null)
            if (id && validDrop(null)) void reparent(id, null)
          }}
          className={clsx(
            'anim-fade-in mt-3 flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed py-4 text-sm transition-colors',
            dropId === 'top' ? 'border-accent bg-accent/10 text-accent' : 'border-muted/40 text-muted',
            !validDrop(null) && 'opacity-40'
          )}
        >
          <BookOpen size={16} />
          Drop here for top level
        </div>
      )}
    </div>
  )
}
