import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { Bold, Image as ImageIcon, Italic, List, Sigma, Underline as UnderlineIcon } from 'lucide-react'
import { IconButton, Kbd, toast } from '@renderer/components/ui'
import { useEffectiveKeys } from '@renderer/lib/shortcuts'
import type { MathfieldElement } from 'mathlive'
import { MathBlock, MathInline } from './mathExtensions'
import type { MathEditRequest } from './mathExtensions'
import { imageFilesFrom, saveImageFile } from './media'
import { eventMatches } from './keys'
import './editor.css'

export interface CardFieldProps {
  /** HTML content. */
  value: string
  onChange: (html: string) => void
  placeholder?: string
  autoFocus?: boolean
  /** Called on the "save" shortcut (Ctrl+Enter by default) while this editor is focused. */
  onSubmit?: () => void
  label: string
  /** Receives the TipTap editor instance (e.g. to call editor.commands.focus()). */
  editorRef?: { current: Editor | null }
  className?: string
}

interface MathState {
  pos: number
  kind: 'inline' | 'block'
  latex: string
  isNew: boolean
  anchor: DOMRect
}

function normalize(html: string): string {
  return html === '<p></p>' ? '' : html
}

/** Empty MathLive slots come out as \placeholder{}, which KaTeX can't render; drop them. */
const cleanLatex = (l: string): string => l.replace(/\\placeholder(\[[^\]]*\])?\{[^{}]*\}/g, '')

type MathfieldEl = HTMLElement & MathfieldElement

/** MathLive is loaded on first use so it stays out of the main bundle. */
let mathliveLoad: Promise<void> | null = null
function loadMathlive(): Promise<void> {
  if (!mathliveLoad) {
    mathliveLoad = import('mathlive').then(({ MathfieldElement }) => {
      // Fonts ship with the app (see vite.mathlive-fonts.ts); no sounds are fetched.
      MathfieldElement.fontsDirectory = new URL('./mathlive-fonts', document.baseURI).href
      MathfieldElement.soundsDirectory = null
      MathfieldElement.plonkSound = null
    })
    mathliveLoad.catch(() => {
      mathliveLoad = null
    })
  }
  return mathliveLoad
}

function MathPopover({
  state,
  onConfirm,
  onCancel
}: {
  state: MathState
  onConfirm: (latex: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [latex, setLatex] = useState(state.latex)
  const [ready, setReady] = useState(false)
  const [source, setSource] = useState(false)
  const hostRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<MathfieldEl | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const latexRef = useRef(latex)
  latexRef.current = latex
  const doneRef = useRef(false)
  const onConfirmRef = useRef(onConfirm)
  onConfirmRef.current = onConfirm
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  const confirm = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    onConfirmRef.current(latexRef.current)
  }, [])
  const cancel = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    onCancelRef.current()
  }, [])

  useEffect(() => {
    let alive = true
    loadMathlive()
      .then(() => alive && setReady(true))
      .catch(() => {
        if (!alive) return
        setReady(true)
        setSource(true)
      })
    return () => {
      alive = false
      window.mathVirtualKeyboard?.hide({ animate: false })
    }
  }, [])

  // Create the <math-field> imperatively (visual mode only) and keep `latex` in sync with it.
  useEffect(() => {
    if (!ready || source || !hostRef.current) return
    const mf = document.createElement('math-field') as MathfieldEl
    mf.setAttribute('aria-label', 'Formula')
    mf.mathVirtualKeyboardPolicy = 'manual'
    mf.value = latexRef.current
    mf.addEventListener('input', () => {
      latexRef.current = cleanLatex(mf.getValue('latex'))
      setLatex(latexRef.current)
    })
    mf.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
          e.preventDefault()
          e.stopPropagation()
          latexRef.current = cleanLatex(mf.getValue('latex'))
          confirm()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          cancel()
        }
      },
      true
    )
    hostRef.current.appendChild(mf)
    fieldRef.current = mf
    const t = window.setTimeout(() => mf.focus(), 0)
    return () => {
      window.clearTimeout(t)
      fieldRef.current = null
      window.mathVirtualKeyboard?.hide({ animate: false })
      mf.remove()
    }
  }, [ready, source, confirm, cancel])

  useEffect(() => {
    const down = (e: MouseEvent): void => {
      const target = e.target as Element | null
      if (!boxRef.current || boxRef.current.contains(target) || doneRef.current) return
      // Taps on MathLive's virtual keyboard (rendered outside the popover) are not "outside".
      if (target?.closest?.('.ML__keyboard, .MLK__plate, .ML__popover')) return
      confirm()
    }
    document.addEventListener('mousedown', down, true)
    return () => document.removeEventListener('mousedown', down, true)
  }, [confirm])

  const width = 340
  const left = Math.max(12, Math.min(state.anchor.left, window.innerWidth - width - 12))
  const below = state.anchor.bottom + 8
  const top = below + 120 > window.innerHeight ? Math.max(12, state.anchor.top - 128) : below

  return createPortal(
    <div ref={boxRef} className="math-popover neu-raised anim-menu-in" style={{ left, top, width }}>
      {source ? (
        <input
          autoFocus
          value={latex}
          onChange={(e) => setLatex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.stopPropagation()
              confirm()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              cancel()
            }
          }}
          spellCheck={false}
          placeholder="LaTeX"
          aria-label="LaTeX"
          className="neu-inset h-11 w-full rounded-xl border border-transparent bg-bg px-3 font-mono text-sm text-text focus-visible:border-accent"
        />
      ) : (
        <div ref={hostRef} className="math-field-host" aria-busy={!ready} />
      )}
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
        <button
          type="button"
          className="underline-offset-2 hover:text-text hover:underline"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setSource((v) => !v)
          }}
        >
          {source ? 'Back to visual editor' : 'Edit as LaTeX'}
        </button>
        <span className="flex items-center gap-2">
          <span>
            <Kbd hotkey="Enter" force /> confirm
          </span>
          <span>
            <Kbd hotkey="Esc" force /> cancel
          </span>
        </span>
      </div>
    </div>,
    document.body
  )
}

export function CardField({
  value,
  onChange,
  placeholder,
  autoFocus,
  onSubmit,
  label,
  editorRef,
  className
}: CardFieldProps): React.JSX.Element {
  const [focused, setFocused] = useState(false)
  const [math, setMath] = useState<MathState | null>(null)
  const mathRef = useRef<MathState | null>(null)
  mathRef.current = math
  const lastEmitted = useRef(value)
  const cb = useRef({ onChange, onSubmit })
  cb.current = { onChange, onSubmit }
  const editorInst = useRef<Editor | null>(null)
  const mathKeys = useEffectiveKeys('creator.math')
  const imageKeys = useEffectiveKeys('creator.image')

  const insertImageUrl = useCallback((url: string, pos?: number) => {
    const ed = editorInst.current
    if (!ed) return
    if (pos === undefined) ed.chain().focus().setImage({ src: url }).run()
    else ed.chain().focus().insertContentAt(pos, { type: 'image', attrs: { src: url } }).run()
  }, [])

  const insertFiles = useCallback(
    async (files: File[], pos?: number) => {
      for (const f of files) {
        try {
          insertImageUrl(await saveImageFile(f), pos)
        } catch (e) {
          toast(e instanceof Error ? e.message : 'Could not add image', { kind: 'error' })
        }
      }
    },
    [insertImageUrl]
  )

  const pickImage = useCallback(async () => {
    try {
      const url = await window.api.pickImage()
      if (url) insertImageUrl(url)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add image', { kind: 'error' })
    }
  }, [insertImageUrl])

  const openMathAt = useCallback((req: MathEditRequest | { pos: number; kind: 'inline' | 'block'; latex: string }, isNew: boolean) => {
    const ed = editorInst.current
    if (!ed) return
    const dom = 'dom' in req ? req.dom : (ed.view.nodeDOM(req.pos) as HTMLElement | null)
    if (!dom || !(dom instanceof HTMLElement)) return
    setMath({ pos: req.pos, kind: req.kind, latex: req.latex, isNew, anchor: dom.getBoundingClientRect() })
  }, [])

  const insertMath = useCallback(() => {
    const ed = editorInst.current
    if (!ed) return
    const { from, to, empty } = ed.state.selection
    const latex = empty ? '' : ed.state.doc.textBetween(from, to, ' ')
    ed.chain().focus().insertContentAt({ from, to }, { type: 'mathInline', attrs: { latex } }).run()
    openMathAt({ pos: from, kind: 'inline', latex }, true)
  }, [openMathAt])

  const insertMathRef = useRef(insertMath)
  insertMathRef.current = insertMath
  const pickImageRef = useRef(pickImage)
  pickImageRef.current = pickImage
  const insertFilesRef = useRef(insertFiles)
  insertFilesRef.current = insertFiles

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        link: false
      }),
      Image.configure({ inline: true }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      MathInline.configure({ onEdit: (r: MathEditRequest) => openMathAt(r, false) }),
      MathBlock.configure({ onEdit: (r: MathEditRequest) => openMathAt(r, false) })
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const editor = useEditor({
    extensions,
    content: value,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { class: 'card-editor-content', 'aria-label': label, role: 'textbox', 'aria-multiline': 'true' },
      handleKeyDown: (_view, event) => {
        if (eventMatches(event, 'creator.save') && cb.current.onSubmit) {
          event.preventDefault()
          event.stopPropagation()
          cb.current.onSubmit()
          return true
        }
        if (eventMatches(event, 'creator.math')) {
          event.preventDefault()
          event.stopPropagation()
          insertMathRef.current()
          return true
        }
        if (eventMatches(event, 'creator.image')) {
          event.preventDefault()
          event.stopPropagation()
          void pickImageRef.current()
          return true
        }
        return false
      },
      handlePaste: (_view, event) => {
        const files = imageFilesFrom(event.clipboardData?.items)
        if (files.length === 0) return false
        event.preventDefault()
        void insertFilesRef.current(files)
        return true
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false
        const files = imageFilesFrom(event.dataTransfer?.files)
        if (files.length === 0) return false
        event.preventDefault()
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        void insertFilesRef.current(files, pos)
        return true
      }
    },
    onUpdate: ({ editor: ed }) => {
      const html = normalize(ed.getHTML())
      lastEmitted.current = html
      cb.current.onChange(html)
    },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false)
  })

  useEffect(() => {
    editorInst.current = editor
    if (editorRef) editorRef.current = editor
    return () => {
      if (editorRef && editorRef.current === editor) editorRef.current = null
    }
  }, [editor, editorRef])

  // External value changes (cleared after save, loaded for editing).
  useEffect(() => {
    if (!editor || value === lastEmitted.current) return
    lastEmitted.current = value
    editor.commands.setContent(value || '', { emitUpdate: false })
  }, [value, editor])

  const active = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      bold: ed?.isActive('bold') ?? false,
      italic: ed?.isActive('italic') ?? false,
      underline: ed?.isActive('underline') ?? false,
      list: ed?.isActive('bulletList') ?? false
    })
  }) ?? { bold: false, italic: false, underline: false, list: false }

  const commitMath = useCallback((latex: string) => {
    const ed = editorInst.current
    const m = mathRef.current
    setMath(null)
    if (!ed || !m) return
    const node = ed.state.doc.nodeAt(m.pos)
    if (node && (node.type.name === 'mathInline' || node.type.name === 'mathBlock')) {
      const clean = latex.trim()
      if (!clean && m.isNew) {
        ed.chain().focus().deleteRange({ from: m.pos, to: m.pos + node.nodeSize }).run()
      } else {
        ed.chain()
          .command(({ tr }) => {
            tr.setNodeMarkup(m.pos, undefined, { latex: clean })
            return true
          })
          .focus()
          .setTextSelection(m.pos + node.nodeSize)
          .run()
      }
    } else ed.commands.focus()
  }, [])

  const cancelMath = useCallback(() => {
    const ed = editorInst.current
    const m = mathRef.current
    setMath(null)
    if (!ed || !m) return
    const node = ed.state.doc.nodeAt(m.pos)
    if (node && m.isNew) ed.chain().focus().deleteRange({ from: m.pos, to: m.pos + node.nodeSize }).run()
    else if (node) ed.chain().focus().setTextSelection(m.pos + node.nodeSize).run()
    else ed.commands.focus()
  }, [])

  const showToolbar = focused || math !== null
  const keep = (e: React.MouseEvent): void => e.preventDefault()

  return (
    <div className={clsx('flex flex-col gap-2', className)}>
      <div className="flex min-h-8 items-center justify-between gap-2">
        <label
          className="text-sm font-semibold text-text"
          onClick={() => editor?.commands.focus()}
        >
          {label}
        </label>
        <div
          className={clsx(
            'flex items-center gap-0.5 transition-opacity duration-150',
            showToolbar ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
          onMouseDown={keep}
        >
          <IconButton
            size="sm"
            variant="ghost"
            label="Bold"
            hotkey="Ctrl+B"
            tabIndex={-1}
            className={clsx(active.bold && 'bg-accent/15 text-accent')}
            onClick={() => editor?.chain().focus().toggleBold().run()}
            icon={<Bold size={15} />}
          />
          <IconButton
            size="sm"
            variant="ghost"
            label="Italic"
            hotkey="Ctrl+I"
            tabIndex={-1}
            className={clsx(active.italic && 'bg-accent/15 text-accent')}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            icon={<Italic size={15} />}
          />
          <IconButton
            size="sm"
            variant="ghost"
            label="Underline"
            hotkey="Ctrl+U"
            tabIndex={-1}
            className={clsx(active.underline && 'bg-accent/15 text-accent')}
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
            icon={<UnderlineIcon size={15} />}
          />
          <IconButton
            size="sm"
            variant="ghost"
            label="Bulleted list"
            hotkey="Ctrl+Shift+8"
            tabIndex={-1}
            className={clsx(active.list && 'bg-accent/15 text-accent')}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            icon={<List size={15} />}
          />
          <IconButton
            size="sm"
            variant="ghost"
            label="Math"
            hotkey={mathKeys}
            tabIndex={-1}
            onClick={insertMath}
            icon={<Sigma size={15} />}
          />
          <IconButton
            size="sm"
            variant="ghost"
            label="Image"
            hotkey={imageKeys}
            tabIndex={-1}
            onClick={() => void pickImage()}
            icon={<ImageIcon size={15} />}
          />
        </div>
      </div>
      <div className="card-editor neu-inset rounded-[16px] transition-shadow duration-150">
        <EditorContent editor={editor} />
      </div>
      {math && <MathPopover state={math} onConfirm={commitMath} onCancel={cancelMath} />}
    </div>
  )
}
