// Batch recipes: the structural edits made while reviewing the first document
// of a format, replayed on every other document of that format. A recipe
// never carries cell values. Every edit finds its column again by header
// name; position is only trusted when the column has no header and the table
// is the same width. An edit that can't be placed is reported, never guessed.

import type { PageTables } from './checks/model'
import { headerCells, words } from './fingerprint'
import * as ops from './tableOps'
import type { PageKind } from './triage'
import type { ColRef, Engine, Table, TableEdit, TableOrigin } from './types'

const soft = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
const loose = (s: string) => words(s).join(' ')

export function originOf(t: Table): TableOrigin {
  return {
    header: headerCells(t),
    width: t.rows[0]?.length ?? 0,
    headerRows: t.headerRows,
    title: t.title,
  }
}

/** The column at c, remembered by its header. */
export function colRef(t: Table, c: number): ColRef {
  const names = headerCells(t)
  const name = names[c] ?? ''
  const key = soft(name)
  const nth = key ? names.slice(0, c).filter(n => soft(n) === key).length : 0
  return { name, nth, index: c, width: t.rows[0]?.length ?? 0 }
}

/**
 * `after` is `before` with one edit applied. Remembers the table's shape
 * before its first edit and appends the structural edit, if any (cell
 * values, titles and Include are not edits: they are read off the result).
 */
export function recordEdit(before: Table, after: Table, edit?: TableEdit): Table {
  const origin = before.origin ?? originOf(before)
  const prev = before.edits ?? []
  let edits = prev
  if (edit) {
    // Typing a header or changing the header-row count one step at a time
    // records only where it ended up.
    const last = prev.at(-1)
    const same =
      last &&
      ((last.op === 'headerRows' && edit.op === 'headerRows') ||
        (last.op === 'header' &&
          edit.op === 'header' &&
          last.row === edit.row &&
          last.col.index === edit.col.index &&
          last.col.width === edit.col.width))
    edits = same
      ? [
          ...prev.slice(0, -1),
          edit.op === 'header' && last.op === 'header' ? { ...edit, col: last.col } : edit,
        ]
      : [...prev, edit]
  }
  return { ...after, origin, edits }
}

/** Find a column again: same header, else same header without digits, else same position in a same-width headerless table. */
export function resolve(t: Table, ref: ColRef): number | string {
  const names = headerCells(t)
  const width = t.rows[0]?.length ?? 0
  if (ref.name.trim()) {
    for (const norm of [soft, loose]) {
      const key = norm(ref.name)
      if (!key) continue
      const hits = names.flatMap((n, c) => (norm(n) === key ? [c] : []))
      const hit = hits[ref.nth] ?? (hits.length === 1 ? hits[0] : undefined)
      if (hit !== undefined) return hit
    }
    return `there’s no “${ref.name}” column`
  }
  if (width === ref.width && (names[ref.index] ?? '') === '') return ref.index
  return `the columns don’t line up (${width} here, ${ref.width} in the first file)`
}

function describe(e: TableEdit): string {
  switch (e.op) {
    case 'merge':
      return `merge “${e.col.name || `column ${e.col.index + 1}`}” with the column to its right`
    case 'split':
      return `split “${e.col.name || `column ${e.col.index + 1}`}”`
    case 'insert':
      return 'add a column'
    case 'delete':
      return `delete “${e.col.name || `column ${e.col.index + 1}`}”`
    case 'headerRows':
      return `use ${e.n} header ${e.n === 1 ? 'row' : 'rows'}`
    case 'header':
      return `rename the header to “${e.text}”`
  }
}

/** Apply one edit, or say why it can't be placed. */
export function applyEdit(t: Table, e: TableEdit): Table | string {
  const at = (ref: ColRef) => resolve(t, ref)
  const fail = (why: string) => `Couldn’t ${describe(e)}: ${why}`
  switch (e.op) {
    case 'merge': {
      const c = at(e.col)
      if (typeof c === 'string') return fail(c)
      const right = headerCells(t)[c + 1]
      if (right === undefined) return fail('it’s the last column')
      if (e.right.trim() && loose(right) !== loose(e.right))
        return fail(`the column to its right is “${right}”, not “${e.right}”`)
      return ops.mergeRight(t, c)
    }
    case 'split': {
      const c = at(e.col)
      return typeof c === 'string' ? fail(c) : ops.splitCol(t, c)
    }
    case 'delete': {
      const c = at(e.col)
      return typeof c === 'string' ? fail(c) : ops.deleteCol(t, c)
    }
    case 'insert': {
      if (e.after) {
        const c = at(e.after)
        return typeof c === 'string' ? fail(c) : ops.insertCol(t, c + 1)
      }
      if (e.before) {
        const c = at(e.before)
        return typeof c === 'string' ? fail(c) : ops.insertCol(t, c)
      }
      return fail('the first file’s table was empty')
    }
    case 'headerRows':
      return ops.setHeaderRows(t, e.n)
    case 'header': {
      if (e.row >= t.headerRows) return fail('this table has fewer header rows')
      const c = at(e.col)
      return typeof c === 'string' ? fail(c) : ops.setCell(t, e.row, c, e.text)
    }
  }
}

/** Page kinds as the engine choice sees them: photos and screenshots apart from scans. */
export type ReadKind = PageKind | 'image'

/** How one table of the first document should be treated in the others. */
export interface TableRule {
  /** The table before any edit, as it would be read from another document. */
  match: TableOrigin
  page: number
  /** 0-based position among its page's tables. */
  position: number
  include: boolean
  /** Set when the title was renamed in review. */
  title?: string
  edits: TableEdit[]
}

export interface Recipe {
  /** File the recipe was set up on, for messages. */
  source: string
  tables: TableRule[]
  /** The engine the first document's pages of each kind ended up read with. */
  engines: Partial<Record<ReadKind, Engine | 'skip'>>
}

/** Matching key for a table shape: its header, or "no header" plus width and title. */
function key(o: TableOrigin, norm: (s: string) => string): string {
  const head = o.header.map(norm)
  return head.some(Boolean) ? `h:${o.width}:${head.join('|')}` : `n:${o.width}:${loose(o.title)}`
}

/**
 * The recipe from a reviewed document. `before` is its tables as read (when
 * review started); `after` is what review left. A table that is gone from
 * `after` was deleted and is left out of every other document too.
 */
export function buildRecipe(
  source: string,
  before: PageTables[],
  after: PageTables[],
  engines: Recipe['engines'],
): Recipe {
  const rules: TableRule[] = []
  const add = (r: TableRule) => {
    const k = key(r.match, soft)
    const i = rules.findIndex(x => key(x.match, soft) === k)
    const cur = rules[i]
    if (!cur) rules.push(r)
    // Repeats of one table (a statement's page 2 and 3) share a rule: keep
    // the one changed most, counting renames and Include as changes too.
    else if (changes(r) > changes(cur)) rules[i] = r
  }
  const changes = (r: TableRule) =>
    r.edits.length + (r.title === undefined ? 0 : 1) + (r.include ? 0 : 1)
  for (const p of after)
    p.tables.forEach((t, position) => {
      const match = t.origin ?? originOf(t)
      add({
        match,
        page: p.page,
        position,
        include: t.include,
        ...(t.title !== match.title ? { title: t.title } : {}),
        edits: t.edits ?? [],
      })
    })
  const kept = new Set(after.flatMap(p => p.tables.map(t => t.id)))
  const was = new Set(before.flatMap(p => p.tables.map(t => t.id)))
  // A page read again (OCR, AI, Fix with AI) has new tables: its old ones were replaced, not deleted.
  const reread = new Set(after.filter(p => p.tables.some(t => !was.has(t.id))).map(p => p.page))
  for (const p of before)
    p.tables.forEach((t, position) => {
      if (kept.has(t.id) || reread.has(p.page)) return
      const match = t.origin ?? originOf(t)
      if (rules.some(r => key(r.match, soft) === key(match, soft))) return
      rules.push({ match, page: p.page, position, include: false, edits: [] })
    })
  return { source, tables: rules, engines }
}

/** The rule for a table: same header (exact, then without digits); headerless tables by width and title, then by position. */
export function ruleFor(
  recipe: Recipe,
  t: Table,
  page: number,
  position: number,
): TableRule | null {
  const o = originOf(t)
  for (const norm of [soft, loose]) {
    const k = key(o, norm)
    const hit = recipe.tables.find(r => key(r.match, norm) === k)
    if (hit) return hit
  }
  if (o.header.some(h => h.trim())) return null
  const sameShape = recipe.tables.filter(
    r => !r.match.header.some(h => h.trim()) && r.match.width === o.width,
  )
  return (
    sameShape.find(r => r.page === page && r.position === position) ??
    (sameShape.length === 1 ? (sameShape[0] ?? null) : null)
  )
}

export interface Applied {
  pages: PageTables[]
  /** Why the recipe didn't apply cleanly; empty when it did. */
  problems: string[]
}

/** Replay a recipe on another document's tables (as read, before any edit). */
export function applyRecipe(recipe: Recipe, pages: PageTables[]): Applied {
  const problems: string[] = []
  let matched = 0
  const out = pages.map(p => ({
    page: p.page,
    tables: p.tables.map((t, position) => {
      const where = `Page ${p.page}, table ${position + 1}`
      const rule = ruleFor(recipe, t, p.page, position)
      if (!rule) {
        problems.push(`${where} doesn’t match any table in ${recipe.source}`)
        return t
      }
      matched++
      let next: Table = t
      for (const e of rule.edits) {
        const res = applyEdit(next, e)
        if (typeof res === 'string') {
          problems.push(`${where}: ${res}`)
          return t
        }
        next = res
      }
      return {
        ...next,
        include: rule.include,
        title: rule.title ?? next.title,
        // The replayed edits are this table's history too, so a later recipe built from it is whole.
        origin: originOf(t),
        edits: rule.edits,
      }
    }),
  }))
  if (matched === 0 && pages.some(p => p.tables.length))
    problems.push(`None of its tables match ${recipe.source}`)
  return { pages: out, problems }
}

/** Plain list of what a recipe does, for the batch screen. */
export function recipeSummary(r: Recipe): string[] {
  const out: string[] = []
  for (const t of r.tables) {
    const name = t.title ?? (t.match.title || t.match.header.filter(Boolean).slice(0, 3).join(', '))
    if (!t.include) {
      out.push(name ? `Leave out “${name}”` : `Leave out table ${t.position + 1} on page ${t.page}`)
      continue
    }
    if (t.title !== undefined)
      out.push(
        `Rename “${t.match.title || `table ${t.position + 1} on page ${t.page}`}” to “${t.title}”`,
      )
    for (const e of t.edits) {
      const d = describe(e)
      out.push(d.charAt(0).toUpperCase() + d.slice(1))
    }
  }
  return out
}
