// Photos, screenshots and TIFF scans as a document: one page per image (or per
// TIFF page). Page units are image pixels after EXIF rotation and the size cap.
// Every page is read from its pixels, exactly like a scanned PDF page.

import { OpenError, type DocSource, type PageSource, type Rendered } from './document'
import type { ImageKind } from './filetype'
import type { Decoded } from './heic'
import type { TiffPage } from './tiff'

/** Long-side cap on decoded pages. OCR renders at 3000px and AI at 2000px, so this loses nothing. */
export const MAX_IMAGE_SIDE = 5000
/**
 * Decoded bitmaps kept referenced; a 5000px page is ~70 MB, so keep few.
 * Evicted bitmaps are left to the garbage collector rather than closed, so a
 * render that is still holding one can finish drawing it.
 */
const BITMAP_CACHE = 3

export interface ImageInput {
  file: File
  kind: ImageKind
}

/** Where one page's pixels come from. */
type Origin =
  | { type: 'native'; file: File; kind: ImageKind }
  | { type: 'heic'; file: File }
  | { type: 'tiff'; file: File; buf: ArrayBuffer; page: TiffPage }

/** A page ready to draw: a blob the browser decodes natively, and its upright size. */
interface Frame {
  blob: Blob
  width: number
  height: number
}

/** Size that fits within the cap, keeping the aspect ratio (pure; tested). */
export function capSize(width: number, height: number, max = MAX_IMAGE_SIDE) {
  const k = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }
}

/** Render scale for a page whose long side is `long` units (same rule as PDFs). */
export function renderScale(long: number, targetPx: number) {
  return Math.min(4, targetPx / long)
}

const damaged = (file: File) =>
  new OpenError(
    `“${file.name}” couldn’t be read as an image. It may be damaged; try saving or exporting it again.`,
  )

let heicModule: Promise<import('libheif-js/libheif-wasm/libheif.js').HeifModule> | null = null

async function decodeHeicFile(file: File): Promise<Decoded> {
  heicModule ??= Promise.all([
    import('libheif-js/libheif-wasm/libheif.js'),
    import('libheif-js/libheif-wasm/libheif.wasm?url'),
    import('./heic'),
  ])
    // This build compiles the WASM synchronously, so it must be handed the bytes.
    .then(async ([lib, wasm, heic]) => {
      const res = await fetch(wasm.default)
      if (!res.ok) throw new Error(`HEIC decoder failed to load (${res.status})`)
      const wasmBinary = new Uint8Array(await res.arrayBuffer())
      return heic.ready(lib.default({ wasmBinary }))
    })
    .catch(() => {
      heicModule = null
      throw new OpenError(
        'The HEIC decoder couldn’t be loaded. Check your connection, then open the file again.',
      )
    })
  const [m, { decodeHeic }] = await Promise.all([heicModule, import('./heic')])
  return decodeHeic(m, new Uint8Array(await file.arrayBuffer()))
}

const fromPixels = (d: Decoded) => createImageBitmap(new ImageData(d.data, d.width, d.height))

/** Downscale to the cap if needed; the input bitmap is consumed. */
async function capped(bmp: ImageBitmap): Promise<{ bmp: ImageBitmap; resized: boolean }> {
  const size = capSize(bmp.width, bmp.height)
  if (size.width === bmp.width && size.height === bmp.height) return { bmp, resized: false }
  const out = await createImageBitmap(bmp, {
    resizeWidth: size.width,
    resizeHeight: size.height,
    resizeQuality: 'high',
  })
  bmp.close()
  return { bmp: out, resized: true }
}

async function encode(bmp: ImageBitmap, type: 'image/png' | 'image/jpeg'): Promise<Blob> {
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  ctx.drawImage(bmp, 0, 0)
  return c.convertToBlob({ type, quality: 0.92 })
}

/**
 * First decode of a page. Formats the browser can't decode natively (HEIC in
 * most browsers, TIFF everywhere) are re-encoded once so later draws are fast.
 */
async function decodeFirst(o: Origin): Promise<{ frame: Frame; bmp: ImageBitmap }> {
  let bmp: ImageBitmap
  let native = o.type === 'native'
  try {
    if (o.type === 'tiff') {
      const { tiffRgba } = await import('./tiff')
      bmp = await fromPixels({
        width: o.page.width,
        height: o.page.height,
        data: tiffRgba(o.buf, o.page),
      })
    } else if (o.type === 'heic') {
      // Safari decodes HEIC itself; everyone else loads libheif.
      const own = await createImageBitmap(o.file, { imageOrientation: 'from-image' }).catch(
        () => null,
      )
      native = own !== null
      bmp = own ?? (await fromPixels(await decodeHeicFile(o.file)))
    } else {
      bmp = await createImageBitmap(o.file, { imageOrientation: 'from-image' })
    }
  } catch (e) {
    throw e instanceof OpenError ? e : damaged(o.file)
  }
  const { bmp: out, resized } = await capped(bmp)
  const lossless = o.type === 'tiff' || (o.type === 'native' && o.kind !== 'jpeg')
  const blob =
    native && !resized ? o.file : await encode(out, lossless ? 'image/png' : 'image/jpeg')
  return { frame: { blob, width: out.width, height: out.height }, bmp: out }
}

/** Open images as one document, in the order given. Decoding happens per page, on demand. */
export async function openImages(inputs: ImageInput[], name: string): Promise<DocSource> {
  const origins: Origin[] = []
  for (const { file, kind } of inputs) {
    if (kind === 'tiff') {
      const buf = await file.arrayBuffer()
      let pages: TiffPage[]
      try {
        const { tiffPages } = await import('./tiff')
        pages = tiffPages(buf)
      } catch {
        throw damaged(file)
      }
      if (pages.length === 0) throw damaged(file)
      for (const page of pages) origins.push({ type: 'tiff', file, buf, page })
    } else if (kind === 'heic') origins.push({ type: 'heic', file })
    else origins.push({ type: 'native', file, kind })
  }

  const frames = new Map<number, Promise<Frame>>()
  const bitmaps = new Map<number, Promise<ImageBitmap>>()

  const remember = (n: number, p: Promise<ImageBitmap>) => {
    bitmaps.delete(n)
    bitmaps.set(n, p)
    while (bitmaps.size > BITMAP_CACHE) {
      const oldest = bitmaps.keys().next().value
      if (oldest === undefined) break
      bitmaps.delete(oldest)
    }
  }

  const frame = (n: number): Promise<Frame> => {
    let f = frames.get(n)
    if (!f) {
      const o = origins[n - 1]
      if (!o) return Promise.reject(new Error(`No page ${n}`))
      const first = decodeFirst(o)
      f = first.then(r => r.frame)
      remember(
        n,
        first.then(r => r.bmp),
      )
      frames.set(n, f)
      // A failed decode may succeed on retry (e.g. the HEIC decoder failed to download).
      f.catch(() => {
        frames.delete(n)
        bitmaps.delete(n)
      })
    }
    return f
  }

  const bitmap = async (n: number): Promise<ImageBitmap> => {
    const fr = await frame(n)
    const cached = bitmaps.get(n)
    if (cached) {
      remember(n, cached) // most recently used
      return cached
    }
    const p = createImageBitmap(fr.blob, { imageOrientation: 'from-image' })
    remember(n, p)
    p.catch(() => bitmaps.delete(n))
    return p
  }

  return {
    name,
    kind: 'image',
    pages: origins.length,
    async page(n): Promise<PageSource> {
      const { width, height } = await frame(n)
      return {
        n,
        width,
        height,
        async render(targetPx): Promise<Rendered> {
          const scale = renderScale(Math.max(width, height), targetPx)
          const bmp = await bitmap(n)
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(width * scale)
          canvas.height = Math.ceil(height * scale)
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('This page couldn’t be drawn. Try again.')
          // Transparent screenshots read as black text on white, like a PDF page.
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
          return { canvas, scale }
        },
        facts: async () => ({ width, height, words: [], raw: '', images: 1, source: 'image' }),
      }
    },
    async destroy() {
      bitmaps.clear()
      frames.clear()
      origins.length = 0
    },
  }
}
