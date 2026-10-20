package store

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"
)

// Requires TEST_DATABASE_URL (a throwaway database); skipped otherwise.
func open(t *testing.T) (*Store, string) {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	s, err := Open(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	return s, fmt.Sprintf("user_%d", time.Now().UnixNano())
}

func TestTopupIsIdempotent(t *testing.T) {
	s, u := open(t)
	ctx := context.Background()
	for range 2 {
		if _, err := s.CreditTopup(ctx, u, "cs_"+u, 5_000_000); err != nil {
			t.Fatal(err)
		}
	}
	a, err := s.Account(ctx, u)
	if err != nil {
		t.Fatal(err)
	}
	if a.BalanceMicros != 5_000_000 {
		t.Fatalf("balance %d, want 5000000 (webhook replay must not double-credit)", a.BalanceMicros)
	}
}

func TestHoldSettleRefundsDifference(t *testing.T) {
	s, u := open(t)
	ctx := context.Background()
	if _, err := s.CreditTopup(ctx, u, "cs_"+u, 1_000_000); err != nil {
		t.Fatal(err)
	}
	id, err := s.ReservePaid(ctx, u, 400_000)
	if err != nil {
		t.Fatal(err)
	}
	bal, err := s.Settle(ctx, u, id, Usage{Model: "claude-opus-5-5", InputTokens: 3000, OutputTokens: 2000, AnthropicCost: 52_000, Charged: 59_800})
	if err != nil {
		t.Fatal(err)
	}
	if bal != 1_000_000-59_800 {
		t.Fatalf("balance %d, want %d", bal, 1_000_000-59_800)
	}
}

func TestConcurrentHoldsCannotOverspend(t *testing.T) {
	s, u := open(t)
	ctx := context.Background()
	if _, err := s.CreditTopup(ctx, u, "cs_"+u, 1_000_000); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	ok, insufficient := 0, 0
	for range 10 {
		wg.Go(func() {
			_, err := s.ReservePaid(ctx, u, 300_000)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				ok++
			case errors.Is(err, ErrInsufficientCredits):
				insufficient++
			default:
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if ok != 3 || insufficient != 7 {
		t.Fatalf("ok=%d insufficient=%d, want 3/7", ok, insufficient)
	}
}

func TestReleaseRestoresBalance(t *testing.T) {
	s, u := open(t)
	ctx := context.Background()
	if _, err := s.CreditTopup(ctx, u, "cs_"+u, 1_000_000); err != nil {
		t.Fatal(err)
	}
	id, err := s.ReservePaid(ctx, u, 250_000)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Release(ctx, u, id); err != nil {
		t.Fatal(err)
	}
	a, _ := s.Account(ctx, u)
	if a.BalanceMicros != 1_000_000 {
		t.Fatalf("balance %d after release", a.BalanceMicros)
	}
}

func TestFreeQuota(t *testing.T) {
	s, u := open(t)
	ctx := context.Background()
	for i := range 3 {
		id, ok, err := s.ReserveFree(ctx, u, 2)
		if err != nil {
			t.Fatal(err)
		}
		if ok != (i < 2) {
			t.Fatalf("reservation %d: ok=%v", i, ok)
		}
		if ok {
			if _, err := s.Settle(ctx, u, id, Usage{Model: "claude-haiku-5-5", AnthropicCost: 700, Charged: 999}); err != nil {
				t.Fatal(err)
			}
		}
	}
	a, _ := s.Account(ctx, u)
	if a.FreeUsedToday != 2 || a.BalanceMicros != 0 {
		t.Fatalf("free=%d balance=%d; free pages must never charge", a.FreeUsedToday, a.BalanceMicros)
	}
}
