import { cards, h2, note, p, table } from '../html.ts'
import { LIMITS, PRICE, PRIVACY, YEARLESS } from '../shared.ts'
import type { Page } from '../types.ts'

import { BANK_DOWNLOADS, BANKS } from './banks.ts'
import { COMPARISONS } from './compare.ts'
import { GUIDES } from './guides.ts'

const UPDATED = '2026-10-21'

const card = (pg: Page) => ({ slug: pg.slug, label: pg.label, text: pg.description })

const convert: Page = {
  slug: 'convert',
  kind: 'hub',
  title: 'PDF to Excel guides: statements, invoices, scans',
  description:
    'Step-by-step guides for converting bank and card statements, invoices, scans and report tables from PDF to Excel, CSV, OFX and QBO with PDFCells.',
  h1: 'PDF to Excel guides',
  label: 'Guides',
  answer:
    'PDFCells converts tables in PDFs to Excel, CSV, OFX, QBO and Xero files, and checks the numbers before you download. Pick the guide for your document.',
  body: [
    h2('Bank and card statements'),
    cards(
      GUIDES.filter(g =>
        [
          'bank-statement-to-excel',
          'bank-statement-to-csv',
          'pdf-to-qbo',
          'pdf-to-ofx',
          'credit-card-statement-to-excel',
          'bank-reconciliation',
        ].includes(g.slug),
      ).map(card),
    ),
    h2('Other documents'),
    cards(
      GUIDES.filter(g =>
        ['invoice-pdf-to-excel', 'scanned-pdf-to-excel', 'pdf-table-to-excel'].includes(g.slug),
      ).map(card),
    ),
    h2('How it works'),
    cards(GUIDES.filter(g => ['accuracy', 'private-pdf-to-excel'].includes(g.slug)).map(card)),
    h2('In short'),
    p(PRIVACY, PRICE, LIMITS),
  ].join(''),
  related: ['banks', 'compare'],
  updated: UPDATED,
}

const banks: Page = {
  slug: 'banks',
  kind: 'hub',
  title: 'Bank statement PDF to Excel, bank by bank',
  description:
    'How Chase, Bank of America, Wells Fargo, Amex, Citi, Capital One and PNC statements are laid out, and when the bank’s own CSV download is the easier route.',
  h1: 'Converting statements from US banks',
  label: 'Banks',
  answer:
    'For recent activity, your bank’s own CSV or QuickBooks download is usually the simplest source. For older statements, closed accounts and scans, convert the PDF: each page below says how that bank lays out its statement and what to check after converting.',
  body: [
    h2('Bank notes'),
    cards(BANKS.map(card)),
    h2('What banks let you download themselves'),
    table(['Bank', 'Formats', 'How far back', 'Source'], BANK_DOWNLOADS),
    p(
      'From each bank’s own help pages, checked October 2026. Outside these windows, the monthly PDF statements are the record.',
    ),
    h2('One thing most US statements share'),
    note(YEARLESS),
    p(
      'PDFCells has no bank-specific templates: every statement is read by the same layout engine and checked the same way. The notes on these pages come from statements the banks have published and from public records, so check your own statement against them.',
    ),
  ].join(''),
  related: ['bank-statement-to-excel', 'credit-card-statement-to-excel', 'convert'],
  updated: UPDATED,
}

const compare: Page = {
  slug: 'compare',
  kind: 'hub',
  title: 'PDFCells compared with other PDF to Excel tools',
  description:
    'How PDFCells compares with Excel Power Query, Adobe Acrobat, Tabula, DocuClipper, ProperConvert and MoneyThumb, including where each of them is the better fit.',
  h1: 'PDFCells compared',
  label: 'Compare',
  answer:
    'Each comparison says plainly where the other tool is the better fit. Competitor details are as of October 2026 and come from their own websites, linked on every page.',
  body: [cards(COMPARISONS.map(card))].join(''),
  related: ['best-pdf-to-excel-converters', 'private-pdf-to-excel', 'accuracy'],
  updated: UPDATED,
}

export const HUBS: Page[] = [convert, banks, compare]
