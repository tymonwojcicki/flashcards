// Web/PWA build of the app: `npm run build:web` -> dist-web/ (deployable to GitHub Pages).
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  base: './',
  publicDir: resolve(__dirname, 'src/web/public'),
  plugins: [react(), tailwindcss()],
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
