import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'


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

/** pdf.js operator codes that paint raster images (scans, photos, logos). */
export const IMAGE_OPS: ReadonlySet<number> = new Set([
  pdfjs.OPS.paintImageXObject,
  pdfjs.OPS.paintInlineImageXObject,
  pdfjs.OPS.paintImageMaskXObject,
  pdfjs.OPS.paintImageXObjectRepeat,
])

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
