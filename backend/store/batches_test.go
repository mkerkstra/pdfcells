package store

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

var noFree = FreeQuota{PerUser: 0, PerIP: -1, Global: -1}

func funded(t *testing.T, micros int64) (*Store, string) {
	t.Helper()
	s, u := open(t)
	if micros > 0 {
		if _, err := s.CreditTopup(context.Background(), u, "cs_"+u, "pi_"+u, micros); err != nil {
			t.Fatal(err)
		}
	}
	return s, u
}

func balanceOf(t *testing.T, s *Store, u string) int64 {
	t.Helper()
	a, err := s.Account(context.Background(), u)
	if err != nil {
		t.Fatal(err)
	}
	return a.BalanceMicros
}

func paidPages(n int, hold int64) []BatchPage {
	ps := make([]BatchPage, n)
	for i := range ps {
		ps[i] = BatchPage{CustomID: fmt.Sprintf("p%d", i), PageNumber: i + 1, PaidHold: hold}
	}
	return ps
}

// submitted reserves pages and marks the batch accepted under a fresh id.
func submitted(t *testing.T, s *Store, u string, q FreeQuota, pages []BatchPage) (string, *BatchReservation) {
	t.Helper()
	ctx := context.Background()
	r, err := s.ReserveBatch(ctx, u, "fast", q, pages)
	if err != nil {
		t.Fatal(err)
	}
	id := fmt.Sprintf("msgbatch_%s_%d", u, r.BatchID)
	if err := s.MarkBatchSubmitted(ctx, u, r.BatchID, id); err != nil {
		t.Fatal(err)
	}
	return id, r
}

func ledgerKinds(t *testing.T, s *Store, u string) map[string]int {
	t.Helper()
	rows, err := s.pool.Query(context.Background(), `SELECT kind, count(*) FROM ledger WHERE user_id = $1 GROUP BY kind`, u)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var k string
		var n int
		if err := rows.Scan(&k, &n); err != nil {
			t.Fatal(err)
		}
		out[k] = n
	}
	return out
}

// A batch hold lasts as long as the batch (up to 24 h); the 15-minute sweep
// of crashed single-page holds must leave it alone.
func TestBatchHoldSurvivesStaleHoldSweep(t *testing.T) {
	s, u := funded(t, 1_000_000)
	ctx := context.Background()
	if _, err := s.ReservePaid(ctx, u, 100_000); err != nil {
		t.Fatal(err)
	}
	submitted(t, s, u, noFree, paidPages(1, 200_000))
	if _, err := s.pool.Exec(ctx, `UPDATE ledger SET created_at = now() - interval '16 minutes' WHERE user_id = $1 AND kind IN ('hold', 'batch_hold')`, u); err != nil {
		t.Fatal(err)
	}
	if got := balanceOf(t, s, u); got != 800_000 {
		t.Fatalf("balance %d, want 800000 (single hold released, batch hold kept)", got)
	}
	if k := ledgerKinds(t, s, u); k["hold"] != 0 || k["batch_hold"] != 1 {
		t.Fatalf("ledger kinds %v", k)
	}
}

func TestBatchReservesAllOrNothing(t *testing.T) {
	s, u := funded(t, 250_000)
	ctx := context.Background()
	if _, err := s.ReserveBatch(ctx, u, "accurate", noFree, paidPages(3, 100_000)); !errors.Is(err, ErrInsufficientCredits) {
		t.Fatalf("3 × 100000 against 250000: err=%v", err)
	}
	if got := balanceOf(t, s, u); got != 250_000 {
		t.Fatalf("a refused batch must hold nothing; balance %d", got)
	}
	if k := ledgerKinds(t, s, u); k["batch_hold"] != 0 {
		t.Fatalf("refused batch left holds: %v", k)
	}
	r, err := s.ReserveBatch(ctx, u, "accurate", noFree, paidPages(2, 100_000))
	if err != nil || r.Balance != 50_000 || len(r.Pages) != 2 || r.Pages[0].Source != "credits" {
		t.Fatalf("2 pages: %+v %v", r, err)
	}
}

func TestConcurrentBatchesCannotOverspend(t *testing.T) {
	s, u := funded(t, 1_000_000)
	ctx := context.Background()
	var wg sync.WaitGroup
	var mu sync.Mutex
	ok := 0
	for range 10 {
		wg.Go(func() {
			_, err := s.ReserveBatch(ctx, u, "max", noFree, paidPages(3, 100_000))
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				ok++
			case !errors.Is(err, ErrInsufficientCredits):
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if ok != 3 {
		t.Fatalf("%d batches of 300000 fit in 1000000, want 3", ok)
	}
	if got := balanceOf(t, s, u); got != 100_000 {
		t.Fatalf("balance %d, want 100000", got)
	}
}

func TestBatchPartialFailureChargesOnlyBilledPages(t *testing.T) {
	s, u := funded(t, 1_000_000)
	ctx := context.Background()
	id, _ := submitted(t, s, u, noFree, paidPages(4, 100_000))
	if got := balanceOf(t, s, u); got != 600_000 {
		t.Fatalf("held balance %d", got)
	}
	sum, err := s.SettleBatch(ctx, u, id, map[string]BatchItemOutcome{
		"p0": {Billed: true, Outcome: "succeeded", Usage: Usage{Model: "claude-haiku-5-5", InputTokens: 4000, OutputTokens: 900, AnthropicCost: 26_000, Charged: 30_000}},
		"p1": {Billed: true, Outcome: "refused", Usage: Usage{Model: "claude-haiku-5-5", InputTokens: 4000, AnthropicCost: 4_000, Charged: 5_000}},
		"p2": {Outcome: "errored"},
		"p3": {Outcome: "expired"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !sum.Settled || sum.Charged != 35_000 || sum.Released != 2 || sum.Capped != 0 || sum.Balance != 965_000 {
		t.Fatalf("summary %+v", sum)
	}
	if got := balanceOf(t, s, u); got != 965_000 {
		t.Fatalf("balance %d, want 965000", got)
	}
	if k := ledgerKinds(t, s, u); k["usage"] != 2 || k["batch_hold"] != 0 {
		t.Fatalf("ledger kinds %v", k)
	}
	v, err := s.Batch(ctx, u, id)
	if err != nil || v.State != "settled" || v.Pages[2].State != "released" || v.Pages[0].Charged != 30_000 {
		t.Fatalf("view %+v %v", v, err)
	}
}

func TestExpiredBatchReleasesEverything(t *testing.T) {
	s, u := funded(t, 500_000)
	ctx := context.Background()
	id, _ := submitted(t, s, u, noFree, paidPages(5, 90_000))
	// An ended batch whose results can no longer be read settles as nothing billed.
	sum, err := s.SettleBatch(ctx, u, id, nil)
	if err != nil || sum.Released != 5 || sum.Charged != 0 {
		t.Fatalf("%+v %v", sum, err)
	}
	if got := balanceOf(t, s, u); got != 500_000 {
		t.Fatalf("balance %d, want everything back", got)
	}
}

// Two tabs polling the same ended batch settle it exactly once.
func TestConcurrentSettleChargesOnce(t *testing.T) {
	s, u := funded(t, 1_000_000)
	ctx := context.Background()
	id, _ := submitted(t, s, u, noFree, paidPages(3, 100_000))
	outcomes := map[string]BatchItemOutcome{}
	for i := range 3 {
		outcomes[fmt.Sprintf("p%d", i)] = BatchItemOutcome{Billed: true, Outcome: "succeeded", Usage: Usage{Model: "claude-haiku-5-5", AnthropicCost: 8_000, Charged: 10_000}}
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	settled := 0
	for range 4 {
		wg.Go(func() {
			sum, err := s.SettleBatch(ctx, u, id, outcomes)
			if err != nil {
				t.Error(err)
				return
			}
			mu.Lock()
			defer mu.Unlock()
			if sum.Settled {
				settled++
			}
		})
	}
	wg.Wait()
	if settled != 1 {
		t.Fatalf("settled %d times", settled)
	}
	if got := balanceOf(t, s, u); got != 970_000 {
		t.Fatalf("balance %d, want 970000", got)
	}
}

func TestSettleNeverChargesMoreThanTheHold(t *testing.T) {
	s, u := funded(t, 100_000)
	ctx := context.Background()
	id, _ := submitted(t, s, u, noFree, paidPages(1, 100_000))
	sum, err := s.SettleBatch(ctx, u, id, map[string]BatchItemOutcome{
		"p0": {Billed: true, Outcome: "succeeded", Usage: Usage{Model: "claude-opus-5-5", AnthropicCost: 140_000, Charged: 161_000}},
	})
	if err != nil || sum.Capped != 1 || sum.Charged != 100_000 {
		t.Fatalf("%+v %v", sum, err)
	}
	if got := balanceOf(t, s, u); got != 0 {
		t.Fatalf("balance %d: a batch must never take it below zero", got)
	}
}

func TestBatchFreeQuotaAndNegativeBalance(t *testing.T) {
	s, u := funded(t, 10_000)
	ctx := context.Background()
	q := FreeQuota{PerUser: 2, PerIP: -1, Global: -1, IPHash: "ip_" + u}
	pages := paidPages(3, 4_000)
	for i := range pages {
		pages[i].TryFree = true
	}
	id, r := submitted(t, s, u, q, pages)
	if r.Pages[0].Source != "free" || r.Pages[1].Source != "free" || r.Pages[2].Source != "credits" || r.Balance != 6_000 {
		t.Fatalf("two free, then credits: %+v", r)
	}
	// A free page that errored gives its quota slot back; one that was read stays free.
	_, err := s.SettleBatch(ctx, u, id, map[string]BatchItemOutcome{
		"p0": {Billed: true, Outcome: "succeeded", Usage: Usage{Model: "claude-haiku-5-5", AnthropicCost: 300, Charged: 345}},
		"p1": {Outcome: "errored"},
		"p2": {Billed: true, Outcome: "succeeded", Usage: Usage{Model: "claude-haiku-5-5", AnthropicCost: 300, Charged: 345}},
	})
	if err != nil {
		t.Fatal(err)
	}
	a, _ := s.Account(ctx, u)
	if a.FreeUsedToday != 1 || a.BalanceMicros != 10_000-345 {
		t.Fatalf("free used %d balance %d", a.FreeUsedToday, a.BalanceMicros)
	}
	// A negative balance pauses free pages for batches too.
	if _, err := s.pool.Exec(ctx, `UPDATE accounts SET balance_micros = -1 WHERE user_id = $1`, u); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReserveBatch(ctx, u, "fast", q, pages[:1]); !errors.Is(err, ErrFreePaused) {
		t.Fatalf("negative balance: %v", err)
	}
}

func TestUnsubmittedBatchIsReleased(t *testing.T) {
	s, u := funded(t, 300_000)
	ctx := context.Background()
	r, err := s.ReserveBatch(ctx, u, "accurate", noFree, paidPages(2, 100_000))
	if err != nil {
		t.Fatal(err)
	}
	// Anthropic refused it: everything goes back at once.
	if err := s.FailBatch(ctx, u, r.BatchID); err != nil {
		t.Fatal(err)
	}
	if got := balanceOf(t, s, u); got != 300_000 {
		t.Fatalf("after fail %d", got)
	}
	// A crash between reserving and submitting: released after reservedTTL.
	if _, err = s.ReserveBatch(ctx, u, "accurate", noFree, paidPages(2, 100_000)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE ai_batches SET created_at = now() - interval '16 minutes' WHERE user_id = $1 AND state = 'reserved'`, u); err != nil {
		t.Fatal(err)
	}
	r3, err := s.ReserveBatch(ctx, u, "accurate", noFree, paidPages(3, 100_000))
	if err != nil || r3.Balance != 0 {
		t.Fatalf("stale reservation not released before the next batch: %+v %v", r3, err)
	}
	if err := s.MarkBatchSubmitted(ctx, u, r.BatchID, "msgbatch_late_"+u); !errors.Is(err, ErrNoBatch) {
		t.Fatalf("a failed batch can't be marked submitted: %v", err)
	}
}

func TestUnsettledBatchesAndAllowN(t *testing.T) {
	s, u := funded(t, 300_000)
	ctx := context.Background()
	id, _ := submitted(t, s, u, noFree, paidPages(1, 100_000))
	if ids, err := s.UnsettledBatches(ctx, u, time.Hour, 5); err != nil || len(ids) != 0 {
		t.Fatalf("young batch listed: %v %v", ids, err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE ai_batches SET created_at = now() - interval '2 hours' WHERE user_id = $1`, u); err != nil {
		t.Fatal(err)
	}
	if ids, err := s.UnsettledBatches(ctx, u, time.Hour, 5); err != nil || len(ids) != 1 || ids[0] != id {
		t.Fatalf("unsettled %v %v", ids, err)
	}
	key := "batch-test:" + u
	if ok, _, err := s.AllowN(ctx, key, 20, 30, time.Minute); !ok || err != nil {
		t.Fatal("20 of 30", err)
	}
	if ok, retry, err := s.AllowN(ctx, key, 20, 30, time.Minute); ok || retry <= 0 || err != nil {
		t.Fatalf("40 of 30 allowed (retry %v, err %v)", retry, err)
	}
}
