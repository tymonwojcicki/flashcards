// Usage: node scripts/webshot.mjs <url> <outDir> [steps.json]
// Drives the web build in Google Chrome (signed, allowed by Smart App Control) and takes screenshots.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const [url, outArg, stepsFile] = process.argv.slice(2)
const outDir = path.resolve(outArg ?? 'screenshots')
const steps = stepsFile ? JSON.parse(fs.readFileSync(stepsFile, 'utf8')) : [{ shot: 'home' }]
fs.mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, colorScheme: 'light' })
const page = await ctx.newPage()
const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
await page.goto(url)
await page.waitForTimeout(1200)
for (const s of steps) {
  try {
    if (s.eval) await page.evaluate(s.eval)
    if (s.hover) await page.hover(s.hover, { timeout: 4000 })
    if (s.click) await page.click(s.click, { timeout: 4000 })
    if (s.type) await page.keyboard.type(s.type, { delay: 15 })
    if (s.press) await page.keyboard.press(s.press)
    if (s.wait) await page.waitForTimeout(s.wait)
    if (s.scheme) await page.emulateMedia({ colorScheme: s.scheme })
    if (s.viewport) await page.setViewportSize(s.viewport)
    if (s.shot) {
      await page.waitForTimeout(350)
      await page.screenshot({ path: path.join(outDir, `${s.shot}.png`), fullPage: !!s.full })
    }
  } catch (e) {
    logs.push(`[step] ${JSON.stringify(s).slice(0, 80)} failed: ${e.message.split('\n')[0]}`)
  }
}
fs.writeFileSync(path.join(outDir, 'console.log'), logs.join('\n'))
console.log(logs.filter((l) => /error|warn|fail/i.test(l)).join('\n') || 'no console errors')
await browser.close()
