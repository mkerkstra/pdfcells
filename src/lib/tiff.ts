// TIFF pages via utif2 (MIT). Pure: no DOM, so it runs in the Node tests too.
// The caller loads this module lazily; utif2 and pako stay out of the main bundle.

import * as utifNs from 'utif2'
import type { IFD } from 'utif2'

// CJS interop: the namespace may or may not carry the API on `default`.
const UTIF: typeof utifNs = (utifNs as { default?: typeof utifNs }).default ?? utifNs

export interface TiffPage {
  ifd: IFD
  width: number
  height: number
}

const num = (v: unknown): number => (Array.isArray(v) ? Number(v[0]) : Number(v ?? 0))

/** Every full-size image in the file; thumbnails and reduced-resolution copies are skipped. */
export function tiffPages(buf: ArrayBuffer): TiffPage[] {
  return UTIF.decode(buf)
    .filter(ifd => (num(ifd.t254) & 1) === 0) // NewSubfileType bit 0: reduced resolution
    .map(ifd => ({ ifd, width: num(ifd.t256), height: num(ifd.t257) }))
    .filter(p => p.width > 0 && p.height > 0)
}

/** RGBA pixels of one page. The Orientation tag is not applied. */
export function tiffRgba(buf: ArrayBuffer, page: TiffPage): Uint8ClampedArray<ArrayBuffer> {
  UTIF.decodeImage(buf, page.ifd)
  const rgba = UTIF.toRGBA8(page.ifd)
  if (rgba.length < page.width * page.height * 4) throw new Error('TIFF page is truncated')
  return new Uint8ClampedArray(
    rgba.buffer as ArrayBuffer,
    rgba.byteOffset,
    page.width * page.height * 4,
  )
}
