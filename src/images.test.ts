// Image fixtures through the pure parts of the image path: type sniffing, TIFF
// pages and HEIC decoding. Drawing (createImageBitmap, EXIF rotation) needs a
// browser and is checked there. Regenerate with fixtures/make_fixtures.py.

import { readFileSync } from 'node:fs'

import factory from 'libheif-js/libheif-wasm/libheif.js'
import { describe, expect, it } from 'vitest'

import { sniff, SNIFF_BYTES } from './lib/filetype'
import { decodeHeic, ready } from './lib/heic'
import { tiffPages, tiffRgba } from './lib/tiff'

const read = (file: string) => new Uint8Array(readFileSync(`fixtures/${file}`))
const buffer = (file: string) => {
  const b = read(file)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
const libheif = () =>
  ready(
    factory({
      wasmBinary: new Uint8Array(readFileSync('node_modules/libheif-js/libheif-wasm/libheif.wasm')),
    }),
  )

/** Share of dark pixels: ink on a page, not a blank or garbage frame. */
function ink(rgba: Uint8ClampedArray) {
  let dark = 0
  for (let i = 0; i < rgba.length; i += 4) if ((rgba[i] ?? 255) < 96) dark++
  return dark / (rgba.length / 4)
}

describe('every image fixture is recognized by its bytes', () => {
  it.each([
    ['scanned-invoice.png', 'png'],
    ['scanned-invoice-2p.tiff', 'tiff'],
    ['photo-rotated.jpg', 'jpeg'],
    ['screenshot.gif', 'gif'],
    ['screenshot.webp', 'webp'],
    ['scanned-invoice.heic', 'heic'],
    ['statement.pdf', 'pdf'],
    ['protected.pdf', 'pdf'],
  ])('%s is %s', (file, kind) => {
    expect(sniff(read(file).subarray(0, SNIFF_BYTES)).kind).toBe(kind)
  })
})

describe('TIFF', () => {
  it('opens every page of a multi-page file', () => {
    const buf = buffer('scanned-invoice-2p.tiff')
    const pages = tiffPages(buf)
    expect(pages.map(p => [p.width, p.height])).toEqual([
      [1275, 1651],
      [1275, 1651],
    ])
    for (const p of pages) {
      const rgba = tiffRgba(buf, p)
      expect(rgba.length).toBe(1275 * 1651 * 4)
      expect(ink(rgba)).toBeGreaterThan(0.005)
      expect(ink(rgba)).toBeLessThan(0.2)
    }
  })

  it('finds no pages in a truncated file (the app reports it as damaged)', () => {
    const buf = buffer('scanned-invoice-2p.tiff').slice(0, 4096)
    const pages = (() => {
      try {
        return tiffPages(buf)
      } catch {
        return []
      }
    })()
    expect(pages).toEqual([])
  })
})

describe('HEIC', () => {
  it('decodes the primary image with libheif', async () => {
    const img = await decodeHeic(await libheif(), read('scanned-invoice.heic'))
    expect(img.width).toBe(1275)
    expect(img.height).toBeGreaterThanOrEqual(1650)
    expect(img.data.length).toBe(img.width * img.height * 4)
    expect(ink(img.data)).toBeGreaterThan(0.005)
    expect(ink(img.data)).toBeLessThan(0.2)
  })

  it('throws on a damaged file', async () => {
    const m = await libheif()
    await expect(decodeHeic(m, read('scanned-invoice.heic').slice(0, 2000))).rejects.toThrow(/./)
  })
})
