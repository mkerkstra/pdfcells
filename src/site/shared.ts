// Sentences several pages share, so a product change is one edit.

import { FACTS } from './facts.ts'
import { a } from './html.ts'

const n = (v: number) => v.toLocaleString('en-US')

export const LIMITS = `One file can have up to ${n(FACTS.maxFilePages)} pages. A batch holds up to ${n(FACTS.maxFiles)} files and ${n(FACTS.maxBatchPages)} pages in all.`

export const PRICE = `Reading the PDF text and OCR are free, need no account and run in your browser. AI reading is optional: signed-in users get ${FACTS.freeAiPages} free AI pages a day on the Fast model, then prepaid credits at Anthropic's token cost plus ${FACTS.markupPercent}% (packs of $${FACTS.topups.join(', $')}), or no markup with your own Anthropic API key.`

export const PRIVACY = `The PDF is opened and converted on your device. Nothing leaves the browser unless you choose an AI feature, and then only what that feature needs (${a('private-pdf-to-excel', 'exactly what is sent')}).`

/**
 * Statement formats need a full date on every row (src/lib/statement.ts
 * layout() requires a date column; src/lib/cells.ts parseDate needs a year).
 * Update this, and the bank pages that quote it, when year inference lands.
 */
export const YEARLESS = `Many statements print dates as month and day only (01/15), with the year only in the statement period. For the statement formats (OFX, QBO, Xero CSV and the bank CSV), PDFCells takes each date's year from the printed period, so December dates on a January statement get the earlier year. When the page prints no period, the export panel's Statement year picker asks for the year, and those formats stay off until you pick one rather than guess. In the Excel export these dates stay as printed text.`

/** Where the printed period can't be found, from docs/bank-statements.md "Dates without a year". */
export const YEARLESS_LIMITS = `The period is read from the page's text, table titles and rows. A scanned page read with AI has no page text, so a statement whose period sits outside its tables needs the picked year there; a batch can't ask, so a batch statement whose period isn't found stays blocked, and a saved batch reopened later keeps only its tables' titles and rows to find it in.`

export const GATE = `OFX, QBO and Xero files are only offered when PDFCells' own checks say the numbers are consistent: with a balance column, every row's balance must equal the previous balance plus that row's amount; without one, the statement's summary must tie (opening + credits − debits = closing) and the transactions must add up to it. When a check fails, the export panel says why, with the page and row where it can.`

export const STEPS_OPEN = `Go to ${a('', 'pdfcells.com')} and choose the PDF, or drop it on the page. Drop several files to open them as a batch. A password-protected PDF asks for its password.`
export const STEPS_CHECK = `Every page is pre-checked and gets a read method: PDF text for pages with a text layer, OCR for scans, or AI for pages you choose.`
export const STEPS_REVIEW = `Each table opens in an editable grid next to the page. Totals that don't add up, balances that don't tie, text in a number column and cells OCR was unsure of are flagged. Fix any cell, merge or split columns, or undo.`
