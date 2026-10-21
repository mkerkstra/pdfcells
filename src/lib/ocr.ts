// In-browser OCR (tesseract.js, WASM). The worker downloads its core and the
// English model once (~7 MB, cached by the browser); pages never leave the device.
// All three come from our own origin (see tesseractAssets in vite.config.ts), not
// tesseract.js's jsDelivr defaults, so OCR works under a 'self'-only CSP.

import type { Block, Worker } from 'tesseract.js'

import { ppocrEnabled } from './ppocr/flag'
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
  if (ppocrEnabled()) {
    try {
      return await (await import('./ppocr/browser')).ppocrWords(canvas, scale, progress)
    } catch (e) {
      console.warn('PP-OCR failed; reading the page with tesseract.js instead.', e)
    }
  }
  onProgress = progress
  const w = await getWorker()
  const { data } = await w.recognize(canvas, { rotateAuto: true }, { blocks: true, text: false })
  return wordsFromBlocks(data.blocks, scale, {
    rotateRadians: data.rotateRadians,
    width: canvas.width,
    height: canvas.height,
  })
}

/**
 * How tesseract levelled the image it read. With rotateAuto, tesseract.js 7
 * rotates the image by `rotateRadians` (its own skew estimate, 0 under ~0.3°)
 * before recognition and reports every box in that levelled frame.
 */
export interface OcrRotation {
  /** `data.rotateRadians` of the recognize result. */
  rotateRadians: number | null | undefined
  /** Size in pixels of the image tesseract was given. */
  width: number
  height: number
}

/**
 * tesseract.js blocks → words in page space: boxes mapped back from
 * tesseract's levelled frame to the image as given (areas are drawn on the
 * page, not on the levelled copy), then divided by the render scale. Pure.
 *
 * tesseract.js-core 7 (Balearica/tesseract @ 2a9c1c4, ImageThresholder::SetImage)
 * levels with leptonica `pixRotate(pix, angle, L_ROTATE_AREA_MAP,
 * L_BRING_IN_WHITE, 0, 0)`: same size, about the centre, positive = clockwise
 * on screen. So a levelled point l came from c + R(−angle)(l − c). Each box
 * keeps its size and moves with its centre, which is what areas test.
 */
export function wordsFromBlocks(
  blocks: Block[] | null,
  scale: number,
  rotation?: OcrRotation,
): Word[] {
  const a = rotation?.rotateRadians ?? 0
  const cos = Math.cos(-a)
  const sin = Math.sin(-a)
  const cx = (rotation?.width ?? 0) / 2
  const cy = (rotation?.height ?? 0) / 2
  const words: Word[] = []
  for (const block of blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        for (const word of line.words) {
          const text = word.text.trim()
          if (!text) continue
          let { x0, y0, x1, y1 } = word.bbox
          if (a !== 0) {
            const dx = (x0 + x1) / 2 - cx
            const dy = (y0 + y1) / 2 - cy
            const mx = cx + dx * cos - dy * sin - (x0 + x1) / 2
            const my = cy + dx * sin + dy * cos - (y0 + y1) / 2
            x0 += mx
            x1 += mx
            y0 += my
            y1 += my
          }
          words.push({
            text,
            x0: x0 / scale,
            y0: y0 / scale,
            x1: x1 / scale,
            y1: y1 / scale,
            conf: word.confidence,
          })
        }
      }
    }
  }
  return words
}
