# Table extraction eval

Measures every table engine against exact ground truth, so engine decisions ("PP-OCRv5 + Table Transformer beats tesseract.js + our heuristics on scans") become numbers. Plan and candidates: `docs/research/ocr-sota-2026.md` §3(d).

## Run

```sh
pnpm eval                                  # text-layer + tesseract over the whole corpus (~2 min)
pnpm eval --engine text-layer --only statement
pnpm eval --only scan                      # --only matches a page type, a source or a fixture name
pnpm eval --list                           # engines, including documented stubs
pnpm eval --engine claude --hosted --tier fast         # prints the cost estimate and stops
pnpm eval --engine claude --hosted --tier fast --yes   # spends it (needs ANTHROPIC_API_KEY)
```

Each run writes `eval/reports/<timestamp>.md` and `.json` (`--name` to choose, `--out` for another directory). Ad-hoc reports are git-ignored; committed baselines are `eval/reports/baseline-<date>.*`.

`pnpm eval` is plain Node (`node --import ./eval/register.ts eval/run.ts`): Node 24 strips the TypeScript types and `register.ts` resolves `src/`'s extensionless imports. No bundler, no new runtime.

The fast subset runs in CI: `eval/floor.test.ts` runs the text-layer engine over every digital fixture with `pnpm test` and fails if the scores drop below the baseline. OCR and hosted engines never run in CI.

## Corpus and truth

Every file in `fixtures/` has `fixtures/truth/<file>.json`, written by `fixtures/make_fixtures.py` from the very strings it draws (format and conventions: `fixtures/README.md`). Each page has a document type (`statement | invoice | report | form | text | blank`) and each file a source (`digital | scan | photo | image`). The corpus is synthetic: it isolates failure modes with exact truth, it does not estimate real-world rates.

## Engines

```ts
interface Engine {
  id: string
  version: string
  kind: 'local' | 'hosted'
  run(page: PageInput): Promise<EngineResult>
  close?(): Promise<void>
}
interface PageInput {
  // eval/engine.ts
  file
  page
  source
  kind: 'pdf' | 'image'
  width
  height // page units: pt, or upright px
  pdfPage?: PDFPageProxy // pdf.js legacy build, text layer included
  render(targetPx): Promise<{ width; height; scale; png(); jpeg(q) }>
}
interface EngineResult {
  tables: { title; headerRows; rows: string[][]; cellConf?: (number | null)[][] }[]
  timing: { ms; renderMs }
  costMicros: number
  notes?: string[]
}
```

| id              | kind   | what it is                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `text-layer`    | local  | The app's digital path: pdf.js text → `src/lib/pagefacts` → `src/lib/triage` → `src/lib/layout` `buildTables`. Pages without a trusted text layer give no tables, as in the app.                                                                                                                                                                                                                                   |
| `tesseract`     | local  | The app's OCR path: render at 3000 px → tesseract.js 7 (WASM, LSTM, `eng` best_int) → `src/lib/ocr` `wordsFromBlocks` → `buildTables`. Runs on every page, digital ones too.                                                                                                                                                                                                                                       |
| `claude`        | hosted | `backend/extract`'s request rebuilt in Node: 2000 px JPEG + text-layer hint, system prompt read from `prompt.go`, ported user prompt and schema, tier model and effort; µ$ from `backend/pricing` rates. Off unless `ANTHROPIC_API_KEY`, `--hosted` and `--yes`. The server-side refusal fallback is not used.                                                                                                     |
| `ppocr-<model>` | local  | The opt-in browser engine `src/lib/ppocr`: render at 3000 px → PP-OCR det+rec (official PaddlePaddle ONNX, `v6-tiny`, `v6-small`, `v5-en-mobile`) on onnxruntime-web WASM, one thread → words split at spaces by CTC timestep → `buildTables`. Models download once into `eval/.cache/ppocr/` (sha256-checked); `PPOCR_DET_MAX_SIDE` sets the det input's long side (default 4000, i.e. the 3000 px render as is). |
| `paddleocr-vl`  | hosted | Stub: PaddleOCR-VL-1.6 on a vLLM server.                                                                                                                                                                                                                                                                                                                                                                           |

**Rendering.** PDF pages render through pdf.js into `@napi-rs/canvas` (the canvas pdf.js itself uses in Node; it was already installed, now a pinned devDependency). Images decode with `@napi-rs/canvas` (PNG, JPEG with EXIF orientation, GIF, WebP) and with the app's own TIFF and HEIC decoders. No Python pre-step.

### Adding an engine

1. Write `eval/engines/<name>.ts` exporting a factory that returns an `Engine`. Take what you need from `PageInput`: `pdfPage` for text, `render(px)` for pixels. Return grids of strings exactly as printed (the app's typing happens later in `src/lib/cells.ts`) and `headerRows`; fill `cellConf` if the engine has one.
2. Word-level engines (any OCR) should end in `src/lib/layout` `buildTables`, like `tesseract.ts`, so the comparison isolates the recognizer. Structure-aware engines (TATR, a VLM) return their own grids; spanned cells put text top-left and `""` elsewhere.
3. Time the whole `run()` in `timing.ms` (render included, one-time model loading excluded) and put model cost in `costMicros`.
4. Register it in `eval/engines/registry.ts` with `status: 'ready'` and a `create()`. Hosted engines are refused without `--hosted`; print an estimate and require `--yes` before spending, as `run.ts` does for `claude`.
5. Bump `version` whenever its output can change.

For the remaining stub: `paddleocr-vl` needs a vLLM endpoint URL and a parser from its HTML/Markdown tables to grids. A Table Transformer / SLANet_plus structure pass on top of `ppocr-*` is not built; see docs/research/ocr-sota-2026.md for why.

## Metrics

All computed per page and summed per engine × document type, × source, × fixture, and overall.

- **Table matching.** Every truth table is compared with every extracted table on the same page by GriTS-Con. Pairs are taken greedily, best first, one-to-one, if the score is at least **0.5**.
- **Precision / recall.** Matched / extracted tables and matched / truth tables. **Junk cells**: non-empty cells of extracted tables that matched nothing (page furniture, charts, prose, tables of contents).
- **Cell exact.** Share of non-empty truth cells reproduced exactly (whitespace-normalized) at the position the GriTS alignment maps them to. Cells of missed tables count as wrong.
- **Numeric accuracy.** Truth body cells that `src/lib/cells.ts` `parseNumber` reads as a number (decimal separator by `detectLocale` per column, each side its own), counted right when the extracted cell parses to the same value. `1043.00` for `1,043.00` is right; `96.80` for `96.50` is wrong; an identifier like `00042` is not numeric.
- **Structure: GriTS-Con** (Smock, Pesala, Abraham, _GriTS: Grid table similarity metric for table structure recognition_, ICDAR 2023, [arXiv:2203.12555](https://arxiv.org/abs/2203.12555)). `2·Σf / (|truth| + |extracted|)` over the most similar 2D substructure, with f = LCS string similarity and rows and columns aligned by the paper's factored dynamic program (`eval/grits.ts`, tests in `eval/grits.test.ts`). Mean over truth tables, 0 for a missed table. It penalizes merged, split, dropped and misordered rows and columns and partially wrong text. GriTS-Top is not reported: no engine here outputs spans, so it would only measure grid shape. Truth files keep the spans for when one does.
- **Header rows.** Share of matched tables whose `headerRows` equals the truth's.
- **Checks-pass** (label-free). `src/lib/validate` `reviewDocument` over each document's extracted tables: a table is _verified_ with at least one passing check and no arithmetic failure, _failed_ with a balance, arithmetic, cross-foot, tie or total issue, _unchecked_ otherwise. Rate = verified / (verified + failed). The report shows the same rate on the truth tables in brackets: the planted-error fixtures fail there by design.
- **Latency** ms per page (engine `run()`, render included, machine-dependent) and **cost** in µ$.
- **Worst cells.** Wrong cells of matched tables, wrong numbers first, then least similar.

### Why 0.5

Measured on the corpus (see the calibration section of each report): two _different_ truth tables on one page score at most 0.25 against each other (`eval/truth.test.ts` keeps this below 0.33), and junk tables score at most 0.15 (text-layer) and 0.33 (tesseract) against the best truth table. Accepted matches start at 0.51, and they are tables merged with a neighbour (side-by-side) that still contain the truth table. The 0.33 case is a truth table buried in a larger extracted one (letterhead + member block + account summary): counted as a miss plus junk, which is how a user experiences it. 0.5 also reads directly: the matched content is at least half the mean size of the two grids.
