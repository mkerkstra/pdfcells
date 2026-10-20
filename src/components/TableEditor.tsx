import {
  ArrowDownToLine,
  ArrowRightToLine,
  Columns2,
  Combine,
  Copy,
  Rows2,
  Sparkles,
  Split,
  Trash2,
} from 'lucide-react'
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'

import * as ops from '@/lib/tableOps'
import type { Table } from '@/lib/types'
import { columnTypes, validate, type Issue } from '@/lib/validate'
import { toCsv } from '@/lib/xlsx'

import { Badge, Button, cn, Spinner } from './ui'

const COL = (i: number): string =>
  i < 26
    ? String.fromCharCode(65 + i)
    : COL(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26))
const KIND_ICON = { number: '#', date: '📅', text: 'Aa' } as const
const FIX_PRESETS = [
  'Columns are misaligned: rebuild the grid',
  'Split merged columns',
  'This continues on the next line: merge wrapped rows',
  'Re-check every number against the page',
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
  const [instruction, setInstruction] = useState('')
  const gridRef = useRef<HTMLTableElement>(null)

  const issues = useMemo(() => validate(table), [table])
  const types = useMemo(() => columnTypes(table), [table])
  const issueAt = useMemo(() => {
    const m = new Map<string, Issue>()
    for (const i of issues) if (i.row >= 0) m.set(`${i.row}:${i.col}`, i)
    return m
  }, [issues])
  const width = table.rows[0]?.length ?? 0

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

  const apply = (fn: (t: Table) => Table) => onChange(fn(table))

  return (
    <section
      onFocusCapture={onFocus}
      className={cn(
        'rounded-lg border bg-card',
        active ? 'border-accent shadow-[0_0_0_1px_var(--color-accent)]' : 'border-line',
      )}
    >
      <header className='flex flex-wrap items-center gap-2 border-b border-line px-3 py-2'>
        <span className='flex size-5 items-center justify-center rounded bg-accent text-[11px] font-semibold text-white'>
          {index + 1}
        </span>
        <input
          value={table.title}
          onChange={e => onChange({ ...table, title: e.target.value })}
          placeholder='Untitled table (sheet name)'
          className='min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted'
        />
        <span className='text-xs text-muted'>
          {table.rows.length}×{width}
        </span>
        <label className='flex items-center gap-1 text-xs'>
          Header rows
          <input
            type='number'
            min={0}
            max={table.rows.length}
            value={table.headerRows}
            onChange={e => apply(t => ops.setHeaderRows(t, Number(e.target.value)))}
            className='h-6 w-11 rounded border border-line bg-paper px-1 text-xs'
          />
        </label>
        <label className='flex items-center gap-1 text-xs'>
          <input
            type='checkbox'
            checked={table.include}
            onChange={e => onChange({ ...table, include: e.target.checked })}
          />
          Export
        </label>
        {issues.length > 0 && (
          <button type='button' onClick={nextIssue} className='text-xs'>
            <Badge tone={issues.some(i => i.kind === 'total') ? 'bad' : 'warn'}>
              {issues.length} to check →
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
              : 'Sign in or add an API key to use AI'
          }
        >
          {aiBusy ? <Spinner /> : <Sparkles className='size-3.5' />} Fix with AI
        </Button>
        <Button
          size='icon'
          variant='ghost'
          onClick={() => void navigator.clipboard.writeText(toCsv(table))}
          title='Copy as CSV'
          aria-label='Copy as CSV'
        >
          <Copy className='size-3.5' />
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
            onAiFix(instruction)
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
                className='rounded-full border border-line bg-card px-2 py-0.5 text-[11px] hover:border-accent'
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
              placeholder='Describe what’s wrong, or leave empty to re-verify every cell against the page'
              className='h-8 min-w-0 flex-1 rounded-md border border-line bg-card px-2 text-xs'
            />
            <Button type='submit' size='sm' variant='primary'>
              Run
            </Button>
          </div>
          <p className='text-[11px] text-muted'>
            AI sees the page image plus these tables and returns a corrected version. Undo with ⌘Z.
          </p>
        </form>
      )}

      {sel && (
        <div className='flex flex-wrap items-center gap-1 border-b border-line px-3 py-1 text-xs text-muted'>
          <span className='mr-1 font-mono text-ink'>
            {COL(sel.c)}
            {sel.r + 1}
          </span>
          <ToolBtn
            icon={<Rows2 />}
            label='Row above'
            onClick={() => apply(t => ops.insertRow(t, sel.r))}
          />
          <ToolBtn
            icon={<ArrowDownToLine />}
            label='Row below'
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
            label='Column left'
            onClick={() => apply(t => ops.insertCol(t, sel.c))}
          />
          <ToolBtn
            icon={<ArrowRightToLine />}
            label='Column right'
            onClick={() => apply(t => ops.insertCol(t, sel.c + 1))}
          />
          <ToolBtn
            icon={<Trash2 />}
            label='Delete column'
            onClick={() => apply(t => ops.deleteCol(t, sel.c))}
          />
          <ToolBtn
            icon={<Combine />}
            label='Merge with right'
            onClick={() => apply(t => ops.mergeRight(t, sel.c))}
          />
          <ToolBtn
            icon={<Split />}
            label='Split column'
            onClick={() => apply(t => ops.splitCol(t, sel.c))}
          />
          {issueAt.get(`${sel.r}:${sel.c}`) && (
            <span className='ml-2 text-bad'>{issueAt.get(`${sel.r}:${sel.c}`)?.message}</span>
          )}
        </div>
      )}

      <div className='max-h-[60vh] overflow-auto'>
        <table ref={gridRef} className='border-collapse font-mono text-xs'>
          <thead className='sticky top-0 z-10 bg-paper'>
            <tr>
              <th className='w-8 border-r border-b border-line' aria-label='Row' />
              {Array.from({ length: width }, (_, c) => (
                <th
                  key={c}
                  className='min-w-20 border-r border-b border-line px-1 py-0.5 text-left font-normal text-muted'
                >
                  {COL(c)} <span className='opacity-60'>{KIND_ICON[types[c]?.kind ?? 'text']}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr
                key={r}
                className={r < table.headerRows ? 'bg-accent-soft/50 font-semibold' : undefined}
              >
                <td className='border-r border-b border-line px-1 text-right text-muted select-none'>
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
                    onSelect={() => setSel({ r, c })}
                    onCommit={nv => apply(t => ops.setCell(t, r, c, nv))}
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
      className='flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-line/60 hover:text-ink [&_svg]:size-3.5'
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
  onSelect,
  onCommit,
  onMove,
}: {
  r: number
  c: number
  value: string
  issue: Issue | undefined
  numeric: boolean
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
        issue?.kind === 'total' && 'bg-bad-soft',
        (issue?.kind === 'type' || issue?.kind === 'low-confidence') && 'bg-warn-soft',
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
        size={Math.max(4, Math.min(40, (draft ?? value).length + 1))}
        className={cn(
          'w-full bg-transparent px-1.5 py-1 outline-none focus:bg-card focus:ring-2 focus:ring-accent focus:ring-inset',
          numeric && 'text-right',
        )}
      />
    </td>
  )
}
