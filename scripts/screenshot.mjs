// Usage: node scripts/screenshot.mjs <outDir> [script.json]
// Launches the built app (out/) with a throwaway data dir and takes screenshots.
import { _electron as electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const outDir = path.resolve(process.argv[2] ?? 'screenshots')
const steps = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : [{ shot: 'home' }]
fs.mkdirSync(outDir, { recursive: true })
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-ui-'))
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env: { ...process.env, ELECTRON_RENDERER_URL: '' } })
const page = await app.firstWindow()
const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
await page.setViewportSize({ width: 1280, height: 820 }).catch(() => {})
await page.waitForTimeout(1500)
for (const s of steps) {
  if (s.eval) await page.evaluate(s.eval)
  if (s.click) await page.click(s.click, { timeout: 5000 }).catch((e) => logs.push(`[step] click ${s.click} failed: ${e.message.split('\n')[0]}`))
  if (s.type) await page.keyboard.type(s.type)
  if (s.press) await page.keyboard.press(s.press)
  if (s.wait) await page.waitForTimeout(s.wait)
  if (s.theme) await page.evaluate((t) => (document.documentElement.dataset.theme = t), s.theme)
  if (s.shot) { await page.waitForTimeout(400); await page.screenshot({ path: path.join(outDir, `${s.shot}.png`) }) }
}
fs.writeFileSync(path.join(outDir, 'console.log'), logs.join('\n'))
console.log(logs.filter((l) => /error|warn/i.test(l)).join('\n') || 'no console errors')
await app.close()
