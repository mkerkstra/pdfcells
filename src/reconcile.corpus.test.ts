// Reconciliation end to end: statement.pdf through the real pdf.js → triage
// path, a ledger export built from its transactions with planted
// differences (a date shifted, a deposit split in three, a line missing, an
// outstanding cheque, an entry after the period), read as CSV and as .xlsx,
// matched, and written into the workbook. Set XLSX_OUT=<dir> to keep the
// workbooks for the Open XML validator and a LibreOffice recalculation.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import writeXlsxFile from 'write-excel-file/browser'

import { guessColumns, ledgerSource } from './lib/ledgerColumns'
import { readLedgerFile } from './lib/ledgerFile'
import { pageFacts } from './lib/pagefacts'
import { runReconciliation } from './lib/reconcileRun'
import { readStatement, type Statement } from './lib/statement'
import { triage } from './lib/triage'
import type { Table } from './lib/types'
import { buildWorkbook, type PageTables } from './lib/xlsx'
import { unzip } from './lib/zipTesting'

const IMAGE_OPS = new Set([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
])

async function read(file: string): Promise<PageTables[]> {
  const doc = await getDocument({
    data: new Uint8Array(readFileSync(`fixtures/${file}`)),
    verbosity: 0,
  }).promise
  const out: PageTables[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const tr = triage(await pageFacts(await doc.getPage(n), IMAGE_OPS), true)
    out.push({
      page: n,
      tables: tr.localTables.map((t, i): Table => ({
        id: `p${n}t${i}`,
        title: t.title,
        headerRows: t.headerRows,
        rows: t.rows,
        notes: '',
        include: true,
      })),
    })
  }
  return out
}

const shift = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const dmy = (iso: string) => iso.split('-').toReversed().join('/')
const money = (v: number) => Math.abs(v).toFixed(2)

interface Planted {
  /** Xero account-transactions rows: Date, Source, Description, Reference, Debit, Credit, Running Balance. */
  rows: string[][]
  shifted: number
  split: number
  missing: number
  balance: number
}

/** A Xero-style ledger for the bank account (debit = money in) with planted differences. */
function plantLedger(s: Statement): Planted {
  const txns = s.transactions
  const split = txns.findIndex(t => t.amount > 100)
  const shifted = txns.findIndex((t, i) => i !== split && t.amount < 0)
  const missing = txns.findLastIndex((t, i) => i !== split && i !== shifted && t.amount < 0)
  const entries: { date: string; text: string; ref?: string; amount: number }[] = []
  txns.forEach((t, i) => {
    if (i === missing) return
    if (i === split) {
      const cents = Math.round(t.amount * 100)
      const a = Math.floor(cents / 3)
      const b = Math.floor(cents / 4)
      for (const [k, part] of [a, b, cents - a - b].entries())
        entries.push({ date: shift(t.date, -1), text: `Receipt ${k + 1}`, amount: part / 100 })
      return
    }
    entries.push({
      date: i === shifted ? shift(t.date, -3) : t.date,
      text: t.description,
      amount: t.amount,
    })
  })
  entries.push({
    date: shift(s.period.end, -2),
    text: 'Cheque to Acme Supplies',
    ref: '1002',
    amount: -250,
  })
  entries.push({ date: shift(s.period.end, 5), text: 'Rent next month', amount: -900 })
  let running = s.opening ?? 0
  let balance = running
  const rows = [
    ['Date', 'Source', 'Description', 'Reference', 'Debit', 'Credit', 'Running Balance'],
  ]
  for (const e of entries) {
    running = Math.round((running + e.amount) * 100) / 100
    if (e.date <= s.period.end) balance = running
    rows.push([
      dmy(e.date),
      e.amount >= 0 ? 'Receive Money' : 'Spend Money',
      e.text,
      e.ref ?? '',
      e.amount >= 0 ? money(e.amount) : '',
      e.amount < 0 ? money(e.amount) : '',
      running.toFixed(2),
    ])
  }
  return { rows, shifted, split, missing, balance }
}

const csv = (rows: string[][]) =>
  rows
    .map(r => r.map(c => (/[",\n]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c)).join(','))
    .join('\r\n')

async function xlsxOf(rows: string[][]): Promise<Uint8Array> {
  const blob = await writeXlsxFile(
    rows.map((r, i) =>
      r.map((c, k) => {
        if (i === 0 || c === '') return c ? { value: c } : null
        if (k === 0) {
          const [d, m, y] = c.split('/').map(Number)
          return {
            value: new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)),
            type: Date,
            format: 'd mmm yyyy',
          }
        }
        if (k >= 4) return { value: Number(c), type: Number, format: '#,##0.00' }
        return { value: c }
      }),
    ),
    {},
  ).toBlob()
  return new Uint8Array(await blob.arrayBuffer())
}

const formulas = (xml: string) => [...xml.matchAll(/<f>([^<]*)<\/f>/g)].map(m => m[1] ?? '')

describe('statement.pdf reconciled against a Xero ledger', () => {
  for (const kind of ['csv', 'xlsx'] as const)
    it(`matches the planted differences and writes a Reconciliation sheet (${kind})`, async () => {
      const pages = await read('statement.pdf')
      const s = readStatement(pages)
      expect(s?.gate.ok).toBe(true)
      if (!s) return
      const planted = plantLedger(s)
      const bytes =
        kind === 'csv' ? new TextEncoder().encode(csv(planted.rows)) : await xlsxOf(planted.rows)
      const grid = await readLedgerFile(`ledger.${kind}`, bytes)
      const map = guessColumns(grid.rows)
      expect(map).not.toBeNull()
      if (!map) return
      expect(ledgerSource(grid.rows, map)).toBe('Xero')

      const run = runReconciliation(s, { name: `ledger.${kind}`, rows: grid.rows, map })
      expect(run.flip).toBe(false)
      expect(run.balanceFrom).toBe('ledger')
      expect(run.sheet.ledgerBalance).toBe(planted.balance)
      const { result } = run.sheet
      const sid = (i: number) => `s:${s.transactions[i]?.fitid ?? ''}`
      const byStatement = new Map(result.matches.flatMap(m => m.statement.map(id => [id, m])))
      expect(byStatement.get(sid(planted.shifted))?.kind).toBe('window')
      const split = byStatement.get(sid(planted.split))
      expect(split?.kind).toBe('split')
      expect(split?.ledger).toHaveLength(3)
      expect(result.statementOnly).toEqual([sid(planted.missing)])
      const only = result.ledgerOnly.map(id => run.sheet.ledger.find(e => e.id === id)?.description)
      expect(only).toEqual(['Cheque to Acme Supplies', 'Rent next month'])
      expect(result.matches.filter(m => m.review)).toEqual([])

      // The reconciliation ties: adjusted statement balance = adjusted ledger balance.
      const closing = s.closing ?? 0
      const outstanding = -250
      const notInBooks = s.transactions[planted.missing]?.amount ?? 0
      expect(Math.round((closing + outstanding - (planted.balance + notInBooks)) * 100)).toBe(0)

      const blob = await buildWorkbook(pages, {
        layout: 'per-table',
        typed: true,
        joinPages: true,
        summarySheets: true,
        auditSheet: true,
        reconciliation: { ...run.sheet, statementName: 'statement.pdf' },
      })
      const out = new Uint8Array(await blob.arrayBuffer())
      const dir = process.env.XLSX_OUT
      if (dir) {
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, `statement-reconciled-${kind}.xlsx`), out)
        // The same with no ledger balance: the summary leaves Difference blank.
        const blank = await buildWorkbook(pages, {
          layout: 'per-table',
          typed: true,
          joinPages: true,
          reconciliation: { ...run.sheet, ledgerBalance: undefined },
        })
        writeFileSync(
          join(dir, `statement-reconciled-${kind}-no-balance.xlsx`),
          new Uint8Array(await blank.arrayBuffer()),
        )
      }
      const files = unzip(out)
      const wb = files.get('xl/workbook.xml') ?? ''
      const names = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map(m => m[1])
      expect(names.slice(-2)).toEqual(['Reconciliation', 'Audit'])
      const sheet = files.get(`xl/worksheets/sheet${names.indexOf('Reconciliation') + 1}.xml`) ?? ''
      // Summary (8) + checks (2) + one Match difference per matched row.
      const rows = result.matches.reduce(
        (n, m) => n + Math.max(m.statement.length, m.ledger.length),
        0,
      )
      expect(formulas(sheet)).toHaveLength(9 + rows)
      const types = files.get('[Content_Types].xml') ?? ''
      for (const k of [...files.keys()].filter(x => x.startsWith('xl/tables/')))
        expect(types).toContain(`PartName="/${k}"`)
    })
})
