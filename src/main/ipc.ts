import fs from 'node:fs'
import path from 'node:path'
import { dialog, ipcMain, net, protocol, shell, BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'
import { state } from './app'
import type { Api, IpcResult } from '../shared/api'
import * as decks from './services/decks'
import * as notes from './services/notes'
import * as study from './services/study'
import * as io from './services/importExport'
import { backup } from './services/backup'
import { safeFileName } from './services/backupCore'
import * as trash from './services/trash'
import { onOpen } from './services/startup'
import { MEDIA_SCHEME, nodeMediaPort, resolveMedia, saveCsvImage, saveMediaBytes, saveMediaFile } from "./services/media"

type Handlers = { [K in keyof Api]: (...args: Parameters<Api[K]>) => ReturnType<Api[K]> | Promise<ReturnType<Api[K]>> }

const win = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
const c = () => state.col

/** Backup file chosen by pickBackup, waiting for the user's confirmation. */
let pendingBackup: Uint8Array | null = null

const handlers: Handlers = {
  // app
  getStartupState: () => state.startupState(),
  forceUnlock: () => state.forceUnlock(),
  openReadOnly: () => state.openReadOnly(),
  resolveConflict: (file, action) => state.resolveConflict(file, action),
  chooseDataDir: async () => {
    const r = await dialog.showOpenDialog(win(), {
      title: 'Choose data folder (e.g. inside OneDrive or Dropbox)',
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return null
    return state.switchDataDir(r.filePaths[0])
  },
  openDataDir: () => {
    void shell.openPath(c().dir)
  },
  backupNow: () => {
    c().saveNow()
    return backup(c().dir) ?? ''
  },
  runAutoBackup: () => null,
  getAutoBackup: () => ({ available: false, enabled: false, lastAt: null }),
  setAutoBackup: () => {},
  pickBackup: async () => {
    const r = await dialog.showOpenDialog(win(), {
      title: 'Restore from backup',
      properties: ['openFile'],
      filters: [{ name: 'Flashcards backup', extensions: ['db'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    const bytes = new Uint8Array(fs.readFileSync(r.filePaths[0]))
    c().validateBytes(bytes)
    pendingBackup = bytes
    return path.basename(r.filePaths[0])
  },
  restoreBackup: () => {
    if (!pendingBackup) throw new Error('No backup file chosen.')
    c().saveNow()
    backup(c().dir) // safety copy of the current data
    c().restoreFrom(pendingBackup)
    pendingBackup = null
    c().saveNow()
    study.clearUndo()
    onOpen(c())
  },

  // trash
  listTrash: () => trash.listTrash(c()),
  restoreTrash: (id) => trash.restoreTrash(c(), id),
  deleteTrashForever: (id) => trash.deleteTrashForever(c(), id),
  emptyTrash: () => trash.emptyTrash(c()),

  // prefs & settings
  getPrefs: () => state.prefs.get(),
  setPrefs: (patch) => state.prefs.set(patch),
  getCollectionSettings: () => decks.getCollectionSettings(c()),
  setCollectionSettings: (patch) => decks.setCollectionSettings(c(), patch),

  // decks
  getDeckTree: () => decks.getDeckTree(c()),
  createDeck: (name, parentId) => decks.createDeck(c(), name, parentId),
  createDeckPath: (p, parentId) => decks.createDeckPath(c(), p, parentId),
  renameDeck: (id, name) => decks.renameDeck(c(), id, name),
  moveDeck: (id, parent) => decks.moveDeck(c(), id, parent),
  deleteDeck: (id) => decks.deleteDeck(c(), id),
  setDeckCollapsed: (id, v) => decks.setDeckCollapsed(c(), id, v),
  setDeckPreset: (id, p) => decks.setDeckPreset(c(), id, p),
  getDeckPreset: (id) => decks.resolvePreset(c(), id),

  // presets
  listPresets: () => decks.listPresets(c()),
  createPreset: (name, config) => decks.createPreset(c(), name, config),
  updatePreset: (id, patch) => decks.updatePreset(c(), id, patch),
  deletePreset: (id) => decks.deletePreset(c(), id),

  // notes
  createNote: (input) => notes.createNote(c(), input),
  updateNote: (id, patch) => notes.updateNote(c(), id, patch),
  getNote: (id) => notes.getNote(c(), id),
  deleteNotes: (ids) => notes.deleteNotes(c(), ids),
  moveNotes: (ids, deckId) => notes.moveNotes(c(), ids, deckId),
  setSuspended: (ids, v) => notes.setSuspended(c(), ids, v),
  addTags: (ids, tags) => notes.addTags(c(), ids, tags),
  resetCards: (ids) => notes.resetCards(c(), ids),
  browse: (q) => notes.browse(c(), q),
  listTags: (deckId) => notes.listTags(c(), deckId),

  // study
  getSession: (deckId, mode) => study.getSession(c(), deckId, mode),
  answer: (id, rating, ms) => study.answer(c(), id, rating, ms),
  previewIntervals: (id) => study.previewIntervals(c(), id),
  undo: () => study.undo(c()),
  buryCard: (id) => study.buryCard(c(), id),

  // media
  saveMedia: (base64, ext) => saveMediaBytes(c().dir, new Uint8Array(Buffer.from(base64, "base64")), ext),
  pickImage: async () => {
    const r = await dialog.showOpenDialog(win(), {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    return saveMediaFile(c().dir, r.filePaths[0])
  },

  // import / export
  pickTextFile: async () => {
    const r = await dialog.showOpenDialog(win(), {
      properties: ['openFile'],
      filters: [{ name: 'CSV / TSV / Text', extensions: ['csv', 'tsv', 'txt'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    const p = r.filePaths[0]
    return { path: p, name: path.basename(p), text: fs.readFileSync(p, 'utf8').replace(/^﻿/, '') }
  },
  previewImport: (rows, target) => io.previewImport(c(), rows, target),
  importRows: (rows, target, baseDir) =>
    io.importRows(c(), rows, target, nodeMediaPort(c().dir), baseDir ? (src) => saveCsvImage(c().dir, baseDir, src) : null),
  exportDeck: async (deckId, format, includeProgress) => {
    const name = safeFileName(decks.getDeck(c(), deckId)?.name ?? 'deck')
    const r = await dialog.showSaveDialog(win(), {
      defaultPath: `${name}.${format}`,
      filters:
        format === 'fdeck'
          ? [{ name: 'Flashcards deck', extensions: ['fdeck'] }]
          : [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (r.canceled || !r.filePath) return null
    if (format === "fdeck") fs.writeFileSync(r.filePath, await io.exportFdeck(c(), deckId, includeProgress, nodeMediaPort(c().dir)))
    else fs.writeFileSync(r.filePath, io.exportCsv(c(), deckId), "utf8")
    return r.filePath
  },
  importDeckFile: async (parentId, includeProgress) => {
    const r = await dialog.showOpenDialog(win(), {
      properties: ['openFile'],
      filters: [{ name: 'Flashcards deck', extensions: ['fdeck'] }]
    })
    if (r.canceled || !r.filePaths[0]) return null
    return io.importFdeck(c(), new Uint8Array(fs.readFileSync(r.filePaths[0])), parentId, includeProgress, nodeMediaPort(c().dir))
  },

  // stats
  getStats: (deckId) => study.getStats(c(), deckId)
}

export function registerIpc(): void {
  ipcMain.handle('api', async (_e, method: keyof Api, ...args: unknown[]): Promise<IpcResult<unknown>> => {
    const fn = handlers[method] as ((...a: unknown[]) => unknown) | undefined
    if (!fn) return { ok: false, error: `Unknown method ${String(method)}` }
    try {
      return { ok: true, value: await fn(...args) }
    } catch (e) {
      console.error(`[api] ${String(method)} failed`, e)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}

/** Must be called before app 'ready'. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, (req) => {
    const p = resolveMedia(state.col.dir, new URL(req.url).hostname || req.url)
    if (!p || !fs.existsSync(p)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(p).toString())
  })
}
