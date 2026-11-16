import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Collection } from '../db/collection'
import * as decks from './decks'
import * as notes from './notes'
import * as study from './study'
import * as io from './importExport'
import { CardState, Rating } from '../../shared/types'
import { foreignLock, Lock, LOCK_FILE } from './lock'
import { prune } from './backup'
import type { MediaPort } from "./mediaCore"
import { nextDayStart } from './time'

const WASM = path.resolve('node_modules/sql.js/dist/sql-wasm.wasm')
let col: Collection

beforeEach(async () => {
  col = await Collection.memory(WASM)
})

const memPort = (): MediaPort => {
  const m = new Map<string, Uint8Array>()
  return { write: async (n, b) => void m.set(n, b), read: async (n) => m.get(n) ?? null }
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fc-test-'))

describe('learn-ahead', () => {
  const MIN = 60_000
  // Noon, so "in 6 hours" stays inside the study day whatever the time zone's day-start falls on.
  const now = new Date(2026, 0, 15, 12).getTime()
  const learningDueIn = (ms: number) => {
    const [d] = decks.ensureDeckPath(col, 'A')
    const note = notes.createNote(col, { deckId: d, front: 'q', back: 'a', tags: [], reverse: false })
    const { id } = col.get<{ id: string }>('SELECT id FROM cards WHERE note_id = ?', [note.id])!
    col.run('UPDATE cards SET state = 1, due = ? WHERE id = ?', [now + ms, id])
    notes.createNote(col, { deckId: d, front: 'other', back: 'a', tags: [], reverse: false })
    return { d, id }
  }
  const learningCount = () => decks.getDeckTree(col, now)[0].counts.learning

  it('holds back a learning card due in 6 hours from the count and the session', async () => {
    const { d, id } = learningDueIn(6 * 60 * MIN)
    expect(learningCount()).toBe(0)
    for (const mode of ['mixed', 'review'] as const) {
      expect((await study.getSession(col, d, mode, now)).cards.map((c) => c.card.id)).not.toContain(id)
    }
  })

  it('counts a learning card due in 10 minutes and shows it first', async () => {
    const { d, id } = learningDueIn(10 * MIN)
    expect(learningCount()).toBe(1)
    const s = await study.getSession(col, d, 'mixed', now)
    expect(s.cards[0].card.id).toBe(id)
    expect(s.learnAheadMs).toBe(20 * MIN)
  })

  it('follows the learn-ahead setting', () => {
    learningDueIn(30 * MIN)
    expect(learningCount()).toBe(0)
    decks.setCollectionSettings(col, { learnAheadMinutes: 60 })
    expect(learningCount()).toBe(1)
  })
})

describe('decks', () => {
  it('builds nested trees and resolves deck paths', () => {
    const [leaf, created] = decks.ensureDeckPath(col, 'Economics::Micro::Supply and Demand')
    expect(created).toBe(3)
    expect(decks.ensureDeckPath(col, 'economics::Micro::Supply and Demand')).toEqual([leaf, 0])
    expect(decks.deckPath(col, leaf)).toEqual(['Economics', 'Micro', 'Supply and Demand'])
    const tree = decks.getDeckTree(col)
    expect(tree).toHaveLength(1)
    expect(tree[0].children[0].children[0].id).toBe(leaf)
  })

  it('splits deck paths by trimming parts and dropping empty ones', () => {
    expect(decks.deckPathParts(' econ :: micro ::  ')).toEqual(['econ', 'micro'])
    expect(decks.deckPathParts('::')).toEqual([])
  })

  it('createDeckPath reuses existing decks case-insensitively, trimming each part', () => {
    const [micro] = decks.ensureDeckPath(col, 'Econ::Micro')
    expect(decks.createDeckPath(col, 'econ :: micro', null)).toBe(micro)
    const leaf = decks.createDeckPath(col, 'econ :: micro :: Supply', null)
    expect(decks.deckPath(col, leaf)).toEqual(['Econ', 'Micro', 'Supply'])
    expect(decks.allDecks(col)).toHaveLength(3)
  })

  it('createDeckPath creates the missing decks together, or none of them', () => {
    col.run(`CREATE TRIGGER no_c BEFORE INSERT ON decks WHEN NEW.name = 'C' BEGIN SELECT RAISE(ABORT, 'boom'); END`)
    expect(() => decks.createDeckPath(col, 'A::B::C', null)).toThrow()
    expect(decks.allDecks(col)).toHaveLength(0)
  })

  it('createDeckPath under a parent expands collapsed ancestors', () => {
    const [b] = decks.ensureDeckPath(col, 'A::B')
    const a = decks.getDeck(col, b)!.parentId!
    decks.setDeckCollapsed(col, a, true)
    decks.setDeckCollapsed(col, b, true)
    const c = decks.createDeckPath(col, 'C', b)
    expect(decks.getDeck(col, c)!.parentId).toBe(b)
    expect(decks.getDeck(col, a)!.collapsed).toBe(false)
    expect(decks.getDeck(col, b)!.collapsed).toBe(false)
  })

  it('aggregates counts up the tree and respects new-card limits', () => {
    const [leaf] = decks.ensureDeckPath(col, 'A::B')
    for (let i = 0; i < 30; i++) notes.createNote(col, { deckId: leaf, front: `q${i}`, back: 'a', tags: [], reverse: false })
    const [a] = decks.getDeckTree(col)
    expect(a.counts.total).toBe(30)
    expect(a.counts.new).toBe(20) // default newPerDay
  })

  it('prevents moving a deck into its own subtree', () => {
    const [leaf] = decks.ensureDeckPath(col, 'A::B::C')
    const root = decks.getDeckTree(col)[0].id
    expect(() => decks.moveDeck(col, root, leaf)).toThrow()
  })

  it('deleting a deck cascades to subdecks and cards', () => {
    const [leaf] = decks.ensureDeckPath(col, 'A::B')
    notes.createNote(col, { deckId: leaf, front: 'q', back: 'a', tags: [], reverse: true })
    decks.deleteDeck(col, decks.getDeckTree(col)[0].id)
    expect(col.get<{ n: number }>('SELECT COUNT(*) n FROM cards')!.n).toBe(0)
  })

  describe('counts follow bury siblings', () => {
    const reverseNote = (deckId: string) =>
      notes.createNote(col, { deckId, front: 'q', back: 'a', tags: [], reverse: true })
    const noBury = () =>
      decks.createPreset(col, 'No bury', { ...decks.resolvePreset(col, decks.getDeckTree(col)[0].id).config, burySiblings: false })
    const sessionSize = async (id: string) => (await study.getSession(col, id, 'mixed')).cards.length

    it('bury on: a reverse note counts once, matching the session', async () => {
      const [d] = decks.ensureDeckPath(col, 'A')
      reverseNote(d)
      reverseNote(d)
      expect(decks.getDeckTree(col)[0].counts.new).toBe(2)
      expect(await sessionSize(d)).toBe(2)
    })

    it('bury on: due reviews count once per note, and hide that note\'s new card', async () => {
      const [d] = decks.ensureDeckPath(col, 'A')
      reverseNote(d) // both cards due for review
      reverseNote(d) // one review due, one new
      const [both, mixed] = col.all<{ id: string }>('SELECT id FROM notes ORDER BY rowid')
      col.run('UPDATE cards SET state = 2, due = 0 WHERE note_id = ?', [both.id])
      col.run("UPDATE cards SET state = 2, due = 0 WHERE note_id = ? AND direction = 'fwd'", [mixed.id])
      const { counts } = decks.getDeckTree(col)[0]
      expect([counts.review, counts.new]).toEqual([2, 0])
      expect(await sessionSize(d)).toBe(2)
    })

    it('bury on, daily limit reached: count and session agree', async () => {
      const [d] = decks.ensureDeckPath(col, 'A')
      for (let i = 0; i < 30; i++) reverseNote(d)
      expect(decks.getDeckTree(col)[0].counts.new).toBe(20) // default newPerDay
      expect(await sessionSize(d)).toBe(20)
    })

    it('bury off: every card counts', async () => {
      const [d] = decks.ensureDeckPath(col, 'A')
      decks.setDeckPreset(col, d, noBury().id)
      reverseNote(d)
      expect(decks.getDeckTree(col)[0].counts.new).toBe(2)
      expect(await sessionSize(d)).toBe(2)
    })

    it('parent and child each follow their own preset', async () => {
      const [child] = decks.ensureDeckPath(col, 'P::C')
      const parent = decks.getDeckTree(col)[0].id
      decks.setDeckPreset(col, child, noBury().id)
      reverseNote(parent)
      reverseNote(child)
      const [p] = decks.getDeckTree(col)
      expect(p.counts.new).toBe(2) // bury on: one per note
      expect(p.children[0].counts.new).toBe(2) // bury off: both cards
      expect(await sessionSize(parent)).toBe(2)
      expect(await sessionSize(child)).toBe(2)
    })

    describe('every study mode serves its menu count', () => {
      // n1: both reviews due. n2: fwd review due, rev new. n3: both new. n4: fwd learning, rev new.
      const fixture = () => {
        const [d] = decks.ensureDeckPath(col, 'A')
        for (let i = 0; i < 4; i++) reverseNote(d)
        const [n1, n2, , n4] = col.all<{ id: string }>('SELECT id FROM notes ORDER BY rowid')
        col.run('UPDATE cards SET state = 2, due = 0 WHERE note_id = ?', [n1.id])
        col.run("UPDATE cards SET state = 2, due = 0 WHERE note_id = ? AND direction = 'fwd'", [n2.id])
        col.run("UPDATE cards SET state = 1, due = 0 WHERE note_id = ? AND direction = 'fwd'", [n4.id])
        return d
      }
      const menu = () => {
        const c = decks.getDeckTree(col)[0].counts
        return { mixed: c.learning + c.review + c.new, review: c.learning + c.review, learn: c.new }
      }
      const served = async (d: string) => ({
        mixed: (await study.getSession(col, d, 'mixed')).cards.length,
        review: (await study.getSession(col, d, 'review')).cards.length,
        learn: (await study.getSession(col, d, 'learn')).cards.length
      })

      it('bury on', async () => {
        const d = fixture()
        expect(menu()).toEqual({ mixed: 4, review: 3, learn: 1 })
        expect(await served(d)).toEqual(menu())
      })

      it('bury off', async () => {
        const d = fixture()
        decks.setDeckPreset(col, d, noBury().id)
        expect(menu()).toEqual({ mixed: 8, review: 4, learn: 4 })
        expect(await served(d)).toEqual(menu())
      })

      it('bury on: Learn new skips a new card whose sibling is a due review', async () => {
        const [d] = decks.ensureDeckPath(col, 'A')
        reverseNote(d)
        col.run("UPDATE cards SET state = 2, due = 0 WHERE direction = 'fwd'")
        expect((await study.getSession(col, d, 'learn')).cards).toHaveLength(0)
      })

      it('bury off: Learn new serves both cards of a reverse note', async () => {
        const [d] = decks.ensureDeckPath(col, 'A')
        decks.setDeckPreset(col, d, noBury().id)
        reverseNote(d)
        const cards = (await study.getSession(col, d, 'learn')).cards
        expect(cards.map((c) => c.card.direction).sort()).toEqual(['fwd', 'rev'])
      })
    })
  })

  it("a parent deck's own limit covers its whole subtree", async () => {
    const [child] = decks.ensureDeckPath(col, 'P::C')
    const parent = decks.getDeckTree(col)[0].id
    const small = decks.createPreset(col, 'Small', { ...decks.resolvePreset(col, parent).config, newPerDay: 3 })
    decks.setDeckPreset(col, parent, small.id)
    const big = decks.createPreset(col, 'Big', { ...small.config, newPerDay: 100 })
    decks.setDeckPreset(col, child, big.id)
    for (let i = 0; i < 5; i++) notes.createNote(col, { deckId: child, front: `q${i}`, back: 'a', tags: [], reverse: false })
    const [p] = decks.getDeckTree(col)
    expect([p.counts.new, p.children[0].counts.new]).toEqual([3, 5])
    expect((await study.getSession(col, parent, 'mixed')).cards).toHaveLength(3)
  })

  it('child decks inherit preset from parent', () => {
    const [leaf] = decks.ensureDeckPath(col, 'A::B')
    const root = decks.getDeckTree(col)[0].id
    const p = decks.createPreset(col, 'Exam', { ...decks.resolvePreset(col, leaf).config, newPerDay: 5 })
    decks.setDeckPreset(col, root, p.id)
    expect(decks.resolvePreset(col, leaf).config.newPerDay).toBe(5)
  })
})

describe('buried cards are never due', () => {
  // Noon, so "in 1 hour" stays inside the study day whatever the day-start hour.
  const now = new Date(2026, 0, 15, 12).getTime()
  const HOUR = 3_600_000
  const reviews = () => {
    const [d] = decks.ensureDeckPath(col, 'B')
    const ids = ['buried', 'open'].map((front) => {
      const note = notes.createNote(col, { deckId: d, front, back: 'a', tags: [], reverse: false })
      const { id } = col.get<{ id: string }>('SELECT id FROM cards WHERE note_id = ?', [note.id])!
      col.run('UPDATE cards SET state = 2, due = ? WHERE id = ?', [now - HOUR, id])
      return id
    })
    col.run('UPDATE cards SET buried_until = ? WHERE id = ?', [tomorrow(), ids[0]])
    return { d, buried: ids[0], open: ids[1] }
  }
  const tomorrow = () => nextDayStart(now, decks.getCollectionSettings(col).dayStartHour)
  const ids = (q: Parameters<typeof notes.browse>[1]) => notes.browse(col, q, now).rows.map((r) => r.cardId)

  it('leaves buried cards out of Browse "due" and lists them under "buried"', () => {
    const { buried, open } = reviews()
    expect(ids({ state: 'due' })).toEqual([open])
    expect(ids({ state: 'buried' })).toEqual([buried])
  })

  it("leaves buried cards out of today's forecast", () => {
    reviews()
    expect(study.getStats(col, null, now).forecast[0].due).toBe(1)
  })

  it('Browse "due", the forecast and the deck count agree', async () => {
    const { d } = reviews()
    const dueInBrowse = notes.browse(col, { state: 'due' }, now).total
    expect(study.getStats(col, null, now).forecast[0].due).toBe(dueInBrowse)
    expect(decks.getDeckTree(col, now)[0].counts.review).toBe(dueInBrowse)
    expect((await study.getSession(col, d, 'review', now)).cards).toHaveLength(dueInBrowse)
  })

  it('a card whose bury has ended is due again', () => {
    const { buried, open } = reviews()
    expect(notes.browse(col, { state: 'due' }, tomorrow()).rows.map((r) => r.cardId).sort()).toEqual([buried, open].sort())
  })
})

describe('notes & browse', () => {
  it('creates reverse cards and finds them via search/tags', () => {
    const [d] = decks.ensureDeckPath(col, 'Lang')
    notes.createNote(col, { deckId: d, front: 'hund', back: 'dog', tags: ['animals', 'german'], reverse: true })
    expect(notes.browse(col, { search: 'dog' }).total).toBe(2)
    expect(notes.browse(col, { tag: 'animals' }).total).toBe(2)
    expect(notes.browse(col, { tag: 'anim' }).total).toBe(0)
    expect(notes.listTags(col)).toEqual(['animals', 'german'])
  })

  it('lists only tags used within the selected deck subtree', () => {
    const [child] = decks.ensureDeckPath(col, 'P::C')
    const [other] = decks.ensureDeckPath(col, 'Other')
    const parent = decks.getDeckTree(col).find((d) => d.name === 'P')!.id
    notes.createNote(col, { deckId: child, front: 'a', back: 'b', tags: ['x'], reverse: false })
    notes.createNote(col, { deckId: other, front: 'c', back: 'd', tags: ['y'], reverse: false })
    expect(notes.listTags(col, parent)).toEqual(['x'])
    expect(notes.listTags(col, other)).toEqual(['y'])
    expect(notes.listTags(col, null)).toEqual(['x', 'y'])
  })
})

describe('study', () => {
  it('runs a new card through learning steps into review, and undo restores it', async () => {
    const [d] = decks.ensureDeckPath(col, 'S')
    notes.createNote(col, { deckId: d, front: 'q', back: 'a', tags: [], reverse: false })
    const s = await study.getSession(col, d, 'mixed')
    expect(s.cards).toHaveLength(1)
    const id = s.cards[0].card.id
    const prev = await study.previewIntervals(col, id)
    expect(prev[Rating.Again]).toBe('1m')
    expect(prev[Rating.Good]).toBe('10m')

    const t0 = Date.now()
    const r1 = await study.answer(col, id, Rating.Good, 3000, t0)
    expect(r1.card.state).toBe(CardState.Learning)
    expect(r1.requeue).toBe(true)
    const r2 = await study.answer(col, id, Rating.Good, 3000, t0 + 11 * 60_000)
    expect(r2.card.state).toBe(CardState.Review)
    expect(r2.requeue).toBe(false)

    expect(study.undo(col)).toBe(id)
    const back = notes.browse(col, {}).rows[0]
    expect(back.state).toBe(CardState.Learning)
    expect(col.get<{ n: number }>('SELECT COUNT(*) n FROM review_log')!.n).toBe(1)
  })

  it('buries sibling cards and limits one card per note in a session', async () => {
    const [d] = decks.ensureDeckPath(col, 'S')
    notes.createNote(col, { deckId: d, front: 'q', back: 'a', tags: [], reverse: true })
    const s = await study.getSession(col, d, 'mixed')
    expect(s.cards).toHaveLength(1)
    await study.answer(col, s.cards[0].card.id, Rating.Easy, 1000)
    const s2 = await study.getSession(col, d, 'mixed')
    expect(s2.cards).toHaveLength(0) // sibling buried until tomorrow
    const cram = await study.getSession(col, d, 'cram')
    expect(cram.cards).toHaveLength(1)
    expect(cram.affectsSchedule).toBe(false)
  })

  it('includes subdeck cards when studying a parent and reverses reverse cards', async () => {
    const [leaf] = decks.ensureDeckPath(col, 'P::C')
    notes.createNote(col, { deckId: leaf, front: 'F', back: 'B', tags: [], reverse: true })
    const root = decks.getDeckTree(col)[0].id
    const cram = await study.getSession(col, root, 'cram')
    expect(cram.cards).toHaveLength(2)
    const rev = cram.cards.find((c) => c.card.direction === 'rev')!
    expect(rev.question).toBe('B')
    expect(rev.answer).toBe('F')
  })

  it('changing desired retention changes intervals', async () => {
    const [d] = decks.ensureDeckPath(col, 'R')
    notes.createNote(col, { deckId: d, front: 'q', back: 'a', tags: [], reverse: false })
    const id = (await study.getSession(col, d, 'mixed')).cards[0].card.id
    const t0 = Date.now()
    await study.answer(col, id, Rating.Good, 1000, t0)
    await study.answer(col, id, Rating.Good, 1000, t0 + 11 * 60_000)
    const lo = await study.previewIntervals(col, id)
    decks.updatePreset(col, 'default', { config: { desiredRetention: 0.97 } })
    const hi = await study.previewIntervals(col, id)
    expect(lo[Rating.Good]).not.toBe(hi[Rating.Good])
  })

  it('computes stats', async () => {
    const [d] = decks.ensureDeckPath(col, 'S')
    notes.createNote(col, { deckId: d, front: 'q', back: 'a', tags: [], reverse: false })
    const id = (await study.getSession(col, d, 'mixed')).cards[0].card.id
    await study.answer(col, id, Rating.Good, 2000)
    const st = study.getStats(col, null)
    expect(st.days.at(-1)!.reviews).toBe(1)
    expect(st.streak).toBe(1)
    expect(st.forecast).toHaveLength(30)
  })
})

describe('import / export', () => {
  it('imports rows with deck paths, escapes plain text, and round-trips .fdeck', async () => {
    const port = memPort()
    const r = await io.importRows(
      col,
      [
        { front: 'a < b', back: 'line1\nline2', deckPath: 'X::Y', tags: ['t'] },
        { front: '$x^2$', back: '<b>bold</b>' },
        { front: '', back: 'skipped' }
      ],
      null,
      port
    )
    expect(r).toMatchObject({ notes: 2, cards: 2, decksCreated: 3, skipped: 1 })
    const rows = notes.browse(col, { search: 'line1' }).rows
    expect(rows[0].front).toBe('a &lt; b')
    expect(rows[0].back).toBe('line1<br>line2')

    const x = decks.getDeckTree(col).find((n) => n.name === 'X')!
    const bytes = await io.exportFdeck(col, x.id, false, port)
    const res = await io.importFdeck(col, bytes, null, false, port)
    expect(res.notes).toBe(1)
    expect(res.decksCreated).toBe(2)
  })

  it('import reuses "Econ::Micro" for "econ :: micro"', async () => {
    const [micro] = decks.ensureDeckPath(col, 'Econ::Micro')
    const r = await io.importRows(col, [{ front: 'q', back: 'a', deckPath: 'econ :: micro' }], null, memPort())
    expect(r.decksCreated).toBe(0)
    expect(notes.browse(col, { search: 'q' }).rows[0].deckId).toBe(micro)
  })

  it('preview counts equal the import result for the same rows', async () => {
    decks.ensureDeckPath(col, 'Econ::Micro')
    const [other] = decks.ensureDeckPath(col, 'Other')
    const rows = [
      { front: 'q1', back: 'a', deckPath: 'econ :: micro :: Demand' },
      { front: 'q2', back: 'a', deckPath: 'Econ::Micro::demand' },
      { front: 'q3', back: 'a', deckPath: 'Lang::Spanish' },
      { front: 'q4', back: 'a', deckPath: 'lang' },
      { front: '  ', back: 'skipped' },
      { front: 'q5', back: 'a' }
    ]
    const targets = [null, { deckId: other }, { newDeck: 'Fresh::Deck' }, { newDeck: 'other' }]
    for (const target of targets) {
      const before = decks.allDecks(col).length
      const preview = io.previewImport(col, rows, target)
      expect(decks.allDecks(col)).toHaveLength(before) // preview writes nothing
      const { deckId: _, ...res } = await io.importRows(col, rows, target, memPort())
      expect(res).toEqual(preview)
    }
  })

  it('preview counts the decks the import creates, including the target and intermediate decks', () => {
    decks.ensureDeckPath(col, 'Econ')
    const rows = [
      { front: 'q1', back: 'a', deckPath: 'econ::Micro::Demand' },
      { front: 'q2', back: 'a', deckPath: 'ECON :: micro' },
      { front: '', back: 'a' }
    ]
    expect(io.previewImport(col, rows, { newDeck: 'New' })).toEqual({ notes: 2, cards: 2, decksCreated: 3, skipped: 1 })
  })
})

describe('lock & backups', () => {
  it('stops the heartbeat and reports when another device takes the lock over', () => {
    vi.useFakeTimers()
    try {
      const dir = tmpDir()
      const lost: string[] = []
      const l = new Lock(dir, (d) => lost.push(d))
      l.acquire()
      vi.advanceTimersByTime(60_000) // own heartbeat: nothing happens
      expect(lost).toEqual([])
      const theirs = JSON.stringify({ device: 'OTHER-PC', pid: 1, heartbeat: Date.now(), since: Date.now() + 1 })
      fs.writeFileSync(path.join(dir, LOCK_FILE), theirs)
      vi.advanceTimersByTime(3 * 60_000)
      expect(lost).toEqual(['OTHER-PC']) // reported once, then stopped
      expect(fs.readFileSync(path.join(dir, LOCK_FILE), 'utf8')).toBe(theirs) // never overwritten
      l.release()
      expect(fs.readFileSync(path.join(dir, LOCK_FILE), 'utf8')).toBe(theirs)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not start a heartbeat when the lock is already taken over at acquire (clock skew)', () => {
    vi.useFakeTimers()
    try {
      const dir = tmpDir()
      const theirs = JSON.stringify({ device: 'OTHER-PC', pid: 1, heartbeat: Date.now(), since: Date.now() + 60_000 })
      fs.writeFileSync(path.join(dir, LOCK_FILE), theirs)
      const lost: string[] = []
      new Lock(dir, (d) => lost.push(d)).acquire()
      vi.advanceTimersByTime(5 * 60_000)
      expect(lost).toEqual(['OTHER-PC']) // once, not every minute
      expect(fs.readFileSync(path.join(dir, LOCK_FILE), 'utf8')).toBe(theirs)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps writing over an older stale lock from another device', () => {
    vi.useFakeTimers()
    try {
      const dir = tmpDir()
      const lost: string[] = []
      const l = new Lock(dir, (d) => lost.push(d))
      l.acquire()
      fs.writeFileSync(
        path.join(dir, LOCK_FILE),
        JSON.stringify({ device: 'OTHER-PC', pid: 1, heartbeat: 0, since: 0 })
      )
      vi.advanceTimersByTime(60_000)
      expect(lost).toEqual([])
      expect(foreignLock(dir)).toBeNull() // our heartbeat is back in the file
      l.release()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores own lock and stale locks', () => {
    const dir = tmpDir()
    const l = new Lock(dir)
    l.acquire()
    expect(foreignLock(dir)).toBeNull() // same device
    fs.writeFileSync(
      path.join(dir, LOCK_FILE),
      JSON.stringify({ device: 'OTHER-PC', pid: 1, heartbeat: Date.now(), since: Date.now() })
    )
    expect(foreignLock(dir)?.device).toBe('OTHER-PC')
    expect(foreignLock(dir, Date.now() + 10 * 60_000)).toBeNull()
    l.release()
    expect(fs.existsSync(path.join(dir, LOCK_FILE))).toBe(true) // foreign lock left untouched
  })

  it('prunes backups to recent + daily', () => {
    const dir = tmpDir()
    for (let day = 1; day <= 20; day++)
      for (let h = 10; h < 13; h++) fs.writeFileSync(path.join(dir, `collection-202601${String(day).padStart(2, '0')}-${h}0000.db`), '')
    prune(dir)
    expect(fs.readdirSync(dir).length).toBe(10 + 3) // 10 newest span days 17-20; daily adds 14-16
  })

  it('saves atomically and detects external changes', async () => {
    const dir = tmpDir()
    const c1 = await Collection.open(dir)
    decks.createDeck(c1, 'Z', null)
    c1.saveNow()
    expect(c1.changedOnDisk()).toBe(false)
    const c2 = await Collection.open(dir)
    expect(decks.allDecks(c2).map((d) => d.name)).toEqual(['Z'])
    decks.createDeck(c2, 'W', null)
    await new Promise((r) => setTimeout(r, 20))
    c2.saveNow()
    expect(c1.changedOnDisk()).toBe(true)
    await c1.reload()
    expect(decks.allDecks(c1)).toHaveLength(2)
    c1.close()
    c2.close()
  })
})

describe('media', () => {
  it('stores data-URI images content-addressed during import', async () => {
    const m = new Map<string, Uint8Array>()
    const port: MediaPort = { write: async (n, b) => void m.set(n, b), read: async (n) => m.get(n) ?? null }
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    await io.importRows(col, [{ front: `<img src="data:image/png;base64,${png}">`, back: 'x' }], null, port)
    const front = notes.browse(col, {}).rows[0].front
    expect(front).toMatch(/^<img src="media:\/\/[a-f0-9]{32}\.png">$/)
    expect(m.size).toBe(1)
  })
})

describe('scheduler model', () => {
  it('uses FSRS-6: Easy on a new card is about a week, not months', async () => {
    const [d] = decks.ensureDeckPath(col, 'M')
    notes.createNote(col, { deckId: d, front: 'q', back: 'a', tags: [], reverse: false })
    const id = (await study.getSession(col, d, 'mixed')).cards[0].card.id
    const easy = (await study.previewIntervals(col, id))[Rating.Easy]
    expect(easy).toMatch(/^\d+d$/)
    const days = parseInt(easy)
    expect(days).toBeGreaterThanOrEqual(5)
    expect(days).toBeLessThanOrEqual(12)
  })
})
