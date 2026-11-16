// Node implementation of media storage (Electron main process).
import fs from 'node:fs'
import path from 'node:path'
import { MEDIA_DIR, mediaNameFromUrl, saveMedia, type MediaPort } from './mediaCore'

export { MEDIA_DIR, MEDIA_SCHEME, referencedMedia } from './mediaCore'

export function mediaDir(dataDir: string): string {
  return path.join(dataDir, MEDIA_DIR)
}

export function nodeMediaPort(dataDir: string): MediaPort {
  return {
    async write(name, bytes) {
      const dir = mediaDir(dataDir)
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, name)
      if (!fs.existsSync(file)) fs.writeFileSync(file, bytes)
    },
    async read(name) {
      const file = path.join(mediaDir(dataDir), name)
      return fs.existsSync(file) ? new Uint8Array(fs.readFileSync(file)) : null
    }
  }
}

export function saveMediaBytes(dataDir: string, bytes: Uint8Array, ext: string): Promise<string> {
  return saveMedia(nodeMediaPort(dataDir), bytes, ext)
}

export function saveMediaFile(dataDir: string, src: string): Promise<string> {
  return saveMediaBytes(dataDir, new Uint8Array(fs.readFileSync(src)), path.extname(src))
}

/** Copy an image referenced by an imported CSV into the media store. Only files inside the
 *  CSV's folder (or its sub-folders) are taken, so a shared CSV can't pull in other files. */
export async function saveCsvImage(dataDir: string, csvDir: string, src: string): Promise<string | null> {
  if (path.isAbsolute(src)) return null
  const abs = path.resolve(csvDir, src)
  const rel = path.relative(csvDir, abs)
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null
  if (!fs.existsSync(abs)) return null
  return saveMediaFile(dataDir, abs)
}

/** Resolve a media URL / filename to a safe absolute path inside the media dir. */
export function resolveMedia(dataDir: string, nameOrUrl: string): string | null {
  const name = mediaNameFromUrl(nameOrUrl)
  return name ? path.join(mediaDir(dataDir), name) : null
}
