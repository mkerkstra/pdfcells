// In-browser OCR (tesseract.js, WASM). The worker downloads its core and the
// English model once (~7 MB, cached by the browser); pages never leave the device.
// All three come from our own origin (see tesseractAssets in vite.config.ts), not
// tesseract.js's jsDelivr defaults, so OCR works under a 'self'-only CSP.

import type { Block, Worker } from 'tesseract.js'

import { ppocrChoice } from './ppocr/flag'
import type { Word } from './types'

declare const __TESSERACT_BASE__: string

let worker: Promise<Worker> | null = null
// The worker's logger is fixed at creation; route progress to the current page.
let onProgress: ((p: number) => void) | undefined

function getWorker(): Promise<Worker> {
  // Loaded on first OCR so the ~100 KB wrapper isn't in the initial bundle.
  worker ??= import('tesseract.js')
    .then(({ createWorker }) =>
      createWorker('eng', 1, {
        workerPath: `${__TESSERACT_BASE__}worker.min.js`,
        // A blob: bootstrap would need worker-src blob:; load the script directly.
        workerBlobURL: false,
        corePath: __TESSERACT_BASE__,
        langPath: __TESSERACT_BASE__,
        logger: m => {
          if (m.status === 'recognizing text') onProgress?.(m.progress)
        },
      }),
    )
    .catch((e: unknown) => {
      worker = null
      throw e
    })
  return worker
}

/** OCR a rendered page; returns words in page space (divided by render scale). */
export async function ocrWords(
  canvas: HTMLCanvasElement,
  scale: number,
  progress?: (p: number) => void,
): Promise<Word[]> {
  // Opt-in experiment (src/lib/ppocr/flag.ts); tesseract.js stays the default.
  const pp = ppocrChoice()
  if (pp) {
    try {
      return await (await import('./ppocr/browser')).ppocrWords(canvas, scale, pp, progress)
    } catch (e) {
      console.warn('PP-OCR failed; reading the page with tesseract.js instead.', e)
    }
  }
  onProgress = progress
  const w = await getWorker()
  const { data } = await w.recognize(canvas, { rotateAuto: true }, { blocks: true, text: false })
  return wordsFromBlocks(data.blocks, scale)
}

/** tesseract.js blocks → words in page space (pixel boxes divided by the render scale). Pure. */
export function wordsFromBlocks(blocks: Block[] | null, scale: number): Word[] {
  const words: Word[] = []
  for (const block of blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        for (const word of line.words) {
          const text = word.text.trim()
          if (!text) continue
          words.push({
            text,
            x0: word.bbox.x0 / scale,
            y0: word.bbox.y0 / scale,
            x1: word.bbox.x1 / scale,
            y1: word.bbox.y1 / scale,
            conf: word.confidence,
          })
        }
      }
    }
  }
  return words
}
