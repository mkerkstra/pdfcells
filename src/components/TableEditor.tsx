import {
  ArrowDownToLine,
  ArrowRightToLine,
  CalendarDays,
  Columns2,
  Combine,
  Check,
  Copy,
  Hash,
  Rows2,
  Sparkles,
  Split,
  Trash2,
  Type,
} from 'lucide-react'
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { fixInstruction } from '@/lib/checks/instruct'
import type { IssueKind, TickKind } from '@/lib/checks/model'
import { copyTable } from '@/lib/plaintext'
import { colRef, recordEdit } from '@/lib/recipe'
import * as ops from '@/lib/tableOps'
import type { Table, TableEdit } from '@/lib/types'
import { columnTypes, review, totalRows as findTotalRows, type Issue } from '@/lib/validate'

import { Badge, Button, cn, FIELD, FOOTED_TITLE, Spinner, Tick } from './ui'

/** Checks where a failure means the numbers can't all be right. */
const ARITHMETIC: ReadonlySet<IssueKind> = new Set([
  'total',
  'balance',
  'arithmetic',
  'crossfoot',
  'tie',
  'provenance',
])

const TICK_TITLE: Record<TickKind, string> = {
  total: FOOTED_TITLE,
  balance: 'Balance ties: each balance equals the previous balance plus that row’s amount',
  arithmetic: 'Line totals check: quantity × price equals the line total on every row',
  crossfoot: 'Cross-footed: the total column equals the sum of the columns it adds up',
  tie: 'Ties: the subtotal, tax and total (or opening and closing balances) agree',
}

const COL = (i: number): string =>
  i < 26
    ? String.fromCharCode(65 + i)
    : COL(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26))
const KIND_ICON = { number: Hash, date: CalendarDays, text: Type } as const
const KIND_NAME = { number: 'Numbers', date: 'Dates', text: 'Text' } as const
const FIX_PRESETS = [
  'Rebuild the grid: the columns are misaligned',
  'Split columns that were merged together',
  'Merge rows that wrap onto a second line',
  'Check every number against the page',
]

export function TableEditor({
  table,
  index,
  active,
  aiAvailable,
  aiBusy,
  onFocus,
  onChange,
  onAiFix,
}: {
  table: Table
  index: number
  active: boolean
  aiAvailable: boolean
  aiBusy: boolean
  onFocus: () => void
  onChange: (t: Table | null) => void
  onAiFix: (instruction: string) => void
}) {
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null)
  const [fixOpen, setFixOpen] = useState(false)
  const [copied, setCopied] = useState<'done' | 'failed' | null>(null)
  const [instruction, setInstruction] = useState('')
  const gridRef = useRef<HTMLTableElement>(null)

  const { issues, ticks } = useMemo(() => review(table), [table])
  const types = useMemo(() => columnTypes(table), [table])
  const issueAt = useMemo(() => {
    const m = new Map<string, Issue>()
    for (const i of issues) if (i.row >= 0) m.set(`${i.row}:${i.col}`, i)
    return m
  }, [issues])
  const width = table.rows[0]?.length ?? 0
  const totalRows = useMemo(() => findTotalRows(table), [table])
  // One badge per passed check, e.g. Footed, Balance ties, Cross-footed.
  const passed = useMemo(() => [...new Map(ticks.map(k => [k.label, k])).values()], [ticks])
  const arithmetic = issues.some(i => ARITHMETIC.has(i.kind))

  const focusCell = (r: number, c: number) => {
    const el = gridRef.current?.querySelector<HTMLInputElement>(
      `input[data-r="${r}"][data-c="${c}"]`,
    )
    el?.focus()
    el?.select()
  }
  const nextIssue = () => {
    const cellIssues = issues.filter(i => i.row >= 0)
    if (!cellIssues.length) return
    const cur = sel
      ? cellIssues.findIndex(i => i.row > sel.r || (i.row === sel.r && i.col > sel.c))
      : 0
    const target = cellIssues[cur < 0 ? 0 : cur]
    if (target) focusCell(target.row, target.col)
  }

  // Structural edits are recorded on the table so a batch can replay them (src/lib/recipe.ts).
  const apply = (fn: (t: Table) => Table, edit?: TableEdit) =>
    onChange(recordEdit(table, fn(table), edit))
  const ref = (c: number) => colRef(table, c)

  return (
    <section
      onFocusCapture={onFocus}
      className={cn(
        'rounded-lg border bg-card',
        active ? 'border-accent shadow-[0_0_0_1px_var(--color-accent)]' : 'border-line',
      )}
    >
      <header className='flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5'>
        <div className='flex w-full min-w-0 items-center gap-2'>
          <span className='flex size-5 shrink-0 items-center justify-center rounded bg-accent text-2xs font-semibold text-white dark:text-paper'>
            {index + 1}
          </span>
          <input
            value={table.title}
            onChange={e => apply(t => ({ ...t, title: e.target.value }))}
            placeholder='Table name (used as the sheet name)'
            aria-label='Table name'
            className='min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 font-semibold outline-none placeholder:font-normal placeholder:text-muted hover:bg-paper focus-visible:bg-paper focus-visible:ring-2 focus-visible:ring-accent/30'
          />
          <span className='shrink-0 text-xs text-muted'>
            {table.rows.length} {table.rows.length === 1 ? 'row' : 'rows'}, {width}{' '}
            {width === 1 ? 'column' : 'columns'}
          </span>
        </div>
        <label className='flex items-center gap-1.5 text-xs'>
          Header rows
          <input
            type='number'
            min={0}
            max={table.rows.length}
            value={table.headerRows}
            onChange={e =>
              apply(t => ops.setHeaderRows(t, Number(e.target.value)), {
                op: 'headerRows',
                n: Math.max(0, Math.min(Number(e.target.value), table.rows.length)),
              })
            }
            className={cn(FIELD, 'h-7 w-12 bg-paper px-1.5 text-xs')}
          />
        </label>
        <label
          className='flex items-center gap-1.5 text-xs'
          title='Include this table in the Excel file'
        >
          <input
            type='checkbox'
            checked={table.include}
            onChange={e => apply(t => ({ ...t, include: e.target.checked }))}
          />
          Include
        </label>
        {passed.map(k => (
          <Badge key={k.label} tone='tick' className='gap-1' title={TICK_TITLE[k.kind]}>
            <Tick /> {k.label}
          </Badge>
        ))}
        {issues.length > 0 && (
          <button
            type='button'
            onClick={nextIssue}
            title='Go to the next cell to check'
            className='rounded text-xs'
          >
            <Badge tone={arithmetic ? 'bad' : 'warn'}>
              {issues.length} {issues.length === 1 ? 'cell' : 'cells'} to check
            </Badge>
          </button>
        )}
        <Button
          size='sm'
          variant={fixOpen ? 'primary' : 'outline'}
          disabled={!aiAvailable || aiBusy}
          onClick={() => setFixOpen(o => !o)}
          title={
            aiAvailable
              ? 'Ask AI to correct this table against the page'
              : 'To use AI, sign in or add an API key in Settings.'
          }
        >
          {aiBusy ? <Spinner /> : <Sparkles className='size-3.5' />} Fix with AI
        </Button>
        <Button
          size='icon'
          variant='ghost'
          onClick={() =>
            void copyTable(table).then(
              () => setCopied('done'),
              () => setCopied('failed'),
            )
          }
          onBlur={() => setCopied(null)}
          title={
            copied === 'done'
              ? 'Copied. Paste into any spreadsheet.'
              : copied === 'failed'
                ? 'Copying was blocked by the browser.'
                : 'Copy the table to paste into Excel, Sheets or Numbers'
          }
          aria-label='Copy table'
        >
          {copied === 'done' ? (
            <Check className='size-3.5 text-tick' />
          ) : (
            <Copy className='size-3.5' />
          )}
        </Button>
        <Button
          size='icon'
          variant='danger'
          onClick={() => onChange(null)}
          title='Delete table'
          aria-label='Delete table'
        >
          <Trash2 className='size-3.5' />
        </Button>
      </header>

      {fixOpen && (
        <form
          className='space-y-2 border-b border-line bg-paper px-3 py-2'
          onSubmit={e => {
            e.preventDefault()
            // With no instruction, send the exact failing checks so the AI re-reads those cells.
            onAiFix(instruction.trim() || (issues.length ? fixInstruction(table, issues) : ''))
            setFixOpen(false)
            setInstruction('')
          }}
        >
          <div className='flex flex-wrap gap-1'>
            {FIX_PRESETS.map(p => (
              <button
                key={p}
                type='button'
                onClick={() => setInstruction(p)}
                className='rounded-full border border-line bg-card px-2.5 py-0.5 text-2xs transition-colors hover:border-accent hover:text-accent'
              >
                {p}
              </button>
            ))}
          </div>
          <div className='flex gap-2'>
            <input
              autoFocus
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              placeholder='Describe what’s wrong, or leave blank to check every cell against the page'
              aria-label='What to fix'
              className={cn(FIELD, 'h-8 min-w-0 flex-1 px-2 text-xs')}
            />
            <Button type='submit' size='sm' variant='primary'>
              Fix table
            </Button>
          </div>
          <p className='text-2xs text-muted'>
            AI gets the page image and this page’s tables, and returns corrected tables. Undo with
            ⌘Z.
          </p>
        </form>
      )}

      {sel && (
        <div className='flex flex-wrap items-center gap-1 border-b border-line px-3 py-1 text-xs text-muted'>
          <span className='mr-1 font-semibold text-ink'>
            {COL(sel.c)}
            {sel.r + 1}
          </span>
          <ToolBtn
            icon={<Rows2 />}
            label='Add row above'
            onClick={() => apply(t => ops.insertRow(t, sel.r))}
          />
          <ToolBtn
            icon={<ArrowDownToLine />}
            label='Add row below'
            onClick={() => apply(t => ops.insertRow(t, sel.r + 1))}
          />
          <ToolBtn
            icon={<Trash2 />}
            label='Delete row'
            onClick={() => apply(t => ops.deleteRow(t, sel.r))}
          />
          <span className='mx-1 h-4 w-px bg-line' />
          <ToolBtn
            icon={<Columns2 />}
            label='Add column left'
            onClick={() =>
              apply(t => ops.insertCol(t, sel.c), {
                op: 'insert',
                before: ref(sel.c),
                width,
              })
            }
          />
          <ToolBtn
            icon={<ArrowRightToLine />}
            label='Add column right'
            onClick={() =>
              apply(t => ops.insertCol(t, sel.c + 1), {
                op: 'insert',
                after: ref(sel.c),
                width,
              })
            }
          />
          <ToolBtn
            icon={<Trash2 />}
            label='Delete column'
            onClick={() => apply(t => ops.deleteCol(t, sel.c), { op: 'delete', col: ref(sel.c) })}
          />
          <ToolBtn
            icon={<Combine />}
            label='Merge with right'
            onClick={() =>
              apply(t => ops.mergeRight(t, sel.c), {
                op: 'merge',
                col: ref(sel.c),
                right: ref(sel.c + 1).name,
              })
            }
          />
          <ToolBtn
            icon={<Split />}
            label='Split column'
            onClick={() => apply(t => ops.splitCol(t, sel.c), { op: 'split', col: ref(sel.c) })}
          />
          {issueAt.get(`${sel.r}:${sel.c}`) && (
            <span className='ml-2 text-bad'>{issueAt.get(`${sel.r}:${sel.c}`)?.message}</span>
          )}
        </div>
      )}

      <div className='max-h-[60vh] overflow-auto'>
        <table ref={gridRef} className='w-max min-w-full border-collapse text-cell'>
          <thead className='sticky top-0 z-10 bg-accent-soft'>
            <tr>
              <th className='w-8 border-r border-b border-line' aria-label='Row' />
              {Array.from({ length: width }, (_, c) => (
                <th
                  key={c}
                  className='min-w-20 border-r border-b border-rule px-2 py-1 text-left text-xs font-medium text-muted'
                >
                  <ColHead letter={COL(c)} kind={types[c]?.kind ?? 'text'} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr
                key={r}
                className={cn(
                  r < table.headerRows && 'bg-accent-soft/40 font-semibold',
                  totalRows[r] && 'font-semibold',
                )}
              >
                <td className='border-r border-b border-line bg-accent-soft/40 px-2 text-right text-xs text-muted select-none'>
                  {r + 1}
                </td>
                {row.map((v, c) => (
                  <Cell
                    key={c}
                    r={r}
                    c={c}
                    value={v}
                    issue={issueAt.get(`${r}:${c}`)}
                    numeric={types[c]?.kind === 'number'}
                    total={totalRows[r] === true && types[c]?.kind === 'number' && v.trim() !== ''}
                    onSelect={() => setSel({ r, c })}
                    onCommit={nv =>
                      apply(
                        t => ops.setCell(t, r, c, nv),
                        r < table.headerRows
                          ? { op: 'header', row: r, col: ref(c), text: nv }
                          : undefined,
                      )
                    }
                    onMove={(dr, dc) =>
                      focusCell(
                        Math.max(0, Math.min(table.rows.length - 1, r + dr)),
                        Math.max(0, Math.min(width - 1, c + dc)),
                      )
                    }
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.notes && (
        <p className='border-t border-line px-3 py-1.5 text-xs text-muted'>{table.notes}</p>
      )}
    </section>
  )
}

function ColHead({ letter, kind }: { letter: string; kind: keyof typeof KIND_ICON }) {
  const Icon = KIND_ICON[kind]
  return (
    <span className='flex items-center gap-1.5' title={`Column ${letter}: ${KIND_NAME[kind]}`}>
      {letter}
      <Icon className='size-3 opacity-60' aria-hidden />
      <span className='sr-only'>{KIND_NAME[kind]}</span>
    </span>
  )
}

function ToolBtn({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactElement
  label: string
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      title={label}
      aria-label={label}
      className='flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-line/60 hover:text-ink [&_svg]:size-3.5'
    >
      {icon}
      <span className='hidden xl:inline'>{label}</span>
    </button>
  )
}

function Cell({
  r,
  c,
  value,
  issue,
  numeric,
  total,
  onSelect,
  onCommit,
  onMove,
}: {
  r: number
  c: number
  value: string
  issue: Issue | undefined
  numeric: boolean
  total: boolean
  onSelect: () => void
  onCommit: (v: string) => void
  onMove: (dr: number, dc: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null && draft !== value) onCommit(draft)
    setDraft(null)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
      onMove(e.shiftKey ? -1 : 1, 0)
    } else if (e.key === 'Escape') {
      setDraft(null)
      el.blur()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      commit()
      onMove(e.key === 'ArrowDown' ? 1 : -1, 0)
    } else if (e.key === 'ArrowRight' && el.selectionStart === el.value.length) {
      e.preventDefault()
      commit()
      onMove(0, 1)
    } else if (e.key === 'ArrowLeft' && el.selectionEnd === 0) {
      e.preventDefault()
      commit()
      onMove(0, -1)
    }
  }
  return (
    <td
      aria-label={`${COL(c)}${r + 1}`}
      className={cn(
        'border-r border-b border-line p-0',
        total && 'double-rule',
        issue && ARITHMETIC.has(issue.kind) && 'bg-bad-soft',
        issue && !ARITHMETIC.has(issue.kind) && 'bg-warn-soft',
      )}
      title={issue?.message}
    >
      <input
        data-r={r}
        data-c={c}
        value={draft ?? value}
        onChange={e => setDraft(e.target.value)}
        onFocus={onSelect}
        onBlur={commit}
        onKeyDown={onKey}
        spellCheck={false}
        // Proportional figures run ~0.8ch per character.
        size={Math.max(3, Math.min(36, Math.ceil((draft ?? value).length * 0.85) + 1))}
        className={cn(
          'w-full bg-transparent px-1.5 py-1 outline-none focus:bg-card focus:ring-2 focus:ring-accent focus:ring-inset',
          numeric && 'text-right',
        )}
      />
    </td>
  )
}
