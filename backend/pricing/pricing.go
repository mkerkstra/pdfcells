// Package pricing converts Anthropic token usage into micro-dollars (µ$).
//
// All money in PDFCells is int64 micro-dollars: 1 USD = 1_000_000 µ$.
// Rates are µ$ per million tokens, so cost = ceil(tokens × rate / 1e6).
package pricing

import (
	"fmt"
	"strings"
)

// Rate is a model's per-million-token price in µ$.
type Rate struct {
	Input      int64
	Output     int64
	CacheRead  int64
	CacheWrite int64 // 5-minute TTL write
}

const usd = 1_000_000

// Anthropic first-party list prices (cached 2026-10-06).
var rates = map[string]Rate{
	"claude-haiku-5-5":  {Input: usd / 10, Output: usd / 2, CacheRead: usd / 100, CacheWrite: usd / 8},
	"claude-sonnet-5-5": {Input: 2 * usd, Output: 10 * usd, CacheRead: usd / 5, CacheWrite: 5 * usd / 2},
	"claude-sonnet-5":   {Input: 2 * usd, Output: 10 * usd, CacheRead: usd / 5, CacheWrite: 5 * usd / 2},
	"claude-opus-5-5":   {Input: 4 * usd, Output: 20 * usd, CacheRead: usd / 5, CacheWrite: 5 * usd},
	"claude-opus-5":     {Input: 5 * usd, Output: 25 * usd, CacheRead: usd / 2, CacheWrite: 25 * usd / 4},
	"claude-opus-4-8":   {Input: 5 * usd, Output: 25 * usd, CacheRead: usd / 2, CacheWrite: 25 * usd / 4},
	"claude-fable-5-1":  {Input: 10 * usd, Output: 50 * usd, CacheRead: usd / 4, CacheWrite: 25 * usd / 2},
}

// Haiku 5.5 charges a higher rate once the prompt exceeds 100K tokens.
var haikuLongContext = Rate{Input: usd / 2, Output: 5 * usd / 2, CacheRead: usd / 20, CacheWrite: 5 * usd / 8}

// Usage is the token accounting for one model's share of a request.
type Usage struct {
	Model      string
	Input      int64
	Output     int64
	CacheRead  int64
	CacheWrite int64
}

// RateFor returns the rate for model. Unknown models are an error rather than
// a silent guess, so a new fallback model can never be billed at zero.
func RateFor(model string, promptTokens int64) (Rate, error) {
	r, ok := rates[normalize(model)]
	if !ok {
		return Rate{}, fmt.Errorf("pricing: no rate for model %q", model)
	}
	if normalize(model) == "claude-haiku-5-5" && promptTokens > 100_000 {
		return haikuLongContext, nil
	}
	return r, nil
}

// Cost returns the µ$ cost of u, rounded up.
func Cost(u Usage) (int64, error) {
	r, err := RateFor(u.Model, u.Input+u.CacheRead+u.CacheWrite)
	if err != nil {
		return 0, err
	}
	return mul(u.Input, r.Input) + mul(u.Output, r.Output) + mul(u.CacheRead, r.CacheRead) + mul(u.CacheWrite, r.CacheWrite), nil
}

// WithMarkup applies a basis-point markup (1500 = 15%), rounded up.
func WithMarkup(costMicros, markupBps int64) int64 {
	return costMicros + ceilDiv(costMicros*markupBps, 10_000)
}

func mul(tokens, ratePerMTok int64) int64 { return ceilDiv(tokens*ratePerMTok, 1_000_000) }

func ceilDiv(a, b int64) int64 {
	if a <= 0 {
		return 0
	}
	return (a + b - 1) / b
}

// normalize strips platform prefixes and date suffixes a response may carry.
func normalize(model string) string {
	m := strings.TrimPrefix(model, "anthropic.")
	if _, ok := rates[m]; ok {
		return m
	}
	for id := range rates {
		if strings.HasPrefix(m, id+"-") {
			return id
		}
	}
	return m
}
