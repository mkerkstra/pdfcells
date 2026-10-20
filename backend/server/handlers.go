package server

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/mkerkstra/pdfcells/backend/billing"
	"github.com/mkerkstra/pdfcells/backend/extract"
	"github.com/mkerkstra/pdfcells/backend/inbound"
	"github.com/mkerkstra/pdfcells/backend/pricing"
	"github.com/mkerkstra/pdfcells/backend/store"
)

type tierInfo struct {
	ID          extract.Tier `json:"id"`
	Model       string       `json:"model"`
	InputPrice  int64        `json:"input_micros_per_mtok"`
	OutputPrice int64        `json:"output_micros_per_mtok"`
}

func (s *Server) config(w http.ResponseWriter, _ *http.Request) {
	var ts []tierInfo
	for _, t := range []extract.Tier{extract.TierFast, extract.TierAccurate, extract.TierMax} {
		model, _ := extract.ModelFor(t)
		rate, _ := pricing.RateFor(model, 0)
		ts = append(ts, tierInfo{ID: t, Model: model, InputPrice: rate.Input, OutputPrice: rate.Output})
	}
	out := map[string]any{
		"hosted":             s.cfg.Hosted(),
		"payments":           s.cfg.Payments(),
		"markup_bps":         s.cfg.MarkupBps,
		"free_pages_per_day": s.cfg.FreePagesPerDay,
		"topup_amounts":      billing.TopupAmountsCents,
		"tiers":              ts,
		"max_output_tokens":  extract.MaxOutputTokens,
	}
	if s.cfg.Hosted() {
		out["clerk_publishable_key"] = s.cfg.ClerkPublishableKey
	}
	writeJSON(w, http.StatusOK, out)
}

type extractResponse struct {
	*extract.Result
	Source        string `json:"source"` // byok | free | credits
	ChargedMicros int64  `json:"charged_micros"`
	BalanceMicros *int64 `json:"balance_micros,omitempty"`
}

func (s *Server) extract(w http.ResponseWriter, r *http.Request) {
	// The caller's own key is used for this one request and forwarded only to
	// Anthropic (extract.BaseURL); it is never logged or stored.
	byokKey := r.Header.Get("X-Anthropic-Key")
	r.Header.Del("X-Anthropic-Key")

	var st *store.Store
	uid := userID(r)
	if byokKey == "" {
		if !s.cfg.Hosted() {
			writeErr(w, http.StatusServiceUnavailable, "hosted_disabled", "hosted AI is not configured on this deployment; add your own Anthropic key in settings")
			return
		}
		if uid == "" {
			writeErr(w, http.StatusUnauthorized, "sign_in", "sign in to use hosted AI, or add your own Anthropic key")
			return
		}
		var err error
		if st, err = s.db(r.Context()); err != nil {
			s.internal(w, r, "database unavailable", err)
			return
		}
		// Rate-limit before reading the 4 MB body.
		ok, retry, err := st.Allow(r.Context(), "extract:"+uid, s.cfg.ExtractPerMinute, time.Minute)
		if err != nil {
			s.internal(w, r, "rate limit unavailable", err)
			return
		}
		if !ok {
			tooMany(w, retry)
			return
		}
	}

	var req extract.Request
	if !decode(w, r, 4_400_000, &req) {
		return
	}
	if err := req.Validate(); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid", err.Error())
		return
	}
	estInput, err := req.EstimateInputTokens()
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid", err.Error())
		return
	}

	// Stay under the function's max duration so failures are reported, not 504'd.
	ctx, cancel := context.WithTimeout(r.Context(), 280*time.Second)
	defer cancel()

	if byokKey != "" {
		res, err := extract.Run(ctx, byokKey, req)
		if err != nil {
			s.modelError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, extractResponse{Result: res, Source: "byok"})
		return
	}

	// Server-paid from here: refuse anything that isn't plausibly one page
	// before any money is reserved.
	if err := req.ValidateHosted(); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid", err.Error())
		return
	}

	source := "credits"
	var holdID int64
	if req.Tier == extract.TierFast {
		id, denied, err := st.ReserveFree(r.Context(), uid, store.FreeQuota{
			PerUser: s.cfg.FreePagesPerDay, PerIP: s.cfg.FreePagesPerIP, Global: s.cfg.FreePagesGlobal,
			IPHash: ipHash(s.cfg.IPHashSecret, clientIP(r)),
		})
		if err != nil {
			s.internal(w, r, "could not reserve free page", err)
			return
		}
		switch denied {
		case store.FreeOK:
			source, holdID = "free", id
			req.MaxTokens = extract.FreeMaxOutputTokens
		case store.FreeIPQuota, store.FreeGlobalLimit:
			// Falls through to credits, like an exhausted personal quota.
			s.log.Warn("free page denied", "reason", string(denied), "request_id", middleware.GetReqID(r.Context()))
		}
	}
	if source == "credits" {
		model, _ := extract.ModelFor(req.Tier)
		worst, err := pricing.Cost(pricing.Usage{Model: model, Input: estInput, Output: extract.MaxOutputTokens})
		if err != nil {
			s.internal(w, r, "pricing", err)
			return
		}
		holdID, err = st.ReservePaid(r.Context(), uid, pricing.WithMarkup(worst, s.cfg.MarkupBps))
		if errors.Is(err, store.ErrInsufficientCredits) {
			writeErr(w, http.StatusPaymentRequired, "insufficient_credits", "not enough credits for this page; top up or use the free tier")
			return
		}
		if err != nil {
			s.internal(w, r, "could not reserve credits", err)
			return
		}
	}

	res, runErr := extract.Run(ctx, s.cfg.AnthropicKey, req)
	// Settle on a fresh context: the page was billed by Anthropic even if the
	// client disconnected.
	settleCtx, settleCancel := context.WithTimeout(context.WithoutCancel(r.Context()), 15*time.Second)
	defer settleCancel()
	if res == nil || (res.Input == 0 && res.Output == 0) {
		if err := st.Release(settleCtx, uid, holdID); err != nil {
			s.log.Error("release hold", "err", err, "hold", holdID)
		}
		s.modelError(w, r, runErr)
		return
	}

	charged := int64(0)
	if source == "credits" {
		charged = pricing.WithMarkup(res.Cost, s.cfg.MarkupBps)
	}
	balance, err := st.Settle(settleCtx, uid, holdID, store.Usage{
		Model: res.Model, InputTokens: res.Input, OutputTokens: res.Output,
		AnthropicCost: res.Cost, Charged: charged,
	})
	if err != nil {
		s.internal(w, r, "could not settle charge", err)
		return
	}
	if runErr != nil {
		s.modelError(w, r, runErr)
		return
	}
	if truncated, dropped := extract.Clamp(res); truncated+dropped > 0 {
		s.log.Warn("clamped model output", "truncated_cells", truncated, "dropped_cells", dropped,
			"request_id", middleware.GetReqID(r.Context()))
	}
	writeJSON(w, http.StatusOK, extractResponse{Result: res, Source: source, ChargedMicros: charged, BalanceMicros: &balance})
}

func (s *Server) modelError(w http.ResponseWriter, r *http.Request, err error) {
	var apiErr *anthropic.Error
	switch {
	case errors.Is(err, extract.ErrRefused):
		writeErr(w, http.StatusUnprocessableEntity, "refused", "the model declined this page")
	case errors.Is(err, extract.ErrTruncated):
		writeErr(w, http.StatusUnprocessableEntity, "truncated", err.Error())
	case errors.Is(err, context.DeadlineExceeded):
		writeErr(w, http.StatusGatewayTimeout, "timeout", "the model took too long on this page")
	case errors.As(err, &apiErr):
		switch apiErr.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			writeErr(w, http.StatusUnauthorized, "bad_key", "Anthropic rejected the API key")
		case http.StatusTooManyRequests, 529:
			writeErr(w, http.StatusServiceUnavailable, "overloaded", "Anthropic is rate-limiting or overloaded; retry shortly")
		case http.StatusBadRequest:
			writeErr(w, http.StatusBadRequest, "model_rejected", "Anthropic rejected the request")
			s.log.Warn("anthropic 400", "err", err)
		default:
			s.internal(w, r, "model request failed", err)
		}
	default:
		s.internal(w, r, "extraction failed", err)
	}
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	if !s.cfg.Hosted() || uid == "" {
		writeErr(w, http.StatusUnauthorized, "sign_in", "not signed in")
		return
	}
	st, err := s.db(r.Context())
	if err != nil {
		s.internal(w, r, "database unavailable", err)
		return
	}
	a, err := st.Account(r.Context(), uid)
	if err != nil {
		s.internal(w, r, "could not load account", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"account": a, "free_pages_per_day": s.cfg.FreePagesPerDay, "markup_bps": s.cfg.MarkupBps,
	})
}

func (s *Server) checkout(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	if s.billing == nil {
		writeErr(w, http.StatusServiceUnavailable, "payments_disabled", "payments are not configured")
		return
	}
	if uid == "" {
		writeErr(w, http.StatusUnauthorized, "sign_in", "sign in to buy credits")
		return
	}
	st, err := s.db(r.Context())
	if err != nil {
		s.internal(w, r, "database unavailable", err)
		return
	}
	ok, retry, err := st.Allow(r.Context(), "checkout:"+uid, s.cfg.CheckoutPerMinute, time.Minute)
	if err != nil {
		s.internal(w, r, "rate limit unavailable", err)
		return
	}
	if !ok {
		tooMany(w, retry)
		return
	}
	var body struct {
		AmountCents int64 `json:"amount_cents"`
	}
	if !decode(w, r, 1<<10, &body) {
		return
	}
	url, err := s.billing.Checkout(r.Context(), uid, body.AmountCents)
	if errors.Is(err, billing.ErrBadAmount) {
		writeErr(w, http.StatusBadRequest, "checkout", err.Error())
		return
	}
	if err != nil {
		// Stripe's error text can describe account configuration; keep it in logs.
		s.internal(w, r, "could not start checkout", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": url})
}

func (s *Server) stripeWebhook(w http.ResponseWriter, r *http.Request) {
	if s.billing == nil {
		writeErr(w, http.StatusServiceUnavailable, "payments_disabled", "payments are not configured")
		return
	}
	payload, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_body", "could not read body")
		return
	}
	ev, err := s.billing.ParseWebhook(payload, r.Header.Get("Stripe-Signature"))
	if errors.Is(err, billing.ErrIgnored) {
		w.WriteHeader(http.StatusOK)
		return
	}
	if err != nil {
		s.log.Warn("rejected stripe webhook", "err", err)
		writeErr(w, http.StatusBadRequest, "bad_webhook", "invalid webhook")
		return
	}
	st, err := s.db(r.Context())
	if err != nil {
		s.internal(w, r, "database unavailable", err)
		return
	}
	switch {
	case ev.Topup != nil:
		t := ev.Topup
		credited, err := st.CreditTopup(r.Context(), t.UserID, t.SessionID, t.PaymentIntent, t.AmountMicros)
		if err != nil {
			s.internal(w, r, "could not credit top-up", err)
			return
		}
		s.log.Info("topup", "user", t.UserID, "session", t.SessionID, "micros", t.AmountMicros, "new", credited)
	case ev.Refund != nil:
		f := ev.Refund
		reversed, err := st.ReverseTopup(r.Context(), f.PaymentIntent, f.Refunded, f.Total)
		if err != nil {
			s.internal(w, r, "could not reverse refunded top-up", err)
			return
		}
		s.log.Info("refund", "payment_intent", f.PaymentIntent, "reversed_micros", reversed)
	}
	w.WriteHeader(http.StatusOK)
}

// inboundEmail forwards mail received at @pdfcells.com (Resend receiving).
func (s *Server) inboundEmail(w http.ResponseWriter, r *http.Request) {
	if s.inbound == nil {
		writeErr(w, http.StatusServiceUnavailable, "inbound_disabled", "inbound email is not configured")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_body", "could not read body")
		return
	}
	if err := s.inbound.Verify(r.Header, body); err != nil {
		writeErr(w, http.StatusUnauthorized, "bad_signature", "webhook signature did not verify")
		return
	}
	id, err := inbound.EmailID(body)
	if errors.Is(err, inbound.ErrIgnored) {
		w.WriteHeader(http.StatusOK)
		return
	}
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_event", "unreadable webhook event")
		return
	}
	if err := s.inbound.Forward(r.Context(), id); err != nil {
		// Non-2xx makes Resend retry; the idempotency key prevents duplicates.
		s.internal(w, r, "could not forward inbound email", err)
		return
	}
	s.log.Info("inbound forwarded", "email_id", id)
	w.WriteHeader(http.StatusOK)
}
