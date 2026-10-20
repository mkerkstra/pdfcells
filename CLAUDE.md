# pdf2excel

PDF → Excel. Vite/React SPA in the repo root (`src/`), Go API as one Vercel function (`api/index.go` → `internal/server`), Postgres only for the credits ledger.

## Rules

- **Local first.** The text and OCR engines run in the browser. Never add a path that uploads a PDF or page image unless the user picked AI for that page.
- **One layout engine.** The PDF text layer and OCR both produce `Word[]`, and `src/lib/layout.ts` turns words into tables. Improve that, don't fork it.
- **One typing path.** Cells stay strings until export. `src/lib/cells.ts` decides numbers and dates for every engine, AI included. The AI prompt says to transcribe, never to reformat.
- **Money.** Amounts are int64 micro-dollars end to end. Every balance change is a `ledger` row written in the same transaction as the locked `accounts` row. Paid pages hold the worst case before the model call and settle to the exact cost (`internal/store`). Price fallback iterations by the model that served them (`extract.usageOf`). Unknown models are an error, never $0.
- **Request size.** Vercel caps function bodies at 4.5 MB, so the client always sends one rendered JPEG page per request, never the PDF.
- **Models.** Fast = `claude-haiku-5-5`, Accurate = `claude-sonnet-5-5`, Max = `claude-opus-5-5`. Use structured outputs (`output_config.format`), not forced tool use, which returns a 400 on 5.5 models. When rates change, update `internal/pricing` and its tests together.
- Named exports, no barrels. Tests sit next to the code (`*.test.ts`, `*_test.go`).
- Commits: `{type}(scope): desc`. No Co-Authored-By trailers.

## Gates

`make qg` runs everything. Targeted runs: `pnpm vitest run src/lib/layout.test.ts` and `go test ./internal/store/`. The store tests need `TEST_DATABASE_URL`.
