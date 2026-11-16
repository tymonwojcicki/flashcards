// Web/PWA build of the app: `npm run build:web` -> dist-web/ (deployable to GitHub Pages).
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

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

export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  base: './',
  publicDir: resolve(__dirname, 'src/web/public'),
  plugins: [react(), tailwindcss(), cspPlugin()],
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
