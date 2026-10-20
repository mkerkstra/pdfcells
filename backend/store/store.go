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

// ReserveFree claims one page of today's (UTC) free quota. ok is false when
// the quota is used up.
func (s *Store) ReserveFree(ctx context.Context, userID string, perDay int) (id int64, ok bool, err error) {
	err = s.tx(ctx, userID, func(tx pgx.Tx, _ int64) error {
		used, err := freeUsedToday(ctx, tx, userID)
		if err != nil || used >= perDay {
			return err
		}
		ok = true
		return tx.QueryRow(ctx, `INSERT INTO ledger (user_id, kind, amount_micros) VALUES ($1, 'free', 0) RETURNING id`, userID).Scan(&id)
	})
	return id, ok, err
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
func (s *Store) CreditTopup(ctx context.Context, userID, sessionID string, amount int64) (credited bool, err error) {
	err = s.tx(ctx, userID, func(tx pgx.Tx, _ int64) error {
		tag, err := tx.Exec(ctx, `
			INSERT INTO ledger (user_id, kind, amount_micros, stripe_session_id)
			VALUES ($1, 'topup', $2, $3) ON CONFLICT (stripe_session_id) DO NOTHING`, userID, amount, sessionID)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		credited = true
		_, err = tx.Exec(ctx, `UPDATE accounts SET balance_micros = balance_micros + $2 WHERE user_id = $1`, userID, amount)
		return err
	})
	return credited, err
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
