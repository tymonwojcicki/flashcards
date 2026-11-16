import { useLayoutEffect, useRef } from 'react'
import katex from 'katex'
import clsx from 'clsx'

/** Strip scripts, embedded objects, inline event handlers and javascript: URLs. */
export function sanitizeHtml(html: string): string {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  tpl.content.querySelectorAll('script, iframe, object, embed, link, meta, base').forEach((el) => el.remove())
  tpl.content.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) el.removeAttribute(attr.name)
      else if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^\s*javascript:/i.test(attr.value))
        el.removeAttribute(attr.name)
    }
  })
  return tpl.innerHTML
}

function renderTex(el: HTMLElement, tex: string, display: boolean): void {
  try {
    katex.render(tex, el, { displayMode: display, throwOnError: false })
  } catch {
    el.textContent = tex
  }
}

// $$...$$ (block) or $...$ (inline). Inline requires no whitespace just inside the
// delimiters and no digit right after the closing $, so "costs $5 and $10" stays text.
const RAW_MATH = /\$\$([\s\S]+?)\$\$|\$(?![\s$])((?:\\.|[^$\\\n])*?[^\s$\\])\$(?!\d)/g

/** Render KaTeX for [data-math] nodes and raw $...$ / $$...$$ text inside `container`. */
export function renderMath(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>('[data-math]').forEach((el) => {
    if (el.dataset.rendered === '1') return
    const tex = el.dataset.latex ?? el.textContent ?? ''
    el.dataset.latex = tex
    renderTex(el, tex, el.dataset.math === 'block')
    el.dataset.rendered = '1'
  })

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || parent.closest('.katex, [data-math], code, pre, script, style')) return NodeFilter.FILTER_REJECT
      return node.nodeValue && node.nodeValue.includes('$') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    }
  })
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)

  for (const node of nodes) {
    const text = node.nodeValue ?? ''
    RAW_MATH.lastIndex = 0
    let last = 0
    let m: RegExpExecArray | null
    const frag = document.createDocumentFragment()
    let found = false
    while ((m = RAW_MATH.exec(text))) {
      found = true
      if (m.index > last) frag.append(text.slice(last, m.index))
      const block = m[1] !== undefined
      const span = document.createElement(block ? 'div' : 'span')
      renderTex(span, (block ? m[1] : m[2]) ?? '', block)
      frag.append(span)
      last = m.index + m[0].length
    }
    if (!found) continue
    if (last < text.length) frag.append(text.slice(last))
    node.replaceWith(frag)
  }
}

/** Displays card HTML (sanitised) with math rendered. Use this everywhere card faces appear. */
export function RichHtml({ html, className }: { html: string; className?: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = sanitizeHtml(html)
    renderMath(el)
  }, [html])
  return <div ref={ref} className={clsx('rich-html', className)} />
}
