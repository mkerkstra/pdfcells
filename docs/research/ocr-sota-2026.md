# OCR / table-recognition SOTA for PDFCells (as of 2026-10-20)

Method: web search + model cards. Many leaderboard numbers come from secondary roundups or the model authors' own reports; flagged **[unverified]** where I could not reach a primary source. Prices/leaderboards move monthly, so re-check before committing.

## Bottom line

1. **Browser:** replace tesseract.js with **PP-OCRv5/v6 mobile det+rec via onnxruntime-web**. *Prototyped and measured 2026-10-21 (section 5): more accurate than tesseract.js on every document type of our corpus, but 2-3× slower per page in single-threaded WASM. Shipped opt-in (`?ocr=ppocr`); tesseract.js stays the default until browser latency is measured.* Keep the existing pdf.js + projection-profile path for born-digital PDFs. Add an **opt-in WebGPU VLM tier** (granite-docling or a TeleOCR/PaddleOCR-VL ONNX port) only after our own eval shows it wins.
2. **Server:** a self-hosted ~1B document VLM (PaddleOCR-VL-1.6, TeleOCR, MinerU2.5-Pro) is plausibly cheaper than Haiku for clean scans. Photos and faxes are unproven. Pilot it behind the checks harness.
3. **Claude** stays the fallback for failed checks, multi-level headers, spanning cells, unusual locales, and "explain/repair" steps.
4. **Build the eval harness first.** Public benchmarks (academic papers) don't resemble bank statements or faxes.

## 1. Table detection / structure recognition

| Model | Reported accuracy | Size | License | In-browser? |
|---|---|---|---|---|
| **Table Transformer (TATR)** v1.1 | Trained on PubTables-1M + FinTabNet.c; the HF card gives no metrics ([card](https://huggingface.co/microsoft/table-transformer-structure-recognition-v1.1-all)). A 2026 third-party paper puts the SOTA on PubTables-1M at GriTS-Top about 99.1 and GriTS-Con about 98.8 ([TableSeq](https://arxiv.org/pdf/2604.16070)). TATR's own paper: [arXiv 2110.00061](https://arxiv.org/pdf/2110.00061). | 28.8M | MIT | Yes, feasible. DETR-style. **Verified 2026-10-20:** [Xenova/table-transformer-structure-recognition-v1.1-all](https://huggingface.co/Xenova/table-transformer-structure-recognition-v1.1-all) (commit `76c3afa`) has ONNX at 115.8 MB fp32, 58.3 MB fp16, 30.2 MB int8 (`model_quantized.onnx`), 29.7 MB uint8; the Xenova card states no license (the Microsoft weights are MIT). Needs separate OCR for text, and a table crop (the structure model is trained on cropped tables). |
| **TableFormer / Docling** | FinTabNet TEDS about 0.96 and PubTables-1M about 0.977 for the OTSL variant ([arXiv 2305.03393](https://arxiv.org/pdf/2305.03393)). Docling's TableFormer license not verified. | not verified | not verified | Unlikely (Python stack). |
| **granite-docling-258M** | FinTabNet TEDS-struct 0.97, with content 0.96 (vs 0.82/0.76 for SmolDocling) ([card](https://huggingface.co/ibm-granite/granite-docling-258M)). Reported on 150dpi clean FinTabNet; not scans. | 258M | Apache-2.0 | **Yes, via WebGPU.** The card lists IBM and community WebGPU Spaces. Expect a few hundred MB download (exact ONNX sizes **unverified**). The card says it is meant for use within Docling. |
| **PP-StructureV3 / SLANet_plus / SLANeXt** | TEDS not found. | **SLANet_plus: 7.8 MB ONNX** | Apache-2.0 | **Verified 2026-10-20:** official [PaddlePaddle/SLANet_plus_onnx](https://huggingface.co/PaddlePaddle/SLANet_plus_onnx) (commit `7dbe640`, `inference.onnx` 7,782,138 B, sha256 `7790c0c1…`). Outputs HTML structure tokens + cell boxes; no browser port found, post-processing would be ours. |
| **Surya table rec** | not verified | not verified | Weights CC-BY-NC-SA, waived only under $2-5M revenue/funding; code GPL ([README mirror](https://pypi.org/project/surya-ocr/0.4.7)) | Not suitable: license risk. |
| UniTable | not checked | not checked | not checked | not checked |

Trade-off: classical structure models (TATR, SLANet) need a separate OCR step but are tiny. Document VLMs emit structure and text together but are 0.3-1.4B parameters.

## 2. OCR / VLM-OCR

OmniDocBench v1.6 overall and olmOCR-Bench (via [Docsumo roundup, 2026-09-30](https://www.docsumo.com/blog/best-ocr-models); the figures are the vendors' own reports):

| Model | Benchmark | Size | License | Notes |
|---|---|---|---|---|
| TeleOCR (Aug 2026) | OmniDocBench v1.6: 96.87 overall, **table TEDS 96.36**, TEDS-S 98.52 ([card](https://huggingface.co/XingChen-AGI/TeleOCR)); roundup lists 96.91 | 1.2-1.4B | Apache-2.0 | **Community ONNX q4f16 = 1.77 GB, runs in transformers.js on WebGPU**, 65-90 tok/s on an iGPU ([ONNX repo](https://huggingface.co/stefanj0/TeleOCR-ONNX)). Unofficial conversion. |
| PaddleOCR-VL-1.6 (May 2026) | 96.33 overall ([card](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6)); Real5 scanning table TEDS 94.12 ([Real5 leaderboard](https://huggingface.co/datasets/PaddlePaddle/Real5-OmniDocBench)) | 0.9B | Apache-2.0 | 109 languages; llama.cpp/GGUF builds exist; no ONNX/browser mention on the card. |
| MinerU2.5-Pro | 95.75 | 1.2B | Apache-2.0 (weights) | |
| GLM-OCR | 95.22 | 0.9B | MIT | |
| dots.mocr / dots.ocr | olmOCR-Bench 83.9 (mocr); dots.ocr Real5 table TEDS 85.68 | 3B | MIT | |
| Chandra OCR 2 | olmOCR-Bench 85.8 | 5.3B | Modified OpenRAIL-M | Check revenue terms. |
| olmOCR 2 | olmOCR-Bench 82.4; GPT-4o 68.9, Mistral OCR 72.0 ([paper](https://arxiv.org/pdf/2510.19817)) | 7B | Apache-2.0 | |
| Gemini 3 Pro / GPT-5.2 | OmniDocBench v1.6: 92.91 / 86.59 | API | closed | |
| Claude (Haiku/Sonnet/Opus 5.5) | **No published OmniDocBench/olmOCR-Bench figures found. Unverified.** Measure ourselves. | API | closed | |

Robustness warning: on photographed pages (Wild-OmniDocBench), PaddleOCR-VL dropped 91.93 to 72.19 and MinerU2.5 90.67 to 70.91 ([Docsumo](https://www.docsumo.com/blog/best-ocr-models)). The Real5 paper ([arXiv 2603.04205](https://arxiv.org/pdf/2603.04205)) shows the 1.5/1.6 releases largely close that gap on scans (table TEDS 94.12 on scanning), but the per-scenario photo numbers are only in images I couldn't read. Public numbers are mostly academic papers, not bank statements or faxes.

**Digit accuracy:** I found no published digit-level or numeric-cell benchmark for any of these models. Treat numeric accuracy as unknown until our own eval (section 3d).

**Classic engines:** PP-OCRv6 (June 2026) tiers: 1.5M / 7.7M / 34.5M parameters, Apache-2.0, 50 languages in a single model. The medium tier is +5.1 points recognition over PP-OCRv5_server on PaddleOCR's in-house benchmark, not a public one ([summary](https://aiweekly.co/alerts/paddlepaddles-pp-ocrv6-beats-billion-scale-vlms-at-ocr), [paper](https://tldr.takara.ai/p/2606.13108)). **Browser ONNX exports of v6 exist (verified 2026-10-20), officially:** PaddlePaddle publishes `PP-OCRv6_{tiny,small,medium}_{det,rec}_onnx` on Hugging Face (June 2026, Apache-2.0); see section 5 for files, sizes and hashes. Packages: [ppu-paddle-ocr](https://www.npmjs.com/package/ppu-paddle-ocr) 6.6.1 (MIT; v6 tiny default, ~6 MB; v6 small ~30 MB; v6 medium ~139 MB; v5 per-language ~12 MB; models from the third-party `snowfluke/ppu-paddle-ocr-models` HF repo, byte-identical sizes to the official exports; the web build uses a canvas engine, the Node build pulls OpenCV.js via `ppu-ocv`). The official [@paddleocr/paddleocr-js](https://www.npmjs.com/package/@paddleocr/paddleocr-js) 0.4.2 (Apache-2.0, 23.8 MB unpacked) needs OpenCV.js and tar-packed models. Neither was used: section 5 runs the official ONNX files through ~650 lines of our own pre/post-processing (`src/lib/ppocr/`).

**Cloud doc AI** (prices from third-party blogs that conflict; confirm on vendor pages; Azure's official page showed placeholders):

| Service | Price per 1,000 pages |
|---|---|
| Mistral OCR 4 | about $4 ($2 batch) ([source](https://invoiceextractor.ai/mistral-ocr-pricing)) |
| Basic OCR (AWS/Google/Azure) | about $1.50 |
| Azure prebuilt/layout | about $10 |
| Google Document AI layout/prebuilt | about $10 (sources conflict; $30 for Form Parser/custom) |
| AWS Textract | $1.50 text + $15 tables = about $16.50 ([roundup](https://soceton.com/blogs/document-ai-ocr-pricing-comparison)) |

I found no verified bank-statement prebuilt pricing or accuracy for Azure or Textract. I did not find a Claude per-page price in this research; use the claude-api reference for current rates.

## 3. Recommendations (ranked)

| # | Option | Why | Risk |
|---|---|---|---|
| 1 | **PP-OCRv5/v6 mobile (det+rec) in onnxruntime-web + existing heuristics; TATR or SLANet_plus ONNX for ruled-table structure** | Small (tens of MB, **unverified exact**), WASM-capable on any device, Apache/MIT, a direct upgrade over tesseract. | Heuristics still carry spanning cells and multi-level headers. Browser TATR/SLANet ports need our own work. |
| 2 | **Server VLM pilot: PaddleOCR-VL-1.6 or TeleOCR on vLLM** | Table TEDS 94-96 on benchmarks; Apache-2.0. Throughput about 1.2-1.4 pages/s on an A100 ([PaddleOCR-VL-1.5 paper](https://arxiv.org/pdf/2601.21957)). At an assumed $1.5-2.5/hr A100 (my arithmetic, rental price assumed) that is roughly $0.30-0.60 per 1,000 pages at full utilization; idle time dominates for a small product. | Photo/fax performance and digit accuracy are unproven. A serverless GPU (scale-to-zero) is the likely cost-efficient shape. |
| 3 | **Opt-in WebGPU VLM tier (TeleOCR q4f16 1.77 GB, or granite-docling)** | Strongest fully-local accuracy; private (a selling point for accountants). | 1.8 GB download, WebGPU-only (needs Chrome/Edge desktop; Safari/Firefox support varies), unofficial conversion, a dense page can exceed 3,000 tokens (about 35-70 s at 65-90 tok/s on an iGPU). Latency on laptops is **unmeasured**. |
| 4 | **Claude** for: checks failed on cheaper engines; multi-level headers/spanning cells; mixed locales (decimal comma); repair prompts using the failing check as context | No competing published benchmark; keep it as the safety net. | Cost per page |
| 5 | Cloud doc AI (Azure/Textract) | Only if a customer demands a named vendor. | $10-17 per 1,000 pages, above Mistral and Claude [unverified] |

**(a) Browser path:** onnxruntime-web (WASM everywhere, WebGPU when available); PP-OCR det+rec 6-31 MB (measured, section 5); fallback to tesseract.js, then Claude. VLM tier requires WebGPU and about 2-3 GB free GPU memory **[estimate, unverified]**. **WASM threads are not available on pdfcells.com:** threads need `SharedArrayBuffer`, i.e. COOP `same-origin` + COEP `require-corp`, and COEP would break the Clerk and Turnstile frames, so section 5 runs single-threaded. WebGPU in onnxruntime-web 1.30 needs the 27 MB `jsep` WASM build; not wired or measured.

**(b) Server vs Haiku:** the self-hosted model can win on cost per page and privacy, but it can only be called better after the eval. Gate it: run both on our corpus, compare checks-pass rate and numeric-cell accuracy.

**(c) Claude is right when** layout is irregular, headers span levels, or a result fails deterministic checks and needs a second opinion; and for downstream normalization.

**(d) Evaluation plan**

- Public datasets (confirm each license before use): [PubTables-1M](https://arxiv.org/pdf/2110.00061) (Microsoft, CDLA-Permissive per the repo [unverified]), FinTabNet (IBM; license unverified), PubTabNet, OmniDocBench and Real5-OmniDocBench (for photos/scans), olmOCR-Bench, SROIE/CORD/FUNSD (receipts/forms; licenses vary, verify; no primary links gathered).
- Own corpus (the real signal): 200-300 anonymized pages stratified by bank statement / invoice / wrapped ruled table / side-by-side / multi-level header / decimal-comma / scan / photo / fax. Store ground truth as cell grids (CSV + merged-cell map).
- Metrics: cell-level exact match; **numeric-cell exact match after locale normalization**; TEDS and TEDS-struct; row/column count match; **checks-pass rate** (running balance, footing, cross-footing, qty x unit) which doubles as a label-free metric on unlabeled pages; cost and latency per page.
- Harness: a `Engine` interface (`page image -> grid + confidence`), adapters for each engine (current, PP-OCR+TATR, TeleOCR WebGPU, PaddleOCR-VL server, Haiku/Sonnet/Opus, Mistral OCR), a runner that caches outputs per (engine, version, page), a scorer, and a report keyed by document type. Run in CI on a small fixed subset and nightly on the full set. Log failures from checks as a regression-hunting queue.

## 4. Downstream models for accountants

I did not find strong sources in this research session, so this part is thin and **unverified**.

- **Embeddings in-browser:** transformers.js (ONNX Runtime Web, WASM or WebGPU) can run [multilingual-e5-small](https://huggingface.co/Xenova/multilingual-e5-small) (12 layers, 384-dim, 100 languages; needs the "query:"/"passage:" prefixes). The WASM default is q8; the WebGPU default is fp32, so download size differs by backend ([HF forum](https://discuss.huggingface.co/t/transformers-js-retrieving-the-size-of-models-in-mb-gb-before-running/174303)). MB sizes weren't confirmed. So: viable for payee normalization, duplicate and reconciliation matching.
- **Practical pattern:** deterministic rules first (exact amount + date window), then embedding similarity on payee strings as a tiebreaker. For categorization, a small-embedding + logistic regression trained on the user's own history is the likely best fit. No open bank-transaction categorization dataset was found.

## 5. PP-OCR in the browser: prototype and measurement (2026-10-21)

**What exists (verified 2026-10-20 against the Hugging Face API; sizes in bytes; all Apache-2.0):**

| Model set | det | rec | rec dictionary | Total download |
|---|---|---|---|---|
| PP-OCRv6 tiny | [`PP-OCRv6_tiny_det_onnx`](https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_det_onnx) @ `2ba1506` 1,780,590 | [`PP-OCRv6_tiny_rec_onnx`](https://huggingface.co/PaddlePaddle/PP-OCRv6_tiny_rec_onnx) @ `2612ab3` 4,462,639 | in `inference.yml`, 55,571 (6,904 chars) | **6.3 MB** |
| PP-OCRv6 small | `PP-OCRv6_small_det_onnx` @ `28fe589` 9,880,512 | `PP-OCRv6_small_rec_onnx` @ `b8f84f0` 21,159,378 | 150,579 (18,708 chars) | **31.2 MB** |
| PP-OCRv5 mobile, English rec | `PP-OCRv5_mobile_det_onnx` @ `e6f4fa8` 4,826,518 | `en_PP-OCRv5_mobile_rec_onnx` @ `3fafbc3` 7,848,423 | 3,964 | **12.7 MB** |
| (not used) PP-OCRv6 medium | `PP-OCRv6_medium_det_onnx` 62,032,837 | `PP-OCRv6_medium_rec_onnx` 76,554,979 | | 138.6 MB |

sha256 of every file, the `inference.yml` dictionaries included (tiny `66170210…`, small `ab078671…`, v5-en `27e91d05…`), is pinned in `src/lib/ppocr/models.ts`. Runtime: onnxruntime-web 1.30.0 (MIT); its plain SIMD WASM is 14.2 MB (3.7 MB gzip), the WebGPU (`jsep`) build 27 MB. Hugging Face `resolve/<commit>` URLs answer CORS for any origin and redirect to `*.hf.co` (seen: `us.aws.cdn.hf.co`).

**What was built.** `src/lib/ppocr/`: det (DB) + rec (CTC) pre/post-processing in plain TypeScript (no OpenCV), shared by the browser and the eval harness. Words come from splitting each recognized line at spaces at the CTC peaks, padded by the line's own glyph width and never past halfway to the next word, so `src/lib/layout` still sees separate columns inside one det box. Pages askew by more than ~0.3° (projection profile over the det map) are levelled and detected again, and every word box is mapped back through the inverse rotation, so words come back in the page's own coordinates and marked areas (ignore and only) still line up.

In the app it runs in a module worker, opt-in with `?ocr=ppocr` (remembered in localStorage; `?ocr=tesseract` turns it off), and falls back to tesseract.js on any failure. **Everything is served from our own origin:** the v6-tiny models are committed under `public/ppocr/PP-OCRv6_tiny-2ba1506-2612ab3/` (unmodified, with the Apache-2.0 `LICENSE` and a `NOTICE` naming the source commits and hashes), served `Cache-Control: immutable`; the ORT `.wasm` is a hashed Vite asset. The page talks to no third party, so the CSP is unchanged from main. The bigger sets (v6-small, v5-en) are eval-only. Every file is checked against its size and sha256 on every load, cache hits included; a mismatch is never used or cached. Downloads have a 120 s deadline (headers and body), and a page gets 180 s (first page, models loading) or 60 s, after which the worker is terminated and the page goes to tesseract.js.

Default-path bundle: main chunk 1,116.05 → 1,116.51 kB (+0.46 kB, the flag check); everything else is in lazy chunks (`browser` 1.2 kB, `worker` 83 kB, the 14.2 MB wasm) or in `public/ppocr/` (6.3 MB), fetched only with the flag on.

**Measured** (`pnpm eval`, all 43 corpus pages; tesseract, v5-en and v6-small at commit `d1519ca`, v6-tiny re-measured after the review fixes below; reports in `eval/reports/baseline-2026-10-21-ppocr-run-*.md` and, for v6-tiny after the fixes, `baseline-2026-10-21-ppocr-fixed-ppocr-v6-tiny.md` at `b8f4496`). Render 3000 px for both engines; PP-OCR det at the render's own resolution (`detMaxSide` 4000). R = table recall; precision differs little and junk cells come almost entirely from the `text` pages for every engine.

| scope | engine | pages | R % | cell exact % | numeric % | GriTS-Con | checks-pass % |
|---|---|---:|---:|---:|---:|---:|---:|
| overall | tesseract | 43 | 90.5 | 94.3 | 95.5 | 0.862 | 78.6 |
| overall | ppocr-v6-tiny | 43 | 95.2 | 95.5 | 97.2 | 0.900 | 85.7 |
| overall | ppocr-v5-en-mobile | 43 | 95.2 | 96.2 | 97.3 | 0.915 | 85.7 |
| overall | ppocr-v6-small | 43 | 95.2 | 96.4 | 97.4 | 0.917 | 85.7 |
| statement | tesseract | 7 | 90.0 | 98.6 | 98.5 | 0.900 | 88.9 |
| statement | ppocr-v6-tiny | 7 | 100.0 | 99.6 | 100.0 | 1.000 | 88.9 |
| invoice | tesseract | 14 | 93.3 | 93.1 | 93.0 | 0.932 | 84.6 |
| invoice | ppocr-v6-tiny | 14 | 100.0 | 92.8 | 96.0 | 0.945 | 84.6 |
| report | tesseract | 14 | 88.2 | 92.8 | 95.0 | 0.778 | 50.0 |
| report | ppocr-v6-tiny | 14 | 88.2 | 94.5 | 96.6 | 0.802 | 83.3 |
| digital (OCR'd) | tesseract | 32 | 90.3 | 94.7 | 96.0 | 0.845 | 66.7 |
| digital (OCR'd) | ppocr-v6-tiny | 32 | 93.5 | 96.2 | 97.6 | 0.891 | 77.8 |
| scan | tesseract | 3 | 66.7 | 66.7 | 66.7 | 0.667 | 100.0 |
| scan | ppocr-v6-tiny | 3 | 100.0 | 75.8 | 79.5 | 0.862 | 100.0 |
| scan | ppocr-v6-small | 3 | 100.0 | 83.3 | 84.6 | 0.957 | 100.0 |
| photo | tesseract | 2 | 100.0 | 100.0 | 100.0 | 1.000 | 100.0 |
| photo | ppocr-v6-tiny | 2 | 100.0 | 86.4 | 100.0 | 0.868 | 100.0 |
| image (screenshots, TIFF, HEIC, PNG) | tesseract | 6 | 100.0 | 100.0 | 100.0 | 1.000 | 100.0 |
| image (screenshots, TIFF, HEIC, PNG) | ppocr-v6-tiny | 6 | 100.0 | 98.5 | 100.0 | 0.974 | 100.0 |

Fixtures that moved: `ruled-wrapped.pdf` cell exact 20.8 → 100 (tesseract dropped the amount column); `scanned-bad.pdf` (fax-quality) 0 → 27.3 (tiny) / 50.0 (small), table found instead of missed; `noisy-statement.pdf` recall 66.7 → 100; `dense-wide.pdf` 99.1 → 100. Worse: `side-by-side-ruled.pdf` 60.3 → 55.2, a layout failure the text-layer engine shares. Remaining PP-OCR misreads are spacing (`5.816,01€`, `Jan 6,2026`, `QoQ%`) and superscripts (`Hardware1`). **Skewed pages are the open cost.** Returning words in page coordinates (needed for areas) puts a tilted row's label and amounts at different heights again, and the layout groups rows by height: `photo-invoice.pdf` (2.4°) reads 72.7 % cell exact vs 100 % with words left in the levelled frame, `scanned-invoice-2p.tiff` p2 95.5 % vs 100 %, `scanned-bad.pdf` 27.3 vs 31.8. The fix belongs in `src/lib/layout` (level rows after the areas are applied, for every engine), not here. **The default path has the same coordinate problem today:** tesseract.js with `rotateAuto` returns words in its levelled frame (checked: a word drawn at (1368, 131) on a page tilted 2.3° comes back at (1352, 108)), so on a tilted scan an ignore area can miss the word it was drawn over. Before deskew existed the photo fixture read 86 %; before native-resolution det (`detMaxSide` 2048) closely spaced short numbers merged and GriTS overall was 0.882.

**Latency** (Apple M5 Max, 18 cores, Node 24.20, single-threaded WASM for PP-OCR, render included, model load excluded). The machine was shared with other jobs (load average 9-71 during the runs), so absolute numbers are noisy; the best of three back-to-back rounds on the 14 invoice pages:

| engine | ms/page (best of 3) | first-use download |
|---|---:|---|
| tesseract.js 7 (eng best_int) | 794 | ~7 MB (core + model, self-hosted) |
| ppocr-v6-tiny, det at render size | 2,338 | 6.3 MB models + 14.2 MB wasm (3.7 MB gzip) |
| ppocr-v6-tiny, det 2048 | 1,411 | same |
| ppocr-v5-en-mobile | 3,812 | 12.7 MB + wasm |
| ppocr-v6-small (full corpus, loaded machine) | ~12,600 | 31.2 MB + wasm |

In Chrome (same machine, built app under the production CSP, `scanned-invoice.png`, render + OCR + layout, timed from the click to the table): tesseract.js 1.17 s first read, 0.73 s re-read; PP-OCRv6 tiny 9.1 s first read with an empty cache (models downloaded), 2.4-4.3 s first read with cached models (session creation), 1.65-2.49 s re-reads (3 runs). So about 2.5-3× tesseract.js in the browser too.

Detection dominates (v6-tiny full corpus: det 2.8 s, rec 1.2 s mean under load). WASM threads would cut it but need cross-origin isolation, which the Clerk/Turnstile frames rule out; WebGPU was not tried.

**Verified vs reasoned.** Verified: model files, sizes, hashes (dictionaries included), licenses; the harness numbers above; the final build (commit `b8f4496`) end to end in Chrome under main's unchanged CSP: `?ocr=ppocr`, `scanned-invoice.png` read exactly, the models fetched from `/ppocr/PP-OCRv6_tiny-2ba1506-2612ab3/` on our origin and the `.wasm` from `/assets/`, no request to any model host, no CSP violation, no console error, no fallback; first read 2.0 s, re-reads 1.7 s. (An earlier pass on the pre-review build also checked `photo-invoice.pdf`, the Cache API reuse after a reload and that `?ocr=tesseract` clears the flag.) Unit and integration tests cover a swapped dictionary, a poisoned cache entry, a fetch and a response body that never finish, a silent worker, cells sharing one det box, and an ignore area on a tilted page (real v6-tiny models, no network). Reasoned only: latency on other machines and browsers (Safari, Firefox, phones), WebGPU speed-ups.

**Table structure (TATR / SLANet_plus): not built.** The one ruled table tesseract failed (`ruled-wrapped.pdf`) was a recognition failure, and PP-OCR fixes it with the existing heuristics. The remaining structure misses (`side-by-side*.pdf`, `multi-level-header.pdf`, `annual-report-excerpt.pdf` p6) fail identically on the text-layer engine, so they belong to `src/lib/layout` or a table-*detection* model shared by both paths, not to the OCR engine. SLANet_plus (7.8 MB) is the cheaper candidate when that work starts.

**Recommendation: keep opt-in; don't switch the default yet.** PP-OCRv6 tiny beats tesseract.js overall (cell exact +1.2, numeric +1.7, GriTS +0.04, checks-pass +7 points; statements, reports, ruled tables and scans markedly better) at a similar model download, but it is 2-3× slower per page single-threaded, adds a 3.7 MB (gzip) runtime, and is now behind on tilted photos until the layout levels rows itself. v6-small and v5-en are no better enough to justify their size and time. Before flipping the default: time it in real browsers (Chrome/Safari/Firefox, a mid-range laptop, a phone), try det at ~2560 px or WebGPU, and grow the scan/photo/fax part of the corpus. Switch if browser latency per page is within ~1.5× of tesseract.js.

## Gaps to close

- Official PP-StructureV3/SLANeXt TEDS and sizes; Docling TableFormer license; Surya/Chandra current license text.
- Official OmniDocBench v1.6 leaderboard (I relied on secondary roundups).
- Claude vs these on any public benchmark; digit-level accuracy for all.
- ONNX file sizes for granite-docling. (PP-OCRv6 browser ONNX: closed, section 5.)
- PP-OCR latency in real browsers (Safari, Firefox, low-end laptops, phones) and with WebGPU; section 5 is Node + the same WASM build on one M5 Max.
- Verified Azure/Google/Textract pricing and bank-statement prebuilt models.
