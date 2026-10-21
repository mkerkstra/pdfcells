// Registry entries for the PP-OCR engines, one per model set
// (src/lib/ppocr/models.ts). Kept apart from registry.ts so that file only
// gains one line.

import { modelBytes, PPOCR_MODELS, type PpocrModelId } from '../../src/lib/ppocr/models'

import { ppocrEngine } from './ppocr'
import { ppocrRetryEngine, type RetryMode } from './ppocrRetry'
import type { EngineSpec } from './registry'

const MB = (b: number) => (b / 1e6).toFixed(1)

export const PPOCR_ENGINES: EngineSpec[] = (Object.keys(PPOCR_MODELS) as PpocrModelId[]).map(
  id => ({
    id: `ppocr-${id}`,
    kind: 'local',
    status: 'ready',
    summary: `render 3000px → PP-OCR ${id} det+rec (official ONNX, ${MB(modelBytes(PPOCR_MODELS[id]))} MB, onnxruntime-web WASM 1 thread) → layout.buildTables (opt-in browser engine, src/lib/ppocr)`,
    create: () => ppocrEngine(id),
  }),
)

const retry = (mode: RetryMode, margin = 0): EngineSpec => ({
  id: mode === 'full' ? 'ppocr-retry-full' : `ppocr-retry-${mode}${margin}`,
  kind: 'local',
  status: 'ready',
  summary:
    mode === 'full'
      ? 'the app’s retry on a weak OCR page, whole page: tesseract.js first read → PP-OCR v6-tiny on the full page (ms: the retry only)'
      : mode === 'band'
        ? `the app’s retry: tesseract.js first read → PP-OCR v6-tiny on the page-wide band over tesseract’s tables ± ${margin} pt, other words kept (ms: the retry only)`
        : `retry cropped to tesseract’s table hull ± ${margin} pt (comparison only; the app reads the full-width band)`,
  create: () => ppocrRetryEngine(mode, margin),
})

/** The weak-page retry (src/lib/ocrRetry), cropped several ways, to choose its margin. */
export const PPOCR_RETRY_ENGINES: EngineSpec[] = [
  retry('full'),
  retry('band', 24),
  retry('band', 48),
  retry('band', 96),
  retry('box', 24),
  retry('box', 48),
]
