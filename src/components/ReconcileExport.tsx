import { Download, FileUp, ListChecks } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'

import { formatNumber } from '@/lib/checks/grid'
import { guessColumns, ledgerSource, type ColumnMap } from '@/lib/ledgerColumns'
import { LEDGER_ACCEPT, readLedgerFile } from '@/lib/ledgerFile'
import { NO_OVERRIDES, type Overrides } from '@/lib/reconcile'
import { runReconciliation, totals, type Run } from '@/lib/reconcileRun'
import { readStatement } from '@/lib/statement'
import { buildWorkbook, download, type SourceInfo } from '@/lib/xlsx'
import { engineLabel, originalTables } from '@/lib/xlsxAudit'
import { columnLetter } from '@/lib/xlsxParts'
import type { DocState } from '@/state/doc'

import { ReconcileReview } from './ReconcileReview'
import { Button, cn, FIELD, Spinner, Tick } from './ui'

interface Ledger {
  name: string
  rows: string[][]
  map: ColumnMap | null
}

const WINDOWS = [3, 7, 14, 30]

export function ReconcileExport({ doc, lead }: { doc: DocState; lead: ReactNode }) {
  const pages = useMemo(
    () =>
      doc.pages
        .filter(p => p.engine !== 'skip' || p.run)
        .map(p => ({ page: p.n, tables: p.tables })),
    [doc.pages],
  )
  const statement = useMemo(() => readStatement(pages), [pages])
  const [ledger, setLedger] = useState<Ledger | null>(null)
  const [flip, setFlip] = useState<boolean | undefined>(undefined)
  const [balance, setBalance] = useState('')
  const [windowDays, setWindowDays] = useState(7)
  const [overrides, setOverrides] = useState<Overrides>(NO_OVERRIDES)
  const [mapping, setMapping] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const typed = balance.trim() === '' ? undefined : Number(balance.replace(/[,\s]/g, ''))
  const run: Run | null = useMemo(() => {
    if (!statement || !ledger?.map) return null
    return runReconciliation(
      statement,
      {
        name: ledger.name,
        rows: ledger.rows,
        map: ledger.map,
        flip,
        balance: typed !== undefined && Number.isFinite(typed) ? typed : undefined,
      },
      { windowDays, splitWindowDays: windowDays },
      overrides,
    )
  }, [statement, ledger, flip, typed, windowDays, overrides])

  const open = async (file: File) => {
    setError('')
    try {
      const grid = await readLedgerFile(file.name, new Uint8Array(await file.arrayBuffer()))
      const map = guessColumns(grid.rows)
      setLedger({ name: file.name, rows: grid.rows, map })
      setFlip(undefined)
      setOverrides(NO_OVERRIDES)
      setMapping(map === null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file couldn’t be read.')
    }
  }

  const save = async () => {
    if (!run) return
    setBusy(true)
    setError('')
    try {
      const source: SourceInfo = {
        fileName: doc.fileName,
        engines: Object.fromEntries(
          doc.pages.map(p => [p.n, engineLabel(p.run?.engine ?? p.engine, p.run)]),
        ),
        originals: originalTables([...doc.past, doc.pages]),
      }
      const blob = await buildWorkbook(pages, {
        layout: 'per-table',
        typed: true,
        joinPages: true,
        auditSheet: true,
        source,
        reconciliation: { ...run.sheet, statementName: doc.fileName || undefined },
      })
      download(blob, `${doc.fileName || 'statement'} reconciled.xlsx`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The Excel file couldn’t be built. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='flex w-full flex-col gap-2'>
      <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
        {lead}
        <input
          ref={input}
          type='file'
          accept={LEDGER_ACCEPT}
          className='hidden'
          aria-label='Ledger file'
          onChange={e => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void open(f)
          }}
        />
        <Button
          onClick={() => input.current?.click()}
          disabled={!statement}
          title='A CSV or .xlsx export of the bank account from your books (QuickBooks, Xero or any Date and Amount columns). It stays on this device.'
        >
          <FileUp className='size-4' /> {ledger ? 'Change ledger' : 'Add your ledger'}
        </Button>
        {ledger && (
          <button
            type='button'
            className='text-accent underline-offset-2 hover:underline'
            onClick={() => setMapping(m => !m)}
          >
            {mapping ? 'Hide columns' : 'Columns'}
          </button>
        )}
        {ledger?.map && (
          <>
            <select
              value={windowDays}
              onChange={e => setWindowDays(Number(e.target.value))}
              className={cn(FIELD, 'h-9 px-2 text-sm')}
              aria-label='Date window'
              title='How far apart the statement and ledger dates may be. Cheques can take a while to clear.'
            >
              {WINDOWS.map(d => (
                <option key={d} value={d}>
                  Dates within {d} days
                </option>
              ))}
            </select>
            <label
              className='flex items-center gap-1.5'
              title='Tick when money in shows as negative in your ledger, for example when debit and credit are the other way round'
            >
              <input
                type='checkbox'
                checked={run?.flip ?? false}
                onChange={e => setFlip(e.target.checked)}
              />
              Swap money in and out
            </label>
            <Button onClick={() => setReviewing(true)} disabled={!run}>
              <ListChecks className='size-4' /> Review matches
            </Button>
          </>
        )}
        <div className='ml-auto flex items-center gap-3'>
          <Button variant='primary' onClick={() => void save()} disabled={!run || busy}>
            {busy ? <Spinner /> : <Download className='size-4' />} Download .xlsx
          </Button>
        </div>
      </div>
      {mapping && ledger && (
        <ColumnPicker
          rows={ledger.rows}
          map={ledger.map}
          onChange={map => {
            setLedger({ ...ledger, map })
            setOverrides(NO_OVERRIDES)
          }}
        />
      )}
      <Status
        error={error}
        hasStatement={statement !== null}
        ledger={ledger}
        run={run}
        decimals={statement?.decimals ?? 2}
      />
      {reviewing && run && (
        <ReconcileReview
          run={run}
          dateOrder={statement?.dateOrder ?? 'mdy'}
          balance={balance}
          onBalance={setBalance}
          overrides={overrides}
          onOverrides={setOverrides}
          onClose={() => setReviewing(false)}
        />
      )}
    </div>
  )
}

function Status({
  error,
  hasStatement,
  ledger,
  run,
  decimals,
}: {
  error: string
  hasStatement: boolean
  ledger: Ledger | null
  run: Run | null
  decimals: number
}) {
  if (error) return <p className='text-bad'>{error}</p>
  if (!hasStatement)
    return (
      <p className='text-muted'>
        No transaction table found. Bank statements need a date, a description and an amount (or
        debit and credit) column.
      </p>
    )
  if (!ledger)
    return (
      <p className='text-muted'>
        Add a CSV or .xlsx export of this account from your books. Matching runs on this device;
        nothing is uploaded.
      </p>
    )
  if (!run)
    return (
      <p className='text-warn'>
        PDFCells couldn’t tell which columns hold the date and amount. Pick them under Columns.
      </p>
    )
  const { result } = run.sheet
  const n = run.sheet.statement.length
  const matched = n - result.statementOnly.length
  const check = result.matches.filter(m => m.review).length
  const t = totals(run.sheet)
  const source = ledger.map ? ledgerSource(ledger.rows, ledger.map) : null
  const parts = [
    `${matched} of ${n} statement ${n === 1 ? 'line' : 'lines'} matched`,
    `${result.statementOnly.length} only on the statement`,
    `${result.ledgerOnly.length} only in the ledger`,
  ]
  return (
    <p className='flex flex-wrap items-center gap-x-1 text-muted'>
      <span>
        {ledger.name}
        {source ? ` (${source})` : ''}: {run.ledger.entries.length} entries. {parts.join(', ')}.
      </span>
      {check > 0 && (
        <span className='text-warn'>
          {check} {check === 1 ? 'match' : 'matches'} to check.
        </span>
      )}
      {t.difference === undefined ? (
        <span>Add your ledger balance in Review matches to finish the reconciliation.</span>
      ) : t.difference === 0 ? (
        <span className='inline-flex items-center gap-1 font-semibold text-tick'>
          Reconciled <Tick />
        </span>
      ) : (
        <span className='text-bad'>Difference {formatNumber(t.difference, decimals)}.</span>
      )}
    </p>
  )
}

type Field =
  | 'date'
  | 'description'
  | 'payee'
  | 'amount'
  | 'moneyIn'
  | 'moneyOut'
  | 'balance'
  | 'reference'

const FIELDS: { key: Field; label: string; optional: boolean }[] = [
  { key: 'date', label: 'Date', optional: false },
  { key: 'description', label: 'Description', optional: true },
  { key: 'payee', label: 'Payee', optional: true },
  { key: 'amount', label: 'Amount', optional: false },
  { key: 'moneyIn', label: 'Money in', optional: false },
  { key: 'moneyOut', label: 'Money out', optional: false },
  { key: 'balance', label: 'Balance', optional: true },
  { key: 'reference', label: 'Reference', optional: true },
]

/** Manual column mapping: header row, then one column per field. */
function ColumnPicker({
  rows,
  map,
  onChange,
}: {
  rows: string[][]
  map: ColumnMap | null
  onChange: (m: ColumnMap) => void
}) {
  const base: ColumnMap = map ?? { headerRow: 0, date: 0, description: 1, amount: 2 }
  const header = rows[base.headerRow] ?? []
  const width = Math.max(0, ...rows.slice(0, 50).map(r => r.length))
  const name = (c: number) =>
    base.headerRow >= 0 && header[c]
      ? `${columnLetter(c)}: ${header[c]}`
      : `Column ${columnLetter(c)}`
  const pair = base.amount === undefined
  const set = (key: Field, v: number | undefined) => {
    const next: ColumnMap = { ...base }
    if (key === 'date') next.date = v ?? 0
    else if (key === 'description') next.description = v ?? -1
    else if (v === undefined) delete next[key]
    else next[key] = v
    onChange(next)
  }
  const shown = FIELDS.filter(f =>
    pair ? f.key !== 'amount' : f.key !== 'moneyIn' && f.key !== 'moneyOut',
  )
  const value = (key: Field) => {
    const v = base[key]
    return v === undefined || v < 0 ? '' : String(v)
  }
  return (
    <div className='flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line bg-card px-3 py-2'>
      <label className='flex items-center gap-1.5'>
        Header row
        <input
          type='number'
          min={0}
          max={Math.max(0, rows.length)}
          value={base.headerRow + 1}
          onChange={e => onChange({ ...base, headerRow: Math.max(-1, Number(e.target.value) - 1) })}
          className={cn(FIELD, 'h-8 w-16 px-2 text-sm')}
          title='The row with the column names. 0 when the file has none.'
        />
      </label>
      <select
        value={pair ? 'pair' : 'one'}
        onChange={e =>
          onChange(
            e.target.value === 'pair'
              ? {
                  ...base,
                  amount: undefined,
                  moneyIn: base.amount ?? 0,
                  moneyOut: (base.amount ?? 0) + 1,
                }
              : { ...base, amount: base.moneyIn ?? 0, moneyIn: undefined, moneyOut: undefined },
          )
        }
        className={cn(FIELD, 'h-8 px-2 text-sm')}
        aria-label='Amount columns'
      >
        <option value='one'>One amount column</option>
        <option value='pair'>Money in and money out columns</option>
      </select>
      {shown.map(f => (
        <label key={f.key} className='flex items-center gap-1.5'>
          {f.label}
          <select
            value={value(f.key)}
            onChange={e => set(f.key, e.target.value === '' ? undefined : Number(e.target.value))}
            className={cn(FIELD, 'h-8 max-w-44 px-2 text-sm')}
          >
            {f.optional && <option value=''>None</option>}
            {Array.from({ length: width }, (_, c) => (
              <option key={c} value={c}>
                {name(c)}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  )
}
