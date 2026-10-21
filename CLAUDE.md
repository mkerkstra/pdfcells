# PDFCells

PDFCells (pdfcells.com): PDF → Excel. Vite/React SPA in the repo root (`src/`), Go API as one Vercel function (`api/index.go` → `backend/server`), Postgres only for the credits ledger.

## Rules

- **Local first.** The text and OCR engines run in the browser. Never add a path that uploads a PDF or page image unless the user picked AI for that page.
- **One layout engine.** The PDF text layer and OCR both produce `Word[]`, and `src/lib/layout.ts` turns words into tables. Improve that, don't fork it.
- **One typing path.** Cells stay strings until export. `src/lib/cells.ts` decides numbers and dates for every engine, AI included. The AI prompt says to transcribe, never to reformat.
- **Money.** Amounts are int64 micro-dollars end to end. Every balance change is a `ledger` row written in the same transaction as the locked `accounts` row. Paid pages hold the worst case before the model call and settle to the exact cost (`backend/store`). Price fallback iterations by the model that served them (`extract.usageOf`). Unknown models are an error, never $0.
- **Request size.** Vercel caps function bodies at 4.5 MB, so the client always sends one rendered JPEG page per request, never the PDF.
- **Models.** Fast = `claude-haiku-5-5`, Accurate = `claude-sonnet-5-5`, Max = `claude-opus-5-5`. Use structured outputs (`output_config.format`), not forced tool use, which returns a 400 on 5.5 models. When rates change, update `backend/pricing` and its tests together.
- **Migrations.** They run on cold start, in one implicit transaction per file, against the live ledger. A future migration that touches `ledger` or `accounts` sets a bounded `lock_timeout` and builds indexes with `CREATE INDEX CONCURRENTLY`, each in its own non-transactional file. Never edit a migration that is already on main.
- **Areas are a privacy boundary.** When a page has marked areas (`src/lib/region.ts`), only words inside them may reach the AI: the image is cropped (`readBox`), the text hint is filtered (`aiHint`), and a page whose areas match nothing throws `NOTHING_MARKED` rather than sending the whole page. Every new AI call (naming, categorising, batches) needs a leak test in the style of the `SECRET` test in `src/state/runner.test.ts`.
- **Excel output must survive sorting.** Check formulas never reference a neighbouring row by position. Tables with a running balance or partial totals get a `Line` column, and checks look rows up with `SUMIFS(Tbl[col],Tbl[Line],n)` (`src/lib/xlsxChecks.ts`). Interior subtotals sit below the Excel Table so pivots don't double-count (`summaryRows`: a row counts as a total only if it foots or only totals follow it).
- **Statement exports** (CSV, Xero, OFX/QBO) follow `docs/bank-statements.md`. Keep that doc in step with `src/lib/statementExport.ts`.
- Named exports, no barrels. Tests sit next to the code (`*.test.ts`, `*_test.go`).
- Commits: `{type}(scope): desc`. No Co-Authored-By trailers.

## Layout

- `src/lib/`: engines and pure logic (`layout`, `cells`, `region`, `areas`, `statement`, `xlsx*`, `recipe`, `batch`). `src/state/`: reducers and runners (`doc.ts`, `runner.ts`, `batchRunner.ts`). `src/components/`: UI.
- `backend/`: `server` (chi routes), `extract` (Anthropic calls), `pricing`, `billing` (Stripe Managed Payments), `store` (Neon ledger), `auth` (Clerk), `inbound` (Resend support mail).
- `fixtures/`: synthetic PDFs plus exact truth, written by `fixtures/make_fixtures.py`. `eval/`: engine scoring harness, see `eval/README.md`. Engine choices are decided by harness numbers, not by impressions.
- `docs/research/ocr-sota-2026.md`: OCR and model research. Record verified findings there.

## Gates

`make qg` runs everything; read its final pass line rather than trusting the exit code of a wrapper. Targeted runs: `pnpm vitest run src/lib/layout.test.ts` and `go test ./backend/store/`. The store tests need `TEST_DATABASE_URL`. `make dev` runs the API on :8080 and the web app on :5173.

Workbook changes: also validate the generated xlsx with the Open XML SDK validator and recalculate it in headless LibreOffice (both via Docker), and confirm every check formula evaluates to 0.

## Ship

- Commit and push straight to `main`; there are no PRs for owned work. Run an adversarial Codex review first on non-trivial changes: `codex exec -m gpt-6.1-sol -c model_reasoning_effort=high -s read-only --cd . "<prompt>" < /dev/null` (stdin must be closed or it hangs). Stop at diminishing returns.
- Pushing runs GitHub CI (`ci`, `security` with govulncheck, `dependency-review`). Wait for them to go green.
- **Pushing does not deploy.** The Vercel project is deliberately not connected to GitHub. Deploy with `vercel --prod --scope mkerkstras-projects --yes`, then check `https://pdfcells.com/api/health` (`db`, `hosted`, `payments` all true) and click through the changed flow on pdfcells.com.
- Parallel work goes on `claude/*` branches in `.claude/worktrees/`, and is merged into main one feature at a time.
- Renovate maintains dependencies (`renovate.json`, `docs/dependencies.md`).

## Secrets

Never print secrets or commit them. Set them with `vercel env add NAME production --sensitive` piped from a file, then delete the file. Delete any env file pulled with `vercel env pull` once you've used it. Never run destructive operations against the production database; migrations run on cold start.
