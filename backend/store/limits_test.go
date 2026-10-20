package store

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestFreePerIPCapSpansAccounts(t *testing.T) {
	s, u := open(t)
	ctx := context.Background()
	q := FreeQuota{PerUser: 25, PerIP: 3, Global: -1, IPHash: "iphash_" + u}
	// Four accounts behind one IP share its three pages.
	var ids []int64
	for i := range 4 {
		id, denied, err := s.ReserveFree(ctx, fmt.Sprintf("%s_%d", u, i), q)
		if err != nil {
			t.Fatal(err)
		}
		want := FreeIPQuota
		if i < 3 {
			want = FreeOK
			ids = append(ids, id)
		}
		if denied != want {
			t.Fatalf("account %d: denied=%q want %q", i, denied, want)
		}
	}
	// A released (failed) page gives its slot back.
	if err := s.Release(ctx, u+"_0", ids[0]); err != nil {
		t.Fatal(err)
	}
	if _, denied, err := s.ReserveFree(ctx, u+"_9", q); err != nil || denied != FreeOK {
		t.Fatalf("after release: denied=%q err=%v", denied, err)
	}
	// PerIP 0 blocks outright.
	if _, denied, _ := s.ReserveFree(ctx, u+"_z", FreeQuota{PerUser: 25, PerIP: 0, Global: -1, IPHash: "other"}); denied != FreeIPQuota {
		t.Fatalf("PerIP=0: denied=%q", denied)
	}
}

func TestFreeGlobalCapAndKillSwitch(t *testing.T) {
	s, u := open(t)
	ctx := context.Background()
	if _, denied, _ := s.ReserveFree(ctx, u, FreeQuota{PerUser: 25, PerIP: -1, Global: 0}); denied != FreeGlobalLimit {
		t.Fatalf("Global=0 must be a kill switch, got %q", denied)
	}
	var today int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM ledger WHERE kind = 'free'
		AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`).Scan(&today); err != nil {
		t.Fatal(err)
	}
	q := FreeQuota{PerUser: 25, PerIP: -1, Global: today + 2}
	var wg sync.WaitGroup
	var mu sync.Mutex
	granted := 0
	for i := range 6 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, denied, err := s.ReserveFree(ctx, fmt.Sprintf("%s_g%d", u, i), q)
			if err != nil {
				t.Error(err)
				return
			}
			switch denied {
			case FreeOK:
				mu.Lock()
				granted++
				mu.Unlock()
			case FreeGlobalLimit:
			default:
				t.Errorf("denied=%q", denied)
			}
		}()
	}
	wg.Wait()
	if granted != 2 {
		t.Fatalf("granted %d free pages with 2 left under the cap; concurrent requests must not overshoot", granted)
	}
}

func TestRateLimiterFixedWindow(t *testing.T) {
	s, u := open(t)
	ctx := context.Background()
	key := "extract:" + u
	for i := range 4 {
		ok, retry, err := s.Allow(ctx, key, 3, time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		if ok != (i < 3) {
			t.Fatalf("hit %d: ok=%v", i, ok)
		}
		if !ok && (retry <= 0 || retry > time.Hour) {
			t.Fatalf("retry-after %v outside the window", retry)
		}
	}
	if ok, _, _ := s.Allow(ctx, "extract:other_"+u, 3, time.Hour); !ok {
		t.Fatal("a separate key must have its own budget")
	}
	if ok, _, _ := s.Allow(ctx, key, 0, time.Hour); !ok {
		t.Fatal("limit 0 must disable the check")
	}
}
