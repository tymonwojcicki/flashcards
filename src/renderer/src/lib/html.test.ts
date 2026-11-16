// @vitest-environment jsdom
// jsdom, not happy-dom: DOMPurify misbehaves under happy-dom 21 (keeps <script>, drops <span>).
import { describe, expect, it } from 'vitest'
import { sanitizeHtml } from './html'

describe('sanitizeHtml strips hostile HTML', () => {
  it.each([
    ['<script>', '<p>a</p><script>alert(1)</script>', /script|alert/i],
    ['img onerror', '<img src="media://x.png" onerror="alert(1)">', /onerror/i],
    ['javascript: href', '<a href="javascript:alert(1)">x</a>', /javascript|href/i],
    ['remote img src', '<img src="https://evil.example/pixel.gif">', /evil|src=/i],
    ['srcset', '<img src="media://x.png" srcset="https://evil.example/a.png 2x">', /srcset|evil/i],
    ['style url()', '<p style="background: url(https://evil.example/a.png)">x</p>', /style|evil/i],
    ['iframe', '<iframe src="https://evil.example"></iframe>', /iframe|evil/i],
    ['form', '<form action="https://evil.example"><input name="q"><button>go</button></form>', /form|input|button|evil/i]
  ])('%s', (_, input, banned) => expect(sanitizeHtml(input)).not.toMatch(banned))
})

describe('sanitizeHtml keeps safe HTML', () => {
  it.each(['media://0123456789abcdef0123456789abcdef.png', 'blob:http://localhost/1234', 'data:image/png;base64,iVBORw0KGgo='])(
    'image src %s',
    (src) => expect(sanitizeHtml(`<img src="${src}">`)).toContain(`src="${src}"`)
  )

  it('https link opens in a new tab', () => {
    const out = sanitizeHtml('<a href="https://example.com/">x</a>')
    expect(out).toContain('href="https://example.com/"')
    expect(out).toContain('target="_blank"')
  })

  it('math data- attributes', () => {
    const out = sanitizeHtml('<span data-math="inline" data-latex="x^2">x^2</span>')
    expect(out).toContain('data-math="inline"')
    expect(out).toContain('data-latex="x^2"')
  })
})
