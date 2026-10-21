// The digital path with the noise layer (src/lib/pipeline extractPage): the
// same text layer and table reader as `text-layer`, plus page-number removal,
// block classification (prose / table of contents / chart axis) and the
// usefulness score. Only tables the pipeline would include by default count.
// Running headers/footers need the whole document (extractDocument), which
// the per-page engine interface can't see, so this measures the per-page rules.

import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'

import { pageFacts } from '../../src/lib/pagefacts'
import { extractPage } from '../../src/lib/pipeline'
import { triage } from '../../src/lib/triage'
import type { Engine, EngineTable } from '../engine'

const IMAGE_OPS: ReadonlySet<number> = new Set([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
])

export function textLayerNoiseEngine(): Engine {
  return {
    id: 'text-layer+noise',
    version: '1',
    kind: 'local',
    async run(page) {
      const t0 = performance.now()
      let tables: EngineTable[] = []
      if (page.pdfPage) {
        const facts = await pageFacts(page.pdfPage, IMAGE_OPS)
        // Same gate as the app: only a trusted text layer is read as tables.
        if (triage(facts, true).textTrusted) {
          const { tables: found } = extractPage(facts.words, {
            pageNumber: page.page,
            pageSize: { width: facts.width, height: facts.height },
          })
          tables = found
            .filter(t => t.include)
            .map(t => ({ title: t.title, headerRows: t.headerRows, rows: t.rows }))
        }
      }
      return { tables, timing: { ms: performance.now() - t0, renderMs: 0 }, costMicros: 0 }
    },
  }
}
