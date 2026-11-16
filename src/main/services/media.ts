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

/** Resolve a media URL / filename to a safe absolute path inside the media dir. */
export function resolveMedia(dataDir: string, nameOrUrl: string): string | null {
  const name = mediaNameFromUrl(nameOrUrl)
  return name ? path.join(mediaDir(dataDir), name) : null
}
