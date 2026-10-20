# OCR / table-recognition SOTA for PDFCells (as of 2026-10-20)

Method: web search + model cards. Many leaderboard numbers come from secondary roundups or the model authors' own reports; flagged **[unverified]** where I could not reach a primary source. Prices/leaderboards move monthly, so re-check before committing.

## Bottom line

1. **Browser:** replace tesseract.js with **PP-OCRv5/v6 mobile det+rec via onnxruntime-web**. Keep the existing pdf.js + projection-profile path for born-digital PDFs. Add an **opt-in WebGPU VLM tier** (granite-docling or a TeleOCR/PaddleOCR-VL ONNX port) only after our own eval shows it wins.
2. **Server:** a self-hosted ~1B document VLM (PaddleOCR-VL-1.6, TeleOCR, MinerU2.5-Pro) is plausibly cheaper than Haiku for clean scans. Photos and faxes are unproven. Pilot it behind the checks harness.
3. **Claude** stays the fallback for failed checks, multi-level headers, spanning cells, unusual locales, and "explain/repair" steps.
4. **Build the eval harness first.** Public benchmarks (academic papers) don't resemble bank statements or faxes.

## 1. Table detection / structure recognition

| Model | Reported accuracy | Size | License | In-browser? |
|---|---|---|---|---|
| **Table Transformer (TATR)** v1.1 | Trained on PubTables-1M + FinTabNet.c; the HF card gives no metrics ([card](https://huggingface.co/microsoft/table-transformer-structure-recognition-v1.1-all)). A 2026 third-party paper puts the SOTA on PubTables-1M at GriTS-Top about 99.1 and GriTS-Con about 98.8 ([TableSeq](https://arxiv.org/pdf/2604.16070)). TATR's own paper: [arXiv 2110.00061](https://arxiv.org/pdf/2110.00061). | 28.8M | MIT | Yes, feasible. DETR-style, small, ONNX export is common; Xenova/transformers.js ports exist [unverified]. Needs separate OCR for text. |
| **TableFormer / Docling** | FinTabNet TEDS about 0.96 and PubTables-1M about 0.977 for the OTSL variant ([arXiv 2305.03393](https://arxiv.org/pdf/2305.03393)). Docling's TableFormer license not verified. | not verified | not verified | Unlikely (Python stack). |
| **granite-docling-258M** | FinTabNet TEDS-struct 0.97, with content 0.96 (vs 0.82/0.76 for SmolDocling) ([card](https://huggingface.co/ibm-granite/granite-docling-258M)). Reported on 150dpi clean FinTabNet; not scans. | 258M | Apache-2.0 | **Yes, via WebGPU.** The card lists IBM and community WebGPU Spaces. Expect a few hundred MB download (exact ONNX sizes **unverified**). The card says it is meant for use within Docling. |
| **PP-StructureV3 / SLANet_plus / SLANeXt** | TEDS not found. SLANet_plus has a third-party Rust ONNX port ([ppocr-rs](https://docs.rs/crate/ppocr-rs/0.7.3)). | **unverified** | Apache-2.0 (PaddleOCR repo) | ONNX likely, no browser port found. |
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

**Classic engines:** PP-OCRv6 (June 2026) tiers: 1.5M / 7.7M / 34.5M parameters, Apache-2.0, 50 languages in a single model. The medium tier is +5.1 points recognition over PP-OCRv5_server on PaddleOCR's in-house benchmark, not a public one ([summary](https://aiweekly.co/alerts/paddlepaddles-pp-ocrv6-beats-billion-scale-vlms-at-ocr), [paper](https://tldr.takara.ai/p/2606.13108)). Whether browser ONNX exports of v6 exist is **unverified**; v5 browser packages do: [ppu-paddle-ocr](https://cdn.jsdelivr.net/npm/ppu-paddle-ocr@5.1.1/README.md) (MIT, onnxruntime-web, English default, 40+ language packs; file sizes not stated).

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

**(a) Browser path:** onnxruntime-web (WASM everywhere, WebGPU when available); PP-OCR det+rec tens of MB; fallback to tesseract.js, then Claude. VLM tier requires WebGPU and about 2-3 GB free GPU memory **[estimate, unverified]**.

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

## Gaps to close

- Official PP-StructureV3/SLANeXt TEDS and sizes; Docling TableFormer license; Surya/Chandra current license text.
- Official OmniDocBench v1.6 leaderboard (I relied on secondary roundups).
- Claude vs these on any public benchmark; digit-level accuracy for all.
- PP-OCRv6 browser ONNX availability; ONNX file sizes for granite-docling.
- Verified Azure/Google/Textract pricing and bank-statement prebuilt models.
