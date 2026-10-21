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
  /** Why the app left it out, for the UI; empty when it is included or the person left it out. */
  hiddenReason?: string
  /** Why scoring (pipeline.ts) leaves it out on its own, before any preset; empty when it doesn't. */
  autoHidden?: string
  /** The person set Include themselves: presets and recipes leave it alone. */
  includeSet?: boolean
  /** Shape before the first edit in review (set by recordEdit). */
  origin?: TableOrigin
  /** Structural edits made in review, in order (set by recordEdit). */
  edits?: TableEdit[]
}

/**
 * A column a structural edit pointed at, remembered by its header so the
 * same edit can find the same column in another document.
 */
export interface ColRef {
  /** Header text of the column (header rows joined), as shown. Empty when it has none. */
  name: string
  /** Which column with this name, when several share it (0 = first). */
  nth: number
  /** Position, used only when the header is empty and the widths match. */
  index: number
  /** Table width when the edit was made. */
  width: number
}

/** A structural edit made in review, replayable on another document (batch recipes). */
export type TableEdit =
  | { op: 'merge'; col: ColRef; right: string }
  | { op: 'split'; col: ColRef }
  | { op: 'insert'; after?: ColRef; before?: ColRef; width: number }
  | { op: 'delete'; col: ColRef }
  | { op: 'headerRows'; n: number }
  | { op: 'header'; row: number; col: ColRef; text: string }

/** What a table looked like before anyone edited it. */
export interface TableOrigin {
  /** Header text per column. */
  header: string[]
  width: number
  headerRows: number
  title: string
}
