package store

// Credits for pages sent through Anthropic's Message Batches API.
//
// A batch runs for up to 24 hours, so its pages hold credits as 'batch_hold'
// ledger rows, which the 15-minute stale-hold sweep in tx() never touches.
// Every page of a submission is reserved in one transaction against the
// locked account row (free quota first on Fast, exactly like a single page,
// then the worst case at batch rates), so a big batch can never take the
// balance below zero: it either fits whole or is refused whole. When the
// batch ends each page settles to its exact cost, capped at its hold, and
// pages Anthropic didn't bill (errored, expired, canceled) are released.

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// ErrFreePaused means a Fast batch was refused because the balance is
// negative, the same rule that pauses single free pages.
var ErrFreePaused = errors.New("free pages are paused while the balance is negative")

// ErrNoBatch means no batch with that id belongs to the user.
var ErrNoBatch = errors.New("no such batch")

// reservedTTL bounds how long credits stay held for a batch Anthropic never
// accepted (a crash between reserving and submitting).
const reservedTTL = 15 * time.Minute

// BatchPage is one page to reserve.
type BatchPage struct {
	CustomID   string
	PageNumber int
	// TryFree uses the daily free quota first (Fast pages), falling through
	// to credits when a per-user, per-IP or global limit is used up.
	TryFree bool
	// PaidHold is the worst-case µ$ charge (batch rates, markup included).
	PaidHold int64
}

// ReservedPage says how a page will be paid for.
type ReservedPage struct {
	CustomID string
	Source   string // free | credits
	Held     int64
}

// BatchReservation is a submission whose credits are held.
type BatchReservation struct {
	BatchID int64
	Pages   []ReservedPage
	Balance int64
}

// ReserveBatch holds credits for every page of one submission, or for none.
func (s *Store) ReserveBatch(ctx context.Context, userID, tier string, q FreeQuota, pages []BatchPage) (*BatchReservation, error) {
	out := &BatchReservation{}
	err := s.tx(ctx, userID, func(tx pgx.Tx, balance int64) error {
		released, err := releaseReservedTx(ctx, tx, userID, reservedTTL)
		if err != nil {
			return err
		}
		balance += released
		var held int64
		ledgerIDs := make([]int64, len(pages))
		for i, p := range pages {
			rp := ReservedPage{CustomID: p.CustomID, Source: "credits"}
			if p.TryFree {
				id, denied, err := reserveFreeTx(ctx, tx, userID, balance, q)
				if err != nil {
					return err
				}
				if denied == FreeNegativeBalance {
					return ErrFreePaused
				}
				if denied == FreeOK {
					rp.Source, ledgerIDs[i] = "free", id
				}
			}
			if rp.Source == "credits" {
				if p.PaidHold <= 0 || balance < p.PaidHold {
					return ErrInsufficientCredits
				}
				balance -= p.PaidHold
				held += p.PaidHold
				rp.Held = p.PaidHold
				if err := tx.QueryRow(ctx, `INSERT INTO ledger (user_id, kind, amount_micros) VALUES ($1, 'batch_hold', $2) RETURNING id`,
					userID, -p.PaidHold).Scan(&ledgerIDs[i]); err != nil {
					return err
				}
			}
			out.Pages = append(out.Pages, rp)
		}
		if _, err := tx.Exec(ctx, `UPDATE accounts SET balance_micros = balance_micros - $2 + $3 WHERE user_id = $1`, userID, held, released); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `INSERT INTO ai_batches (user_id, tier) VALUES ($1, $2) RETURNING id`, userID, tier).Scan(&out.BatchID); err != nil {
			return err
		}
		for i, p := range pages {
			rp := out.Pages[i]
			if _, err := tx.Exec(ctx, `
				INSERT INTO ai_batch_items (batch_id, custom_id, page_number, source, ledger_id, held_micros)
				VALUES ($1, $2, $3, $4, $5, $6)`, out.BatchID, p.CustomID, p.PageNumber, rp.Source, ledgerIDs[i], rp.Held); err != nil {
				return err
			}
		}
		out.Balance = balance
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// MarkBatchSubmitted records Anthropic's id once it accepted the batch.
func (s *Store) MarkBatchSubmitted(ctx context.Context, userID string, batchID int64, anthropicID string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE ai_batches SET state = 'submitted', anthropic_batch_id = $3
		WHERE id = $1 AND user_id = $2 AND state = 'reserved'`, batchID, userID, anthropicID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNoBatch
	}
	return nil
}

// FailBatch releases every hold of a batch Anthropic never accepted.
func (s *Store) FailBatch(ctx context.Context, userID string, batchID int64) error {
	return s.tx(ctx, userID, func(tx pgx.Tx, _ int64) error {
		released, err := releaseItemsTx(ctx, tx, batchID, "not_submitted")
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE ai_batches SET state = 'failed', settled_at = now() WHERE id = $1 AND user_id = $2`, batchID, userID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE accounts SET balance_micros = balance_micros + $2 WHERE user_id = $1`, userID, released)
		return err
	})
}

// releaseReservedTx fails the user's batches still 'reserved' after ttl and
// returns the credits it gave back. The caller holds the account lock and
// adds the amount to the balance it writes.
func releaseReservedTx(ctx context.Context, tx pgx.Tx, userID string, ttl time.Duration) (int64, error) {
	rows, err := tx.Query(ctx, `
		SELECT id FROM ai_batches
		WHERE user_id = $1 AND state = 'reserved' AND created_at < now() - $2::interval
		FOR UPDATE`, userID, ttl.String())
	if err != nil {
		return 0, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		return 0, err
	}
	var total int64
	for _, id := range ids {
		released, err := releaseItemsTx(ctx, tx, id, "not_submitted")
		if err != nil {
			return 0, err
		}
		total += released
		if _, err := tx.Exec(ctx, `UPDATE ai_batches SET state = 'failed', settled_at = now() WHERE id = $1`, id); err != nil {
			return 0, err
		}
	}
	return total, nil
}

// releaseItemsTx deletes the hold (or free reservation) of every pending
// item of a batch and returns the credits held. It doesn't touch accounts.
func releaseItemsTx(ctx context.Context, tx pgx.Tx, batchID int64, outcome string) (int64, error) {
	var released int64
	err := tx.QueryRow(ctx, `
		WITH items AS (
			UPDATE ai_batch_items SET state = 'released', outcome = $2
			WHERE batch_id = $1 AND state = 'pending'
			RETURNING ledger_id
		), gone AS (
			DELETE FROM ledger WHERE id IN (SELECT ledger_id FROM items) AND kind IN ('batch_hold', 'free')
			RETURNING amount_micros
		)
		SELECT COALESCE(-SUM(amount_micros), 0) FROM gone`, batchID, outcome).Scan(&released)
	return released, err
}

// BatchItemOutcome is how one page of an ended batch turned out. Billed
// pages carry their exact usage; Charged is the credits price before the
// hold cap (ignored for free pages).
type BatchItemOutcome struct {
	Billed  bool
	Outcome string // succeeded | refused | truncated | errored | expired | canceled | ...
	Usage   Usage
}

// SettleSummary reports what a settlement did.
type SettleSummary struct {
	Settled  bool  // false when another request had already settled it
	Charged  int64 // µ$ taken from the balance in total
	Released int   // pages whose hold went back
	// Capped counts pages whose actual price exceeded the hold; they were
	// charged the hold. It should be 0: the hold is the worst case.
	Capped int
	// MissingHold counts billed pages whose hold row was gone; they were not
	// charged. It should be 0.
	MissingHold int
	Balance     int64
}

// SettleBatch charges or releases every pending page of an ended batch in
// one transaction. outcomes is keyed by custom id; a page missing from it is
// released (not charged). Safe to call concurrently and repeatedly: pages
// are row-locked and only 'pending' ones are touched.
func (s *Store) SettleBatch(ctx context.Context, userID, anthropicID string, outcomes map[string]BatchItemOutcome) (SettleSummary, error) {
	var sum SettleSummary
	err := s.tx(ctx, userID, func(tx pgx.Tx, balance int64) error {
		var batchID int64
		var state string
		err := tx.QueryRow(ctx, `SELECT id, state FROM ai_batches WHERE anthropic_batch_id = $1 AND user_id = $2 FOR UPDATE`,
			anthropicID, userID).Scan(&batchID, &state)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNoBatch
		}
		if err != nil {
			return err
		}
		sum.Balance = balance
		if state != "submitted" {
			return nil
		}
		rows, err := tx.Query(ctx, `
			SELECT id, custom_id, source, ledger_id, held_micros FROM ai_batch_items
			WHERE batch_id = $1 AND state = 'pending' ORDER BY id FOR UPDATE`, batchID)
		if err != nil {
			return err
		}
		type item struct {
			id, ledgerID, held int64
			customID, source   string
		}
		items, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (item, error) {
			var it item
			err := r.Scan(&it.id, &it.customID, &it.source, &it.ledgerID, &it.held)
			return it, err
		})
		if err != nil {
			return err
		}
		var delta int64
		for _, it := range items {
			o := outcomes[it.customID]
			if !o.Billed {
				var amount int64
				err := tx.QueryRow(ctx, `DELETE FROM ledger WHERE id = $1 AND user_id = $2 AND kind IN ('batch_hold', 'free') RETURNING amount_micros`,
					it.ledgerID, userID).Scan(&amount)
				if err != nil && !errors.Is(err, pgx.ErrNoRows) {
					return err
				}
				delta -= amount
				outcome := o.Outcome
				if outcome == "" {
					outcome = "missing"
				}
				if _, err := tx.Exec(ctx, `UPDATE ai_batch_items SET state = 'released', outcome = $2 WHERE id = $1`, it.id, outcome); err != nil {
					return err
				}
				sum.Released++
				continue
			}
			u := o.Usage
			charged, kind, holdKind := u.Charged, "usage", "batch_hold"
			if it.source == "free" {
				charged, kind, holdKind = 0, "free", "free"
			} else if charged > it.held {
				charged = it.held
				sum.Capped++
			}
			tag, err := tx.Exec(ctx, `
				UPDATE ledger SET kind = $3, amount_micros = $4, anthropic_cost_micros = $5,
					model = $6, input_tokens = $7, output_tokens = $8
				WHERE id = $1 AND user_id = $2 AND kind = $9`,
				it.ledgerID, userID, kind, -charged, u.AnthropicCost, u.Model, u.InputTokens, u.OutputTokens, holdKind)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				// The hold is gone; never charge without one.
				sum.MissingHold++
				charged = 0
			} else {
				delta += it.held - charged
				sum.Charged += charged
			}
			if _, err := tx.Exec(ctx, `UPDATE ai_batch_items SET state = 'charged', charged_micros = $2, outcome = $3 WHERE id = $1`,
				it.id, charged, o.Outcome); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE accounts SET balance_micros = balance_micros + $2 WHERE user_id = $1`, userID, delta); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE ai_batches SET state = 'settled', settled_at = now() WHERE id = $1`, batchID); err != nil {
			return err
		}
		sum.Settled = true
		sum.Balance = balance + delta
		return nil
	})
	return sum, err
}

// BatchPageView is one page of a batch as the client sees it.
type BatchPageView struct {
	CustomID   string `json:"custom_id"`
	PageNumber int    `json:"page_number"`
	Source     string `json:"source"`
	State      string `json:"state"`
	Charged    int64  `json:"charged_micros"`
	Outcome    string `json:"outcome"`
}

// BatchView is a batch's billing state.
type BatchView struct {
	AnthropicID string          `json:"id"`
	Tier        string          `json:"tier"`
	State       string          `json:"state"`
	CreatedAt   time.Time       `json:"created_at"`
	Pages       []BatchPageView `json:"pages"`
}

// Batch returns the user's batch by Anthropic id.
func (s *Store) Batch(ctx context.Context, userID, anthropicID string) (*BatchView, error) {
	v := &BatchView{AnthropicID: anthropicID}
	var id int64
	err := s.pool.QueryRow(ctx, `SELECT id, tier, state, created_at FROM ai_batches WHERE anthropic_batch_id = $1 AND user_id = $2`,
		anthropicID, userID).Scan(&id, &v.Tier, &v.State, &v.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoBatch
	}
	if err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `
		SELECT custom_id, page_number, source, state, charged_micros, outcome
		FROM ai_batch_items WHERE batch_id = $1 ORDER BY id`, id)
	if err != nil {
		return nil, err
	}
	v.Pages, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (BatchPageView, error) {
		var p BatchPageView
		err := r.Scan(&p.CustomID, &p.PageNumber, &p.Source, &p.State, &p.Charged, &p.Outcome)
		return p, err
	})
	return v, err
}

// UnsettledBatches lists the Anthropic ids of the user's submitted batches
// older than age, oldest first, so they can be settled without the client.
func (s *Store) UnsettledBatches(ctx context.Context, userID string, age time.Duration, limit int) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT anthropic_batch_id FROM ai_batches
		WHERE user_id = $1 AND state = 'submitted' AND created_at < now() - $2::interval
		ORDER BY created_at LIMIT $3`, userID, age.String(), limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// AllowN is Allow counting n hits at once (n pages of a batch submission).
func (s *Store) AllowN(ctx context.Context, key string, n, limit int, window time.Duration) (ok bool, retry time.Duration, err error) {
	if limit <= 0 {
		return true, 0, nil
	}
	if n > limit {
		return false, window, nil
	}
	secs := max(int64(window/time.Second), 1)
	var hits int
	var remaining float64
	err = s.pool.QueryRow(ctx, `
		INSERT INTO rate_limits AS r (key, window_start, hits)
		VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / $2) * $2), $3)
		ON CONFLICT (key, window_start) DO UPDATE SET hits = r.hits + $3
		RETURNING hits, extract(epoch FROM r.window_start + make_interval(secs => $2) - now())::float8`,
		key, secs, n).Scan(&hits, &remaining)
	if err != nil {
		return false, 0, err
	}
	if hits > limit {
		return false, time.Duration(max(remaining, 1) * float64(time.Second)), nil
	}
	return true, 0, nil
}
