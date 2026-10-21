// Corpus files → PageInput[] in Node. PDFs open with pdf.js's legacy build
// (the same one src/corpus.test.ts uses) and render through pdf.js's own
// Node canvas factory (@napi-rs/canvas). Images decode with @napi-rs/canvas
// (PNG, JPEG with EXIF orientation applied, GIF, WebP), TIFF with
// src/lib/tiff.ts and HEIC with src/lib/heic.ts, the app's own decoders.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createCanvas, ImageData, loadImage, type Canvas } from '@napi-rs/canvas'
import factory from 'libheif-js/libheif-wasm/libheif.js'
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'

import { decodeHeic, ready } from '../src/lib/heic'
import { renderScale } from '../src/lib/image'
import { tiffPages, tiffRgba } from '../src/lib/tiff'

import type { PageInput, RenderedPage } from './engine'
import { FIXTURES_DIR, type TruthDoc } from './truth'

const rendered = (canvas: Canvas, scale: number): RenderedPage => ({
  width: canvas.width,
  height: canvas.height,
  scale,
  png: () => canvas.toBuffer('image/png'),
  jpeg: quality => canvas.toBuffer('image/jpeg', Math.round(quality * 100)),
})

/** Pixels of one image page, upright, at their native size. */
type Bitmap = { width: number; height: number; draw(c: Canvas, scale: number): void }

async function imageBitmaps(file: string, bytes: Uint8Array): Promise<Bitmap[]> {
  const fromRgba = (width: number, height: number, data: Uint8ClampedArray): Bitmap => {
    const src = createCanvas(width, height)
    src.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0)
    return {
      width,
      height,
      draw: (c, s) => c.getContext('2d').drawImage(src, 0, 0, width * s, height * s),
    }
  }
  if (/\.tiff?$/i.test(file)) {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    if (!(buf instanceof ArrayBuffer)) throw new Error('unexpected shared buffer')
    return tiffPages(buf).map(p => fromRgba(p.width, p.height, tiffRgba(buf, p)))
  }
  if (/\.hei[cf]$/i.test(file)) {
    const wasm = readFileSync('node_modules/libheif-js/libheif-wasm/libheif.wasm')
    const m = await ready(factory({ wasmBinary: new Uint8Array(wasm) }))
    const d = await decodeHeic(m, bytes)
    return [fromRgba(d.width, d.height, d.data)]
  }
  const img = await loadImage(Buffer.from(bytes))
  return [
    {
      width: img.width,
      height: img.height,
      draw: (c, s) => c.getContext('2d').drawImage(img, 0, 0, img.width * s, img.height * s),
    },
  ]
}

export interface OpenedDoc {
  pages: PageInput[]
  close(): Promise<void>
}

/** Open one corpus file. Page n of the result is truth page n. */
export async function openDoc(truth: TruthDoc, dir = FIXTURES_DIR): Promise<OpenedDoc> {
  const bytes = new Uint8Array(readFileSync(join(dir, truth.file)))
  const base = { file: truth.file, source: truth.source }
  if (truth.file.toLowerCase().endsWith('.pdf')) {
    const pdf: PDFDocumentProxy = await getDocument({
      data: bytes,
      password: truth.password,
      verbosity: 0,
    }).promise
    const pages: PageInput[] = []
    for (let n = 1; n <= pdf.numPages; n++) {
      const pdfPage = await pdf.getPage(n)
      const vp = pdfPage.getViewport({ scale: 1 })
      pages.push({
        ...base,
        page: n,
        kind: 'pdf',
        width: vp.width,
        height: vp.height,
        pdfPage,
        async render(targetPx) {
          const scale = renderScale(Math.max(vp.width, vp.height), targetPx)
          const viewport = pdfPage.getViewport({ scale })
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
          // pdf.js draws into any canvas-like object; @napi-rs/canvas is what its Node factory uses.
          await pdfPage.render({
            canvas: canvas as unknown as HTMLCanvasElement,
            viewport,
            background: '#ffffff',
          }).promise
          return rendered(canvas, scale)
        },
      })
    }
    return { pages, close: () => pdf.loadingTask.destroy() }
  }
  const bitmaps = await imageBitmaps(truth.file, bytes)
  return {
    pages: bitmaps.map((b, i) => ({
      ...base,
      page: i + 1,
      kind: 'image' as const,
      width: b.width,
      height: b.height,
      async render(targetPx) {
        const scale = renderScale(Math.max(b.width, b.height), targetPx)
        const canvas = createCanvas(Math.round(b.width * scale), Math.round(b.height * scale))
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        b.draw(canvas, scale)
        return rendered(canvas, scale)
      },
    })),
    close: async () => {},
  }
}
