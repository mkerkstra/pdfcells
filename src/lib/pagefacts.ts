// What a page contains, read from pdf.js without any browser-only imports, so
// the same code runs in the app and in the Node corpus tests.

import type { Word } from './types'

type Matrix = [number, number, number, number, number, number]

/** The slice of pdf.js's PDFPageProxy this module needs. */
export interface PageLike {
  getViewport(o: { scale: number }): { width: number; height: number; scale: number; transform: number[] }
  getTextContent(): Promise<{ items: unknown[] }>
  getOperatorList(): Promise<{ fnArray: number[] }>
}

export interface PageFacts {
  width: number
  height: number
  words: Word[]
  /** All extracted text, for character counts and encoding checks. */
  raw: string
  /** Number of raster image paint operations. */
  images: number
}

interface TextItemLike {
  str: string
  transform: number[]
  width: number
}

function isTextItem(x: unknown): x is TextItemLike {
  return typeof x === 'object' && x !== null && 'str' in x && 'transform' in x && 'width' in x
}

function mul(m1: readonly number[], m2: readonly number[]): Matrix {
  const [a1 = 1, b1 = 0, c1 = 0, d1 = 1, e1 = 0, f1 = 0] = m1
  const [a2 = 1, b2 = 0, c2 = 0, d2 = 1, e2 = 0, f2 = 0] = m2
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1]
}

/**
 * Words from the embedded text layer in page space at scale 1 (y down),
 * honouring the page's /Rotate. pdf.js items can hold several words; split
 * them proportionally so the layout engine sees word-level gaps.
 */
export async function pageFacts(page: PageLike, imageOps: ReadonlySet<number>): Promise<PageFacts> {
  const viewport = page.getViewport({ scale: 1 })
  const [content, ops] = await Promise.all([page.getTextContent(), page.getOperatorList()])
  const words: Word[] = []
  let raw = ''
  for (const item of content.items) {
    if (!isTextItem(item) || item.str.trim() === '') continue
    raw += item.str + ' '
    const [a, b, c, d, x, baseline] = mul(viewport.transform, item.transform)
    // Skip text that is still rotated after the page's own rotation (axis
    // labels, watermarks); it never forms table rows.
    if (Math.abs(b) > Math.abs(a) * 0.2) continue
    const fontHeight = Math.hypot(c, d)
    const width = item.width * viewport.scale
    const y0 = baseline - fontHeight * 0.85
    const y1 = baseline + fontHeight * 0.15
    const per = width / Math.max(1, item.str.length)
    const re = /\S+/g
    let m: RegExpExecArray | null
    while ((m = re.exec(item.str))) {
      words.push({ text: m[0], x0: x + m.index * per, x1: x + (m.index + m[0].length) * per, y0, y1 })
    }
  }
  const images = ops.fnArray.filter(fn => imageOps.has(fn)).length
  return { width: viewport.width, height: viewport.height, words, raw, images }
}
