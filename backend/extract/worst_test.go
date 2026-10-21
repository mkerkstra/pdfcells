package extract

import (
	"testing"

	"github.com/mkerkstra/pdfcells/backend/pricing"
)

func TestWorstCostCoversAFallbackHop(t *testing.T) {
	const input = 3_000
	cost := func(model string, in int64) int64 {
		c, err := pricing.Cost(pricing.Usage{Model: model, Input: in, Output: MaxOutputTokens})
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	fast, err := WorstCost(TierFast, input)
	if err != nil || fast != cost("claude-haiku-5-5", input) {
		t.Fatalf("fast: got %d, %v; Haiku has no fallback", fast, err)
	}
	for _, tier := range []Tier{TierAccurate, TierMax} {
		got, err := WorstCost(tier, input)
		if err != nil {
			t.Fatal(err)
		}
		model, _ := ModelFor(tier)
		// The declined attempt plus a full retry on either target.
		for _, m := range fallbackTargets {
			if want := cost(model, input) + cost(m, input+MaxOutputTokens); got < want {
				t.Errorf("%s: hold %d doesn't cover a fallback to %s (%d)", tier, got, m, want)
			}
		}
	}
	if _, err := WorstCost("nope", input); err == nil {
		t.Error("unknown tier priced")
	}
}
