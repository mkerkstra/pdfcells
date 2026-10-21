import { Download } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { formatNumber } from '@/lib/checks/grid'
import type { Statement } from '@/lib/statement'
import {
  CURRENCIES,
  toBankCsv,
  toOfx,
  toQbo,
  toXeroCsv,
  type Currency,
  type XeroDateOrder,
} from '@/lib/statementExport'
import { download } from '@/lib/xlsx'

import type { TransactionsState } from './Transactions'
import { Button, cn, FIELD, Tick } from './ui'

export type StatementFormat = 'ofx' | 'qbo' | 'xero' | 'csv'

const FORMATS: Record<StatementFormat, string> = {
  ofx: 'OFX (.ofx)',
  qbo: 'QuickBooks (.qbo)',
  xero: 'Xero CSV',
  csv: 'Bank CSV',
}

const DOWNLOAD: Record<StatementFormat, string> = {
  ofx: 'Download .ofx',
  qbo: 'Download .qbo',
  xero: 'Download Xero .csv',
  csv: 'Download .csv',
}

function showDate(iso: string, order: Statement['dateOrder']): string {
  const [y, m, d] = iso.split('-')
  return order === 'dmy' ? `${d}/${m}/${y}` : `${m}/${d}/${y}`
}

/** "45 transactions, 03/01/2026–03/31/2026, closing balance 1,547.18" */
export function statementSummaryLine(s: Statement): string {
  const n = s.transactions.length
  const parts = [
    `${n} ${n === 1 ? 'transaction' : 'transactions'}`,
    `${showDate(s.period.start, s.dateOrder)}–${showDate(s.period.end, s.dateOrder)}`,
  ]
  if (s.closing !== undefined)
    parts.push(
      `${s.creditCard ? 'new balance owed' : 'closing balance'} ${formatNumber(s.closing, s.decimals)}`,
    )
  return parts.join(', ')
}

function build(
  s: Statement,
  format: StatementFormat,
  opts: { account: string; currency: Currency; xeroDates: XeroDateOrder },
): { text: string; ext: string; type: string } {
  if (format === 'csv') return { text: toBankCsv(s.transactions), ext: 'csv', type: 'text/csv' }
  if (format === 'xero')
    return { text: toXeroCsv(s.transactions, opts.xeroDates), ext: 'xero.csv', type: 'text/csv' }
  if (s.closing === undefined) throw new Error('No closing balance was found.')
  const input = {
    transactions: s.transactions,
    period: s.period,
    closing: s.closing,
    creditCard: s.creditCard,
    account: opts.account,
    currency: opts.currency,
    now: new Date(),
  }
  return format === 'qbo'
    ? { text: toQbo(input), ext: 'qbo', type: 'application/vnd.intu.qbo' }
    : { text: toOfx(input), ext: 'ofx', type: 'application/x-ofx' }
}

export function StatementExport({
  transactions,
  fileName,
  lead,
}: {
  transactions: TransactionsState
  fileName: string
  lead: ReactNode
}) {
  const { statement } = transactions
  const [format, setFormat] = useState<StatementFormat>('ofx')
  const [account, setAccount] = useState('000000')
  const [currency, setCurrency] = useState<Currency>('USD')
  const [xeroDates, setXeroDates] = useState<XeroDateOrder>('dmy')
  const [anyway, setAnyway] = useState(false)
  const [error, setError] = useState('')

  const gate = statement?.gate
  const blocked = !gate?.ok
  const override = blocked && statement !== null && format === 'csv' && anyway
  const canDownload = statement !== null && (!blocked || override)

  const run = () => {
    if (!statement) return
    setError('')
    try {
      const { text, ext, type } = build(statement, format, { account, currency, xeroDates })
      download(new Blob([text], { type }), `${fileName || 'statement'}.${ext}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file couldn’t be built. Try again.')
    }
  }

  return (
    <div className='flex w-full flex-col gap-2'>
      <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
        {lead}
        {transactions.controls}
        <select
          value={format}
          onChange={e => setFormat(e.target.value as StatementFormat)}
          className={cn(FIELD, 'h-9 px-2 text-sm')}
          aria-label='Statement format'
        >
          {Object.entries(FORMATS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {(format === 'ofx' || format === 'qbo') && (
          <>
            <label className='flex items-center gap-1.5'>
              Account number
              <input
                value={account}
                onChange={e => setAccount(e.target.value.replace(/\D/g, '').slice(0, 22))}
                inputMode='numeric'
                placeholder='000000'
                className={cn(FIELD, 'h-9 w-28 px-2 font-mono text-sm')}
                title='Digits only. Your accounting software asks which account to import into, so the placeholder works.'
              />
            </label>
            <select
              value={currency}
              onChange={e => setCurrency(e.target.value as Currency)}
              className={cn(FIELD, 'h-9 px-2 text-sm')}
              aria-label='Currency'
            >
              {CURRENCIES.map(c => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </>
        )}
        {format === 'xero' && (
          <select
            value={xeroDates}
            onChange={e => setXeroDates(e.target.value === 'mdy' ? 'mdy' : 'dmy')}
            className={cn(FIELD, 'h-9 px-2 text-sm')}
            aria-label='Date format'
            title='Match the date format of your Xero organisation’s region'
          >
            <option value='dmy'>Dates as DD/MM/YYYY</option>
            <option value='mdy'>Dates as MM/DD/YYYY</option>
          </select>
        )}
        {blocked && statement && format === 'csv' && (
          <label className='flex items-center gap-1.5 text-warn'>
            <input type='checkbox' checked={anyway} onChange={e => setAnyway(e.target.checked)} />
            Export anyway, I’ll check the numbers myself
          </label>
        )}
        <div className='ml-auto flex items-center gap-3'>
          <Button variant='primary' onClick={run} disabled={!canDownload}>
            <Download className='size-4' /> {DOWNLOAD[format]}
          </Button>
        </div>
      </div>
      <StatementStatus statement={statement} error={error} />
    </div>
  )
}

function StatementStatus({ statement, error }: { statement: Statement | null; error: string }) {
  if (error) return <p className='text-bad'>{error}</p>
  if (!statement)
    return (
      <p className='text-muted'>
        No transaction table found. Bank statements need a date, a description and an amount (or
        debit and credit) column.
      </p>
    )
  const line = statementSummaryLine(statement)
  if (statement.gate.ok)
    return (
      <p className='flex flex-wrap items-center gap-1 text-muted'>
        <span>{line},</span>
        <span className='inline-flex items-center gap-1 font-semibold text-tick'>
          {statement.gate.label} <Tick />
        </span>
      </p>
    )
  const { reasons } = statement.gate
  return (
    <div className='text-muted'>
      <p>{line}. Export is off until the numbers check out:</p>
      <ul className='mt-1 list-disc pl-5 text-bad'>
        {reasons.slice(0, 3).map(r => (
          <li key={r}>{r}. Fix it first.</li>
        ))}
        {reasons.length > 3 && <li>and {reasons.length - 3} more</li>}
      </ul>
    </div>
  )
}
