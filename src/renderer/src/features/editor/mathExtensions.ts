import { InputRule, Node, mergeAttributes } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import katex from 'katex'

export interface MathEditRequest {
  pos: number
  kind: 'inline' | 'block'
  latex: string
  dom: HTMLElement
}

interface MathOptions {
  onEdit: (req: MathEditRequest) => void
}

export function renderKatex(el: HTMLElement, latex: string, display: boolean): void {
  if (!latex.trim()) {
    el.classList.add('math-empty')
    el.textContent = display ? 'math block' : 'math'
    return
  }
  el.classList.remove('math-empty')
  try {
    katex.render(latex, el, { displayMode: display, throwOnError: false })
  } catch {
    el.textContent = latex
  }
}

function makeMathNode(kind: 'inline' | 'block'): Node<MathOptions> {
  const inline = kind === 'inline'
  const tag = inline ? 'span' : 'div'
  return Node.create<MathOptions>({
    name: inline ? 'mathInline' : 'mathBlock',
    group: inline ? 'inline' : 'block',
    inline,
    atom: true,
    selectable: true,
    draggable: false,

    addOptions() {
      return { onEdit: () => {} }
    },

    addAttributes() {
      return { latex: { default: '' } }
    },

    parseHTML() {
      return [
        {
          tag: `${tag}[data-math="${kind}"]`,
          getAttrs: (el) => ({ latex: (el as HTMLElement).dataset.latex ?? (el as HTMLElement).textContent ?? '' })
        }
      ]
    },

    renderHTML({ node, HTMLAttributes }) {
      return [tag, mergeAttributes(HTMLAttributes, { 'data-math': kind }), (node.attrs.latex as string) ?? '']
    },

    renderText({ node }) {
      return inline ? `$${node.attrs.latex}$` : `$$${node.attrs.latex}$$`
    },

    addNodeView() {
      const options = this.options
      return ({ node, getPos }) => {
        let current = node
        const dom = document.createElement(tag)
        dom.className = inline ? 'math-node math-inline' : 'math-node math-block'
        dom.contentEditable = 'false'
        dom.title = 'Click to edit math'
        const draw = (): void => renderKatex(dom, current.attrs.latex as string, !inline)
        draw()
        dom.addEventListener('click', () => {
          const pos = getPos()
          if (typeof pos !== 'number') return
          options.onEdit({ pos, kind, latex: current.attrs.latex as string, dom })
        })
        return {
          dom,
          update(updated) {
            if (updated.type !== current.type) return false
            current = updated
            draw()
            return true
          }
        }
      }
    },

    addInputRules() {
      const type = this.type
      if (inline) {
        return [
          new InputRule({
            find: /(^|[^$\\])\$([^\s$](?:[^$\n]*[^\s$])?)\$$/,
            handler: ({ state, range, match }) => {
              const lead = (match[1] ?? '').length
              const from = range.from + lead
              state.tr.replaceWith(from, range.to, type.create({ latex: match[2] ?? '' }))
            }
          })
        ]
      }
      return [
        new InputRule({
          find: /^\$\$([^$]+)\$\$$/,
          handler: ({ state, range, match }) => {
            const $from = state.doc.resolve(range.from)
            const before = $from.before()
            const after = $from.after()
            const para = state.schema.nodes.paragraph
            if (!para) return
            const blockNode = type.create({ latex: (match[1] ?? '').trim() })
            const tr = state.tr.replaceWith(before, after, [blockNode, para.create()])
            tr.setSelection(TextSelection.create(tr.doc, before + blockNode.nodeSize + 1))
          }
        })
      ]
    }
  })
}

export const MathInline = makeMathNode('inline')
export const MathBlock = makeMathNode('block')
