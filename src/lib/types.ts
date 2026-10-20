/** A word with a box in page space: points at scale 1, origin top-left, y down. */
export interface Word {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
  /** OCR confidence 0–100; undefined for embedded PDF text. */
  conf?: number
}

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Which engine produced (or will produce) a page's tables. */
export type Engine = 'text' | 'ocr' | 'ai'

export type Tier = 'fast' | 'accurate' | 'max'

/** One editable grid. Cells stay strings until export. */
export interface Table {
  id: string
  title: string
  headerRows: number
  rows: string[][]
  notes: string
  /** Page-space bounding box, when the engine knows it. */
  bbox?: Box
  /** Per-cell confidence 0–100, aligned with rows (OCR only). */
  cellConf?: (number | null)[][]
  /** Whether the table goes into the workbook. */
  include: boolean
}
