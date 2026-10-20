// In-browser OCR (tesseract.js, WASM). The worker downloads its core and the
// English model once (~7 MB, cached by the browser); pages never leave the device.
// All three come from our own origin (see tesseractAssets in vite.config.ts), not
// tesseract.js's jsDelivr defaults, so OCR works under a 'self'-only CSP.

import type { Worker } from 'tesseract.js'

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
  onProgress = progress
  const w = await getWorker()
  const { data } = await w.recognize(canvas, { rotateAuto: true }, { blocks: true, text: false })
  const words: Word[] = []
  for (const block of data.blocks ?? []) {
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
