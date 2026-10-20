// Package extract turns one rendered PDF page into tables with Claude.
//
// The browser renders each page to a JPEG (bounded size regardless of how the
// PDF was produced) and sends whatever text layer pdf.js found alongside it.
// The image gives layout; the text layer, when trustworthy, gives exact digits.
package extract

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // register decoder for DecodeConfig
	_ "image/png"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"

	"github.com/mkerkstra/pdfcells/backend/pricing"
)

// Tier is a user-facing quality/cost level.
type Tier string

const (
	TierFast     Tier = "fast"
	TierAccurate Tier = "accurate"
	TierMax      Tier = "max"
)

type tierSpec struct {
	Model  string
	Effort anthropic.BetaOutputConfigEffort
	// Server-side refusal fallback is not offered on Haiku.
	Fallback bool
}

var tiers = map[Tier]tierSpec{
	TierFast:     {Model: "claude-haiku-5-5", Effort: anthropic.BetaOutputConfigEffortLow},
	TierAccurate: {Model: "claude-sonnet-5-5", Effort: anthropic.BetaOutputConfigEffortLow, Fallback: true},
	TierMax:      {Model: "claude-opus-5-5", Effort: anthropic.BetaOutputConfigEffortMedium, Fallback: true},
}

// ModelFor returns the model id behind a tier.
func ModelFor(t Tier) (string, bool) {
	s, ok := tiers[t]
	return s.Model, ok
}

// MaxOutputTokens bounds one page's response; dense ledgers can run long.
const MaxOutputTokens = 16_000

// MaxImageBytes keeps the request well inside Vercel's 4.5 MB body limit
// after base64 inflation.
const MaxImageBytes = 3 << 20

// Request is one page to extract (or one table to correct).
type Request struct {
	Tier Tier `json:"tier"`
	// ImageBase64 is a JPEG or PNG render of the page, no data: prefix.
	ImageBase64 string `json:"image_base64"`
	MediaType   string `json:"media_type"`
	// TextLayer is the page's positioned text from pdf.js, already grouped
	// into lines. Empty for scans.
	TextLayer string `json:"text_layer"`
	// TextLayerTrusted is false when the client detected mojibake/CID glyphs.
	TextLayerTrusted bool `json:"text_layer_trusted"`
	PageNumber       int  `json:"page_number"`
	// Correction mode: the user's current tables plus what to change.
	Current     []Table `json:"current,omitempty"`
	Instruction string  `json:"instruction,omitempty"`
}

// Table is one extracted grid. Cells are strings; typing happens client-side
// so the local and AI engines share one number/date parser.
type Table struct {
	Title      string     `json:"title"`
	HeaderRows int        `json:"header_rows"`
	Rows       [][]string `json:"rows"`
	Notes      string     `json:"notes"`
}

// Result is the parsed model output plus exact billing inputs.
type Result struct {
	PageKind string                   `json:"page_kind"`
	Tables   []Table                  `json:"tables"`
	Warnings []string                 `json:"warnings"`
	Model    string                   `json:"model"`
	Usage    []pricing.Usage          `json:"-"`
	Input    int64                    `json:"input_tokens"`
	Output   int64                    `json:"output_tokens"`
	Cost     int64                    `json:"anthropic_cost_micros"`
	Stop     anthropic.BetaStopReason `json:"-"`
}

// ErrRefused means the model declined and no fallback recovered it.
var ErrRefused = errors.New("extract: model refused the page")

// ErrTruncated means the page produced more table text than MaxOutputTokens.
var ErrTruncated = errors.New("extract: output hit the token limit; split the page or use a smaller region")

// Validate checks a request before any money is reserved.
func (r *Request) Validate() error {
	if _, ok := tiers[r.Tier]; !ok {
		return fmt.Errorf("unknown tier %q", r.Tier)
	}
	if r.MediaType == "" {
		r.MediaType = "image/jpeg"
	}
	if r.MediaType != "image/jpeg" && r.MediaType != "image/png" {
		return fmt.Errorf("unsupported media type %q", r.MediaType)
	}
	if base64.StdEncoding.DecodedLen(len(r.ImageBase64)) > MaxImageBytes {
		return fmt.Errorf("page image too large (max %d MB)", MaxImageBytes>>20)
	}
	if len(r.TextLayer) > 200_000 {
		return errors.New("text layer too large")
	}
	if len(r.Instruction) > 4_000 {
		return errors.New("instruction too long")
	}
	return nil
}

// EstimateInputTokens is a conservative pre-flight estimate used to size the
// credit hold. Actual usage from the response is what gets billed.
func (r *Request) EstimateInputTokens() (int64, error) {
	raw, err := base64.StdEncoding.DecodeString(r.ImageBase64)
	if err != nil {
		return 0, fmt.Errorf("image is not valid base64: %w", err)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return 0, fmt.Errorf("image could not be decoded: %w", err)
	}
	// Images cost ≈ w×h/750 tokens; double it to cover any resolution policy.
	imageTokens := int64(cfg.Width*cfg.Height) / 750 * 2
	textTokens := int64(len(r.TextLayer)) / 2
	var current []byte
	if len(r.Current) > 0 {
		current, _ = json.Marshal(r.Current)
	}
	return imageTokens + textTokens + int64(len(current))/2 + int64(len(r.Instruction))/2 + 3_000, nil
}

// Run calls Claude once and returns parsed tables.
func Run(ctx context.Context, apiKey string, req Request) (*Result, error) {
	spec := tiers[req.Tier]
	client := anthropic.NewClient(option.WithAPIKey(apiKey), option.WithMaxRetries(2))

	content := []anthropic.BetaContentBlockParamUnion{
		anthropic.NewBetaImageBlock(anthropic.BetaBase64ImageSourceParam{
			Data:      req.ImageBase64,
			MediaType: anthropic.BetaBase64ImageSourceMediaType(req.MediaType),
		}),
		anthropic.NewBetaTextBlock(userPrompt(req)),
	}

	params := anthropic.BetaMessageNewParams{
		Model:     spec.Model,
		MaxTokens: MaxOutputTokens,
		System:    []anthropic.BetaTextBlockParam{{Text: systemPrompt}},
		Messages:  []anthropic.BetaMessageParam{anthropic.NewBetaUserMessage(content...)},
		OutputConfig: anthropic.BetaOutputConfigParam{
			Effort: spec.Effort,
			Format: anthropic.BetaJSONOutputFormatParam{Schema: outputSchema},
		},
	}
	if spec.Fallback {
		params.Betas = []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_07_01}
		params.Fallbacks = anthropic.BetaFallbacksParamOfDefault()
	}

	msg, err := client.Beta.Messages.New(ctx, params)
	if err != nil {
		return nil, err
	}

	res := &Result{Model: string(msg.Model), Stop: msg.StopReason}
	res.Usage = usageOf(msg)
	for _, u := range res.Usage {
		c, err := pricing.Cost(u)
		if err != nil {
			return nil, err
		}
		res.Cost += c
		res.Input += u.Input + u.CacheRead + u.CacheWrite
		res.Output += u.Output
	}

	switch msg.StopReason {
	case anthropic.BetaStopReasonRefusal:
		return res, ErrRefused
	case anthropic.BetaStopReasonMaxTokens:
		return res, ErrTruncated
	}

	var text strings.Builder
	for _, block := range msg.Content {
		if t, ok := block.AsAny().(anthropic.BetaTextBlock); ok {
			text.WriteString(t.Text)
		}
	}
	var out struct {
		PageKind string   `json:"page_kind"`
		Tables   []Table  `json:"tables"`
		Warnings []string `json:"warnings"`
	}
	if err := json.Unmarshal([]byte(text.String()), &out); err != nil {
		return res, fmt.Errorf("extract: model output was not valid JSON: %w", err)
	}
	res.PageKind, res.Tables, res.Warnings = out.PageKind, normalizeTables(out.Tables), out.Warnings
	return res, nil
}

// usageOf prices each fallback iteration by the model that actually served it.
func usageOf(msg *anthropic.BetaMessage) []pricing.Usage {
	var us []pricing.Usage
	for _, it := range msg.Usage.Iterations {
		if it.InputTokens == 0 && it.OutputTokens == 0 && it.CacheReadInputTokens == 0 {
			continue
		}
		model := string(it.Model)
		if model == "" {
			model = string(msg.Model)
		}
		us = append(us, pricing.Usage{
			Model: model, Input: it.InputTokens, Output: it.OutputTokens,
			CacheRead: it.CacheReadInputTokens, CacheWrite: it.CacheCreationInputTokens,
		})
	}
	if len(us) > 0 {
		return us
	}
	u := msg.Usage
	return []pricing.Usage{{
		Model: string(msg.Model), Input: u.InputTokens, Output: u.OutputTokens,
		CacheRead: u.CacheReadInputTokens, CacheWrite: u.CacheCreationInputTokens,
	}}
}

// normalizeTables pads ragged rows so every table is rectangular and drops
// tables with no content.
func normalizeTables(ts []Table) []Table {
	out := make([]Table, 0, len(ts))
	for _, t := range ts {
		width := 0
		for _, r := range t.Rows {
			width = max(width, len(r))
		}
		if width == 0 {
			continue
		}
		for i, r := range t.Rows {
			for len(r) < width {
				r = append(r, "")
			}
			t.Rows[i] = r
		}
		t.HeaderRows = min(max(t.HeaderRows, 0), len(t.Rows))
		out = append(out, t)
	}
	return out
}
