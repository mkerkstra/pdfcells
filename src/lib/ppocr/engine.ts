// PP-OCR det + rec on an injected ONNX Runtime: the browser passes
// onnxruntime-web's WASM build, the eval harness the same package under Node.
// Returns words in the pixel space of the image it was given.

import type * as Ort from 'onnxruntime-web'

import {
  ctcDecode,
  dbBoxes,
  deskew,
  detInput,
  lineWords,
  pageSkew,
  parseCharacterDict,
  recInput,
  recWidth,
  REC_HEIGHT,
  type OcrWord,
  type Rgba,
} from './core'
import type { ModelFile, PpocrModel } from './models'

export type OrtModule = Pick<typeof Ort, 'InferenceSession' | 'Tensor'>

export interface PpocrOptions {
  /** Long side of the det input in pixels (a multiple of 32). */
  detMaxSide: number
  /** Crops per rec run. */
  recBatch: number
  /** Widest rec input; longer lines are squeezed. */
  recMaxWidth: number
}

export const DEFAULT_PPOCR_OPTIONS: PpocrOptions = {
  // PaddleX's own cap: pages are detected at the resolution they're rendered
  // at. 2048 merged closely spaced rows of short numbers on the corpus.
  detMaxSide: 4000,
  recBatch: 8,
  recMaxWidth: 3200,
}

export interface PpocrTiming {
  detMs: number
  recMs: number
  boxes: number
  /** Page skew found (dy/dx); levelled when above SKEW_MIN. */
  skew: number
}

/** Skew (dy/dx) below which a page is read as is: about 0.3°. */
export const SKEW_MIN = 0.005

export interface Ppocr {
  model: PpocrModel
  recognize(
    img: Rgba,
    progress?: (p: number) => void,
  ): Promise<{ words: OcrWord[]; timing: PpocrTiming }>
  release(): Promise<void>
}

/** Loads both sessions and the character list. `load` fetches (and verifies) one file. */
export async function createPpocr(
  ort: OrtModule,
  model: PpocrModel,
  load: (f: ModelFile) => Promise<Uint8Array>,
  options: Partial<PpocrOptions> = {},
): Promise<Ppocr> {
  const opt = { ...DEFAULT_PPOCR_OPTIONS, ...options }
  const [detBytes, recBytes, yml] = await Promise.all([
    load(model.det),
    load(model.rec),
    load(model.recYml),
  ])
  const dict = parseCharacterDict(new TextDecoder().decode(yml))
  const sessionOpts: Ort.InferenceSession.SessionOptions = {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  }
  const det = await ort.InferenceSession.create(detBytes, sessionOpts)
  const rec = await ort.InferenceSession.create(recBytes, sessionOpts)
  const detIn = det.inputNames[0] ?? 'x'
  const detOut = det.outputNames[0] ?? ''
  const recIn = rec.inputNames[0] ?? 'x'
  const recOut = rec.outputNames[0] ?? ''

  return {
    model,
    async recognize(page, progress) {
      const t0 = performance.now()
      const detect = async (im: Rgba) => {
        const di = detInput(im, opt.detMaxSide)
        const res = await det.run({
          [detIn]: new ort.Tensor('float32', di.data, [1, 3, di.height, di.width]),
        })
        const prob = res[detOut]
        if (!prob) throw new Error('PP-OCR det returned no output')
        const map = prob.data as Float32Array
        const found = dbBoxes(
          map,
          di.width,
          di.height,
          model.det.params,
          im.width / di.width,
          im.height / di.height,
          im.width,
          im.height,
        )
        const sk =
          pageSkew(map, di.width, di.height, model.det.params.thresh) *
          (im.height / di.height / (im.width / di.width))
        prob.dispose()
        return { found, sk }
      }
      // There's no orientation model: a page more than ~0.3° askew is
      // levelled and detected again, as tesseract's rotateAuto does. Words
      // are then in the levelled frame, as tesseract's are.
      let img = page
      const first = await detect(img)
      let boxes = first.found
      const skew = first.sk
      if (Math.abs(skew) > SKEW_MIN) {
        img = deskew(page, skew)
        boxes = (await detect(img)).found
      }
      const t1 = performance.now()

      // Similar widths batch together, so little of each batch is padding.
      const order = boxes.map((_, i) => i).sort((a, b) => recWidthOf(a) - recWidthOf(b))
      function recWidthOf(i: number) {
        const b = boxes[i]
        return b ? recWidth(b) : 0
      }
      const perBox: OcrWord[][] = Array.from({ length: boxes.length }, () => [])
      for (let at = 0; at < order.length; at += opt.recBatch) {
        const idx = order.slice(at, at + opt.recBatch)
        const batch = idx.flatMap(i => {
          const b = boxes[i]
          return b ? [b] : []
        })
        const ri = recInput(img, batch, opt.recMaxWidth)
        const res = await rec.run({
          [recIn]: new ort.Tensor('float32', ri.data, [batch.length, 3, REC_HEIGHT, ri.width]),
        })
        const out = res[recOut]
        if (!out) throw new Error('PP-OCR rec returned no output')
        const [, steps = 0, classes = 0] = out.dims
        const probs = out.data as Float32Array
        batch.forEach((b, k) => {
          const chars = ctcDecode(probs, k * steps * classes, steps, classes, dict)
          const i = idx[k]
          if (i !== undefined) perBox[i] = lineWords(chars, b, ri.widths[k] ?? 0, ri.width, steps)
        })
        out.dispose()
        progress?.(Math.min(1, (at + batch.length) / Math.max(1, order.length)))
      }
      return {
        words: perBox.flat(),
        timing: {
          detMs: t1 - t0,
          recMs: performance.now() - t1,
          boxes: boxes.length,
          skew,
        },
      }
    },
    async release() {
      await det.release()
      await rec.release()
    },
  }
}
