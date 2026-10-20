# Test corpus

Each PDF targets one way real-world documents go wrong. `src/corpus.test.ts` runs every file through the real pdf.js → triage → layout path in Node and checks hand-written expectations. Regenerate (deterministic):

```sh
uv run --with reportlab --with pillow --with pypdfium2 --with numpy python fixtures/make_fixtures.py fixtures
```

| File | What it stresses | Expected route |
|---|---|---|
| `statement.pdf` | 2 pages, repeated header, page footers, large-font title, summary table after a gap | PDF text; joined across pages on export |
| `ruled-wrapped.pdf` | Grid lines, description cells wrapping over 2–3 lines, `(3,000.00)` | PDF text |
| `eu-invoice.pdf` | Key-value block, decimal commas, trailing `€`, `DD.MM.YYYY`, zero-padded IDs, A4 | PDF text, comma locale |
| `financial-report.pdf` | Landscape P&L, spanning header, sections, subtotals, `—`, `n/m`, `%`, footnote marker | PDF text, totals validate |
| `dense-wide.pdf` | 12 columns × 55 rows at 6.5pt, IDs with leading zeros, ISO dates | PDF text |
| `no-header-ids.pdf` | No header row, mixed date formats, trailing-minus negative `8.00-`, monospace | PDF text |
| `mixed-document.pdf` | Prose page, blank page, table page, portrait media box with `/Rotate 90` | skip, skip, text, text |
| `side-by-side.pdf` | Two independent tables on one row of the page | Known limitation: comes out as one table |
| `protected.pdf` | Password `pdfcells` | Password prompt, then PDF text |
| `scanned-invoice.pdf` | Clean 200 dpi scan, 0.8° skew, light noise | AI (OCR without AI access) |
| `scanned-bad.pdf` | 110 dpi fax-grade, 2.5° skew, heavy noise, JPEG q25 | AI |
| `photo-invoice.pdf` | Phone photo: perspective warp, uneven lighting, tint | AI |
| `broken-text-layer.pdf` | Scan with an invisible OCR layer of garbage glyphs | Broken text → AI |
