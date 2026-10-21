package pricing

import "testing"

func TestBatchCostIsHalfOfCost(t *testing.T) {
	cases := []struct {
		name string
		u    Usage
		want int64
	}{
		// 2,000 × $0.05/M + 1,000 × $0.25/M = 100 + 250 µ$
		{"haiku page", Usage{Model: "claude-haiku-5-5", Input: 2000, Output: 1000}, 350},
		// 3,000 × $2/M + 2,000 × $10/M = 6,000 + 20,000 µ$
		{"opus page", Usage{Model: "claude-opus-5-5", Input: 3000, Output: 2000}, 26_000},
		// Long-context Haiku halves too: 200,000 × $0.25/M
		{"haiku long context", Usage{Model: "claude-haiku-5-5", Input: 200_000}, 50_000},
		// Cache reads and writes are discounted as well.
		{"cache", Usage{Model: "claude-sonnet-5-5", CacheRead: 1_000_000, CacheWrite: 1_000_000}, 100_000 + 1_250_000},
		// A single token still costs 1 µ$, never 0.
		{"rounds up", Usage{Model: "claude-haiku-5-5", Output: 1}, 1},
	}
	for _, tc := range cases {
		got, err := BatchCost(tc.u)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if got != tc.want {
			t.Errorf("%s: got %d µ$, want %d", tc.name, got, tc.want)
		}
		full, _ := Cost(tc.u)
		if got > full || (full > 1 && got*2 > full+4) {
			t.Errorf("%s: batch %d is not about half of %d", tc.name, got, full)
		}
	}
	if _, err := BatchCost(Usage{Model: "gpt-9", Input: 10}); err == nil {
		t.Fatal("unknown model must be an error, never $0")
	}
}
