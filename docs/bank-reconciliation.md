# Bank reconciliation

Export type "Reconcile with your ledger (.xlsx)" matches a converted statement against the person's ledger export and adds a Reconciliation sheet to the workbook. Everything runs in the browser; the ledger never leaves the device.

## Ledger input

- **CSV** (comma, semicolon or tab; UTF-8 with or without BOM) and **.xlsx** (first sheet, read by `src/lib/ledgerFile.ts` with the browser's own decompression). `.xls` and `.ods` are refused with a message: QuickBooks, Xero and banks all export .xlsx or CSV.
- Resource limits, checked before allocating: 20 MB per file, 64 MB per inflated part, 128 MB inflated in total, 200,000 rows, 256 columns, 2,000,000 cells counted as a dense grid.
- Columns are auto-mapped from header words (`src/lib/ledgerColumns.ts`): QuickBooks register and reports, Xero account transactions and statement lines, and generic Date / Description / Amount, Debit / Credit, Money in / Money out, Deposit / Withdrawal. Title rows above the header are skipped. If nothing reads as a ledger, the Columns panel opens for manual mapping.
- **Signs.** "Debit" means money in on a bookkeeping ledger and money out on a bank export. The mapping guesses from the other columns, then counts same-amount matches against the statement both ways, using only entries inside the statement period, and keeps whichever fits better. "Swap money in and out" overrides it.
- **Order and balance.** File order comes from the running-balance arithmetic. When neither that nor the dates settle it, the app asks for the ledger balance instead of guessing.

## Period

The cutoff and the ledger balance date need a confirmed statement period: the one printed on the statement, or dates the person confirms. The last transaction date is never used as the period end. Editing a transaction so it falls outside the confirmed period asks again.

## Matching (`src/lib/reconcile.ts`)

1. Same amount within the date window (3, 7, 14 or 30 days). Payee similarity (`src/lib/reconcilePayee.ts`, built on `cleanPayee` from `src/lib/payee.ts`) breaks ties, then the nearer date. A pick between different-looking entries that fit equally well is flagged "Check".
2. Splits: one line equal to the sum of 2–4 lines on the other side, same sign, inside the window.
3. Identical entries (same amount, date and payee) are paired in file order. Each statement line keeps at most its 64 best candidates, so matching stays near-linear.

Ledger entries dated after the period end never match. Unmatched entries dated before the period start go in **Before this statement**: left out of the reconciliation by default, each with a "Still outstanding" toggle, and still selectable for a manual match (a cheque written in February that cleared in March).

Manual matches and unmatches are keyed to the statement line's content (date, amount, description, check number, printed balance, page) and the number of identical lines when the match was made. A manual match is dropped, never moved, when any of its lines disappears or changes.

## Reconciliation sheet (`src/lib/xlsxReconcile.ts`)

Excel Tables for matched pairs, statement-only lines, ledger-only entries and Before this statement, with a summary above them. Every summary figure is a formula over those Tables and stays right after sorting:

- statement closing balance ± ledger items not yet on the statement = adjusted statement balance
- ledger balance ± statement lines not in the ledger = adjusted ledger balance
- Difference (blank when no ledger balance is given)
- checks that should read 0: matched amounts net to zero, opening balance plus every statement line equals closing, and the count of matches whose two sides differ (`COUNTIFS` on the match difference)

The app never says "Reconciled" while any match has unequal sides.
