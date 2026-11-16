import { app, BrowserWindow, dialog, session, shell } from 'electron'
import { join } from 'path'
import { state } from './app'
import { handleMediaProtocol, registerIpc, registerMediaScheme } from './ipc'
import { initAutoUpdate } from './updater'

registerMediaScheme()

// One instance per PC (a second one would fight over the collection file).
if (!app.requestSingleInstanceLock()) app.quit()

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#e3e7ee',
    title: 'Flashcards',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())
  mainWindow.on('focus', () => void state.session.checkExternalChanges())

  // Open external links in the browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // The window never leaves the app page (e.g. a dropped .html file), so no foreign page gets window.api.
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('second-instance', () => {
  const w = BrowserWindow.getAllWindows()[0]
  if (w) {
    if (w.isMinimized()) w.restore()
    w.focus()
  }
})

app.whenReady().then(async () => {
  try {
    await state.init()
  } catch (e) {
    dialog.showErrorBox('Flashcards could not open its data', String(e instanceof Error ? e.stack : e))
    app.quit()
    return
  }
  registerIpc()
  handleMediaProtocol()
  if (!process.env['ELECTRON_RENDERER_URL']) {
    // Production CSP (dev server needs inline scripts for HMR, so only enforce when packaged/built).
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: media:; font-src 'self' data:; connect-src 'self' media:; object-src 'none'; base-uri 'none'; form-action 'none'"
          ]
        }
      })
    })
  }
  createWindow()
  initAutoUpdate()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Saving is async: hold the quit until the collection is written and the lock released.
let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  void state.dispose().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  app.quit()
})
