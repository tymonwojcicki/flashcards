// Housekeeping run once whenever a collection is opened for writing (both Electron and web).
import type { BaseCollection as Collection } from '../db/core'
import { createDeck } from './decks'
import { createNote } from './notes'
import { purgeTrash } from './trash'
import type { AutoBackupState } from '../../shared/dataSafety'

const inline = (tex: string) => `<span data-math="inline" data-latex="${tex}">${tex}</span>`
const block = (tex: string) => `<div data-math="block" data-latex="${tex}">${tex}</div>`

/** Creates the sample deck. Called only for a collection that has no decks. */
export function createSampleDeck(col: Collection): void {
  const root = createDeck(col, 'Sample deck', null).id
  const basics = createDeck(col, 'Basics', root).id
  const math = createDeck(col, 'Math', root).id
  const add = (deckId: string, front: string, back: string, tags: string[] = [], reverse = false) =>
    createNote(col, { deckId, front, back, tags, reverse })

  add(root, '<p>How do I add my own cards?</p>', '<p>Open Add cards, choose a deck, write the front and the back, then save. Tags are optional.</p>', ['how-to'])
  add(
    root,
    '<p>How do the ratings work?</p>',
    '<p>After you show the answer, rate how well you remembered it: Again, Hard, Good or Easy. Easier ratings show the card again later. Again shows it soon.</p>',
    ['how-to']
  )
  add(
    root,
    '<p>Can I delete this sample deck?</p>',
    '<p>Yes. Delete it from the Decks screen whenever you like. Deleted decks stay in Trash for 30 days, and you can restore them in Settings under Data.</p>',
    ['how-to']
  )

  add(basics, '<p>What is the capital of France?</p>', '<p>Paris</p>', ['geography'])
  add(
    basics,
    '<p>Which colours are primary colours for painters?</p>',
    '<ul><li><b>Red</b></li><li><b>Yellow</b></li><li><b>Blue</b></li></ul><p><i>Formatting such as bold, italic and lists works on cards.</i></p>',
    ['formatting', 'art']
  )
  add(
    basics,
    '<p>bonjour</p>',
    '<p>hello</p><p><i>This card has a reverse, so you are also asked in the other direction.</i></p>',
    ['language', 'french'],
    true
  )

  add(math, `<p>State the Pythagorean theorem.</p>`, `<p>${inline('a^2 + b^2 = c^2')}</p>`, ['math'])
  add(math, '<p>What is the derivative of $x^2$?</p>', '<p>$2x$</p>', ['math', 'calculus'])
  add(
    math,
    '<p>Write the quadratic formula.</p>',
    block('x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}'),
    ['math', 'algebra']
  )
}

/** Seed the sample deck once (never for existing users) and purge old Trash entries. */
export function onOpen(col: Collection, now = Date.now()): void {
  if (col.readOnly) return
  col.tx(() => {
    if (!col.getMeta('sample_seeded')) {
      if (!col.get('SELECT 1 FROM decks LIMIT 1')) createSampleDeck(col)
      col.setMeta('sample_seeded', '1')
    }
    purgeTrash(col, now)
  })
}

// ---------- automatic backup downloads (browser-only storage) ----------
const AUTO_AT = 'auto_backup_at'
const AUTO_OFF = 'auto_backup_off'
export const AUTO_BACKUP_EVERY_MS = 7 * 86_400_000

export function getAutoBackup(col: Collection, available: boolean): AutoBackupState {
  const at = Number(col.getMeta(AUTO_AT))
  return { available, enabled: col.getMeta(AUTO_OFF) !== '1', lastAt: at > 0 ? at : null }
}

export function setAutoBackup(col: Collection, enabled: boolean): void {
  col.setMeta(AUTO_OFF, enabled ? '0' : '1')
}

/**
 * True when a backup download is due: enabled, the collection has notes and the last one was 7+ days ago.
 * The first run only records a starting time (nothing to download yet). Records the time when due.
 */
export function autoBackupDue(col: Collection, now = Date.now()): boolean {
  if (col.readOnly || col.getMeta(AUTO_OFF) === '1') return false
  if (!col.get('SELECT 1 FROM notes LIMIT 1')) return false
  const at = Number(col.getMeta(AUTO_AT))
  if (!(at > 0)) {
    col.setMeta(AUTO_AT, String(now))
    return false
  }
  if (now - at < AUTO_BACKUP_EVERY_MS) return false
  col.setMeta(AUTO_AT, String(now))
  return true
}
