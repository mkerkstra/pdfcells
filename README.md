# PDFCells

**PDF to Excel converter** at [pdfcells.com](https://pdfcells.com). It turns PDF tables into Excel spreadsheets you can trust. Every page is checked first and handled by the cheapest engine that can read it. Every cell can be corrected before you download.

- **Free and local by default.** Digital PDFs are read straight from their embedded text with pdf.js, and scans go through tesseract.js OCR (WASM). Both run in your browser, so the file is never uploaded.
- **AI when the page needs it.** Scans, photos, broken font encodings and irregular layouts can go to Claude one page at a time. The page goes as a rendered image plus whatever text layer exists.
- **A check before you spend anything.** Each page is classified as digital, scanned, broken text or blank, and given a recommended engine and a cost estimate. You can override any page.
- **Corrections built in.** The grid editor supports undo and redo, inserting and deleting rows and columns, merging and splitting columns, and setting header rows. Suspect cells are flagged: non-numbers in numeric columns, totals that don't add up, and low OCR confidence. "Fix with AI" sends the page plus your current table and an instruction, and returns a corrected version.
- **Real spreadsheets.** Numbers, percents, currencies, parenthesised negatives, decimal-comma locales and dates become real cell values with consistent per-column formats. Header rows are frozen, and tables continued across pages are joined into one sheet.

## Bank statements

Choose **Bank statement (OFX, QBO, Xero CSV)** in the export bar to turn a statement into an import file for QuickBooks, Xero, Wave and similar: OFX 1.02, QuickBooks Web Connect (.qbo), Xero's statement CSV, or a plain bank CSV. Transactions are read from the same columns the running-balance check verified, joined across pages, signed money-in positive, with stable FITIDs.

The download is only enabled when the numbers check out: the running balance ties on every row, or, without a balance column, the account summary ties and the transactions add up to it. Otherwise the panel names the cell to fix ("Balance doesn't tie on page 1, row 11: ..."). Only the plain CSV can be exported anyway, behind a confirm box. Import tips and format details, including QuickBooks' limits on .qbo files: [docs/bank-statements.md](docs/bank-statements.md).

## Pricing model

| Path | Cost |
|---|---|
| PDF text, in-browser OCR | Free, unlimited, on your device |
| AI, signed in | 25 Fast (Claude Haiku 5.5) pages per day free |
| AI with credits | Anthropic's exact token cost **+ 15%** (covers payment and merchant-of-record fees), prepaid in $10 / $25 / $50 packs. Every charge is itemised with token counts |
| AI with your own Anthropic key | Billed by Anthropic directly. The key stays in your browser's storage and is sent per request, never stored server-side |

Tiers: **Fast** = `claude-haiku-5-5`, **Accurate** = `claude-sonnet-5-5`, **Max** = `claude-opus-5-5`.

## Stack

- **Web**: Vite + React 19 + TypeScript (strict), Tailwind 4, TanStack Query, pdf.js, tesseract.js, write-excel-file, Clerk. Lint and format with oxlint and oxfmt, tests with vitest.
- **API**: Go, chi, and the Anthropic Go SDK with structured outputs (JSON schema). Database access is pgx with golang-migrate, plus Stripe Checkout with Managed Payments (Stripe is merchant of record for sales tax and VAT). It deploys as a single Vercel Go function (`api/index.go`), and every `/api/*` path is rewritten to it.
- **DB**: Postgres, used only for the credits ledger. Money is stored as int64 micro-dollars. A paid page reserves a worst-case hold under a row lock and then settles to the exact cost, so concurrent requests can't overspend.

```
src/lib/layout.ts     words → lines → segments → table blocks → columns (projection profile) → cells
src/lib/triage.ts     per-page classification + engine recommendation
src/lib/cells.ts      number/date/percent parsing, per-column typing
src/lib/validate.ts   checks that drive the correction UI
src/lib/statement.ts  bank statement transactions + the export accuracy gate (writers in statementExport.ts)
backend/extract       one Claude call per page, structured output, exact per-model billing
backend/store         ledger: topups, holds, settlement, free quota
```

## Develop

```sh
pnpm install
make dev          # API on :8080, web on :5173 (proxies /api)
make qg           # gofmt, vet, golangci-lint, go test, oxfmt, oxlint, tsc, vitest, build
```

With no environment configured, the app runs the local engines and the bring-your-own-key AI path. Hosted AI and credits switch on once the variables in [`.env.example`](.env.example) are set.

Ledger tests need a throwaway Postgres:

```sh
docker run -d --rm -e POSTGRES_PASSWORD=pg -p 55432:5432 postgres:18-alpine
TEST_DATABASE_URL='postgres://postgres:pg@localhost:55432/postgres?sslmode=disable' go test ./...
```

Regenerate the test PDFs in `fixtures/`:

```sh
uv run --with reportlab --with pillow --with pypdfium2 python fixtures/make_fixtures.py fixtures
```

## License

MIT. Third-party code keeps its own license: notably [libheif-js](https://github.com/catdad-experiments/libheif-js) (LGPL-3.0), used unmodified as a separately loaded module for HEIC photos, and [tesseract.js](https://github.com/naptha/tesseract.js) with its English model (Apache-2.0), self-hosted under `/tesseract/`.
