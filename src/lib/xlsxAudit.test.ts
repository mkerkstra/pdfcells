import { describe, expect, it } from 'vitest'

import { table } from './checks/testing'
import { auditRow, editsOf, engineLabel, originalTables, pageList } from './xlsxAudit'

const statement = table([
  ['Date', 'Description', 'Amount', 'Balance'],
  ['03/01', 'Opening', '', '1,000.00'],
  ['03/02', 'Card', '(39.51)', '960.49'],
  ['03/03', 'Payroll', '82.51', '1,043.00'],
  ['03/04', 'Card', '12.30-', '1,030.70'],
  ['03/05', 'Refund', '7.84', '1,038.54'],
])

describe('engineLabel', () => {
  it('names each engine plainly, with the AI model', () => {
    expect(engineLabel('text')).toBe('PDF text')
    expect(engineLabel('ocr')).toBe('OCR')
    expect(engineLabel('ai', { tier: 'accurate', model: 'claude-sonnet-5-5' })).toBe(
      'AI (claude-sonnet-5-5)',
    )
    expect(engineLabel('ai', { tier: 'fast' })).toBe('AI (fast)')
  })
})

describe('originalTables', () => {
  it('keeps the oldest copy of each table id', () => {
    const first = { ...statement, id: 'a' }
    const edited = {
      ...first,
      rows: [...first.rows.slice(0, 2), ['03/02', 'Card', '(39.15)', '960.49']],
    }
    const m = originalTables([
      [{ tables: [first] }],
      [{ tables: [edited, { ...statement, id: 'b' }] }],
    ])
    expect(m.get('a')).toBe(first)
    expect(m.get('b')?.id).toBe('b')
  })
})

describe('editsOf', () => {
  it('lists cells whose text changed since the first read', () => {
    const now = table(
      statement.rows.map((r, i) => (i === 2 ? [r[0] ?? '', r[1] ?? '', '(39.51)', '960.49'] : r)),
    )
    const was = table(
      statement.rows.map((r, i) => (i === 2 ? [r[0] ?? '', r[1] ?? '', '(39.15)', '960.49'] : r)),
    )
    expect(editsOf(now, was)).toEqual({
      cells: [{ row: 2, col: 2, original: '(39.15)' }],
      structural: 0,
      compared: 'yes',
    })
  })

  it('says why cells could not be compared', () => {
    expect(editsOf(statement, undefined).compared).toBe('no-original')
    const narrower = table(statement.rows.map(r => r.slice(0, 3)))
    expect(editsOf(statement, narrower).compared).toBe('reshaped')
  })
})

describe('auditRow', () => {
  it('records source, engines, ticks, issues and edits', () => {
    const row = auditRow({
      sheet: 'Statement',
      table: 'Statement',
      exported: statement,
      pages: [2, 1, 3],
      source: { fileName: 'march.pdf', engines: { 1: 'PDF text', 2: 'PDF text', 3: 'OCR' } },
      edits: [
        { cells: [{ row: 2, col: 2, original: 'x' }], structural: 1, compared: 'yes' },
        { cells: [], structural: 0, compared: 'no-original' },
      ],
    })
    expect(row).toEqual({
      sheet: 'Statement',
      table: 'Statement',
      source: 'march.pdf',
      pages: '1–3',
      engine: 'PDF text, OCR',
      checks: 'Balance ties',
      issues: 0,
      editedCells: 1,
      structuralEdits: 1,
      notes: 'First read not available (undo history), so edited cells can’t be counted.',
    })
  })

  it('lists pages as ranges', () => {
    expect(pageList([1, 2, 3, 5, 7, 8])).toBe('1–3, 5, 7–8')
  })
})
