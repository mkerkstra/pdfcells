// A document is a list of pages that can be drawn and described. PDFs and
// images both implement it, so nothing past opening needs to know which it is.

import type { PageFacts } from './pagefacts'

export interface Rendered {
  canvas: HTMLCanvasElement
  /** canvas pixels per page unit */
  scale: number
}

export interface PageSource {
  /** 1-based page number */
  n: number
  /** Page size in page units: PDF points, or image pixels. Words and bboxes use the same space. */
  width: number
  height: number
  /** Draw the page so its long side is ~targetPx (capped for memory). */
  render(targetPx: number): Promise<Rendered>
  /** What triage needs to classify the page. */
  facts(): Promise<PageFacts>
}

export interface DocSource {
  name: string
  kind: 'pdf' | 'image'
  pages: number
  page(n: number): Promise<PageSource>
  destroy(): Promise<void>
}

/** A file that can't be opened; the message is written for the person who chose it. */
export class OpenError extends Error {}

/** JPEG for the AI engine: bounded size regardless of how the page was made. */
export async function toJpegBase64(canvas: HTMLCanvasElement, quality = 0.85): Promise<string> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      b =>
        b
          ? resolve(b)
          : reject(new Error('This page couldn’t be turned into an image. Try again.')),
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
