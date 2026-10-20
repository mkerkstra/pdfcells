// Package server is the HTTP API, shared by the Vercel function and the
// local dev server.
package server

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/clerk/clerk-sdk-go/v2"
	clerkhttp "github.com/clerk/clerk-sdk-go/v2/http"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/mkerkstra/pdfcells/backend/billing"
	"github.com/mkerkstra/pdfcells/backend/inbound"
	"github.com/mkerkstra/pdfcells/backend/store"
)

// Config is read from the environment. Each hosted feature switches on only
// when everything it needs is present, so a bare deploy still serves the
// local-only and bring-your-own-key paths.
type Config struct {
	AnthropicKey        string
	DatabaseURL         string
	DatabaseURLDirect   string
	ClerkSecretKey      string
	ClerkPublishableKey string
	StripeSecretKey     string
	StripeWebhookSecret string
	StripePriceIDs      string
	ResendAPIKey        string
	ResendWebhookSecret string
	InboundForwardTo    string
	AppURL              string
	MarkupBps           int64
	FreePagesPerDay     int
}

func ConfigFromEnv() Config {
	cfg := configFromEnv()
	// Only production may touch the production ledger. Vercel exposes the Neon
	// integration's DATABASE_URL to Preview and Development too, and a preview
	// that migrates or writes it can take production down. Previews get a
	// database only via PREVIEW_DATABASE_URL (e.g. a Neon branch).
	if env := os.Getenv("VERCEL_ENV"); env != "" && env != "production" {
		cfg.DatabaseURL = os.Getenv("PREVIEW_DATABASE_URL")
		cfg.DatabaseURLDirect = os.Getenv("PREVIEW_DATABASE_URL_UNPOOLED")
	}
	return cfg
}

func configFromEnv() Config {
	return Config{
		AnthropicKey:        os.Getenv("ANTHROPIC_API_KEY"),
		DatabaseURL:         os.Getenv("DATABASE_URL"),
		DatabaseURLDirect:   os.Getenv("DATABASE_URL_UNPOOLED"),
		ClerkSecretKey:      os.Getenv("CLERK_SECRET_KEY"),
		ClerkPublishableKey: envOr("CLERK_PUBLISHABLE_KEY", os.Getenv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")), // the Vercel Clerk integration uses the Next.js name
		StripeSecretKey:     os.Getenv("STRIPE_SECRET_KEY"),
		StripeWebhookSecret: os.Getenv("STRIPE_WEBHOOK_SECRET"),
		StripePriceIDs:      os.Getenv("STRIPE_PRICE_IDS"),
		ResendAPIKey:        os.Getenv("RESEND_API_KEY"),
		ResendWebhookSecret: os.Getenv("RESEND_WEBHOOK_SECRET"),
		InboundForwardTo:    os.Getenv("INBOUND_FORWARD_TO"),
		AppURL:              envOr("APP_URL", "http://localhost:5173"),
		MarkupBps:           int64(envInt("CREDIT_MARKUP_BPS", 1500)),
		FreePagesPerDay:     envInt("FREE_PAGES_PER_DAY", 25),
	}
}

// Hosted reports whether server-paid AI (free quota + credits) is available.
func (c Config) Hosted() bool {
	return c.AnthropicKey != "" && c.DatabaseURL != "" && c.ClerkSecretKey != "" && c.ClerkPublishableKey != ""
}

// Payments reports whether credits can be bought.
func (c Config) Payments() bool {
	return c.Hosted() && c.StripeSecretKey != "" && c.StripeWebhookSecret != ""
}

type Server struct {
	cfg     Config
	log     *slog.Logger
	billing *billing.Billing
	inbound *inbound.Forwarder

	storeMu sync.Mutex
	store   *store.Store
}

func New(cfg Config) *Server {
	s := &Server{cfg: cfg, log: slog.New(slog.NewJSONHandler(os.Stdout, nil))}
	if cfg.ClerkSecretKey != "" {
		clerk.SetKey(cfg.ClerkSecretKey)
	}
	if cfg.Payments() {
		prices, err := billing.ParsePriceIDs(cfg.StripePriceIDs)
		if err != nil {
			// Inline pricing still works; a typo here shouldn't take payments down.
			s.log.Error("ignoring STRIPE_PRICE_IDS", "err", err)
		}
		s.billing = billing.New(cfg.StripeSecretKey, cfg.StripeWebhookSecret, cfg.AppURL, prices)
	}
	if cfg.ResendAPIKey != "" && cfg.ResendWebhookSecret != "" && cfg.InboundForwardTo != "" {
		s.inbound = &inbound.Forwarder{
			APIKey: cfg.ResendAPIKey, WebhookSecret: cfg.ResendWebhookSecret,
			To: cfg.InboundForwardTo, From: "PDFCells support <support@pdfcells.com>",
		}
	}
	return s
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.Recoverer)
	r.Route("/api", func(r chi.Router) {
		r.Get("/health", s.health)
		r.Get("/config", s.config)
		r.Post("/stripe/webhook", s.stripeWebhook)
		r.Post("/inbound", s.inboundEmail)
		r.Group(func(r chi.Router) {
			if s.cfg.ClerkSecretKey != "" {
				r.Use(clerkhttp.WithHeaderAuthorization())
			}
			r.Post("/extract", s.extract)
			r.Get("/me", s.me)
			r.Post("/checkout", s.checkout)
		})
	})
	return r
}

// db lazily connects (and migrates) on first use and retries after failure,
// so a cold start with a briefly unavailable database recovers by itself.
func (s *Server) db(ctx context.Context) (*store.Store, error) {
	s.storeMu.Lock()
	defer s.storeMu.Unlock()
	if s.store != nil {
		return s.store, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	st, err := store.Open(ctx, s.cfg.DatabaseURL, s.cfg.DatabaseURLDirect)
	if err != nil {
		return nil, err
	}
	s.store = st
	return st, nil
}

func userID(r *http.Request) string {
	if c, ok := clerk.SessionClaimsFromContext(r.Context()); ok {
		return c.Subject
	}
	return ""
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"ok": true, "hosted": s.cfg.Hosted(), "payments": s.cfg.Payments()}
	if s.cfg.DatabaseURL != "" {
		st, err := s.db(r.Context())
		if err == nil {
			err = st.Ping(r.Context())
		}
		out["db"] = err == nil
		if err != nil {
			s.log.Error("health db", "err", err)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

type apiError struct {
	Error string `json:"error"`
	Code  string `json:"code"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, apiError{Error: msg, Code: code})
}

func (s *Server) internal(w http.ResponseWriter, r *http.Request, msg string, err error) {
	s.log.Error(msg, "err", err, "path", r.URL.Path, "request_id", middleware.GetReqID(r.Context()))
	writeErr(w, http.StatusInternalServerError, "internal", msg)
}

func decode(w http.ResponseWriter, r *http.Request, limit int64, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeErr(w, http.StatusRequestEntityTooLarge, "too_large", "request body too large")
		} else {
			writeErr(w, http.StatusBadRequest, "bad_json", "invalid JSON body")
		}
		return false
	}
	return true
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	if v, err := strconv.Atoi(os.Getenv(k)); err == nil {
		return v
	}
	return def
}
