package server

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5/middleware"

	"github.com/mkerkstra/pdfcells/backend/extract"
	"github.com/mkerkstra/pdfcells/backend/pricing"
	"github.com/mkerkstra/pdfcells/backend/store"
)

// categorizeBody bounds the JSON body: 500 payees of 200 characters, with room for escaping.
const categorizeBody = 256 << 10

type categorizeResponse struct {
	*extract.CategorizeResult
	Source        string `json:"source"` // byok | free | credits
	ChargedMicros int64  `json:"charged_micros"`
	BalanceMicros *int64 `json:"balance_micros,omitempty"`
}

// categorize runs the same guards as extract, in the same order: BYOK or a
// signed-in hosted user, the per-user rate limit before the body is read,
// validation and the hosted caps before any money moves, the free quota (one
// free page per call on Fast) or a worst-case credit hold, then settle to the
// exact cost, or release the hold when the model billed nothing.
func (s *Server) categorize(w http.ResponseWriter, r *http.Request) {
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
		ok, retry, err := st.Allow(r.Context(), "categorize:"+uid, s.cfg.ExtractPerMinute, time.Minute)
		if err != nil {
			s.internal(w, r, "rate limit unavailable", err)
			return
		}
		if !ok {
			tooMany(w, retry)
			return
		}
	}

	var req extract.CategorizeRequest
	if !decode(w, r, categorizeBody, &req) {
		return
	}
	if err := req.Validate(); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid", err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()

	if byokKey != "" {
		res, err := extract.RunCategorize(ctx, byokKey, req)
		if err != nil {
			s.modelError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, categorizeResponse{CategorizeResult: res, Source: "byok"})
		return
	}

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
		case store.FreeNegativeBalance:
			writeErr(w, http.StatusPaymentRequired, "balance_negative", "free AI pages are paused while your credit balance is negative; add credits to settle it")
			return
		case store.FreeIPQuota, store.FreeGlobalLimit:
			s.log.Warn("free page denied", "reason", string(denied), "request_id", middleware.GetReqID(r.Context()))
		}
	}
	if source == "credits" {
		model, _ := extract.ModelFor(req.Tier)
		worst, err := pricing.Cost(pricing.Usage{Model: model, Input: req.EstimateInputTokens(), Output: req.OutputTokens()})
		if err != nil {
			s.internal(w, r, "pricing", err)
			return
		}
		holdID, err = st.ReservePaid(r.Context(), uid, pricing.WithMarkup(worst, s.cfg.MarkupBps))
		if errors.Is(err, store.ErrInsufficientCredits) {
			writeErr(w, http.StatusPaymentRequired, "insufficient_credits", "not enough credits to categorise; top up or use the free tier")
			return
		}
		if err != nil {
			s.internal(w, r, "could not reserve credits", err)
			return
		}
	}

	res, runErr := extract.RunCategorize(ctx, s.cfg.AnthropicKey, req)
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
	writeJSON(w, http.StatusOK, categorizeResponse{CategorizeResult: res, Source: source, ChargedMicros: charged, BalanceMicros: &balance})
}
