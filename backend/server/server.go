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
	"strings"
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

	// Abuse controls (see SECURITY.md). Negative free caps mean unlimited;
	// 0 turns that path off. Rate limits <= 0 are disabled.
	AuthorizedParties []string // allowed Clerk azp origins
	FreePagesPerIP    int      // free pages per caller IP per UTC day
	FreePagesGlobal   int      // free pages across all users per UTC day
	ExtractPerMinute  int      // hosted /api/extract calls per user
	CheckoutPerMinute int      // /api/checkout calls per user
	IPHashSecret      string   // HMAC key for stored IP hashes
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
		AuthorizedParties:   parseList(envOr("CLERK_AUTHORIZED_PARTIES", strings.Join(DefaultAuthorizedParties, ","))),
		FreePagesPerIP:      envInt("FREE_PAGES_PER_IP_PER_DAY", 40),
		FreePagesGlobal:     envInt("FREE_PAGES_GLOBAL_PER_DAY", 2000),
		ExtractPerMinute:    envInt("RATE_EXTRACT_PER_MINUTE", 30),
		CheckoutPerMinute:   envInt("RATE_CHECKOUT_PER_MINUTE", 5),
		// Without a dedicated secret, derive one from the Clerk secret, which
		// every hosted deployment already has and never leaves the server.
		IPHashSecret: envOr("IP_HASH_SECRET", "pdfcells-ip-v1:"+os.Getenv("CLERK_SECRET_KEY")),
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
	r.NotFound(notFound)
	r.MethodNotAllowed(methodNotAllowed)
	auth := func(next http.Handler) http.Handler { return next }
	if s.cfg.ClerkSecretKey != "" {
		auth = clerkhttp.WithHeaderAuthorization(
			clerkhttp.AuthorizedParty(azpAllowed(s.cfg.AuthorizedParties)),
			clerkhttp.AuthorizationFailureHandler(http.HandlerFunc(unauthorized)),
		)
	}
	r.Route("/api", func(r chi.Router) {
		r.NotFound(notFound)
		r.MethodNotAllowed(methodNotAllowed)
		// Model calls get the function's full budget (extract bounds its own
		// call at 280s); everything else should finish in seconds.
		r.With(secure(295*time.Second), requireJSON, auth).Post("/extract", s.extract)
		r.With(secure(130*time.Second), requireJSON, auth).Post("/categorize", s.categorize)
		r.Group(func(r chi.Router) {
			r.Use(secure(60 * time.Second))
			r.Get("/health", s.health)
			r.Get("/config", s.config)
			r.Post("/stripe/webhook", s.stripeWebhook)
			r.Post("/inbound", s.inboundEmail)
			r.With(auth).Get("/me", s.me)
			r.With(requireJSON, auth).Post("/checkout", s.checkout)
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
