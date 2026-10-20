import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'

import type { Word } from './types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type { PDFDocumentProxy, PDFPageProxy }

export class PasswordRequired extends Error {
  readonly incorrect: boolean
  constructor(incorrect: boolean) {
    super(incorrect ? 'Incorrect password' : 'This PDF is password-protected')
    this.incorrect = incorrect
  }
}

export async function openPdf(data: ArrayBuffer, password?: string): Promise<PDFDocumentProxy> {
  try {
    // pdf.js transfers the buffer to its worker; keep the caller's copy intact.
    return await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), password }).promise
  } catch (e) {
    if (e instanceof pdfjs.PasswordException) {
      throw new PasswordRequired(e.code === pdfjs.PasswordResponses.INCORRECT_PASSWORD)
    }
    throw e
  }
}

function isTextItem(x: unknown): x is TextItem {
  return typeof x === 'object' && x !== null && 'str' in x && 'transform' in x
}

/**
 * Words from the embedded text layer, in page space at scale 1 (y down).
 * pdf.js items can hold several words; split them proportionally so the
 * layout engine sees word-level gaps.
 */
export async function textWords(page: PDFPageProxy): Promise<{ words: Word[]; raw: string }> {
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const words: Word[] = []
  let raw = ''
  for (const item of content.items) {
    if (!isTextItem(item) || item.str.trim() === '') continue
    raw += item.str + ' '
    const tx = pdfjs.Util.transform(viewport.transform, item.transform)
    const a = Number(tx[0])
    const b = Number(tx[1])
    // Skip rotated text (axis labels, watermarks); it never forms table rows.
    if (Math.abs(b) > Math.abs(a) * 0.2) continue
    const fontHeight = Math.hypot(Number(tx[2]), Number(tx[3]))
    const x = Number(tx[4])
    const baseline = Number(tx[5])
    const width = item.width * viewport.scale
    const y0 = baseline - fontHeight * 0.85
    const y1 = baseline + fontHeight * 0.15
    const str = item.str
    const per = width / Math.max(1, str.length)
    const re = /\S+/g
    let m: RegExpExecArray | null
    while ((m = re.exec(str))) {
      words.push({
        text: m[0],
        x0: x + m.index * per,
        x1: x + (m.index + m[0].length) * per,
        y0,
        y1,
      })
    }
  }
  return { words, raw }
}

/** Whether the page paints any raster image (a scan, photo, or logo). */
export async function imageCoverage(page: PDFPageProxy): Promise<number> {
  const ops = await page.getOperatorList()
  const imageOps = new Set([
    pdfjs.OPS.paintImageXObject,
    pdfjs.OPS.paintInlineImageXObject,
    pdfjs.OPS.paintImageMaskXObject,
    pdfjs.OPS.paintImageXObjectRepeat,
  ])
  return ops.fnArray.filter(fn => imageOps.has(fn)).length
}

export interface Rendered {
  canvas: HTMLCanvasElement
  /** canvas pixels per page point */
  scale: number
}

/** Render a page so its long side is ~targetPx (capped for memory). */
export async function renderPage(page: PDFPageProxy, targetPx = 2000): Promise<Rendered> {
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(4, targetPx / Math.max(base.width, base.height))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvas, viewport, background: '#ffffff' }).promise
  return { canvas, scale }
}

/** JPEG for the AI engine: bounded size regardless of how the PDF was made. */
export async function toJpegBase64(canvas: HTMLCanvasElement, quality = 0.85): Promise<string> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('could not encode page'))),
      'image/jpeg',
      quality,
    ),
  )
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
