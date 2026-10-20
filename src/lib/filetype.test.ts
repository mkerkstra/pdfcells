import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { baseName, naturalSort, sniff, SNIFF_BYTES } from './filetype'

const head = (file: string) => new Uint8Array(readFileSync(`fixtures/${file}`)).subarray(0, SNIFF_BYTES)
const bytes = (...xs: (number | string)[]) =>
  new Uint8Array(xs.flatMap(x => (typeof x === 'string' ? [...x].map(c => c.charCodeAt(0)) : [x])))

describe('sniff', () => {
  it.each([
    ['statement.pdf', 'pdf'],
    ['protected.pdf', 'pdf'],
    ['scanned-invoice.png', 'png'],
    ['scanned-invoice-2p.tiff', 'tiff'],
    ['photo-rotated.jpg', 'jpeg'],
    ['screenshot.gif', 'gif'],
    ['screenshot.webp', 'webp'],
    ['scanned-invoice.heic', 'heic'],
  ])('%s is %s', (file, kind) => {
    expect(sniff(head(file)).kind).toBe(kind)
  })

  it('ignores the extension and MIME type entirely', () => {
    expect(sniff(bytes(0xff, 0xd8, 0xff, 0xe0)).kind).toBe('jpeg')
    expect(sniff(bytes('hello, world'))).toEqual({ kind: null, reason: 'unknown' })
  })

  it('finds a PDF header behind leading junk', () => {
    expect(sniff(bytes('\r\n\r\n', '%PDF-1.7')).kind).toBe('pdf')
  })

  it('reads big-endian TIFF and rejects BigTIFF clearly', () => {
    expect(sniff(bytes('MM', 0, 0x2a)).kind).toBe('tiff')
    expect(sniff(bytes('II', 0x2b, 0))).toEqual({ kind: null, reason: 'bigtiff' })
  })

  it('tells HEIC from AVIF, which shares the mif1 brand', () => {
    const ftyp = (major: string, ...compat: string[]) =>
      bytes(0, 0, 0, 16 + compat.length * 4, 'ftyp', major, 0, 0, 0, 0, ...compat)
    expect(sniff(ftyp('heic', 'mif1', 'heic')).kind).toBe('heic')
    expect(sniff(ftyp('mif1', 'heic')).kind).toBe('heic')
    expect(sniff(ftyp('avif', 'mif1', 'miaf'))).toEqual({ kind: null, reason: 'avif' })
    expect(sniff(ftyp('mif1', 'avif'))).toEqual({ kind: null, reason: 'avif' })
    expect(sniff(ftyp('isom', 'mp41')).kind).toBe(null) // an MP4 video
  })

  it('reports empty files', () => {
    expect(sniff(new Uint8Array())).toEqual({ kind: null, reason: 'empty' })
  })
})

describe('naturalSort', () => {
  it('orders numbered files the way people number them', () => {
    const names = ['scan10.png', 'scan2.png', 'Scan1.png', 'IMG_0003.HEIC', 'img_0001.heic']
    expect(naturalSort(names.map(name => ({ name }))).map(f => f.name)).toEqual([
      'img_0001.heic',
      'IMG_0003.HEIC',
      'Scan1.png',
      'scan2.png',
      'scan10.png',
    ])
  })

  it('keeps the original order for identical names (pasted screenshots)', () => {
    const files = [
      { name: 'image.png', id: 1 },
      { name: 'image.png', id: 2 },
    ]
    expect(naturalSort(files).map(f => f.id)).toEqual([1, 2])
  })
})

it('baseName strips document and image extensions only', () => {
  expect(baseName('March.PDF')).toBe('March')
  expect(baseName('IMG_0001.heic')).toBe('IMG_0001')
  expect(baseName('scan.tif')).toBe('scan')
  expect(baseName('notes.txt')).toBe('notes.txt')
})
