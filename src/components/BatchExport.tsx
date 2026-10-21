import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'

import { combineStatements, combineTables, readTables, uniqueNames } from '@/lib/batch'
import { categorise } from '@/lib/categories'
import { baseName } from '@/lib/filetype'
import { zip } from '@/lib/plaintext'
import { readStatement, type Statement } from '@/lib/statement'
import {
  CURRENCIES,
  toBankCsv,
  toOfx,
  toQbo,
  toXeroCsv,
  type Currency,
} from '@/lib/statementExport'
import { groupIsCard } from '@/lib/transactions'
import { buildSheetsWorkbook, buildWorkbook, download } from '@/lib/xlsx'
import { engineLabel, originalTables } from '@/lib/xlsxAudit'
import type { BatchGroup, BatchItem } from '@/state/batch'
import { useCategories } from '@/state/categoryStore'

import type { Verdict } from './BatchView'
import type { StatementFormat } from './StatementExport'
import { Button, cn, FIELD, Spinner } from './ui'

type Output = 'workbook' | 'zip' | 'statements'

const OUTPUTS: Record<Output, string> = {
  workbook: 'One workbook (.xlsx)',
  zip: 'One file per document (.zip)',
  statements: 'Bank statements (OFX, QBO, CSV)',
}

const FORMATS: Record<StatementFormat, string> = {
  ofx: 'OFX (.ofx)',
  qbo: 'QuickBooks (.qbo)',
  xero: 'Xero CSV',
  csv: 'Bank CSV',
}

const EXT: Record<StatementFormat, string> = {
  ofx: 'ofx',
  qbo: 'qbo',
  xero: 'xero.csv',
  csv: 'csv',
}

interface StatementSet {
  name: string
  statements: { name: string; statement: Statement }[]
}

export function BatchExport({
  items,
  groups,
  verdicts,
}: {
  items: BatchItem[]
  groups: BatchGroup[]
  verdicts: Map<string, Verdict>
}) {
  const [output, setOutput] = useState<Output>('workbook')
  const [typed, setTyped] = useState(true)
  const [joinPages, setJoinPages] = useState(true)
  const [format, setFormat] = useState<StatementFormat>('ofx')
  const [account, setAccount] = useState('000000')
  const [currency, setCurrency] = useState<Currency>('USD')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const categories = useCategories()

  const ready = useMemo(
    () => items.filter(it => verdicts.get(it.id) === 'ready'),
    [items, verdicts],
  )
  const look = [...verdicts.values()].filter(v => v === 'look').length

  // One statement file per format group (a confirmed group, or a file on its own).
  const sets: StatementSet[] = useMemo(() => {
    const withStatement = new Map(
      ready.flatMap(it => {
        const s = readStatement(readTables(it.doc.pages))
        return s?.gate.ok ? [[it.id, { name: it.fileName, statement: s }] as const] : []
      }),
    )
    const out: StatementSet[] = []
    const used = new Set<string>()
    for (const g of groups) {
      if (g.state !== 'confirmed') continue
      const st = g.members.flatMap(id => withStatement.get(id) ?? [])
      g.members.forEach(id => used.add(id))
      const first = st[0]
      if (first)
        out.push({
          name:
            st.length > 1
              ? `${baseName(first.name)} and ${st.length - 1} more`
              : baseName(first.name),
          statements: st,
        })
    }
    for (const [id, s] of withStatement)
      if (!used.has(id)) out.push({ name: baseName(s.name), statements: [s] })
    return out
  }, [ready, groups])

  const transactions = sets.reduce(
    (n, s) => n + s.statements.reduce((m, x) => m + x.statement.transactions.length, 0),
    0,
  )
  const canDownload =
    output === 'statements'
      ? sets.length > 0 &&
        (format === 'csv' ||
          format === 'xero' ||
          sets.every(s => s.statements.every(x => x.statement.closing !== undefined)))
      : ready.length > 0

  const run = async () => {
    setBusy(true)
    setError('')
    try {
      const docs = ready.map(it => ({
        name: it.fileName,
        pages: readTables(it.doc.pages),
        source: {
          fileName: it.fileName,
          engines: Object.fromEntries(
            it.doc.pages.map(p => [p.n, engineLabel(p.run?.engine ?? p.engine, p.run)]),
          ),
          originals: originalTables([...it.doc.past, it.doc.pages]),
        },
      }))
      if (output === 'workbook') {
        const blob = await buildSheetsWorkbook(combineTables(docs, joinPages), typed)
        download(blob, `batch of ${ready.length} ${ready.length === 1 ? 'file' : 'files'}.xlsx`)
      } else if (output === 'zip') {
        const enc = await Promise.all(
          docs.map(async d => {
            const blob = await buildWorkbook(d.pages, {
              layout: 'per-table',
              typed,
              joinPages,
              auditSheet: true,
              source: d.source,
              transactions: { columns: true, ...categories },
            })
            return new Uint8Array(await blob.arrayBuffer())
          }),
        )
        const names = uniqueNames(docs.map(d => baseName(d.name)))
        const files = enc.map((data, i) => ({ name: `${names[i] ?? `file ${i + 1}`}.xlsx`, data }))
        download(
          new Blob([zip(files)], { type: 'application/zip' }),
          `batch of ${ready.length} files.zip`,
        )
      } else {
        const built = sets.map(set => {
          const combined = combineStatements(set.statements)
          const creditCard = groupIsCard(set.statements.map(x => x.statement))
          const c = { ...combined, transactions: categorise(combined.transactions, categories) }
          const text =
            format === 'csv'
              ? toBankCsv(c.transactions)
              : format === 'xero'
                ? toXeroCsv(
                    c.transactions,
                    set.statements[0]?.statement.dateOrder === 'mdy' ? 'mdy' : 'dmy',
                  )
                : (format === 'qbo' ? toQbo : toOfx)({
                    transactions: c.transactions,
                    period: c.period,
                    closing: c.closing ?? 0,
                    creditCard,
                    account,
                    currency,
                    now: new Date(),
                  })
          return { base: set.name, text }
        })
        const names = uniqueNames(built.map(b => b.base)).map(n => `${n}.${EXT[format]}`)
        const only = built[0]
        if (built.length === 1 && only)
          download(new Blob([only.text]), names[0] ?? `statement.${EXT[format]}`)
        else {
          const enc = new TextEncoder()
          download(
            new Blob(
              [
                zip(
                  built.map((b, i) => ({
                    name: names[i] ?? `statement ${i + 1}.${EXT[format]}`,
                    data: enc.encode(b.text),
                  })),
                ),
              ],
              {
                type: 'application/zip',
              },
            ),
            'bank statements.zip',
          )
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The file couldn’t be built. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='sticky bottom-0 z-10 mt-4 flex flex-col gap-2 border-t border-rule bg-paper/95 py-3 text-sm backdrop-blur'>
      <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
        <select
          value={output}
          onChange={e => setOutput(e.target.value as Output)}
          className={cn(FIELD, 'h-9 px-2 text-sm')}
          aria-label='What to download'
        >
          {Object.entries(OUTPUTS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {output === 'statements' ? (
          <>
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
                    className={cn(FIELD, 'h-9 w-28 px-2 font-mono text-sm')}
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
          </>
        ) : (
          <>
            <label
              className='flex items-center gap-1.5'
              title='Tables with the same columns on consecutive pages of a file become one table'
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
              title='Store numbers, percentages and dates as Excel values. Off keeps the text exactly as printed.'
            >
              <input type='checkbox' checked={typed} onChange={e => setTyped(e.target.checked)} />
              Real numbers
            </label>
          </>
        )}
        <div className='ml-auto flex items-center gap-3'>
          <Button variant='primary' onClick={() => void run()} disabled={busy || !canDownload}>
            {busy ? <Spinner /> : <Download className='size-4' />} Download
          </Button>
        </div>
      </div>
      <p className={error ? 'text-bad' : 'text-muted'}>
        {error ||
          (output === 'statements'
            ? sets.length === 0
              ? 'No ready file reads as a bank statement whose balance ties.'
              : `${transactions} transactions from ${ready.filter(it => sets.some(s => s.statements.some(x => x.name === it.fileName))).length} statements, in ${sets.length === 1 ? 'one file' : `${sets.length} files, one per format`}, sorted by date.`
            : ready.length === 0
              ? 'No file is ready yet.'
              : output === 'workbook'
                ? `${ready.length} ready ${ready.length === 1 ? 'file' : 'files'}, with a Source file and Page column on every sheet.`
                : `${ready.length} ready ${ready.length === 1 ? 'file' : 'files'}, one .xlsx each.`)}
        {!error &&
          look > 0 &&
          ` Files that need a look are left out until you mark them as reviewed.`}
      </p>
    </div>
  )
}
