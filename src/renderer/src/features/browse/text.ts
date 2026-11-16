const cache = new Map<string, string>()

/** Plain-text one-liner of card HTML, with [image] / [math] markers. */
export function plainText(html: string): string {
  const hit = cache.get(html)
  if (hit !== undefined) return hit
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  tpl.content.querySelectorAll('img').forEach((el) => el.replaceWith(' [image] '))
  tpl.content.querySelectorAll('[data-math]').forEach((el) => el.replaceWith(' [math] '))
  tpl.content.querySelectorAll('p, div, li, br').forEach((el) => el.append(' '))
  const text = (tpl.content.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (cache.size > 3000) cache.clear()
  cache.set(html, text)
  return text
}
