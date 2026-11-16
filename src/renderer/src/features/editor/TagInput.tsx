import { useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { X } from 'lucide-react'

export interface TagInputProps {
  tags: string[]
  onChange: (tags: string[]) => void
  suggestions?: string[]
  label?: string
  placeholder?: string
  className?: string
}

/** Chip-style tag editor. Space / Enter / comma add; Backspace on empty removes the last chip. */
export function TagInput({ tags, onChange, suggestions = [], label = 'Tags', placeholder, className }: TagInputProps): React.JSX.Element {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase()
    if (!q) return []
    return suggestions.filter((s) => s.toLowerCase().includes(q) && !tags.includes(s)).slice(0, 6)
  }, [text, suggestions, tags])

  function add(raw: string): void {
    const parts = raw
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean)
    if (parts.length === 0) return
    const next = [...tags]
    for (const p of parts) if (!next.some((t) => t.toLowerCase() === p.toLowerCase())) next.push(p)
    onChange(next)
    setText('')
    setActive(-1)
  }

  return (
    <div className={clsx('relative flex flex-col gap-2', className)}>
      <label className="text-sm font-semibold text-text" onClick={() => inputRef.current?.focus()}>
        {label}
      </label>
      <div
        className="neu-inset flex min-h-10 flex-wrap items-center gap-1.5 rounded-2xl border border-transparent px-2.5 py-1.5 focus-within:border-accent"
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((t) => (
          <span
            key={t}
            className="neu-raised-sm inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs font-medium text-text"
          >
            {t}
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Remove tag ${t}`}
              className="flex h-4 w-4 items-center justify-center rounded-full text-muted hover:text-danger"
              onClick={(e) => {
                e.stopPropagation()
                onChange(tags.filter((x) => x !== t))
              }}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={text}
          aria-label={label}
          placeholder={tags.length === 0 ? (placeholder ?? 'Add tags…') : ''}
          spellCheck={false}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            add(text)
          }}
          onChange={(e) => {
            const v = e.target.value
            if (/[\s,]$/.test(v)) add(v)
            else {
              setText(v)
              setActive(-1)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (e.ctrlKey || e.metaKey) return
              e.preventDefault()
              const pick = active >= 0 ? matches[active] : undefined
              add(pick ?? text)
            } else if (e.key === 'Backspace' && text === '' && tags.length > 0) {
              onChange(tags.slice(0, -1))
            } else if (e.key === 'ArrowDown' && matches.length) {
              e.preventDefault()
              setActive((a) => Math.min(matches.length - 1, a + 1))
            } else if (e.key === 'ArrowUp' && matches.length) {
              e.preventDefault()
              setActive((a) => Math.max(-1, a - 1))
            } else if (e.key === 'Escape' && text) {
              e.preventDefault()
              e.stopPropagation()
              setText('')
            }
          }}
          className="min-w-24 flex-1 bg-transparent px-1 py-1 text-sm text-text placeholder:text-muted/80"
        />
      </div>
      {focused && matches.length > 0 && (
        <div className="anim-menu-in neu-raised absolute top-full right-0 left-0 z-[60] mt-1 rounded-2xl p-1.5">
          {matches.map((m, i) => (
            <div
              key={m}
              onMouseDown={(e) => {
                e.preventDefault()
                add(m)
              }}
              onMouseMove={() => setActive(i)}
              className={clsx(
                'cursor-pointer rounded-xl px-3 py-1.5 text-sm',
                i === active ? 'bg-accent/12 text-accent' : 'text-text'
              )}
            >
              {m}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
