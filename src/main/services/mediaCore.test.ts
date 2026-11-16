import { describe, expect, it } from 'vitest'
import { mediaNameFromUrl } from './mediaCore'

const NAME = '0123456789abcdef0123456789abcdef.png'

describe('mediaNameFromUrl', () => {
  it.each([NAME, `media://${NAME}`, `media://${NAME}/`, `${NAME}/`])('accepts %s', (input) =>
    expect(mediaNameFromUrl(input)).toBe(NAME))

  it.each([
    `../${NAME}`,
    `..`,
    `media://../${NAME}`,
    `sub/${NAME}`,
    `/${NAME}`,
    `sub\\${NAME}`,
    `..\\${NAME}`,
    `..%2F${NAME}`,
    `..%5C${NAME}`,
    `%2e%2e%2F${NAME}`,
    `media://..%2f${NAME}`,
    '0123456789abcdef0123456789abcdeg.png', // non-hex
    '0123456789ABCDEF0123456789ABCDEF.png', // upper-case hex
    '0123456789abcdef.png', // too short
    '0123456789abcdef0123456789abcdef.exe', // unknown extension
    '0123456789abcdef0123456789abcdef.png.exe',
    '0123456789abcdef0123456789abcdef',
    '%',
    ''
  ])('rejects %s', (input) => expect(mediaNameFromUrl(input)).toBeNull())
})
