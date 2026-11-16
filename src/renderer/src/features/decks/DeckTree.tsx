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
  const cancelRef = useRef(false)
  const renamingRef = useRef(false)
  const keepFocusRef = useRef(false)
  const keepRenameFocus = (e: Event): void => {
    if (keepFocusRef.current || renamingRef.current) e.preventDefault()
  }

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
    cancelRef.current = false
    keepFocusRef.current = true
    renamingRef.current = true
    setRenaming(d.id)
    setRenameText(d.name)
    // Menus hand focus back to their trigger when they close; take it back once that has happened.
    setTimeout(() => {
      const el = containerRef.current?.querySelector<HTMLInputElement>('input[data-rename]')
      el?.focus()
      el?.select()
      keepFocusRef.current = false
    }, 250)
  }

  const commitRename = async (d: DeckNode): Promise<void> => {
    renamingRef.current = false
    if (cancelRef.current) {
      cancelRef.current = false
      return
    }
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
      message: `This moves the deck${d.children.length ? ', its sub-decks,' : ''} and ${plural(d.counts.total, 'card')} to Trash. You can restore them from Trash for 30 days.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    try {
      const trashId = await window.api.deleteDeck(d.id)
      await refreshDecks()
      toast(`Deleted "${d.name}"`, {
        kind: 'success',
        action: trashId
          ? {
              label: 'Undo',
              onClick: () =>
                void window.api.restoreTrash(trashId).then(
                  () => refreshDecks(),
                  (e) => fail(e, 'Could not restore deck')
                )
            }
          : undefined
      })
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
    { type: 'separator' },
    { label: 'Rename', icon: <Pencil size={16} />, onSelect: () => startRename(d) },
    { label: 'Move to…', icon: <FolderInput size={16} />, onSelect: () => onMove(d) },
    {
      label: 'Deck options',
      icon: <Settings2 size={16} />,
      onSelect: () => navigate({ name: 'settings', tab: 'scheduling', deckId: d.id })
    },
    { type: 'separator' },
    { label: 'Export…', icon: <Download size={16} />, onSelect: () => onExport(d) },
    { type: 'separator' },
    { label: 'Delete', icon: <Trash2 size={16} />, danger: true, onSelect: () => void remove(d) }
  ]

  // Weak-spot counts depend on memory strength, so they're computed when the study menu opens.
  const [weakCounts, setWeakCounts] = useState<Record<Id, number | null>>({})
  const loadWeak = (d: DeckNode): void => {
    setWeakCounts((m) => ({ ...m, [d.id]: m[d.id] ?? null }))
    window.api.getSession(d.id, 'weak').then(
      (s) => setWeakCounts((m) => ({ ...m, [d.id]: s.cards.length })),
      () => setWeakCounts((m) => ({ ...m, [d.id]: 0 }))
    )
  }

  const studyItems = (d: DeckNode): MenuEntry[] => {
    const c = d.counts
    return [
      { label: 'Study', icon: <GraduationCap size={16} />, description: 'Due reviews and new cards', count: c.learning + c.review + c.new, onSelect: () => study(d, 'mixed') },
      { label: 'Review only', icon: <RotateCcw size={16} />, description: 'Due reviews, no new cards', count: c.learning + c.review, onSelect: () => study(d, 'review') },
      { label: 'Learn new', icon: <Sparkles size={16} />, description: 'New cards only', count: c.new, onSelect: () => study(d, 'learn') },
      {
        label: 'Practice all',
        icon: <Zap size={16} />,
        description: "Every card. Doesn't change your schedule.",
        count: c.total,
        onSelect: () => study(d, 'cram')
      },
      {
        label: 'Weak spots',
        icon: <Target size={16} />,
        description: "Cards you often forget. Doesn't change your schedule.",
        count: weakCounts[d.id] ?? null,
        onSelect: () => study(d, 'weak')
      }
    ]
  }

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
    }
  }

  // Study key (Enter by default) starts the highlighted deck. Handled at window level because the
  // highlighted row is not always the focused element (e.g. right after the page opens). Keys on
  // buttons, inputs and inside dialogs keep their own behaviour.
  const studyRef = useRef<() => void>(() => {})
  studyRef.current = () => {
    const d = (focused && byId.get(focused)) || rows[0]
    if (d) study(d)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (e.key !== studyKey) return
      if (renamingRef.current) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return
      const a = document.activeElement as HTMLElement | null
      const onRow = !!a?.matches('[data-row-id]')
      if (!onRow && a && a !== document.body && !a.matches('main, [role="tree"]')) return
      e.preventDefault()
      studyRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [studyKey])

  const dragging = dragId ? byId.get(dragId) : null
  const validDrop = (target: Id | null): boolean => !!dragging && canMoveTo(tree, dragging, target)

  const renderNode = (d: DeckNode, level: number, index: number): React.JSX.Element => {
    const hasKids = d.children.length > 0
    const collapsed = isCollapsed(d)
    const isFocused = (focused ?? rows[0]?.id) === d.id
    const isDrop = dropId === d.id
    const isRenaming = renaming === d.id
    const reveal = isFocused
      ? 'opacity-100'
      : 'pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100'
    return (
      <div key={d.id} role="none" className="anim-row" style={{ '--i': index } as React.CSSProperties}>
        <ContextMenu items={manageItems(d)} onCloseAutoFocus={keepRenameFocus}>
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
                data-rename=""
                value={renameText}
                className="h-8 max-w-sm flex-1"
                onChange={(e) => setRenameText(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={() => {
                  if (keepFocusRef.current) return // focus is still being handed over from the menu
                  void commitRename(d)
                }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.currentTarget.blur()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelRef.current = true
                    renamingRef.current = false
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
                'inline-flex h-8 shrink-0 items-center gap-1 rounded-xl pr-2.5 pl-2 text-xs font-bold whitespace-nowrap btn-ghost btn-shine press active:neu-pressed',
                reveal
              )}
            >
              <Plus size={14} />
              <span className="btn-label">Add cards</span>
            </button>

            <div
              className={clsx(
                'neu-accent btn-invite inline-flex h-8 shrink-0 items-stretch rounded-xl bg-accent text-accent-contrast',
                reveal
              )}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  study(d)
                }}
                className="inline-flex items-center gap-1.5 rounded-l-xl pr-3 pl-3.5 text-[0.8125rem] font-semibold press hover:brightness-110 active:brightness-95"
              >
                <Play size={13} fill="currentColor" />
                Study
                {isFocused && <Kbd hotkey={studyKey} tone="onAccent" className="ml-0.5" />}
              </button>
              <span aria-hidden className="my-1.5 w-px bg-accent-contrast/25" />
              <DropdownMenu
                items={studyItems(d)}
                onOpenChange={(open) => open && loadWeak(d)}
                trigger={
                  <button
                    type="button"
                    aria-label={`Study modes for ${d.name}`}
                    data-usage="Study modes"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex w-7 items-center justify-center rounded-r-xl press hover:brightness-110 active:brightness-95"
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
                  data-usage="Deck actions"
                  tabIndex={-1}
                  onClick={(e) => e.stopPropagation()}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full btn-quiet press active:neu-pressed"
                >
                  <MoreHorizontal size={18} />
                </button>
              }
              items={manageItems(d)}
              onCloseAutoFocus={keepRenameFocus}
            />
          </div>
        </ContextMenu>
        {hasKids && !collapsed && <div role="group">{d.children.map((c, i) => renderNode(c, level + 1, i))}</div>}
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
        {tree.map((d, i) => renderNode(d, 0, i))}
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
