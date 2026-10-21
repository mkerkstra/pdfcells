// What every table-extraction engine looks like to the eval harness.

import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'

import type { Source } from './truth'

/** A page rendered to pixels. Page units × scale = pixels. */
export interface RenderedPage {
  width: number
  height: number
  scale: number
  png(): Buffer
  jpeg(quality: number): Buffer
}

/** One page of a corpus file, as an engine receives it. */
export interface PageInput {
  /** Fixture file name, e.g. "statement.pdf". */
  file: string
  /** 1-based page number. */
  page: number
  source: Source
  /** 'pdf' pages carry a pdf.js page with its text layer; 'image' pages are pixels only. */
  kind: 'pdf' | 'image'
  /** Page size in page units: points for PDFs, upright pixels for images. */
  width: number
  height: number
  /** pdf.js (legacy Node build) page; undefined for image pages. */
  pdfPage?: PDFPageProxy
  /** Render so the long side is ~targetPx (scale capped at 4, as in the app). */
  render(targetPx: number): Promise<RenderedPage>
}

export interface EngineTable {
  title: string
  headerRows: number
  rows: string[][]
  /** Per-cell confidence 0–100 aligned with rows, when the engine has one. */
  cellConf?: (number | null)[][]
}

export interface EngineResult {
  tables: EngineTable[]
  timing: {
    /** Wall time of run(), rendering included. */
    ms: number
    /** Part of ms spent rendering the page, if any. */
    renderMs: number
  }
  /** Cost of this page in micro-dollars (0 for local engines). */
  costMicros: number
  /** Free-form notes (e.g. model warnings) carried into the JSON report. */
  notes?: string[]
}

export interface Engine {
  /** Stable id used on the command line and in reports, e.g. "tesseract". */
  id: string
  /** Bump when the engine's output can change, so cached/old reports are comparable. */
  version: string
  kind: 'local' | 'hosted'
  run(page: PageInput): Promise<EngineResult>
  /** Release workers/handles; called once after the last page. */
  close?(): Promise<void>
}

export async function timed<T>(f: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now()
  const v = await f()
  return [v, performance.now() - t0]
}
