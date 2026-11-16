// Web/PWA build of the app: `npm run build:web` -> dist-web/ (deployable to GitHub Pages).
import { resolve } from 'path'
import { readFileSync } from 'fs'
import { createHash } from 'crypto'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { mathliveFonts } from './vite.mathlive-fonts'

// Strict Content-Security-Policy for the published build: only code from this site runs, and the
// app cannot connect to or load anything from other servers. (Not applied to the dev server,
// whose hot-reload needs an inline script.)
const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob: data:; worker-src 'self'; " +
  "manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'"

const cspPlugin = (): Plugin => ({
  name: 'flashcards-csp',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }]
})

// Emits sw.js from src/web/sw.template.js with a per-build cache name and the list of files to
// precache. Old caches are deleted when a new version activates (see the template).
const PUBLIC_FILES = ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png']
const swPlugin = (): Plugin => ({
  name: 'flashcards-sw',
  apply: 'build',
  generateBundle(_, bundle) {
    const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'sw.js').sort()
    const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12)
    const precache = ['./', ...files.map((f) => `./${f}`), ...PUBLIC_FILES.map((f) => `./${f}`)]
    const source = readFileSync(resolve(__dirname, 'src/web/sw.template.js'), 'utf8')
      .replaceAll('__VERSION__', version)
      .replaceAll('__PRECACHE__', JSON.stringify(precache))
    this.emitFile({ type: 'asset', fileName: 'sw.js', source })
  }
})

export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  base: './',
  publicDir: resolve(__dirname, 'src/web/public'),
  plugins: [react(), tailwindcss(), mathliveFonts(), cspPlugin(), swPlugin()],
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist-web'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000
  },
  server: { port: 5199, strictPort: true }
})
