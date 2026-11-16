// Web entry: choose storage, install window.api, then start the shared React app.
import { WebBackend } from './backend'
import { setLaunchFile } from '../renderer/src/lib/launchFile'
import { BrowserStore, FolderStore, rememberFolder, savedFolder, type DataStore, type DirHandle } from './storage'

const backend = new WebBackend()

// Opening a .fdeck file from Windows (installed app only, Chrome/Edge): queue it for import.
type LaunchParams = { files: { getFile(): Promise<File> }[] }
const launchQueue = (window as unknown as { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } })
  .launchQueue
launchQueue?.setConsumer(async (p) => {
  const h = p.files[0]
  if (!h) return
  const f = await h.getFile()
  if (!/\.fdeck$/i.test(f.name)) return
  setLaunchFile(f)
})

/** A minimal pre-React screen asking for one click to re-grant folder access (browser security rule). */
function reconnectGate(handle: DirHandle): Promise<DataStore> {
  return new Promise((resolve) => {
    const root = document.getElementById('root')!
    root.innerHTML = `
      <div class="fc-gate">
        <div class="fc-gate-card">
          <div class="fc-gate-logo">◆</div>
          <h1>Welcome back</h1>
          <p>Flashcards needs your permission to open your data folder <b></b>.</p>
          <button class="fc-gate-primary" id="fc-reconnect">Open my folder</button>
          <button class="fc-gate-link" id="fc-browser">Use browser storage instead</button>
        </div>
      </div>`
    root.querySelector('b')!.textContent = `“${handle.name}”`
    root.querySelector<HTMLButtonElement>('#fc-reconnect')!.onclick = async () => {
      const p = await handle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied' as const)
      if (p === 'granted') {
        root.innerHTML = ''
        resolve(new FolderStore(handle))
      }
    }
    root.querySelector<HTMLButtonElement>('#fc-browser')!.onclick = async () => {
      await rememberFolder(null)
      root.innerHTML = ''
      resolve(new BrowserStore())
    }
    ;(root.querySelector('#fc-reconnect') as HTMLButtonElement).focus()
  })
}

async function chooseStore(): Promise<DataStore> {
  const h = await savedFolder().catch(() => undefined)
  if (!h) return new BrowserStore()
  const perm = await h.queryPermission({ mode: 'readwrite' }).catch(() => 'denied' as const)
  if (perm === 'granted') return new FolderStore(h)
  // 'prompt' or 'denied': let the user decide; never fall back to browser storage silently.
  return reconnectGate(h)
}

async function start(): Promise<void> {
  await backend.open(await chooseStore())
  ;(window as unknown as { api: unknown }).api = backend.rendererApi()

  // Pick up changes synced from another PC when the window regains focus.
  window.addEventListener('focus', () => void backend.session.checkExternalChanges())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void backend.col.flush()
    else void backend.session.checkExternalChanges()
  })
  window.addEventListener('pagehide', () => {
    void backend.col.flush()
    void backend.session.release()
  })
  // Ask the browser not to evict IndexedDB data.
  void navigator.storage?.persist?.()

  await import('../renderer/src/main')

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e))
  }
}

start().catch((e) => {
  console.error(e)
  document.getElementById('root')!.innerHTML = `<pre style="padding:24px;white-space:pre-wrap">Flashcards failed to start:\n${String(
    e?.stack ?? e
  )}</pre>`
})
