# Bank statements

PDFCells can turn a PDF bank statement into a file your accounting software imports: OFX, QuickBooks Web Connect (.qbo), a Xero statement CSV, or a plain bank CSV. In the export bar, pick **Bank statement (OFX, QBO, Xero CSV)** as the file type.

The code is in `src/lib/statement.ts` (detection and the accuracy gate) and `src/lib/statementExport.ts` (the writers).

## What gets exported

PDFCells looks at every included table, joins tables that continue onto the next page, and takes the one that reads as a transaction table: a date column, a description column, and either one amount column or a debit and credit pair, usually with a running balance.

Each row becomes one transaction:

- **Date** as printed, read M/D or D/M the same way the rest of the app reads it (a day above 12 anywhere in the column decides).
- **Amount**, signed so money in is positive and money out is negative. When there is a balance column, the sign comes from the running-balance check: an amount that raises the balance is money in. So `(39.51)`, `39.51-`, a value in a Debit or Withdrawals column, and `-39.51` all export as `-39.51`.
- **Description**. Wrapped description lines are joined onto their transaction. A row with an amount but no date takes the date above it.
- **Check number**, when the table has a Check or Cheque column.
- **FITID**, an id importers use to skip transactions they already have. It is built from the date, the amount, the description and the transaction's place among identical transactions, so exporting the same statement twice gives the same ids, and two identical coffees on one day still get two.

The statement period is the one printed in a table title ("statement period 03/01/2026 to 03/31/2026") when there is one, otherwise the first and last transaction dates. The closing balance is the last printed balance, or the summary's closing balance.

## The accuracy gate

OFX, QBO and Xero exports are only offered when PDFCells' own checks say the numbers are consistent:

- **With a balance column**, the running-balance check has to pass on the joined table, so the balance on every row equals the previous balance plus that row's amount, including across page breaks. Every transaction has to sit inside the checked run (an amount the check couldn't use, for example next to an unreadable balance, blocks the export). If the statement prints an opening or closing balance in a summary, those have to match too.
- **Without a balance column**, the account summary has to tie (opening + credits − debits = closing), and the transactions have to add up to it: money in to the summary's credits, money out to its debits.

When the gate fails, the panel says why, using the same messages as the review screen, with the page and row: "Balance doesn't tie on page 1, row 11: Credit should be 397.86 (balance goes from 2,948.91 to 3,346.77). Fix it first." Correct the cell in the grid and the export switches on.

The plain bank CSV can be downloaded anyway after ticking "Export anyway, I'll check the numbers myself". OFX, QBO and Xero files can't: importers post those straight into your books, and some can't be undone in bulk.

The first transaction's amount is only checked when the statement prints an opening balance (a balance-forward row or a summary), since there is no earlier balance to check it against.

## Formats

### OFX (.ofx)

OFX 1.02 SGML bank statement: `BANKMSGSRSV1` / `STMTTRNRS` / `STMTRS`, one `STMTTRN` per transaction (`TRNTYPE` CREDIT, DEBIT or CHECK, `DTPOSTED`, `TRNAMT`, `FITID`, `CHECKNUM`, `NAME`, `MEMO`), and `LEDGERBAL` with the closing balance as of the period end.

```
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260302
<TRNAMT>-39.51
<FITID>20260302-c99b5ab85b647802
<NAME>Payment ref 1001
<MEMO>Payment ref 1001
</STMTTRN>
```

- `NAME` is the first 32 characters of the description; `MEMO` has all of it. `&`, `<` and `>` are escaped.
- The file is declared US-ASCII. Accented letters lose their accents (Café becomes Cafe), `€` becomes `EUR`, and other non-ASCII characters become `?`.
- `BANKID` is the placeholder `000000000`. `ACCTID` is the account number you type (digits only, default `000000`). The account type is CHECKING.
- Currency: USD, EUR, GBP, CAD or AUD.

OFX 1.x is the statement format QuickBooks Desktop (File > Utilities > Import > Web Connect Files, though see below), Xero, Wave, Quicken, GnuCash and many banks document for import. This file has been checked against the OFX 1.02 structure, not test-imported into each of those products.

### QuickBooks (.qbo)

The same OFX with the block QuickBooks looks for in the sign-on response:

```
<FI>
<ORG>PDFCells
<FID>3000
</FI>
<INTU.BID>3000
```

`INTU.BID` is the Intuit bank id. Intuit publishes no generic value; QuickBooks checks it against its list of banks that support Web Connect. `3000` is the value converters commonly use (it belongs to a large US bank in Intuit's list). Limitations, honestly:

- **QuickBooks Online** (Banking > Upload transactions, or Transactions > Bank transactions > Link account > Upload from file) is usually fine with this file. It asks which account to put the transactions in, so the placeholder account number doesn't matter.
- **QuickBooks Desktop** is stricter. It may refuse a file whose bank id it doesn't recognise, or ask you to pick an existing account. Versions that are more than about three years old stop importing .qbo files altogether. If a .qbo is refused, import the OFX or the bank CSV instead.
- QuickBooks skips a transaction whose FITID it has already imported into that account. That's what stops a second import creating duplicates, but it also means a statement edited after an import keeps its old ids for unchanged rows.

### Xero CSV

Xero's statement CSV columns: `Date, Amount, Payee, Description, Reference, Cheque Number`. Amounts are plain signed numbers (`-39.51`, no currency symbol or thousands separator). Payee and Description both get the description, because Xero's bank rules match on Payee.

Dates are DD/MM/YYYY by default, as in Xero's template. Xero reads dates in your organisation's region format, so a US organisation should switch the panel to MM/DD/YYYY. Xero maps the columns when you import, so check the mapping screen once and save it.

In Xero: Accounting > Bank accounts, pick the account, then Manage account > Import a statement. Choose the file and confirm the column mapping. (An OFX file also imports here, with no mapping step.)

### Bank CSV

`Date, Description, Amount, Balance`, ISO dates (2026-03-02), plain signed numbers, balance blank on rows without one. Good for spreadsheets and for software that maps CSV columns itself.

Both CSVs start with a UTF-8 byte order mark and guard every text cell against spreadsheet formula injection (a description starting with `=`, `+`, `-` or `@` gets a leading `'`).

## Known limitations

- **Credit card statements** where the balance is the amount owed come out with inverted signs (a purchase raises the balance, so it reads as money in). Export as bank CSV and flip the sign, or wait for a credit-card mode.
- One account per export. A statement with several accounts exports the longest transaction table.
- OFX/QBO always declare a checking account.
- A row whose description starts with "Total" or "Sum" is treated as a total line and skipped, as the balance check does. A real payee such as "Total Wine" would be dropped, and the balance check then flags the next row.
