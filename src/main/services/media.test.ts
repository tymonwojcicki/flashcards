import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { saveCsvImage } from './media'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

describe('saveCsvImage', () => {
  let root: string, csvDir: string, dataDir: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'csvimg-'))
    csvDir = path.join(root, 'csv')
    dataDir = path.join(root, 'data')
    fs.mkdirSync(path.join(csvDir, 'images'), { recursive: true })
    fs.mkdirSync(dataDir)
    fs.writeFileSync(path.join(csvDir, 'images', 'x.png'), PNG)
    fs.writeFileSync(path.join(root, 'private.png'), PNG)
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it('imports an image from a sub-folder next to the CSV', async () => {
    expect(await saveCsvImage(dataDir, csvDir, 'images/x.png')).toMatch(/^media:\/\/[a-f0-9]{32}\.png$/)
  })

  it.each([
    ['absolute path', () => path.join(root, 'private.png')],
    ['absolute path inside the CSV folder', () => path.join(csvDir, 'images', 'x.png')],
    ['../ outside the folder', () => '../private.png'],
    ['sub-folder then ../.. outside', () => 'images/../../private.png'],
    ['missing file', () => 'images/nope.png']
  ])('rejects %s', async (_, src) => {
    expect(await saveCsvImage(dataDir, csvDir, src())).toBeNull()
  })
})
