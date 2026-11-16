// Per-device preferences, stored in Electron's userData (never synced).
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_PREFS, type Prefs } from '../../shared/types'

export class PrefsStore {
  private data: Prefs
  constructor(private file: string) {
    let loaded: Partial<Prefs> = {}
    try {
      loaded = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      /* first run */
    }
    this.data = { ...DEFAULT_PREFS, ...loaded }
  }

  get(): Prefs {
    return { ...this.data }
  }

  set(patch: Partial<Prefs>): Prefs {
    this.data = { ...this.data, ...patch }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
    return this.get()
  }
}
