// Table reconstruction from positioned words.
//
// Both engines that run in the browser (the PDF text layer and OCR) produce
// words with boxes; this turns them into grids:
//   1. words → lines (cluster on vertical centre)
//   2. lines → segments (merge words separated by less than a gutter)
//   3. runs of multi-segment lines → table blocks
//   4. per block, columns are the x-ranges between gutters that almost no
//      line crosses (a vertical projection profile)
//   5. segments → cells; wrapped continuation lines fold into the row above

import type { Box, Word } from './types'

export interface LocalTable {
  /** Caption taken from a short line just above the table, if any. */
  title: string
  rows: string[][]
  headerRows: number
  bbox: Box
  cellConf: (number | null)[][] | undefined
  /** 0–1 heuristic quality; drives the triage recommendation. */
  confidence: number
}

interface Line {
  words: Word[]
  y0: number
  y1: number
  yc: number
}

interface Segment {
  text: string
  x0: number
  x1: number
  y0: number
  y1: number
  conf: number | null
}

interface SegLine {
  segs: Segment[]
  y0: number
  y1: number
}

// Currency may lead ($1.00) or trail (1,00 €); negatives as -1, 1-, or (1).
const NUMERIC = /^[(\-−+]?[$€£¥₹]?\s?\d[\d,.\s']*%?\s?[$€£¥₹]?\)?-?$/

export function isNumericCell(s: string): boolean {
  const t = s.trim()
  return t !== '' && NUMERIC.test(t)
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2
}

export function groupLines(words: Word[]): Line[] {
  const ws = words.filter(w => w.text.trim() !== '' && w.y1 > w.y0)
  if (ws.length === 0) return []
  const h = median(ws.map(w => w.y1 - w.y0)) || 1
  const sorted = [...ws].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2)
  const lines: Line[] = []
  for (const w of sorted) {
    const yc = (w.y0 + w.y1) / 2
    const last = lines.at(-1)
    if (last && Math.abs(yc - last.yc) <= h * 0.45) {
      last.words.push(w)
      last.y0 = Math.min(last.y0, w.y0)
      last.y1 = Math.max(last.y1, w.y1)
      last.yc = (last.yc * (last.words.length - 1) + yc) / last.words.length
    } else {
      lines.push({ words: [w], y0: w.y0, y1: w.y1, yc })
    }
  }
  for (const l of lines) l.words.sort((a, b) => a.x0 - b.x0)
  return lines
}

/** Median width of one character, the unit for gap thresholds. */
function charWidth(words: Word[]): number {
  const per = words
    .filter(w => w.text.length > 0)
    .map(w => (w.x1 - w.x0) / w.text.length)
    .filter(x => x > 0)
  return median(per) || 4
}

function segmentLine(line: Line, cw: number): SegLine {
  const segs: Segment[] = []
  for (const w of line.words) {
    const last = segs.at(-1)
    // Word gaps scale with font size: a 16pt title's spaces are wider than a
    // 9pt body column's character, but still far narrower than a gutter.
    const gap = Math.max(cw * 1.2, (w.y1 - w.y0) * 0.55)
    if (last && w.x0 - last.x1 < gap) {
      last.text += ' ' + w.text
      last.x1 = Math.max(last.x1, w.x1)
      last.y0 = Math.min(last.y0, w.y0)
      last.y1 = Math.max(last.y1, w.y1)
      if (w.conf !== undefined) last.conf = Math.min(last.conf ?? 100, w.conf)
    } else {
      segs.push({ text: w.text, x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1, conf: w.conf ?? null })
    }
  }
  return { segs, y0: line.y0, y1: line.y1 }
}

/** Split lines into candidate table blocks. */
function findBlocks(lines: SegLine[]): SegLine[][] {
  const pitch = median(lines.slice(1).map((l, i) => l.y0 - (lines[i]?.y0 ?? 0))) || 12
  const blocks: SegLine[][] = []
  let cur: SegLine[] = []
  let singles = 0
  const flush = () => {
    // Trim trailing single-segment lines that start at the block's left edge
    // (captions, footnotes). Ones indented into a later column are the wrapped
    // tail of the last row's cell and belong to the table.
    const left = Math.min(...cur.flatMap(l => l.segs.map(s => s.x0)))
    const indent = (l: SegLine) => (l.segs[0]?.x0 ?? left) - left > pitch
    while (cur.length && (cur.at(-1)?.segs.length ?? 0) < 2 && !indent(cur.at(-1) as SegLine))
      cur.pop()
    while (
      cur.length &&
      (cur.at(-1)?.segs.length ?? 0) < 2 &&
      cur.filter(l => l.segs.length >= 2).length < 2
    )
      cur.pop()
    if (cur.filter(l => l.segs.length >= 2).length >= 2) blocks.push(cur)
    cur = []
    singles = 0
  }
  for (const l of lines) {
    const prev = cur.at(-1)
    // A blank line's worth of space ends the table.
    if (prev && l.y0 - prev.y0 > pitch * 1.8) flush()
    if (l.segs.length >= 2) {
      cur.push(l)
      singles = 0
    } else if (cur.length > 0 && singles < 2) {
      // Possible wrapped cell, section label or subtotal caption inside a table.
      cur.push(l)
      singles++
    } else {
      flush()
    }
  }
  flush()
  return blocks
}

/** Column x-ranges from the block's vertical projection profile. */
function findColumns(block: SegLine[], cw: number): [number, number][] {
  const segs = block.flatMap(l => l.segs)
  const left = Math.floor(Math.min(...segs.map(s => s.x0)))
  const right = Math.ceil(Math.max(...segs.map(s => s.x1)))
  const width = right - left + 1
  const cover = new Uint16Array(width)
  for (const l of block) {
    if (l.segs.length < 2) continue // spanning captions shouldn't fill gutters
    for (const s of l.segs) {
      for (let x = Math.floor(s.x0) - left; x <= Math.ceil(s.x1) - left; x++)
        cover[x] = (cover[x] ?? 0) + 1
    }
  }
  const multi = block.filter(l => l.segs.length >= 2).length
  const allowance = Math.floor(multi * 0.1) // a few lines may cross a gutter (spanning cells)
  const cols: [number, number][] = []
  let start = -1
  let gap = 0
  for (let x = 0; x < width; x++) {
    const filled = (cover[x] ?? 0) > allowance
    if (filled) {
      if (start < 0) start = x
      else if (gap >= cw * 0.8) {
        cols.push([start + left, x - gap - 1 + left])
        start = x
      }
      gap = 0
    } else if (start >= 0) {
      gap++
    }
  }
  if (start >= 0) cols.push([start + left, width - 1 - gap + left])
  return cols
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

function assign(segs: Segment[], cols: [number, number][]) {
  const cells: string[] = cols.map(() => '')
  const conf: (number | null)[] = cols.map(() => null)
  for (const s of segs) {
    let best = -1
    let bestOv = -1
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i]
      if (!c) continue
      const ov = overlap(s.x0, s.x1, c[0], c[1])
      // Segments falling in a gutter go to the nearest column.
      const score = ov > 0 ? ov : -Math.min(Math.abs(s.x0 - c[1]), Math.abs(s.x1 - c[0]))
      if (best < 0 || score > bestOv) {
        best = i
        bestOv = score
      }
    }
    if (best < 0) continue
    cells[best] = cells[best] ? `${cells[best]} ${s.text}` : s.text
    if (s.conf !== null) conf[best] = Math.min(conf[best] ?? 100, s.conf)
  }
  return { cells, conf }
}

/** A line that only continues the row above (wrapped text in some cells). */
function isContinuation(cells: string[], prev: string[] | undefined): boolean {
  if (!prev) return false
  const filled = cells.filter(c => c !== '')
  if (filled.length === 0) return true
  if (filled.some(isNumericCell)) return false
  // Leading column empty and the row above has a value there: classic wrap of
  // a description column, or a wrapped header.
  const firstEmpty = cells[0] === ''
  return (
    firstEmpty &&
    filled.length <= Math.max(1, Math.floor(cells.length / 2)) &&
    prev.some(c => c !== '')
  )
}

function headerRowCount(rows: string[][]): number {
  const hasNumbers = rows.some(r => r.some(isNumericCell))
  if (!hasNumbers) return rows.length >= 3 ? 1 : 0
  let n = 0
  for (const r of rows) {
    // A section label ("Revenue") fills one cell; a header row fills several.
    if (r.some(isNumericCell) || r.filter(c => c !== '').length < 2 || n >= 3) break
    n++
  }
  return n === rows.length ? 0 : n
}

export function buildTables(words: Word[]): LocalTable[] {
  const lines = groupLines(words)
  if (lines.length === 0) return []
  const cw = charWidth(words)
  const segLines = lines.map(l => segmentLine(l, cw))
  const out: LocalTable[] = []

  const pitch = median(segLines.slice(1).map((l, i) => l.y0 - (segLines[i]?.y0 ?? 0))) || 12
  for (const block of findBlocks(segLines)) {
    const cols = findColumns(block, cw)
    if (cols.length < 2) continue
    const rows: string[][] = []
    const confs: (number | null)[][] = []
    for (const l of block) {
      const { cells, conf } = assign(l.segs, cols)
      const prev = rows.at(-1)
      const prevConf = confs.at(-1)
      if (prev && prevConf && isContinuation(cells, prev)) {
        cells.forEach((c, i) => {
          if (c) prev[i] = prev[i] ? `${prev[i]} ${c}` : c
          const ci = conf[i]
          if (ci !== null && ci !== undefined) prevConf[i] = Math.min(prevConf[i] ?? 100, ci)
        })
      } else {
        rows.push(cells)
        confs.push(conf)
      }
    }
    // Drop columns that ended up entirely empty.
    const keep = cols.map((_, i) => rows.some(r => r[i] !== ''))
    const pruned = rows.map(r => r.filter((_, i) => keep[i]))
    const prunedConf = confs.map(r => r.filter((_, i) => keep[i]))
    const width = pruned[0]?.length ?? 0
    if (width < 2 || pruned.length < 2) continue

    const fill = pruned.map(r => r.filter(c => c !== '').length / width)
    const dense = fill.filter(f => f >= 0.6).length / pruned.length
    const ocrConf = prunedConf.flat().filter((c): c is number => c !== null)
    const ocrFactor = ocrConf.length ? Math.min(1, median(ocrConf) / 90) : 1
    const segs = block.flatMap(l => l.segs)
    const above = segLines[segLines.indexOf(block[0] as SegLine) - 1]
    const caption =
      above?.segs.length === 1 && (block[0]?.y0 ?? 0) - above.y1 < pitch * 2.5
        ? (above.segs[0]?.text ?? '')
        : ''
    out.push({
      title: caption.length <= 60 ? caption : '',
      rows: pruned,
      headerRows: headerRowCount(pruned),
      bbox: {
        x0: Math.min(...segs.map(s => s.x0)),
        y0: Math.min(...segs.map(s => s.y0)),
        x1: Math.max(...segs.map(s => s.x1)),
        y1: Math.max(...segs.map(s => s.y1)),
      },
      cellConf: ocrConf.length ? prunedConf : undefined,
      confidence: Math.max(0, Math.min(1, dense * ocrFactor * (pruned.length >= 3 ? 1 : 0.7))),
    })
  }
  return out
}

/** Render lines as plain text in reading order, for the AI text-layer hint. */
export function linesToText(words: Word[]): string {
  const cw = charWidth(words)
  return groupLines(words)
    .map(l =>
      segmentLine(l, cw)
        .segs.map(s => s.text)
        .join('\t'),
    )
    .join('\n')
}
