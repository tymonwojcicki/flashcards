// Renders src/web/public/icon.svg to PNGs (web manifest + Electron installer icon) using headless Chrome.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const svg = fs.readFileSync('src/web/public/icon.svg', 'utf8')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
const targets = [
  ['src/web/public/icon-192.png', 192],
  ['src/web/public/icon-512.png', 512],
  ['build/icon.png', 512]
]
for (const [out, size] of targets) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  await page.screenshot({ path: out, omitBackground: true })
  console.log('wrote', out)
}
await browser.close()
