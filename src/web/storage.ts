// Web storage backends:
//  - FolderStore: a real folder picked by the user (File System Access API, Chrome/Edge). Put it in
//    OneDrive/Dropbox to sync — it uses the exact same layout as the desktop app (collection.db, media/, backups/).
//  - BrowserStore: IndexedDB fallback ("this browser only").

// ---------- tiny IndexedDB key-value ----------
const DB_NAME = 'flashcards'
const STORE = 'kv'

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function kvDel(key: string): Promise<void> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function kvKeys(prefix: string): Promise<string[]> {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAllKeys()
    req.onsuccess = () => resolve((req.result as string[]).filter((k) => typeof k === 'string' && k.startsWith(prefix)))
    req.onerror = () => reject(req.error)
  })
}

// ---------- store interface ----------
/** Paths are like "collection.db", "media/abc.png", "backups/x.db". */
export interface DataStore {
  kind: 'folder' | 'browser'
  label: string
  read(path: string): Promise<Uint8Array | null>
  write(path: string, bytes: Uint8Array | string): Promise<void>
  remove(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  /** File names directly inside a sub-folder ('' = root). */
  list(dir: string): Promise<{ name: string; modified: number; size: number }[]>
  modified(path: string): Promise<number | null>
}

const toBytes = (b: Uint8Array | string) => (typeof b === 'string' ? new TextEncoder().encode(b) : b)

export class BrowserStore implements DataStore {
  kind = 'browser' as const
  label = 'This browser only'
  async read(path: string) {
    const v = await kvGet<{ bytes: Uint8Array }>(`file:${path}`)
    return v?.bytes ?? null
  }
  async write(path: string, bytes: Uint8Array | string) {
    const b = toBytes(bytes)
    await kvSet(`file:${path}`, { bytes: b, modified: Date.now(), size: b.length })
  }
  async remove(path: string) {
    await kvDel(`file:${path}`)
  }
  async exists(path: string) {
    return (await kvGet(`file:${path}`)) !== undefined
  }
  async list(dir: string) {
    const prefix = `file:${dir ? dir + '/' : ''}`
    const keys = (await kvKeys(prefix)).filter((k) => !k.slice(prefix.length).includes('/'))
    const out: { name: string; modified: number; size: number }[] = []
    for (const k of keys) {
      const v = await kvGet<{ modified: number; size: number }>(k)
      out.push({ name: k.slice(prefix.length), modified: v?.modified ?? 0, size: v?.size ?? 0 })
    }
    return out
  }
  async modified(path: string) {
    return (await kvGet<{ modified: number }>(`file:${path}`))?.modified ?? null
  }
}

// File System Access API typings (not all are in lib.dom yet).
type PermState = 'granted' | 'denied' | 'prompt'
export interface DirHandle extends FileSystemDirectoryHandle {
  queryPermission(o: { mode: 'readwrite' }): Promise<PermState>
  requestPermission(o: { mode: "readwrite" }): Promise<PermState>
}

export class FolderStore implements DataStore {
  kind = 'folder' as const
  constructor(readonly root: DirHandle) {}
  get label() {
    return this.root.name
  }

  private async dirFor(path: string, create: boolean): Promise<[FileSystemDirectoryHandle, string] | null> {
    const parts = path.split('/')
    const file = parts.pop()!
    let dir: FileSystemDirectoryHandle = this.root
    for (const p of parts) {
      try {
        dir = await dir.getDirectoryHandle(p, { create })
      } catch {
        return null
      }
    }
    return [dir, file]
  }

  private async file(path: string): Promise<File | null> {
    const d = await this.dirFor(path, false)
    if (!d) return null
    try {
      return await (await d[0].getFileHandle(d[1])).getFile()
    } catch {
      return null
    }
  }

  async read(path: string) {
    const f = await this.file(path)
    return f ? new Uint8Array(await f.arrayBuffer()) : null
  }

  async write(path: string, bytes: Uint8Array | string) {
    const d = await this.dirFor(path, true)
    if (!d) throw new Error(`Cannot create folder for ${path}`)
    const fh = await d[0].getFileHandle(d[1], { create: true })
    // createWritable writes to a swap file and atomically replaces on close().
    const w = await fh.createWritable()
    await w.write(toBytes(bytes) as unknown as ArrayBuffer)
    await w.close()
  }

  async remove(path: string) {
    const d = await this.dirFor(path, false)
    if (d) await d[0].removeEntry(d[1]).catch(() => {})
  }

  async exists(path: string) {
    return (await this.file(path)) !== null
  }

  async list(dir: string) {
    let handle: FileSystemDirectoryHandle = this.root
    if (dir) {
      try {
        handle = await this.root.getDirectoryHandle(dir)
      } catch {
        return []
      }
    }
    const out: { name: string; modified: number; size: number }[] = []
    for await (const h of handle.values()) {
      if (h.kind !== 'file') continue
      const f = await (h as FileSystemFileHandle).getFile()
      out.push({ name: h.name, modified: f.lastModified, size: f.size })
    }
    return out
  }

  async modified(path: string) {
    return (await this.file(path))?.lastModified ?? null
  }
}

// ---------- persistence of the chosen folder ----------
const HANDLE_KEY = 'dirHandle'

export const folderSupported = (): boolean => 'showDirectoryPicker' in window

export async function savedFolder(): Promise<DirHandle | undefined> {
  return kvGet<DirHandle>(HANDLE_KEY)
}

export async function rememberFolder(h: DirHandle | null): Promise<void> {
  if (h) await kvSet(HANDLE_KEY, h)
  else await kvDel(HANDLE_KEY)
}

export async function pickFolder(): Promise<DirHandle | null> {
  try {
    const h = (await (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker({
      id: 'flashcards-data',
      mode: 'readwrite'
    })) as DirHandle
    return h
  } catch {
    return null // cancelled
  }
}
