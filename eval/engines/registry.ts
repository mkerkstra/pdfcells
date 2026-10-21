// Every engine the harness knows about. Adding one: see eval/README.md.

import type { Engine } from '../engine'

import { claudeEngine, type Tier } from './claude'
import { PPOCR_ENGINES } from './ppocrRegistry'
import { tesseractEngine } from './tesseract'
import { textLayerEngine } from './textLayer'
import { textLayerNoiseEngine } from './textLayerNoise'

export interface EngineContext {
  apiKey?: string
  tier: Tier
}

export interface EngineSpec {
  id: string
  kind: 'local' | 'hosted'
  /** 'stub' engines are documented candidates with no adapter yet; selecting one is an error. */
  status: 'ready' | 'stub'
  summary: string
  create?(ctx: EngineContext): Engine
}

export const ENGINES: EngineSpec[] = [
  {
    id: 'text-layer',
    kind: 'local',
    status: 'ready',
    summary: 'pdf.js text layer → pagefacts → triage → layout.buildTables (the app’s digital path)',
    create: () => textLayerEngine(),
  },
  {
    id: 'text-layer+noise',
    kind: 'local',
    status: 'ready',
    summary:
      'text-layer plus src/lib/pipeline extractPage: page numbers removed, prose/contents/axis blocks and low scores hidden',
    create: () => textLayerNoiseEngine(),
  },
  {
    id: 'tesseract',
    kind: 'local',
    status: 'ready',
    summary:
      'render 3000px → tesseract.js 7 LSTM (eng best_int) → layout.buildTables (the app’s OCR path)',
    create: () => tesseractEngine(),
  },
  {
    id: 'claude',
    kind: 'hosted',
    status: 'ready',
    summary:
      'render 2000px JPEG + text-layer hint → Anthropic Messages API with backend/extract’s prompt and schema (--tier fast|accurate|max); needs ANTHROPIC_API_KEY, --hosted and --yes',
    create: ctx => {
      if (!ctx.apiKey) throw new Error('claude needs ANTHROPIC_API_KEY')
      return claudeEngine({ apiKey: ctx.apiKey, tier: ctx.tier })
    },
  },
  ...PPOCR_ENGINES,
  {
    id: 'paddleocr-vl',
    kind: 'hosted',
    status: 'stub',
    summary:
      'PaddleOCR-VL-1.6 served by vLLM (self-hosted GPU), page image → HTML/Markdown tables → grids. Candidate #2 in docs/research/ocr-sota-2026.md.',
  },
]

export function engineSpec(id: string): EngineSpec {
  const s = ENGINES.find(e => e.id === id)
  if (!s) throw new Error(`unknown engine "${id}" (known: ${ENGINES.map(e => e.id).join(', ')})`)
  return s
}
