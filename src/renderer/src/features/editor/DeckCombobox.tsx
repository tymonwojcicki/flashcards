import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, Folder, Plus } from 'lucide-react'
import type { DeckNode, Id } from '@shared/types'
import { toastError } from '@renderer/components/ui'
import { flattenDecks } from '@renderer/lib/decks'
import { deckPathLabel } from '@renderer/lib/format'

export interface DeckComboboxProps {
  tree: DeckNode[]
  value: Id | null
  onChange: (id: Id | null) => void
  /** Adds an "All decks" entry that selects null (for filters). */
  allowAll?: boolean
  /** Adds a "New deck…" entry. */
  allowNew?: boolean
  /** Called after the user picked something with the keyboard/mouse. */
  onDone?: () => void
  inputRef?: React.RefObject<HTMLInputElement | null>
  placeholder?: string
  label?: string
  className?: string
  /** Called after a deck was created, so callers can refresh the tree. */
  onCreated?: () => void
}

interface Option {
  key: string
  kind: 'all' | 'deck' | 'new'
  id?: Id
  label: string
  depth?: number
  path?: string[]
}

export function DeckCombobox({
  tree,
  value,
  onChange,
  allowAll,
  allowNew,
  onDone,
  inputRef,
  placeholder,
  label,
  className,
  onCreated
}: DeckComboboxProps): React.JSX.Element {
  const localRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? localRef
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const flat = useMemo(() => flattenDecks(tree), [tree])
  const selected = flat.find((d) => d.id === value) ?? null
  const selectedLabel = selected ? deckPathLabel(selected.path) : allowAll ? 'All decks' : ''

  const options = useMemo<Option[]>(() => {
    const q = query.trim().toLowerCase()
    const out: Option[] = []
    if (allowAll && !q) out.push({ key: 'all', kind: 'all', label: 'All decks' })
    for (const d of flat) {
      const label = deckPathLabel(d.path)
      if (!q || label.toLowerCase().includes(q) || d.path.join('::').toLowerCase().includes(q))
        out.push({ key: d.id, kind: 'deck', id: d.id, label, depth: d.depth, path: d.path })
    }
    if (allowNew)
      out.push({ key: 'new', kind: 'new', label: q ? `Create deck "${query.trim()}"` : 'New deck…' })
    return out
  }, [flat, query, allowAll, allowNew])

  useEffect(() => setActive(0), [query, open])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  })

  function close(): void {
    setOpen(false)
    setQuery('')
    setCreating(false)
  }

  async function create(path: string): Promise<void> {
    try {
      onChange(await window.api.createDeckPath(path, null))
      onCreated?.()
      close()
      onDone?.()
    } catch (e) {
      toastError(e, 'Could not create deck')
    }
  }

  function choose(opt: Option | undefined): void {
    if (!opt) return
    if (opt.kind === 'new') {
      if (query.trim()) void create(query.trim())
      else {
        setCreating(true)
        setQuery('')
      }
      return
    }
    onChange(opt.kind === 'all' ? null : (opt.id ?? null))
    close()
    onDone?.()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(options.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      if (creating) {
        if (query.trim()) void create(query.trim())
      } else if (!open) setOpen(true)
      else choose(options[active])
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        e.stopPropagation()
        close()
      }
    } else if (e.key === 'Tab') {
      close()
    }
  }

  return (
    <div ref={wrapRef} className={clsx('relative', className)}>
      <div className="relative">
        <Folder size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
        <input
          ref={ref}
          role="combobox"
          aria-expanded={open}
          aria-label={label ?? 'Deck'}
          title={!open && selectedLabel ? selectedLabel : undefined}
          aria-autocomplete="list"
          spellCheck={false}
          value={open || creating ? query : selectedLabel}
          placeholder={creating ? 'New deck name (use :: for subdecks)' : open ? 'Type to filter decks…' : (placeholder ?? 'Choose a deck')}
          onFocus={(e) => {
            setOpen(true)
            e.currentTarget.select()
          }}
          onBlur={(e) => {
            // Focus moved elsewhere (Tab, a shortcut): close the list.
            if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) close()
          }}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onKeyDown={onKeyDown}
          className="neu-inset h-10 w-full rounded-2xl border border-transparent bg-bg pr-9 pl-10 text-sm text-text placeholder:text-muted/80 focus-visible:border-accent"
        />
        <ChevronDown size={16} className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-muted" />
      </div>
      {open && !creating && (
        <div
          ref={listRef}
          role="listbox"
          className="anim-menu-in neu-raised absolute top-full left-0 z-[70] mt-2 max-h-72 w-max max-w-[min(30rem,calc(100vw-2rem))] min-w-full overflow-y-auto rounded-2xl p-1.5"
        >
          {options.length === 0 && <div className="px-3 py-2 text-sm text-muted">No matching decks</div>}
          {options.map((o, i) => (
            <div
              key={o.key}
              role="option"
              aria-selected={o.id === value}
              data-active={i === active}
              onMouseMove={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(o)
              }}
              className={clsx(
                'flex cursor-pointer items-start gap-2 rounded-xl px-3 py-2 text-sm',
                i === active ? 'bg-accent/12 text-accent' : 'text-text',
                o.kind === 'deck' && o.id === value && 'font-semibold'
              )}
            >
              {o.kind === 'new' && <Plus size={14} className="mt-0.5 shrink-0" />}
              {o.kind === 'deck' && o.path && o.path.length > 1 ? (
                <span className="min-w-0 break-words">
                  <span className={i === active ? 'opacity-70' : 'text-muted'}>
                    {o.path.slice(0, -1).join(' › ')} ›{' '}
                  </span>
                  <span>{o.path[o.path.length - 1]}</span>
                </span>
              ) : (
                <span className="min-w-0 break-words">{o.label}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
