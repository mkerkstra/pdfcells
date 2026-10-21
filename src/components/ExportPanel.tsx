import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'

import { buildCsvExport } from '@/lib/plaintext'
import { buildWorkbook, download, type SheetLayout, type SourceInfo } from '@/lib/xlsx'
import { engineLabel, originalTables } from '@/lib/xlsxAudit'
import type { DocState } from '@/state/doc'

import { ReconcileExport } from './ReconcileExport'
import { StatementExport } from './StatementExport'
import { useTransactions } from './Transactions'
import { Button, cn, FIELD, Spinner } from './ui'

const LAYOUTS: Record<SheetLayout, string> = {
  'per-table': 'One sheet per table',
  'per-page': 'One sheet per page',
  single: 'Everything on one sheet',
}

export function ExportPanel({ doc }: { doc: DocState }) {
  const [format, setFormat] = useState<'xlsx' | 'csv' | 'statement' | 'reconcile'>('xlsx')
  const [layout, setLayout] = useState<SheetLayout>('per-table')
  const [typed, setTyped] = useState(true)
  const [joinPages, setJoinPages] = useState(true)
  const [summary, setSummary] = useState(false)
  const [audit, setAudit] = useState(true)
  const [payeeColumns, setPayeeColumns] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const count = doc.pages
    .filter(p => p.engine !== 'skip' || p.run)
    .reduce((n, p) => n + p.tables.filter(t => t.include).length, 0)
  const statementPages = useMemo(
    () =>
      doc.pages
        .filter(p => p.engine !== 'skip' || p.run)
        .map(p => ({ page: p.n, tables: p.tables })),
    [doc.pages],
  )
  const transactions = useTransactions(statementPages)

  const run = async () => {
    setBusy(true)
    setError('')
    try {
      const pages = doc.pages
        .filter(p => p.engine !== 'skip' || p.run)
        .map(p => ({ page: p.n, tables: p.tables }))
      const base = doc.fileName || 'tables'
      if (format === 'csv') {
        const { blob, ext } = buildCsvExport(pages, { typed, joinPages })
        download(blob, `${base}.${ext}`)
      } else {
        const source: SourceInfo = {
          fileName: doc.fileName,
          engines: Object.fromEntries(
            doc.pages.map(p => [p.n, engineLabel(p.run?.engine ?? p.engine, p.run)]),
          ),
          // The undo history holds each table as first read.
          originals: originalTables([...doc.past, doc.pages]),
        }
        download(
          await buildWorkbook(pages, {
            layout,
            typed,
            joinPages,
            summarySheets: summary,
            auditSheet: audit,
            source,
            transactions: transactions.workbook(payeeColumns),
          }),
          `${base}.xlsx`,
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The Excel file couldn’t be built. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const fileType = (
    <select
      value={format}
      onChange={e =>
        setFormat(
          e.target.value === 'csv' ||
            e.target.value === 'statement' ||
            e.target.value === 'reconcile'
            ? e.target.value
            : 'xlsx',
        )
      }
      className={cn(FIELD, 'h-9 px-2 text-sm')}
      aria-label='File type'
    >
      <option value='xlsx'>Excel (.xlsx)</option>
      <option value='csv'>CSV (one file per table)</option>
      <option value='statement'>Bank statement (OFX, QBO, Xero CSV)</option>
      <option value='reconcile'>Reconcile with your ledger (.xlsx)</option>
    </select>
  )

  return (
    <div className='sticky bottom-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule bg-paper/95 px-4 py-2.5 text-xs backdrop-blur sm:py-3 sm:text-sm'>
      {format === 'statement' ? (
        <StatementExport transactions={transactions} fileName={doc.fileName} lead={fileType} />
      ) : format === 'reconcile' ? (
        <ReconcileExport doc={doc} lead={fileType} />
      ) : (
        tableExport()
      )}
    </div>
  )

  function tableExport() {
    return (
      <>
        {fileType}
        <select
          hidden={format === 'csv'}
          value={layout}
          onChange={e => setLayout(e.target.value as SheetLayout)}
          className={cn(FIELD, 'h-9 px-2 text-sm')}
          aria-label='Sheet layout'
        >
          {Object.entries(LAYOUTS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <label
          className='flex items-center gap-1.5'
          title='Tables with the same columns on consecutive pages become one table'
        >
          <input
            type='checkbox'
            checked={joinPages}
            onChange={e => setJoinPages(e.target.checked)}
          />
          Join across pages
        </label>
        <label
          className='flex items-center gap-1.5'
          title={
            format === 'csv'
              ? 'Write plain numbers (1234.56, -39.51) and ISO dates. Off keeps the text exactly as printed.'
              : 'Store numbers, percentages and dates as Excel values. Off keeps the text exactly as printed.'
          }
        >
          <input type='checkbox' checked={typed} onChange={e => setTyped(e.target.checked)} />
          Real numbers
        </label>
        <label
          className={cn('items-center gap-1.5', format === 'xlsx' ? 'flex' : 'hidden')}
          title='Statements get By month and By description sheets, invoices a By item sheet. Their totals are formulas over the table, so they update when you edit it. Needs Real numbers.'
        >
          <input
            type='checkbox'
            checked={summary}
            disabled={!typed}
            onChange={e => setSummary(e.target.checked)}
          />
          Add summary sheets
        </label>
        <label
          className={cn('items-center gap-1.5', format === 'xlsx' ? 'flex' : 'hidden')}
          title='A sheet listing each table’s source page, how it was read, the checks it passed, open issues and your edits. Edited cells get a note with the value first read.'
        >
          <input type='checkbox' checked={audit} onChange={e => setAudit(e.target.checked)} />
          Include audit sheet
        </label>
        {format === 'xlsx' && transactions.statement && (
          <>
            {transactions.controls}
            <label
              className='flex items-center gap-1.5'
              title='Adds a cleaned-up Payee and a Category to each transaction, and a By category sheet with the summary sheets'
            >
              <input
                type='checkbox'
                checked={payeeColumns}
                onChange={e => setPayeeColumns(e.target.checked)}
              />
              Payee and category columns
            </label>
          </>
        )}
        <div className='ml-auto flex items-center gap-3'>
          {error ? (
            <span className='text-bad'>{error}</span>
          ) : (
            <span className='hidden text-muted sm:inline'>
              {count === 0
                ? 'No tables included'
                : `${count} ${count === 1 ? 'table' : 'tables'} included`}
            </span>
          )}
          <Button variant='primary' onClick={() => void run()} disabled={busy || count === 0}>
            {busy ? <Spinner /> : <Download className='size-4' />}{' '}
            {format === 'xlsx'
              ? 'Download .xlsx'
              : count > 1
                ? 'Download .zip of CSVs'
                : 'Download .csv'}
          </Button>
        </div>
      </>
    )
  }
}
