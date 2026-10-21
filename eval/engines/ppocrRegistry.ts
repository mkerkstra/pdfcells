// Registry entries for the PP-OCR engines, one per model set
// (src/lib/ppocr/models.ts). Kept apart from registry.ts so that file only
// gains one line.

import { modelBytes, PPOCR_MODELS, type PpocrModelId } from '../../src/lib/ppocr/models'

import { ppocrEngine } from './ppocr'
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
