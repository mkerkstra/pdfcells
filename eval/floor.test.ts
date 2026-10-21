// CI guard for src/lib/layout.ts (and pagefacts/triage): the text-layer
// engine over every digital fixture with ground truth must not score below
// the measured baseline (eval/reports/baseline-2026-10-20.md). Deterministic
// and OCR-free, so it runs with `pnpm test`. When a layout change improves a
// number, raise its floor here in the same commit.

import { describe, expect, it } from 'vitest'

import { textLayerEngine } from './engines/textLayer'
import { breakdown, runEngine, selectPages } from './runner'
import { loadCorpus } from './truth'

/** Measured 2026-10-20 on 32 digital pages (31 truth tables), minus 0.005 for ratios. */
const FLOOR = {
  matched: 29,
  maxExtracted: 42,
  maxJunkCells: 225,
  cellExact: 0.9749 - 0.005,
  numericAcc: 0.9756 - 0.005,
  grits: 0.8794 - 0.005,
}

describe('text-layer engine on the digital corpus', () => {
  it('does not regress below the baseline', async () => {
    const run = await runEngine(textLayerEngine(), selectPages(loadCorpus(), { only: 'digital' }))
    const o = breakdown(run.pages).overall
    expect(o.pages).toBe(32)
    expect(o.truthTables).toBe(31)
    expect(o.matched).toBeGreaterThanOrEqual(FLOOR.matched)
    expect(o.predTables).toBeLessThanOrEqual(FLOOR.maxExtracted)
    expect(o.junkCells).toBeLessThanOrEqual(FLOOR.maxJunkCells)
    expect(o.cellExact).toBeGreaterThanOrEqual(FLOOR.cellExact)
    expect(o.numericAcc).toBeGreaterThanOrEqual(FLOOR.numericAcc)
    expect(o.grits).toBeGreaterThanOrEqual(FLOOR.grits)
  }, 60_000)
})
