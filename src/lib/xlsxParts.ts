// OOXML parts write-excel-file doesn't write itself, added through its
// "feature" hooks: Excel Tables (ListObjects), cell comments (notes), the
// active cell, and recalculation on open. Each sheet carries what it needs in
// a `parts` sheet option; ids and file numbers are assigned workbook-wide
// before writing, because the per-sheet hooks only see their own sheet.

import type { Feature, Sheet } from 'write-excel-file/browser'
import {
  findElement,
  findElementInsideElement,
  getOrderOfSiblings,
  insertElementMarkupAccordingToOrderOfSiblings,
  sanitizeAttributeValue,
  sanitizeTextContent,
} from 'write-excel-file/utility'

/** An Excel Table on a sheet. Rows and columns are 0-based sheet positions. */
export interface TableSpec {
  /** Workbook-wide id, also the tableN.xml number. */
  id: number
  /** Table name (also its display name): unique, letters, digits and _ only. */
  name: string
  /** Header row; the table runs from here to `lastRow`. */
  headerRow: number
  lastRow: number
  firstCol: number
  /** Column names, exactly as written in the header cells. */
  columns: string[]
}

export interface CommentSpec {
  row: number
  col: number
  text: string
}

export interface SheetParts {
  tables: TableSpec[]
  comments: CommentSpec[]
  /** Workbook-wide number for commentsN.xml and vmlDrawingN.vml (set when there are comments). */
  commentsId?: number
  /** Cell selected on open (Insert → PivotTable starts from the table around it). */
  activeCell?: { row: number; col: number }
}

/** What write-excel-file/browser accepts as file content. */
type Content = File | Blob | ArrayBuffer

export type PartsSheet = Sheet<Content> & { parts?: SheetParts }

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

export function columnLetter(col: number): string {
  let s = ''
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** A1-style address from 0-based row and column. */
export function address(row: number, col: number): string {
  return `${columnLetter(col)}${row + 1}`
}

export function tableRef(t: TableSpec): string {
  return `${address(t.headerRow, t.firstCol)}:${address(t.lastRow, t.firstCol + t.columns.length - 1)}`
}

// Names Excel would read as a cell or R1C1 reference.
const CELL_LIKE = /^(?:[A-Za-z]{1,3}\d+|[RrCc]\d*|[Rr]\d*[Cc]\d*)$/

/**
 * A table name Excel accepts, unique (case-insensitively) among `used`:
 * letters, digits and underscores, starting with a letter, never a cell
 * reference, at most 26 characters.
 */
export function tableName(base: string, used: Set<string>): string {
  let clean = base
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/\W+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  // Short enough to type in a formula: cut long titles at a word break.
  if (clean.length > 24) {
    const cut = clean.lastIndexOf('_', 24)
    clean = clean.slice(0, cut >= 8 ? cut : 24)
  }
  if (!clean) clean = 'Table'
  if (!/^[A-Za-z]/.test(clean) || CELL_LIKE.test(clean)) clean = `T_${clean}`.slice(0, 26)
  let name = clean
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${clean}_${i}`
  used.add(name.toLowerCase())
  return name
}

/**
 * Header names for a table: non-empty, whitespace collapsed, unique within
 * the table (case-insensitively). `fallback(c)` names a blank column.
 */
export function columnNames(
  headers: string[],
  fallback: (c: number) => string = c => `Column ${c + 1}`,
): string[] {
  const used = new Set<string>()
  return headers.map((h, c) => {
    const clean = h.replace(/\s+/g, ' ').trim().slice(0, 250) || fallback(c)
    let name = clean
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${clean} ${i}`
    used.add(name.toLowerCase())
    return name
  })
}

/** xl/tables/tableN.xml: banded rows, filter buttons, Excel's default style. */
export function tableXml(t: TableSpec): string {
  const ref = tableRef(t)
  const cols = t.columns
    .map((name, i) => `<tableColumn id="${i + 1}" name="${sanitizeAttributeValue(name)}"/>`)
    .join('')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<table xmlns="${MAIN}" id="${t.id}" name="${t.name}" displayName="${t.name}" ref="${ref}" headerRowCount="1" totalsRowShown="0">` +
    `<autoFilter ref="${ref}"/>` +
    `<tableColumns count="${t.columns.length}">${cols}</tableColumns>` +
    '<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>' +
    '</table>'
  )
}

export function commentsXml(comments: CommentSpec[]): string {
  const list = comments
    .map(
      c =>
        `<comment ref="${address(c.row, c.col)}" authorId="0"><text><r><t xml:space="preserve">${sanitizeTextContent(c.text)}</t></r></text></comment>`,
    )
    .join('')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<comments xmlns="${MAIN}"><authors><author>PDFCells</author></authors><commentList>${list}</commentList></comments>`
  )
}

/** The legacy VML shapes Excel needs to show comments (hidden until hovered). */
export function vmlXml(comments: CommentSpec[], n: number): string {
  const shapes = comments
    .map(
      (c, k) =>
        `<v:shape id="_x0000_s${n * 1024 + k + 1}" type="#_x0000_t202" style="position:absolute;margin-left:80pt;margin-top:2pt;width:160pt;height:60pt;z-index:${k + 1};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto">` +
        '<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/>' +
        '<v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox>' +
        '<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/>' +
        `<x:Anchor>${c.col + 1}, 15, ${c.row}, 2, ${c.col + 3}, 15, ${c.row + 4}, 16</x:Anchor>` +
        `<x:AutoFill>False</x:AutoFill><x:Row>${c.row}</x:Row><x:Column>${c.col}</x:Column></x:ClientData></v:shape>`,
    )
    .join('')
  return (
    '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
    `<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${n}"/></o:shapelayout>` +
    '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe">' +
    '<v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>' +
    shapes +
    '</xml>'
  )
}

const tableRel = (id: number) => `rIdPdfcellsTable${id}`
const COMMENTS_REL = 'rIdPdfcellsComments'
const VML_REL = 'rIdPdfcellsVml'

function partsOf(options: unknown): SheetParts | undefined {
  return (options as { parts?: SheetParts }).parts
}

function insertInWorksheet(xml: string, markup: string): string {
  const order = getOrderOfSiblings('xl/worksheets/sheet{id}.xml', 'worksheet')
  if (!order) throw new Error('write-excel-file no longer knows the worksheet element order')
  return insertElementMarkupAccordingToOrderOfSiblings(xml, markup, order, 'worksheet')
}

export function selectCell(xml: string, cell: string, sheetIndex: number): string {
  const view = findElement(xml, 'sheetView')
  if (!view) {
    if (findElement(xml, 'sheetViews')) return xml
    return insertInWorksheet(
      xml,
      `<sheetViews><sheetView tabSelected="${sheetIndex === 0 ? 1 : 0}" workbookViewId="0"><selection activeCell="${cell}" sqref="${cell}"/></sheetView></sheetViews>`,
    )
  }
  if (view.selfClosingTag || view.closingTagStartIndex === undefined) return xml
  if (findElementInsideElement(xml, 'selection', view)) return xml
  const pane = findElementInsideElement(xml, 'pane', view)
  const active = pane?.openingTagAttributes.activePane
  const attrs = `${active ? `pane="${String(active)}" ` : ''}activeCell="${cell}" sqref="${cell}"`
  // <selection> follows <pane>, which write-excel-file puts last in the view.
  const at = view.closingTagStartIndex
  return `${xml.slice(0, at)}<selection ${attrs}/>${xml.slice(at)}`
}

// CT_Font child order from the SpreadsheetML schema.
const FONT_ORDER = [
  'b',
  'i',
  'strike',
  'condense',
  'extend',
  'outline',
  'shadow',
  'u',
  'vertAlign',
  'sz',
  'color',
  'name',
  'family',
  'charset',
  'scheme',
]

/** Reorder each <font>'s (self-closing) children into schema order. */
export function orderFontChildren(xml: string): string {
  return xml.replace(/<font>((?:\s*<[a-zA-Z]+\b[^>]*\/>)*)\s*<\/font>/g, (_, inner: string) => {
    const kids = inner.match(/<[a-zA-Z]+\b[^>]*\/>/g) ?? []
    const rank = (k: string) => {
      const i = FONT_ORDER.indexOf(/^<([a-zA-Z]+)/.exec(k)?.[1] ?? '')
      return i < 0 ? FONT_ORDER.length : i
    }
    return `<font>${[...kids].sort((a, b) => rank(a) - rank(b)).join('')}</font>`
  })
}

/** The feature that writes every sheet's `parts`. */
export const partsFeature: Feature<Content> = {
  files: {
    transform: {
      '[Content_Types].xml': {
        insert: sheets => {
          let xml = ''
          let vml = false
          for (const s of sheets) {
            const p = partsOf(s)
            for (const t of p?.tables ?? [])
              xml += `<Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml" PartName="/xl/tables/table${t.id}.xml"/>`
            if (p?.commentsId !== undefined) {
              vml = true
              xml += `<Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml" PartName="/xl/comments${p.commentsId}.xml"/>`
            }
          }
          if (vml)
            xml += `<Default ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing" Extension="vml"/>`
          return xml || undefined
        },
      },
      'xl/styles.xml': {
        // write-excel-file emits <font> children out of schema order (e.g. <color>
        // before <b>); the Open XML SDK validator flags it, so reorder them.
        transform: xml => orderFontChildren(xml),
      },
      'xl/workbook.xml': {
        // No cached values are written, so ask for a full recalculation on open.
        transformElementAttributes: (tag, attrs) =>
          tag === 'calcPr' ? { ...attrs, fullCalcOnLoad: 1 } : attrs,
        transform: xml =>
          findElement(xml, 'calcPr')
            ? xml
            : insertElementMarkupAccordingToOrderOfSiblings(
                xml,
                '<calcPr fullCalcOnLoad="1"/>',
                getOrderOfSiblings('xl/workbook.xml', 'workbook') ?? ['calcPr'],
                'workbook',
              ),
      },
      'xl/worksheets/_rels/sheet{id}.xml.rels': {
        insert: options => {
          const p = partsOf(options)
          if (!p) return undefined
          let xml = p.tables
            .map(
              t =>
                `<Relationship Id="${tableRel(t.id)}" Type="${REL}/table" Target="../tables/table${t.id}.xml"/>`,
            )
            .join('')
          if (p.commentsId !== undefined)
            xml +=
              `<Relationship Id="${COMMENTS_REL}" Type="${REL}/comments" Target="../comments${p.commentsId}.xml"/>` +
              `<Relationship Id="${VML_REL}" Type="${REL}/vmlDrawing" Target="../drawings/vmlDrawing${p.commentsId}.vml"/>`
          return xml || undefined
        },
      },
      'xl/worksheets/sheet{id}.xml': {
        transform: (xml, options, { sheetIndex }) => {
          const p = partsOf(options)
          if (!p) return xml
          let out = xml
          if (p.activeCell)
            out = selectCell(out, address(p.activeCell.row, p.activeCell.col), sheetIndex)
          if (p.commentsId !== undefined)
            out = insertInWorksheet(out, `<legacyDrawing r:id="${VML_REL}"/>`)
          if (p.tables.length)
            out = insertInWorksheet(
              out,
              `<tableParts count="${p.tables.length}">${p.tables.map(t => `<tablePart r:id="${tableRel(t.id)}"/>`).join('')}</tableParts>`,
            )
          return out
        },
      },
    },
    write: {
      files: sheets => {
        const files: Record<string, string> = {}
        for (const s of sheets) {
          const p = partsOf(s)
          for (const t of p?.tables ?? []) files[`xl/tables/table${t.id}.xml`] = tableXml(t)
          if (p?.commentsId !== undefined) {
            files[`xl/comments${p.commentsId}.xml`] = commentsXml(p.comments)
            files[`xl/drawings/vmlDrawing${p.commentsId}.vml`] = vmlXml(p.comments, p.commentsId)
          }
        }
        return Object.keys(files).length ? files : undefined
      },
    },
  },
}

/** Number tables and comment parts workbook-wide, in sheet order. */
export function numberParts(sheets: PartsSheet[]): void {
  let table = 0
  let comments = 0
  for (const s of sheets) {
    if (!s.parts) continue
    for (const t of s.parts.tables) t.id = ++table
    s.parts.commentsId = s.parts.comments.length ? ++comments : undefined
  }
}
