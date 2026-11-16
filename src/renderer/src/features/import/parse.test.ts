import { describe, expect, it } from 'vitest'
import { detectDelimiter, dirName, guessHeader, guessRoles, mapRows, parseTable } from './parse'

describe('detectDelimiter', () => {
  it('detects comma', () => expect(detectDelimiter('a,b\nc,d\n')).toBe(','))
  it('detects tab even with commas in text', () =>
    expect(detectDelimiter('hello, world\tbonjour\nfoo, bar\tbaz\n')).toBe('\t'))
  it('detects semicolon', () => expect(detectDelimiter('a;b;c\nd;e;f')).toBe(';'))
  it('detects pipe', () => expect(detectDelimiter('a|b\nc|d')).toBe('|'))
  it('ignores delimiters inside quotes', () => expect(detectDelimiter('"a;b;c",x\n"d;e;f",y')).toBe(','))
})

describe('guessHeader', () => {
  it('recognises header names', () => expect(guessHeader(['Front', 'Back'])).toBe(true))
  it('recognises question/answer', () => expect(guessHeader(['Question', 'Answer', 'Tags'])).toBe(true))
  it('rejects data rows', () => expect(guessHeader(['hola', 'hello'])).toBe(false))
  it('rejects sentences containing keywords', () =>
    expect(guessHeader(['What is the back of a book?', 'spine'])).toBe(false))
  it('handles empty', () => expect(guessHeader(undefined)).toBe(false))
})

describe('parseTable', () => {
  it('handles quoted commas and newlines', () => {
    const t = parseTable('front,back\n"a, b","line1\nline2"\n"say ""hi""",x\n', ',')
    expect(t).toEqual([
      ['front', 'back'],
      ['a, b', 'line1\nline2'],
      ['say "hi"', 'x']
    ])
  })
  it('skips blank lines and BOM', () => {
    expect(parseTable('\ufeffa,b\n\n\nc,d\n', ',')).toEqual([
      ['a', 'b'],
      ['c', 'd']
    ])
  })
})

describe('guessRoles', () => {
  it('uses header names', () =>
    expect(guessRoles(['tags', 'Answer', 'Question', 'deck'], 4)).toEqual(['tags', 'back', 'front', 'deck']))
  it('defaults to front/back', () => expect(guessRoles(null, 3)).toEqual(['front', 'back', 'ignore']))
  it('fills missing front/back from unassigned columns', () =>
    expect(guessRoles(['x', 'y', 'deck'], 3)).toEqual(['front', 'back', 'deck']))
})

describe('mapRows', () => {
  const table = [
    ['front', 'back', 'deck', 'tags'],
    ['Q1', 'A1', 'A::B', 'x y, z'],
    ['', 'A2', '', ''],
    ['Q3', 'A3', '', '']
  ]
  it('maps rows, splits tags, keeps empty fronts for the import to skip', () => {
    expect(mapRows(table, true, ['front', 'back', 'deck', 'tags'])).toEqual([
      { front: 'Q1', back: 'A1', deckPath: 'A::B', tags: ['x', 'y', 'z'] },
      { front: '', back: 'A2' },
      { front: 'Q3', back: 'A3' }
    ])
  })
  it('includes first row when no header', () => {
    expect(mapRows([['a', 'b']], false, ['front', 'back'])).toHaveLength(1)
  })
  it('honours ignore', () => {
    const rows = mapRows([['a', 'b', 'c']], false, ['front', 'ignore', 'back'])
    expect(rows[0]).toEqual({ front: 'a', back: 'c' })
  })
})

describe('dirName', () => {
  it('strips filename', () => {
    expect(dirName('C:\\x\\y\\f.csv')).toBe('C:\\x\\y')
    expect(dirName('/a/b.csv')).toBe('/a')
    expect(dirName('f.csv')).toBeNull()
  })
})
