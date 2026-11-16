// Browser implementation of the full `Api` (same services as the Electron main process).
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url'
import { BaseCollection, DB_FILE } from '../main/db/core'
import * as decks from '../main/services/decks'
import * as notes from '../main/services/notes'
import * as study from '../main/services/study'
import * as io from '../main/services/importExport'
import * as trash from '../main/services/trash'
import { autoBackupDue, getAutoBackup, onOpen, setAutoBackup } from '../main/services/startup'
import { MEDIA_DIR, base64ToBytes, mediaNameFromUrl, saveMedia, type MediaPort } from '../main/services/mediaCore'
import type { Api, MainEvent, RendererApi } from '../shared/api'
import { API_METHODS } from '../shared/api'
import { DEFAULT_PREFS, type LockStatus, type Prefs, type StartupState } from '../shared/types'
import { takeLaunchFile } from '../renderer/src/lib/launchFile'
import { BrowserStore, FolderStore, pickFolder, rememberFolder, type DataStore } from './storage'

// ---------------- collection ----------------
class WebCollection extends BaseCollection {
  protected override saveDelay = 250
  knownModified = 0
  private chain: Promise<void> = Promise.resolve()
  constructor(
    SQL: SqlJsStatic,
    public store: DataStore,
    bytes: Uint8Array | null
  ) {
    super(SQL, store.label, bytes)
  }

  protected override persist(bytes: Uint8Array): Promise<void> {
    // Serialise writes so an older snapshot never overwrites a newer one.
    this.chain = this.chain.then(async () => {
      await this.store.write(DB_FILE, bytes)
      this.knownModified = (await this.store.modified(DB_FILE)) ?? Date.now()
    })
    return this.chain.catch((e) => console.error('[web] save failed', e))
  }

  async flush(): Promise<void> {
    await this.saveNow()
    await this.chain
  }

  async changedOnDisk(): Promise<boolean> {
    const m = await this.store.modified(DB_FILE)
    return m !== null && m > this.knownModified + 1
  }

  async reload(): Promise<void> {
    const bytes = await this.store.read(DB_FILE)
    if (bytes) this.replaceBytes(bytes)
    this.knownModified = (await this.store.modified(DB_FILE)) ?? 0
  }
}

let SQL: SqlJsStatic | null = null
const sqlJs = async () => (SQL ??= await initSqlJs({ locateFile: () => wasmUrl }))

// ---------------- device lock (same format as desktop app) ----------------
const LOCK_FILE = 'app.lock'
const STALE_MS = 3 * 60_000
const deviceName = (): string => {
  let d = localStorage.getItem('fc-device')
  if (!d) {
    d = `Browser-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    localStorage.setItem('fc-device', d)
  }
  return d
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

const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// ---------------- the backend ----------------
export class WebBackend {
  col!: WebCollection
  store!: DataStore
  lockStatus: LockStatus = { kind: 'ok' }
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private listeners = new Set<(e: MainEvent) => void>()
  media = new MediaUrls(() => mediaPort(this.store))
  /** Backup file chosen by pickBackup, waiting for the user's confirmation. */
  private pendingBackup: Uint8Array | null = null
  private changedSinceBackup = false
  private backupTimer: ReturnType<typeof setInterval> | null = null

  async open(store: DataStore): Promise<void> {
    this.releaseLock()
    this.store = store
    this.media.reset()
    study.clearUndo()
    const bytes = await store.read(DB_FILE)
    this.col = new WebCollection(await sqlJs(), store, bytes)
    this.col.knownModified = (await store.modified(DB_FILE)) ?? 0
    if (!bytes) {
      this.col.markDirty()
      await this.col.flush()
    }
    this.col.onChange = () => {
      this.changedSinceBackup = true
      this.emit('collection-changed')
    }
    const foreign = await this.foreignLock()
    if (foreign) {
      this.col.readOnly = true
      this.lockStatus = { kind: 'locked', device: foreign.device, since: foreign.since }
    } else {
      await this.takeLock()
      await this.backup()
      onOpen(this.col)
      this.changedSinceBackup = false
    }
    // Folder mode: keep rolling backups while the app stays open.
    if (this.backupTimer) clearInterval(this.backupTimer)
    this.backupTimer = setInterval(() => {
      if (this.changedSinceBackup && !this.col.readOnly) {
        this.changedSinceBackup = false
        void this.backup()
      }
    }, 30 * 60_000)
  }

  // ----- lock -----
  private async foreignLock(): Promise<{ device: string; since: number } | null> {
    if (this.store.kind !== 'folder') return null
    try {
      const raw = await this.store.read(LOCK_FILE)
      if (!raw) return null
      const l = JSON.parse(new TextDecoder().decode(raw)) as { device: string; heartbeat: number; since: number }
      if (l.device === deviceName() || Date.now() - l.heartbeat > STALE_MS) return null
      return l
    } catch {
      return null
    }
  }

  private async takeLock(): Promise<void> {
    this.col.readOnly = false
    this.lockStatus = { kind: 'ok' }
    if (this.store.kind !== 'folder') return
    const since = Date.now()
    const write = () =>
      this.store
        .write(LOCK_FILE, JSON.stringify({ device: deviceName(), pid: 0, heartbeat: Date.now(), since }))
        .catch(() => {})
    await write()
    this.heartbeat = setInterval(write, 60_000)
  }

  releaseLock(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    if (this.store?.kind === 'folder' && this.col && !this.col.readOnly) void this.store.remove(LOCK_FILE)
  }

  // ----- backups (folder mode only; browser mode can download a copy) -----
  async backup(): Promise<string | null> {
    if (this.store.kind !== 'folder') return null
    await this.col.flush()
    const bytes = await this.store.read(DB_FILE)
    if (!bytes) return null
    const name = `backups/collection-${stamp()}.db`
    await this.store.write(name, bytes)
    // prune: newest 10 + newest per day for 7 days
    const files = (await this.store.list('backups'))
      .map((f) => f.name)
      .filter((f) => /^collection-\d{8}-\d{6}\.db$/.test(f))
      .sort()
      .reverse()
    const keep = new Set(files.slice(0, 10))
    const days = new Set<string>()
    for (const f of files) {
      const day = f.slice(11, 19)
      if (!days.has(day) && days.size < 7) {
        days.add(day)
        keep.add(f)
      }
    }
    for (const f of files) if (!keep.has(f)) await this.store.remove(`backups/${f}`)
    return name
  }

  async conflicts() {
    if (this.store.kind !== 'folder') return []
    return (await this.store.list('')).filter((f) => f.name !== DB_FILE && /^collection.*\.db$/i.test(f.name)).map((f) => ({
      file: f.name,
      modified: f.modified,
      size: f.size
    }))
  }

  async startupState(): Promise<StartupState> {
    return {
      dataDir: this.store.kind === 'folder' ? `${this.store.label} (folder)` : 'This browser only',
      lock: this.lockStatus,
      conflicts: await this.conflicts(),
      readOnly: this.col.readOnly
    }
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

  async checkExternalChanges(): Promise<void> {
    if (!this.col || this.col.hasUnsavedChanges || !(await this.col.changedOnDisk())) return
    await this.col.reload()
    study.clearUndo()
    this.emit('collection-reloaded')
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
      getStartupState: () => this.startupState(),
      forceUnlock: async () => {
        if (await this.col.changedOnDisk()) await this.col.reload()
        await this.takeLock()
        return this.startupState()
      },
      openReadOnly: async () => {
        const device = this.lockStatus.kind === 'locked' ? this.lockStatus.device : 'another device'
        this.col.readOnly = true
        this.lockStatus = { kind: 'readonly', device }
        return this.startupState()
      },
      resolveConflict: async (file, action) => {
        const bytes = await this.store.read(file)
        if (bytes && action === 'use') {
          await this.backup()
          await this.store.write(DB_FILE, bytes)
          await this.col.reload()
          study.clearUndo()
        }
        if (bytes) await this.store.write(`backups/conflict-${Date.now()}-${file}`, bytes)
        await this.store.remove(file)
        this.emit('collection-reloaded')
        return this.startupState()
      },
      chooseDataDir: async () => {
        const h = await pickFolder()
        if (!h) return null
        const target = new FolderStore(h)
        if (!(await target.exists(DB_FILE))) {
          // Copy current data into the new folder.
          await this.col.flush()
          await target.write(DB_FILE, this.col.exportBytes())
          for (const f of await this.store.list(MEDIA_DIR)) {
            const b = await this.store.read(`${MEDIA_DIR}/${f.name}`)
            if (b) await target.write(`${MEDIA_DIR}/${f.name}`, b)
          }
        }
        await this.col.flush()
        await rememberFolder(h)
        await this.open(target)
        this.emit('collection-reloaded')
        return this.startupState()
      },
      openDataDir: () => {},
      backupNow: async () => {
        const name = await this.backup()
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
        await c().flush()
        // Safety copy of the current data first.
        if (!(await this.backup())) {
          download(`flashcards-before-restore-${stamp()}.db`, c().exportBytes(), 'application/octet-stream')
        }
        c().restoreFrom(bytes)
        this.pendingBackup = null
        await c().flush()
        study.clearUndo()
        onOpen(c())
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
      importRows: (rows, d) => io.importRows(c(), rows, d, port(), null),
      exportDeck: async (deckId, format, includeProgress) => {
        const name = (decks.getDeck(c(), deckId)?.name ?? 'deck').replace(/[<>:"/\\|?*]+/g, '_')
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
