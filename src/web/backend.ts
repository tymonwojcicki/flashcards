// Browser implementation of the full `Api` (same services as the Electron main process).
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url'
import * as decks from '../main/services/decks'
import * as notes from '../main/services/notes'
import * as study from '../main/services/study'
import * as io from '../main/services/importExport'
import * as trash from '../main/services/trash'
import { autoBackupDue, getAutoBackup, setAutoBackup } from '../main/services/startup'
import { MEDIA_DIR, base64ToBytes, mediaNameFromUrl, saveMedia, type MediaPort } from '../main/services/mediaCore'
import { safeFileName, stamp } from '../main/services/backupCore'
import { DataFolderSession, type DataStore } from '../main/services/dataFolder'
import type { Api, MainEvent, RendererApi } from '../shared/api'
import { API_METHODS } from '../shared/api'
import { DEFAULT_PREFS, type Prefs } from '../shared/types'
import { takeLaunchFile } from '../renderer/src/lib/launchFile'
import { FolderStore, pickFolder, rememberFolder } from './storage'

let SQL: SqlJsStatic | null = null
const sqlJs = async () => (SQL ??= await initSqlJs({ locateFile: () => wasmUrl }))

// ---------------- device name (written into the data folder's lock) ----------------
let sessionDevice: string | null = null
const deviceName = (): string => {
  try {
    let d = localStorage.getItem('fc-device')
    if (!d) {
      d = `Browser-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
      localStorage.setItem('fc-device', d)
    }
    return d
  } catch {
    // Storage blocked (private window): a name that lasts for this page load.
    return (sessionDevice ??= `Browser-${Math.random().toString(36).slice(2, 6).toUpperCase()}`)
  }
}

// ---------------- media ----------------
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif'
}

function mediaPort(store: DataStore): MediaPort {
  return {
    async write(name, bytes) {
      const p = `${MEDIA_DIR}/${name}`
      if (!(await store.exists(p))) await store.write(p, bytes)
    },
    read: (name) => store.read(`${MEDIA_DIR}/${name}`)
  }
}

/** media://name <-> blob: URL mapping so <img> tags work in the browser. */
class MediaUrls {
  private toBlob = new Map<string, string>()
  private toMedia = new Map<string, string>()
  constructor(private port: () => MediaPort) {}

  reset(): void {
    for (const u of this.toBlob.values()) URL.revokeObjectURL(u)
    this.toBlob.clear()
    this.toMedia.clear()
  }

  private async blobFor(name: string): Promise<string | null> {
    const hit = this.toBlob.get(name)
    if (hit) return hit
    const bytes = await this.port().read(name)
    if (!bytes) return null
    const ext = name.split('.').pop() ?? 'png'
    const url = URL.createObjectURL(new Blob([bytes as unknown as ArrayBuffer], { type: MIME[ext] ?? 'application/octet-stream' }))
    this.toBlob.set(name, url)
    this.toMedia.set(url, `media://${name}`)
    return url
  }

  /** Deep-replace media:// URLs in a result with blob URLs. */
  async outgoing<T>(v: T): Promise<T> {
    const names = new Set<string>()
    const collect = (x: unknown): void => {
      if (typeof x === 'string') {
        if (x.includes('media://')) for (const m of x.matchAll(/media:\/\/([a-f0-9]{32}\.[a-z]+)/g)) names.add(m[1])
      } else if (Array.isArray(x)) x.forEach(collect)
      else if (x && typeof x === 'object') Object.values(x).forEach(collect)
    }
    collect(v)
    if (!names.size) return v
    await Promise.all([...names].map((n) => this.blobFor(n)))
    return deepMap(v, (s) =>
      s.includes('media://')
        ? s.replace(/media:\/\/([a-f0-9]{32}\.[a-z]+)/g, (whole, n: string) => this.toBlob.get(n) ?? whole)
        : s
    )
  }

  /** Deep-replace blob URLs we created back to media:// before storing. */
  incoming<T>(v: T): T {
    if (!this.toMedia.size) return v
    return deepMap(v, (s) =>
      s.includes('blob:') ? s.replace(/blob:[^"'\s)]+/g, (u) => this.toMedia.get(u) ?? u) : s
    )
  }
}

function deepMap<T>(v: T, f: (s: string) => string): T {
  if (typeof v === 'string') return f(v) as T
  if (Array.isArray(v)) return v.map((x) => deepMap(x, f)) as T
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const o: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) o[k] = deepMap(x, f)
    return o as T
  }
  return v
}

// ---------------- file pickers / downloads ----------------
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

function download(name: string, data: Uint8Array | string, type: string): void {
  const blob = new Blob([data as unknown as ArrayBuffer], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

// ---------------- the backend ----------------
export class WebBackend {
  private listeners = new Set<(e: MainEvent) => void>()
  readonly session = new DataFolderSession({ sql: sqlJs, device: deviceName, emit: (e) => this.emit(e) })
  media = new MediaUrls(() => mediaPort(this.store))
  /** Backup file chosen by pickBackup, waiting for the user's confirmation. */
  private pendingBackup: Uint8Array | null = null

  get col() {
    return this.session.col
  }
  get store(): DataStore {
    return this.session.store
  }

  async open(store: DataStore): Promise<void> {
    this.media.reset()
    await this.session.open(store)
  }

  // ----- events -----
  emit(e: MainEvent): void {
    for (const l of this.listeners) l(e)
  }
  on(e: MainEvent, cb: () => void): () => void {
    const l = (x: MainEvent) => x === e && cb()
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  // ----- prefs (per device) -----
  getPrefs(): Prefs {
    try {
      return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem('fc-prefs') ?? '{}'), dataDir: this.store?.label ?? null }
    } catch {
      return { ...DEFAULT_PREFS }
    }
  }
  setPrefs(patch: Partial<Prefs>): Prefs {
    const next = { ...this.getPrefs(), ...patch }
    localStorage.setItem('fc-prefs', JSON.stringify(next))
    return next
  }

  // ----- handlers -----
  handlers(): { [K in keyof Api]: (...a: Parameters<Api[K]>) => ReturnType<Api[K]> | Promise<ReturnType<Api[K]>> } {
    const c = () => this.col
    const port = () => mediaPort(this.store)
    return {
      getStartupState: () => this.session.startupState(),
      forceUnlock: () => this.session.forceUnlock(),
      openReadOnly: () => this.session.openReadOnly(),
      resolveConflict: (file, action) => this.session.resolveConflict(file, action),
      chooseDataDir: async () => {
        const h = await pickFolder()
        if (!h) return null
        await rememberFolder(h)
        this.media.reset()
        return this.session.switchTo(new FolderStore(h))
      },
      openDataDir: () => {},
      backupNow: async () => {
        const name = await this.session.backup()
        if (name) return name
        await this.col.flush()
        const file = `flashcards-backup-${stamp()}.db`
        download(file, this.col.exportBytes(), 'application/octet-stream')
        return `Downloads/${file}`
      },

      runAutoBackup: async () => {
        if (this.store.kind === 'folder' || !autoBackupDue(c())) return null
        await c().flush()
        const file = `flashcards-backup-${new Date().toISOString().slice(0, 10)}.db`
        download(file, c().exportBytes(), 'application/octet-stream')
        return file
      },
      getAutoBackup: () => getAutoBackup(c(), this.store.kind !== 'folder'),
      setAutoBackup: (on) => setAutoBackup(c(), on),
      pickBackup: async () => {
        const f = await pickFile('.db,application/octet-stream')
        if (!f) return null
        const bytes = new Uint8Array(await f.arrayBuffer())
        c().validateBytes(bytes)
        this.pendingBackup = bytes
        return f.name
      },
      restoreBackup: async () => {
        const bytes = this.pendingBackup
        if (!bytes) throw new Error('No backup file chosen.')
        await this.session.restore(bytes, (current) =>
          download(`flashcards-before-restore-${stamp()}.db`, current, 'application/octet-stream')
        )
        this.pendingBackup = null
      },

      listTrash: () => trash.listTrash(c()),
      restoreTrash: (id) => trash.restoreTrash(c(), id),
      deleteTrashForever: (id) => trash.deleteTrashForever(c(), id),
      emptyTrash: () => trash.emptyTrash(c()),

      getPrefs: () => this.getPrefs(),
      setPrefs: (p) => this.setPrefs(p),
      getCollectionSettings: () => decks.getCollectionSettings(c()),
      setCollectionSettings: (p) => decks.setCollectionSettings(c(), p),

      getDeckTree: () => decks.getDeckTree(c()),
      createDeck: (n, p) => decks.createDeck(c(), n, p),
      createDeckPath: (n, p) => decks.createDeckPath(c(), n, p),
      renameDeck: (id, n) => decks.renameDeck(c(), id, n),
      moveDeck: (id, p) => decks.moveDeck(c(), id, p),
      deleteDeck: (id) => decks.deleteDeck(c(), id),
      setDeckCollapsed: (id, v) => decks.setDeckCollapsed(c(), id, v),
      setDeckPreset: (id, p) => decks.setDeckPreset(c(), id, p),
      getDeckPreset: (id) => decks.resolvePreset(c(), id),

      listPresets: () => decks.listPresets(c()),
      createPreset: (n, cfg) => decks.createPreset(c(), n, cfg),
      updatePreset: (id, p) => decks.updatePreset(c(), id, p),
      deletePreset: (id) => decks.deletePreset(c(), id),

      createNote: (i) => notes.createNote(c(), i),
      updateNote: (id, p) => notes.updateNote(c(), id, p),
      getNote: (id) => notes.getNote(c(), id),
      deleteNotes: (ids) => notes.deleteNotes(c(), ids),
      moveNotes: (ids, d) => notes.moveNotes(c(), ids, d),
      setSuspended: (ids, v) => notes.setSuspended(c(), ids, v),
      addTags: (ids, t) => notes.addTags(c(), ids, t),
      resetCards: (ids) => notes.resetCards(c(), ids),
      browse: (q) => notes.browse(c(), q),
      listTags: (deckId) => notes.listTags(c(), deckId),

      getSession: (d, m) => study.getSession(c(), d, m),
      answer: (id, r, ms) => study.answer(c(), id, r, ms),
      previewIntervals: (id) => study.previewIntervals(c(), id),
      undo: () => study.undo(c()),
      buryCard: (id) => study.buryCard(c(), id),

      saveMedia: (b64, ext) => saveMedia(port(), base64ToBytes(b64), ext),
      pickImage: async () => {
        const f = await pickFile('image/*')
        if (!f) return null
        const ext = f.name.split('.').pop() || f.type.split('/')[1] || 'png'
        return saveMedia(port(), new Uint8Array(await f.arrayBuffer()), ext)
      },

      pickTextFile: async () => {
        const f = await pickFile('.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain')
        if (!f) return null
        return { path: '', name: f.name, text: (await f.text()).replace(/^﻿/, '') }
      },
      previewImport: (rows, t) => io.previewImport(c(), rows, t),
      importRows: (rows, t) => io.importRows(c(), rows, t, port(), null),
      exportDeck: async (deckId, format, includeProgress) => {
        const name = safeFileName(decks.getDeck(c(), deckId)?.name ?? 'deck')
        if (format === 'fdeck') download(`${name}.fdeck`, await io.exportFdeck(c(), deckId, includeProgress, port()), 'application/zip')
        else download(`${name}.csv`, io.exportCsv(c(), deckId), 'text/csv;charset=utf-8')
        return `${name}.${format}`
      },
      importDeckFile: async (parentId, includeProgress) => {
        const f = takeLaunchFile() ?? (await pickFile('.fdeck,application/zip'))
        if (!f) return null
        return io.importFdeck(c(), new Uint8Array(await f.arrayBuffer()), parentId, includeProgress, port())
      },

      getStats: (d) => study.getStats(c(), d)
    }
  }

  /** Build the object installed as window.api. */
  rendererApi(): RendererApi & { pathForFile(f: File): string } {
    const h = this.handlers() as unknown as Record<string, (...a: unknown[]) => unknown>
    const api: Record<string, unknown> = {}
    for (const m of API_METHODS) {
      api[m] = async (...args: unknown[]) => {
        const res = await h[m](...this.media.incoming(args))
        return this.media.outgoing(res)
      }
    }
    api.on = (e: MainEvent, cb: () => void) => this.on(e, cb)
    api.pathForFile = () => ''
    return api as unknown as RendererApi & { pathForFile(f: File): string }
  }
}

export { mediaNameFromUrl }
