// Package store is the Postgres-backed credits ledger.
//
// Every balance change is a ledger row written in the same transaction as the
// accounts.balance_micros update, with the account row locked. Paid pages
// reserve a hold sized to the worst-case cost before calling the model, then
// settle to the exact cost, so concurrent requests can never overspend.
package store

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"net/url"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5" // pgx5:// driver
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mkerkstra/pdfcells/migrations"
)

// ErrInsufficientCredits means the balance can't cover the hold.
var ErrInsufficientCredits = errors.New("insufficient credits")

// holdTTL bounds how long a crashed request can keep credits locked.
const holdTTL = 15 * time.Minute

type Store struct{ pool *pgxpool.Pool }

// Open applies pending migrations over migrateURL, then pools databaseURL.
// Migrations take a session advisory lock, which a transaction-mode pooler
// (Neon's default DATABASE_URL) can't hold, so pass the direct URL there.
func Open(ctx context.Context, databaseURL, migrateURL string) (*Store, error) {
	if migrateURL == "" {
		migrateURL = databaseURL
	}
	if err := migrateUp(migrateURL); err != nil {
		return nil, err
	}
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}
	// Serverless instances are short-lived; keep the pool small.
	cfg.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	return &Store{pool: pool}, nil
}

func migrateUp(databaseURL string) error {
	src, err := iofs.New(migrations.FS, ".")
	if err != nil {
		return err
	}
	u, err := url.Parse(databaseURL)
	if err != nil {
		return fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	u.Scheme = "pgx5"
	m, err := migrate.NewWithSourceInstance("iofs", src, u.String())
	if err != nil {
		return fmt.Errorf("migrate init: %w", err)
	}
	defer func() { _, _ = m.Close() }()
	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrate up: %w", err)
	}
	return nil
}

// tx runs fn with the user's account row created if needed and locked.
func (s *Store) tx(ctx context.Context, userID string, fn func(pgx.Tx, int64) error) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO accounts (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, userID); err != nil {
			return err
		}
		var balance int64
		if err := tx.QueryRow(ctx, `SELECT balance_micros FROM accounts WHERE user_id = $1 FOR UPDATE`, userID).Scan(&balance); err != nil {
			return err
		}
		released, err := releaseStale(ctx, tx, userID)
		if err != nil {
			return err
		}
		return fn(tx, balance+released)
	})
}

func releaseStale(ctx context.Context, tx pgx.Tx, userID string) (int64, error) {
	var released int64
	err := tx.QueryRow(ctx, `
		WITH gone AS (
			DELETE FROM ledger
			WHERE user_id = $1 AND kind = 'hold' AND created_at < now() - $2::interval
			RETURNING amount_micros
		)
		SELECT COALESCE(-SUM(amount_micros), 0) FROM gone`, userID, holdTTL.String()).Scan(&released)
	if err != nil || released == 0 {
		return 0, err
	}
	_, err = tx.Exec(ctx, `UPDATE accounts SET balance_micros = balance_micros + $2 WHERE user_id = $1`, userID, released)
	return released, err
}

// FreeQuota bounds free pages per UTC day. A negative PerIP or Global means
// unlimited; Global 0 is the kill switch that stops all free pages.
type FreeQuota struct {
	PerUser int
	PerIP   int
	Global  int
	IPHash  string // HMAC of the caller's IP; never the raw address
}

// FreeDenied says which free-page limit refused a reservation.
type FreeDenied string

const (
	FreeOK          FreeDenied = ""
	FreeUserQuota   FreeDenied = "user_quota"
	FreeIPQuota     FreeDenied = "ip_quota"
	FreeGlobalLimit FreeDenied = "global_cap"
	// A negative balance (spent credits later refunded or charged back) pauses
	// free pages until the account is settled.
	FreeNegativeBalance FreeDenied = "negative_balance"
)

// ReserveFree claims one page of today's (UTC) free quota. denied is set,
// and id is 0, when any of the per-user, per-IP or global limits is used up.
// Per-IP and global counts are serialized with transaction advisory locks so
// concurrent requests from many accounts can't overshoot them.
func (s *Store) ReserveFree(ctx context.Context, userID string, q FreeQuota) (id int64, denied FreeDenied, err error) {
	err = s.tx(ctx, userID, func(tx pgx.Tx, balance int64) error {
		id, denied, err = reserveFreeTx(ctx, tx, userID, balance, q)
		return err
	})
	if err != nil {
		return 0, FreeOK, err
	}
	return id, denied, nil
}

// reserveFreeTx is ReserveFree inside a transaction that already holds the
// account lock (batches reserve many pages in one transaction).
func reserveFreeTx(ctx context.Context, tx pgx.Tx, userID string, balance int64, q FreeQuota) (id int64, denied FreeDenied, err error) {
	if balance < 0 {
		return 0, FreeNegativeBalance, nil
	}
	used, err := freeUsedToday(ctx, tx, userID)
	if err != nil {
		return 0, FreeOK, err
	}
	if used >= q.PerUser {
		return 0, FreeUserQuota, nil
	}
	if q.PerIP >= 0 {
		if q.PerIP == 0 {
			return 0, FreeIPQuota, nil
		}
		n, err := countFreeToday(ctx, tx, "free-ip:"+q.IPHash, `AND ip_hash = $1`, q.IPHash)
		if err != nil {
			return 0, FreeOK, err
		}
		if n >= q.PerIP {
			return 0, FreeIPQuota, nil
		}
	}
	if q.Global >= 0 {
		if q.Global == 0 {
			return 0, FreeGlobalLimit, nil
		}
		n, err := countFreeToday(ctx, tx, "free-global", ``)
		if err != nil {
			return 0, FreeOK, err
		}
		if n >= q.Global {
			return 0, FreeGlobalLimit, nil
		}
	}
	err = tx.QueryRow(ctx, `INSERT INTO ledger (user_id, kind, amount_micros, ip_hash) VALUES ($1, 'free', 0, NULLIF($2, '')) RETURNING id`,
		userID, q.IPHash).Scan(&id)
	return id, FreeOK, err
}

// countFreeToday takes a transaction advisory lock named lock, then counts
// today's free ledger rows matching the extra filter.
func countFreeToday(ctx context.Context, tx pgx.Tx, lock, filter string, args ...any) (int, error) {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, lock); err != nil {
		return 0, err
	}
	var n int
	q := `SELECT count(*) FROM ledger WHERE kind = 'free' ` + filter + `
		AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`
	err := tx.QueryRow(ctx, q, args...).Scan(&n)
	return n, err
}

// Allow counts one hit against key in a fixed window and reports whether it
// is within limit. When it isn't, retry is how long until the window resets.
// A limit <= 0 disables the check.
func (s *Store) Allow(ctx context.Context, key string, limit int, window time.Duration) (ok bool, retry time.Duration, err error) {
	if limit <= 0 {
		return true, 0, nil
	}
	secs := int64(window / time.Second)
	if secs < 1 {
		secs = 1
	}
	var hits int
	var remaining float64
	err = s.pool.QueryRow(ctx, `
		INSERT INTO rate_limits AS r (key, window_start)
		VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / $2) * $2))
		ON CONFLICT (key, window_start) DO UPDATE SET hits = r.hits + 1
		RETURNING hits, extract(epoch FROM r.window_start + make_interval(secs => $2) - now())::float8`,
		key, secs).Scan(&hits, &remaining)
	if err != nil {
		return false, 0, err
	}
	// Prune expired windows now and then; one statement, no extra round trip
	// on the hot path most of the time.
	if hits == 1 && rand.IntN(50) == 0 {
		_, _ = s.pool.Exec(ctx, `DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`)
	}
	if hits > limit {
		return false, time.Duration(max(remaining, 1) * float64(time.Second)), nil
	}
	return true, 0, nil
}

// ReservePaid places a hold of amount µ$ against the balance.
func (s *Store) ReservePaid(ctx context.Context, userID string, amount int64) (id int64, err error) {
	err = s.tx(ctx, userID, func(tx pgx.Tx, balance int64) error {
		if balance < amount {
			return ErrInsufficientCredits
		}
		if _, err := tx.Exec(ctx, `UPDATE accounts SET balance_micros = balance_micros - $2 WHERE user_id = $1`, userID, amount); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `INSERT INTO ledger (user_id, kind, amount_micros) VALUES ($1, 'hold', $2) RETURNING id`, userID, -amount).Scan(&id)
	})
	return id, err
}

// Usage is what a settled page cost.
type Usage struct {
	Model         string
	InputTokens   int64
	OutputTokens  int64
	AnthropicCost int64
	Charged       int64 // 0 for free pages
}

// Settle converts a hold (or free reservation) into its final ledger row and
// refunds the difference between the hold and the actual charge. It returns
// the new balance.
func (s *Store) Settle(ctx context.Context, userID string, id int64, u Usage) (balance int64, err error) {
	err = s.tx(ctx, userID, func(tx pgx.Tx, current int64) error {
		var kind string
		var held int64
		if err := tx.QueryRow(ctx, `SELECT kind, -amount_micros FROM ledger WHERE id = $1 AND user_id = $2`, id, userID).Scan(&kind, &held); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// The hold expired and was released; charge directly.
				kind, held = "hold", 0
				if err := tx.QueryRow(ctx, `INSERT INTO ledger (user_id, kind, amount_micros) VALUES ($1, 'hold', 0) RETURNING id`, userID).Scan(&id); err != nil {
					return err
				}
			} else {
				return err
			}
		}
		final := "usage"
		if kind == "free" {
			final, u.Charged = "free", 0
		}
		if _, err := tx.Exec(ctx, `
			UPDATE ledger SET kind = $2, amount_micros = $3, anthropic_cost_micros = $4,
				model = $5, input_tokens = $6, output_tokens = $7
			WHERE id = $1`, id, final, -u.Charged, u.AnthropicCost, u.Model, u.InputTokens, u.OutputTokens); err != nil {
			return err
		}
		balance = current + held - u.Charged
		_, err := tx.Exec(ctx, `UPDATE accounts SET balance_micros = $2 WHERE user_id = $1`, userID, balance)
		return err
	})
	return balance, err
}

// Release cancels a hold or free reservation after a failed request.
func (s *Store) Release(ctx context.Context, userID string, id int64) error {
	return s.tx(ctx, userID, func(tx pgx.Tx, _ int64) error {
		var amount int64
		err := tx.QueryRow(ctx, `DELETE FROM ledger WHERE id = $1 AND user_id = $2 AND kind IN ('hold', 'free') RETURNING amount_micros`, id, userID).Scan(&amount)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE accounts SET balance_micros = balance_micros - $2 WHERE user_id = $1`, userID, amount)
		return err
	})
}

// CreditTopup records a paid Checkout session exactly once.
func (s *Store) CreditTopup(ctx context.Context, userID, sessionID, paymentIntent string, amount int64) (credited bool, err error) {
	err = s.tx(ctx, userID, func(tx pgx.Tx, _ int64) error {
		tag, err := tx.Exec(ctx, `
			INSERT INTO ledger (user_id, kind, amount_micros, stripe_session_id, stripe_payment_intent)
			VALUES ($1, 'topup', $2, $3, NULLIF($4, '')) ON CONFLICT (stripe_session_id) DO NOTHING`, userID, amount, sessionID, paymentIntent)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		credited = true
		_, err = tx.Exec(ctx, `UPDATE accounts SET balance_micros = balance_micros + $2 WHERE user_id = $1`, userID, amount)
		return err
	})
	return credited, err
}

// ReverseTopup takes back the share of a top-up that Stripe has refunded.
// refunded/total is the cumulative refunded fraction of the charge, so
// replayed or incremental refund events converge on the same result. The
// balance may go negative if the credits were already spent; that blocks
// further paid pages until the next top-up.
func (s *Store) ReverseTopup(ctx context.Context, paymentIntent string, refunded, total int64) (reversed int64, err error) {
	if total <= 0 || paymentIntent == "" {
		return 0, nil
	}
	var userID string
	var credited int64
	err = s.pool.QueryRow(ctx, `SELECT user_id, amount_micros FROM ledger WHERE kind = 'topup' AND stripe_payment_intent = $1`, paymentIntent).Scan(&userID, &credited)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	err = s.tx(ctx, userID, func(tx pgx.Tx, _ int64) error {
		var already int64
		if err := tx.QueryRow(ctx, `SELECT COALESCE(-SUM(amount_micros), 0) FROM ledger WHERE kind = 'refund' AND stripe_payment_intent = $1`, paymentIntent).Scan(&already); err != nil {
			return err
		}
		target := credited * min(refunded, total) / total
		reversed = target - already
		if reversed <= 0 {
			reversed = 0
			return nil
		}
		if _, err := tx.Exec(ctx, `INSERT INTO ledger (user_id, kind, amount_micros, stripe_payment_intent) VALUES ($1, 'refund', $2, $3)`, userID, -reversed, paymentIntent); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE accounts SET balance_micros = balance_micros - $2 WHERE user_id = $1`, userID, reversed)
		return err
	})
	return reversed, err
}

// Entry is one ledger row for display.
type Entry struct {
	Kind          string    `json:"kind"`
	AmountMicros  int64     `json:"amount_micros"`
	AnthropicCost int64     `json:"anthropic_cost_micros"`
	Model         string    `json:"model"`
	InputTokens   int64     `json:"input_tokens"`
	OutputTokens  int64     `json:"output_tokens"`
	CreatedAt     time.Time `json:"created_at"`
}

// Account is a user's balance, quota use and recent history.
type Account struct {
	BalanceMicros int64   `json:"balance_micros"`
	FreeUsedToday int     `json:"free_used_today"`
	Recent        []Entry `json:"recent"`
}

func (s *Store) Account(ctx context.Context, userID string) (*Account, error) {
	a := &Account{Recent: []Entry{}}
	err := s.tx(ctx, userID, func(tx pgx.Tx, balance int64) error {
		a.BalanceMicros = balance
		used, err := freeUsedToday(ctx, tx, userID)
		if err != nil {
			return err
		}
		a.FreeUsedToday = used
		rows, err := tx.Query(ctx, `
			SELECT kind, amount_micros, anthropic_cost_micros, model, input_tokens, output_tokens, created_at
			FROM ledger WHERE user_id = $1 AND kind <> 'hold' ORDER BY created_at DESC LIMIT 25`, userID)
		if err != nil {
			return err
		}
		a.Recent, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Entry, error) {
			var e Entry
			err := r.Scan(&e.Kind, &e.AmountMicros, &e.AnthropicCost, &e.Model, &e.InputTokens, &e.OutputTokens, &e.CreatedAt)
			return e, err
		})
		return err
	})
	return a, err
}

func freeUsedToday(ctx context.Context, tx pgx.Tx, userID string) (int, error) {
	var n int
	err := tx.QueryRow(ctx, `
		SELECT count(*) FROM ledger
		WHERE user_id = $1 AND kind = 'free' AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
		userID).Scan(&n)
	return n, err
}

// Ping reports database reachability for /api/health.
func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}
