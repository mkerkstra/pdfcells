package pricing

import "testing"

func TestCost(t *testing.T) {
	cases := []struct {
		name string
		u    Usage
		want int64
	}{
		// 2,000 in × $0.10/M + 1,000 out × $0.50/M = $0.0002 + $0.0005 = 700 µ$
		{"haiku page", Usage{Model: "claude-haiku-5-5", Input: 2000, Output: 1000}, 700},
		// 3,000 × $4/M + 2,000 × $20/M = 12,000 + 40,000 µ$
		{"opus page", Usage{Model: "claude-opus-5-5", Input: 3000, Output: 2000}, 52_000},
		// 1 token rounds up to 1 µ$ rather than 0
		{"rounds up", Usage{Model: "claude-haiku-5-5", Input: 1}, 1},
		{"dated suffix", Usage{Model: "claude-sonnet-5-5-20260901", Input: 1_000_000}, 2_000_000},
		{"haiku long context", Usage{Model: "claude-haiku-5-5", Input: 200_000}, 100_000},
	}
	for _, tc := range cases {
		got, err := Cost(tc.u)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if got != tc.want {
			t.Errorf("%s: got %d µ$, want %d", tc.name, got, tc.want)
		}
	}
}

func TestUnknownModel(t *testing.T) {
	if _, err := Cost(Usage{Model: "gpt-9", Input: 10}); err == nil {
		t.Fatal("expected error for unknown model")
	}
}

func TestWithMarkup(t *testing.T) {
	if got := WithMarkup(52_000, 1500); got != 59_800 {
		t.Errorf("got %d, want 59800", got)
	}
	if got := WithMarkup(1, 1500); got != 2 {
		t.Errorf("markup on 1 µ$ should round up to 2, got %d", got)
	}
	if got := WithMarkup(0, 1500); got != 0 {
		t.Errorf("zero cost stays zero, got %d", got)
	}
}
