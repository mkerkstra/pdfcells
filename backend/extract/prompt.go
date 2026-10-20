package extract

import (
	"encoding/json"
	"fmt"
	"strings"
)

const systemPrompt = `You convert pages of PDF documents into spreadsheet tables.

You receive an image of one page. When available you also receive the page's embedded text layer, grouped into lines in reading order. Use the image to understand layout (rows, columns, merged cells, headers) and the text layer to get characters exactly right. If the text layer is marked untrusted, or it disagrees with what is clearly visible, trust the image.

Rules:
- Transcribe values exactly as printed: keep currency symbols, thousands separators, parentheses for negatives, percent signs, footnote markers and leading zeros. Never compute, round, reformat or infer a value that is not on the page.
- Every row of a table has the same number of cells. Use "" for empty cells.
- A cell that spans several columns or rows: put its text in the top-left cell of the span and "" in the others.
- Text that wraps onto several lines inside one cell becomes one cell value joined with a single space.
- header_rows is how many leading rows are column headers (0 if none). Multi-level headers count every level.
- A page can hold several separate tables; return each one. Repeated page headers/footers, page numbers and running titles are not tables.
- Key-value blocks (invoices, forms, statements) become a two-column table of label and value.
- Give every table its own descriptive title, used as its sheet name: e.g. "Invoice details" for a header block and "Line items" for the items, never the same title twice. Use the caption printed above a table when there is one.
- If the page has no tabular or key-value content, return an empty tables array and page_kind "text" or "blank".
- Put anything uncertain (illegible digits, a guessed column boundary, cut-off content) in warnings, naming the table and row.`

func userPrompt(r Request) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Page %d.\n", max(r.PageNumber, 1))
	switch {
	case r.TextLayer == "":
		b.WriteString("This page has no text layer (likely a scan or photo). Read everything from the image.\n")
	case r.TextLayerTrusted:
		b.WriteString("Embedded text layer (trusted):\n<text_layer>\n" + r.TextLayer + "\n</text_layer>\n")
	default:
		b.WriteString("Embedded text layer (UNTRUSTED: it may contain broken font encodings):\n<text_layer>\n" + r.TextLayer + "\n</text_layer>\n")
	}
	if r.Instruction != "" || len(r.Current) > 0 {
		cur, _ := json.Marshal(r.Current)
		b.WriteString("\nThe user already has these tables for this page (possibly from a heuristic extractor, possibly hand-edited):\n<current_tables>\n")
		b.Write(cur)
		b.WriteString("\n</current_tables>\n")
		if r.Instruction != "" {
			b.WriteString("\nThe user asks for this correction. Apply it, keep every other cell that is already correct, and fix any other clear transcription errors you notice against the image:\n<instruction>\n" + r.Instruction + "\n</instruction>\n")
		} else {
			b.WriteString("\nVerify them cell by cell against the image and return corrected tables.\n")
		}
	} else {
		b.WriteString("\nExtract every table on this page.\n")
	}
	return b.String()
}

var outputSchema = map[string]any{
	"type":                 "object",
	"additionalProperties": false,
	"required":             []string{"page_kind", "tables", "warnings"},
	"properties": map[string]any{
		"page_kind": map[string]any{
			"type": "string",
			"enum": []string{"table", "form", "mixed", "text", "blank"},
		},
		"tables": map[string]any{
			"type": "array",
			"items": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"title", "header_rows", "rows", "notes"},
				"properties": map[string]any{
					"title":       map[string]any{"type": "string", "description": "Caption or nearest heading; \"\" if none"},
					"header_rows": map[string]any{"type": "integer"},
					"rows": map[string]any{
						"type":  "array",
						"items": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
					},
					"notes": map[string]any{"type": "string", "description": "Footnotes or units that apply to the table; \"\" if none"},
				},
			},
		},
		"warnings": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
	},
}
