// The app's free OCR path: render at ~3000px on the long side (≈300 dpi for
// a letter page, as src/state/runner.ts does) → tesseract.js (WASM, LSTM,
// English best_int model from @tesseract.js-data/eng, as served to the
// browser) → src/lib/ocr wordsFromBlocks → src/lib/layout buildTables.
// Every page is OCR'd, digital ones included, so the two local engines can be
// compared page for page. One worker serves the whole run.

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { createWorker, type Worker } from 'tesseract.js'

import { buildTables } from '../../src/lib/layout'
import { wordsFromBlocks } from '../../src/lib/ocr'
import { timed, type Engine } from '../engine'

/** Same render target as the app's OCR path. */
export const OCR_TARGET_PX = 3000

export function tesseractEngine(): Engine {
  let worker: Promise<Worker> | undefined
  const getWorker = () => {
    const require = createRequire(import.meta.url)
    const eng = join(
      dirname(require.resolve('@tesseract.js-data/eng/package.json')),
      '4.0.0_best_int',
    )
    // OEM 1 = LSTM only, as in src/lib/ocr.ts; cacheMethod 'none' reads the model from node_modules.
    worker ??= createWorker('eng', 1, { langPath: eng, cacheMethod: 'none' })
    return worker
  }
  return {
    id: 'tesseract',
    version: '7.0.0+eng-best_int+page-coords',
    kind: 'local',
    async run(page) {
      // Worker start-up (once per run, ~0.1 s) is not charged to the first page.
      const w = await getWorker()
      const t0 = performance.now()
      const [img, renderMs] = await timed(() => page.render(OCR_TARGET_PX))
      const { data } = await w.recognize(
        img.png(),
        { rotateAuto: true },
        { blocks: true, text: false },
      )
      const words = wordsFromBlocks(data.blocks, img.scale, {
        rotateRadians: data.rotateRadians,
        width: img.width,
        height: img.height,
      })
      const tables = buildTables(words).map(t => ({
        title: t.title,
        headerRows: t.headerRows,
        rows: t.rows,
        ...(t.cellConf ? { cellConf: t.cellConf } : {}),
      }))
      return { tables, timing: { ms: performance.now() - t0, renderMs }, costMicros: 0 }
    },
    async close() {
      if (worker) await (await worker).terminate()
      worker = undefined
    },
  }
}
