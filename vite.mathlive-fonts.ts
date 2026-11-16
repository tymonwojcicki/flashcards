// Bundles MathLive's fonts locally (no CDN). Served at /mathlive-fonts/ by the dev server and
// emitted into the build as plain assets, so the web build's service worker precaches them too.
import { readdirSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { Plugin } from 'vite'

export const MATHLIVE_FONTS_DIR = 'mathlive-fonts'

export const mathliveFonts = (): Plugin => {
  const dir = resolve(__dirname, 'node_modules/mathlive/fonts')
  return {
    name: 'flashcards-mathlive-fonts',
    configureServer(server) {
      server.middlewares.use(`/${MATHLIVE_FONTS_DIR}/`, (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '')
        if (!/^[\w.-]+\.woff2$/.test(name)) return next()
        try {
          const data = readFileSync(resolve(dir, name))
          res.setHeader('Content-Type', 'font/woff2')
          res.end(data)
        } catch {
          next()
        }
      })
    },
    generateBundle() {
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.woff2'))) {
        this.emitFile({ type: 'asset', fileName: `${MATHLIVE_FONTS_DIR}/${f}`, source: readFileSync(resolve(dir, f)) })
      }
    }
  }
}
