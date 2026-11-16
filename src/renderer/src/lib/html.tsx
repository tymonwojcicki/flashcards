import { useLayoutEffect, useRef } from 'react'
import katex from 'katex'
import DOMPurify from 'dompurify'
import clsx from 'clsx'

// Card HTML can come from other people (shared .fdeck / CSV files), so it is treated as untrusted.
// DOMPurify removes scripts, event handlers, forms, iframes, javascript: URLs etc. In addition,
// images may only come from the app itself (media:, blob:, data:) — no remote URLs, so a shared
// deck cannot "phone home" (tracking pixels) when you look at a card. <style> is dropped too.
const SAFE_IMG_SRC = /^(media:|blob:|data:image\/)/i

DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (data.attrName === 'src' && !SAFE_IMG_SRC.test(data.attrValue)) data.keepAttr = false
  if (data.attrName === 'srcset' || data.attrName === 'style' && /url\s*\(/i.test(data.attrValue)) data.keepAttr = false
  if (data.attrName === 'href') {
    // Links may only open web pages, in the external browser.
    if (!/^https?:\/\//i.test(data.attrValue)) data.keepAttr = false
    else node.setAttribute('target', '_blank')
  }
})

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'link', 'meta', 'base'],
    ADD_ATTR: ['target', 'data-math', 'latex'],
    ALLOWED_URI_REGEXP: /^(?:https?:|media:|blob:|data:image\/)/i
  })
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
