// PP-OCR det + rec (official PaddlePaddle ONNX exports) through the app's own
// code: render at 3000 px like the tesseract engine → src/lib/ppocr/engine
// (pre/post-processing shared with the browser) on onnxruntime-web's WASM
// backend, single-threaded as in the browser without cross-origin isolation →
// words divided by the render scale → src/lib/layout buildTables.
//
// Models download once from their pinned Hugging Face URLs into
// eval/.cache/ppocr/ (git-ignored) and are checked against their sha256.
// PPOCR_DET_MAX_SIDE overrides the det input's long side for tuning sweeps.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createCanvas, loadImage } from '@napi-rs/canvas'
import * as ort from 'onnxruntime-web'

import { buildTables } from '../../src/lib/layout'
import { createPpocr, DEFAULT_PPOCR_OPTIONS, type Ppocr } from '../../src/lib/ppocr/engine'
import { PPOCR_MODELS, type ModelFile, type PpocrModelId } from '../../src/lib/ppocr/models'
import { ppocrWordsToPage } from '../../src/lib/ppocr/words'
import { timed, type Engine } from '../engine'

import { OCR_TARGET_PX } from './tesseract'

const CACHE = join(import.meta.dirname, '..', '.cache', 'ppocr')

/** Reads a model file from the cache, downloading and verifying it on a miss. */
export async function cachedModelFile(f: ModelFile): Promise<Uint8Array> {
  const name = createHash('sha256').update(f.url).digest('hex').slice(0, 16)
  const path = join(CACHE, `${name}-${f.url.split('/').pop() ?? 'file'}`)
  if (!existsSync(path)) {
    const res = await fetch(f.url)
    if (!res.ok) throw new Error(`${f.url}: HTTP ${res.status}`)
    const buf = new Uint8Array(await res.arrayBuffer())
    mkdirSync(CACHE, { recursive: true })
    writeFileSync(path, buf)
  }
  const buf = new Uint8Array(readFileSync(path))
  if (buf.byteLength !== f.bytes)
    throw new Error(`${path}: ${buf.byteLength} bytes, want ${f.bytes}`)
  if (f.sha256 && createHash('sha256').update(buf).digest('hex') !== f.sha256)
    throw new Error(`${path}: sha256 mismatch`)
  return buf
}

export function ppocrEngine(modelId: PpocrModelId): Engine {
  const model = PPOCR_MODELS[modelId]
  const detMaxSide = Number(process.env.PPOCR_DET_MAX_SIDE) || DEFAULT_PPOCR_OPTIONS.detMaxSide
  let svc: Promise<Ppocr> | undefined
  const get = () => {
    // Single-threaded WASM, as the app runs it (no COOP/COEP → no SharedArrayBuffer).
    ort.env.wasm.numThreads = 1
    svc ??= createPpocr(ort, model, cachedModelFile, { detMaxSide })
    return svc
  }
  return {
    id: `ppocr-${modelId}`,
    version: `${modelId}+ort-web-${ort.env.versions.web}+det${detMaxSide}+3`,
    kind: 'local',
    async run(page) {
      // Model download and session creation are not charged to the first page.
      const p = await get()
      const t0 = performance.now()
      const [rgba, renderMs] = await timed(async () => {
        const img = await page.render(OCR_TARGET_PX)
        const decoded = await loadImage(img.png())
        const c = createCanvas(decoded.width, decoded.height)
        const ctx = c.getContext('2d')
        ctx.drawImage(decoded, 0, 0)
        return { pixels: ctx.getImageData(0, 0, c.width, c.height), scale: img.scale }
      })
      const { words, timing } = await p.recognize(rgba.pixels)
      const tables = buildTables(ppocrWordsToPage(words, rgba.scale)).map(t => ({
        title: t.title,
        headerRows: t.headerRows,
        rows: t.rows,
        ...(t.cellConf ? { cellConf: t.cellConf } : {}),
      }))
      return {
        tables,
        timing: { ms: performance.now() - t0, renderMs },
        costMicros: 0,
        notes: [
          `det ${Math.round(timing.detMs)} ms, rec ${Math.round(timing.recMs)} ms, ${timing.boxes} boxes, skew ${timing.skew.toFixed(4)}`,
        ],
      }
    },
    async close() {
      if (svc) await (await svc).release()
      svc = undefined
    },
  }
}
