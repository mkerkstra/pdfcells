package server

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/mkerkstra/pdfcells/backend/extract"
	"github.com/mkerkstra/pdfcells/backend/pricing"
	"github.com/mkerkstra/pdfcells/backend/store"
)

type nameTablesOut struct {
	Titles        []string `json:"titles"`
	Model         string   `json:"model"`
	Source        string   `json:"source"` // byok | free | credits
	ChargedMicros int64    `json:"charged_micros"`
	BalanceMicros *int64   `json:"balance_micros,omitempty"`
}

// nameTables titles untitled tables from their header and a few rows: one
// cheap, text-only Fast call for a whole document. It goes through the same
// guards and billing as /api/extract: rate limit, the free daily quota (one
// call counts as one free page), a paused free tier on a negative balance,
// and otherwise a worst-case hold settled to the exact cost.
func (s *Server) nameTables(w http.ResponseWriter, r *http.Request) {
	byokKey := r.Header.Get("X-Anthropic-Key")
	r.Header.Del("X-Anthropic-Key")

	var st *store.Store
	uid := userID(r)
	if byokKey == "" {
		if !s.hostedReady(w, r, uid) {
			return
		}
		var err error
		if st, err = s.db(r.Context()); err != nil {
			s.internal(w, r, "database unavailable", err)
			return
		}
		if !s.allow(w, r, st, "extract:"+uid, 1, s.cfg.ExtractPerMinute) {
			return
		}
	}

	var req extract.NameRequest
	if !decode(w, r, 256<<10, &req) {
		return
	}
	if err := req.Validate(); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid", err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 50*time.Second)
	defer cancel()

	if byokKey != "" {
		res, err := extract.RunNaming(ctx, byokKey, req)
		if err != nil {
			s.modelError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, nameTablesOut{Titles: res.Titles, Model: res.Model, Source: "byok"})
		return
	}

	source := "credits"
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
		source = "free"
	case store.FreeNegativeBalance:
		writeErr(w, http.StatusPaymentRequired, "balance_negative", "free AI pages are paused while your credit balance is negative; add credits to settle it")
		return
	}
	if source == "credits" {
		model, _ := extract.ModelFor(extract.NameTier)
		worst, err := pricing.Cost(pricing.Usage{Model: model, Input: req.EstimateInputTokens(), Output: extract.NameMaxOutputTokens})
		if err != nil {
			s.internal(w, r, "pricing", err)
			return
		}
		id, err = st.ReservePaid(r.Context(), uid, pricing.WithMarkup(worst, s.cfg.MarkupBps))
		if errors.Is(err, store.ErrInsufficientCredits) {
			writeErr(w, http.StatusPaymentRequired, "insufficient_credits", "not enough credits to name these tables")
			return
		}
		if err != nil {
			s.internal(w, r, "could not reserve credits", err)
			return
		}
	}

	res, runErr := extract.RunNaming(ctx, s.cfg.AnthropicKey, req)
	settleCtx, settleCancel := context.WithTimeout(context.WithoutCancel(r.Context()), 15*time.Second)
	defer settleCancel()
	if res == nil || (res.Input == 0 && res.Output == 0) {
		if err := st.Release(settleCtx, uid, id); err != nil {
			s.log.Error("release hold", "err", err, "hold", id)
		}
		s.modelError(w, r, runErr)
		return
	}
	charged := int64(0)
	if source == "credits" {
		charged = pricing.WithMarkup(res.Cost, s.cfg.MarkupBps)
	}
	balance, err := st.Settle(settleCtx, uid, id, store.Usage{
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
	writeJSON(w, http.StatusOK, nameTablesOut{Titles: res.Titles, Model: res.Model, Source: source, ChargedMicros: charged, BalanceMicros: &balance})
}
