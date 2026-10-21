// The app's "try the experimental OCR engine" retry, measured: tesseract.js
// reads the page first (as the app's OCR path does), then PP-OCR v6-tiny
// reads it again, either
//   full  the whole page,
//   band  the page's full width from tesseract's first table to its last,
//         ± margin (src/lib/ocrRetry retryBox, what the app does), or
//   box   tesseract's table hull ± margin (to show why the app doesn't),
// and the PP-OCR words inside the crop replace tesseract's, the rest of the
// page's words kept (src/lib/ocrRetry mergeWords) → layout.buildTables.
//
// timing.ms is the retry alone: render + crop + PP-OCR + layout, as the
// person waits for it after clicking. tesseract's first read is not charged.
// Each page's notes say whether the app would offer the retry on it
// (`trigger: …`), so weak pages can be scored apart.

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { createCanvas, loadImage } from '@napi-rs/canvas'
import * as ort from 'onnxruntime-web'
import { createWorker, type Worker } from 'tesseract.js'

import { buildTables, type LocalTable } from '../../src/lib/layout'
import { wordsFromBlocks } from '../../src/lib/ocr'
import { fromCrop, mergeWords, retryBox, retryReason } from '../../src/lib/ocrRetry'
import { createPpocr, type Ppocr } from '../../src/lib/ppocr/engine'
import { PPOCR_MODELS } from '../../src/lib/ppocr/models'
import { ppocrWordsToPage } from '../../src/lib/ppocr/words'
import { cropForAI, type PixelRect } from '../../src/lib/region'
import type { Table } from '../../src/lib/types'
import type { Engine } from '../engine'

import { cachedModelFile } from './ppocr'
import { OCR_TARGET_PX } from './tesseract'

export type RetryMode = 'full' | 'band' | 'box'

const asTable = (t: LocalTable, i: number): Table => ({
  id: `t${i}`,
  title: t.title,
  headerRows: t.headerRows,
  rows: t.rows,
  notes: '',
  bbox: t.bbox,
  cellConf: t.cellConf,
  include: true,
})

export function ppocrRetryEngine(mode: RetryMode, margin: number): Engine {
  let svc: Promise<Ppocr> | undefined
  let worker: Promise<Worker> | undefined
  const ppocr = () => {
    ort.env.wasm.numThreads = 1
    svc ??= createPpocr(ort, PPOCR_MODELS['v6-tiny'], cachedModelFile)
    return svc
  }
  const tesseract = () => {
    const require = createRequire(import.meta.url)
    const eng = join(
      dirname(require.resolve('@tesseract.js-data/eng/package.json')),
      '4.0.0_best_int',
    )
    worker ??= createWorker('eng', 1, { langPath: eng, cacheMethod: 'none' })
    return worker
  }
  return {
    id: mode === 'full' ? 'ppocr-retry-full' : `ppocr-retry-${mode}${margin}`,
    version: `v6-tiny+${mode}+${margin}+1`,
    kind: 'local',
    async run(page) {
      const [p, w] = await Promise.all([ppocr(), tesseract()])
      // The first read, as the app makes it.
      const img = await page.render(OCR_TARGET_PX)
      const { data } = await w.recognize(
        img.png(),
        { rotateAuto: true },
        { blocks: true, text: false },
      )
      const first = wordsFromBlocks(data.blocks, img.scale, {
        rotateRadians: data.rotateRadians,
        width: img.width,
        height: img.height,
      })
      const tables = buildTables(first).map(asTable)
      const trigger =
        retryReason({ status: 'done', run: { engine: 'ocr', recognizer: 'tesseract' }, tables }) ??
        'none'

      // The retry.
      const t0 = performance.now()
      const size = { width: page.width, height: page.height }
      let rect: PixelRect | null = null
      if (mode === 'band') {
        const crop = retryBox(tables, [], page.page, size, margin)
        rect = crop ? cropForAI(crop.box, size, img.scale, crop.padding) : null
      } else if (mode === 'box') {
        const boxes = tables.flatMap(t => (t.bbox ? [t.bbox] : []))
        if (boxes.length) {
          const hull = {
            x0: Math.min(...boxes.map(b => b.x0)),
            y0: Math.min(...boxes.map(b => b.y0)),
            x1: Math.max(...boxes.map(b => b.x1)),
            y1: Math.max(...boxes.map(b => b.y1)),
          }
          rect = cropForAI(hull, size, img.scale, margin)
        }
      }
      const decoded = await loadImage(img.png())
      const r = rect ?? { x: 0, y: 0, width: img.width, height: img.height }
      const c = createCanvas(r.width, r.height)
      c.getContext('2d').drawImage(decoded, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height)
      const pixels = c.getContext('2d').getImageData(0, 0, r.width, r.height)
      const renderMs = performance.now() - t0
      const { words, timing } = await p.recognize(pixels)
      const fresh = fromCrop(ppocrWordsToPage(words, img.scale), rect, img.scale)
      const all = rect ? mergeWords(first, fresh, rect, img.scale) : fresh
      const out = buildTables(all).map(t => ({
        title: t.title,
        headerRows: t.headerRows,
        rows: t.rows,
        ...(t.cellConf ? { cellConf: t.cellConf } : {}),
      }))
      const area = (r.width * r.height) / (img.width * img.height)
      return {
        tables: out,
        timing: { ms: performance.now() - t0, renderMs },
        costMicros: 0,
        notes: [
          `trigger: ${trigger}`,
          `crop: ${(area * 100).toFixed(0)}% of the page`,
          `det ${Math.round(timing.detMs)} ms, rec ${Math.round(timing.recMs)} ms, ${timing.boxes} boxes`,
        ],
      }
    },
    async close() {
      if (svc) await (await svc).release()
      if (worker) await (await worker).terminate()
      svc = undefined
      worker = undefined
    },
  }
}
