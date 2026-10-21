// The app's free digital-PDF path, unchanged: pdf.js text layer →
// src/lib/pagefacts → src/lib/triage (which runs src/lib/layout buildTables
// on pages whose text it trusts). Pages without a trustworthy text layer
// (scans, photos, garbled fonts) yield no tables, exactly as in the app,
// which routes those pages to OCR or AI instead.

import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'

import { pageFacts } from '../../src/lib/pagefacts'
import { triage } from '../../src/lib/triage'
import type { Engine, EngineTable } from '../engine'

const IMAGE_OPS: ReadonlySet<number> = new Set([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
])

export function textLayerEngine(): Engine {
  return {
    id: 'text-layer',
    version: '1',
    kind: 'local',
    async run(page) {
      const t0 = performance.now()
      let tables: EngineTable[] = []
      if (page.pdfPage) {
        const facts = await pageFacts(page.pdfPage, IMAGE_OPS)
        tables = triage(facts, true).localTables.map(t => ({
          title: t.title,
          headerRows: t.headerRows,
          rows: t.rows,
          ...(t.cellConf ? { cellConf: t.cellConf } : {}),
        }))
      }
      return { tables, timing: { ms: performance.now() - t0, renderMs: 0 }, costMicros: 0 }
    },
  }
}
