// Platform-neutral media helpers (no Node / DOM imports).
export const MEDIA_SCHEME = 'media'
export const MEDIA_DIR = 'media'
const ALLOWED = new Set(['png', 'jpg', 'gif', 'webp', 'svg', 'bmp', 'avif'])
const NAME_RE = /^[a-f0-9]{32}\.[a-z]+$/

/** Storage adapter for media files, implemented per platform. */
export interface MediaPort {
  /** Write bytes under `name` if not present. */
  write(name: string, bytes: Uint8Array): Promise<void>
  read(name: string): Promise<Uint8Array | null>
}

export function normalizeExt(ext: string): string {
  let e = ext.toLowerCase().replace(/^\./, '')
  if (e === 'jpeg') e = 'jpg'
  if (e === 'svg+xml') e = 'svg'
  if (!ALLOWED.has(e)) throw new Error(`Unsupported image type: ${ext}`)
  return e
}

/** Content-addressed file name: first 32 hex chars of SHA-256 + extension. */
export async function mediaName(bytes: Uint8Array, ext: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 32)}.${normalizeExt(ext)}`
}

export async function saveMedia(port: MediaPort, bytes: Uint8Array, ext: string): Promise<string> {
  const name = await mediaName(bytes, ext)
  await port.write(name, bytes)
  return `${MEDIA_SCHEME}://${name}`
}

/** "media://abc.png" (optionally with trailing slash) -> "abc.png", or null if invalid. */
export function mediaNameFromUrl(nameOrUrl: string): string | null {
  const raw = decodeURIComponent(nameOrUrl.replace(/^media:\/\//, '').replace(/\/$/, ''))
  const name = raw.split(/[\\/]/).pop() ?? ''
  return NAME_RE.test(name) ? name : null
}

/** All media filenames referenced by some HTML. */
export function referencedMedia(html: string): string[] {
  return [...html.matchAll(/media:\/\/([a-f0-9]{32}\.[a-z]+)/g)].map((m) => m[1])
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
