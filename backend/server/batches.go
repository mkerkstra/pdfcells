package server

// Batch AI pages: the "cheaper, results within hours" path for large batch
// runs. The browser sends pages in submissions of up to extract.BatchMaxItems
// (each request stays under Vercel's 4.5 MB body cap); each submission
// becomes one Anthropic Message Batch. Hosted submissions hold the worst case
// for every page at batch rates before anything is sent, and settle when the
// client (or the /api/me sweep) sees the batch end. Bring-your-own-key
// submissions are passed through and never touch the ledger.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/mkerkstra/pdfcells/backend/extract"
	"github.com/mkerkstra/pdfcells/backend/pricing"
	"github.com/mkerkstra/pdfcells/backend/store"
)

// mountAI adds the batch and naming routes under /api.
func (s *Server) mountAI(r chi.Router, auth func(http.Handler) http.Handler) {
	r.With(secure(120*time.Second), requireJSON, auth).Post("/batches", s.submitBatch)
	r.With(secure(120*time.Second), auth).Get("/batches/{id}", s.batchStatus)
	r.With(secure(60*time.Second), auth).Get("/batches/submission/{sid}", s.submissionStatus)
	r.With(secure(60*time.Second), requireJSON, auth).Post("/name-tables", s.nameTables)
}

type batchPageIn struct {
	Key string `json:"key"`
	extract.Request
}

type batchSubmitIn struct {
	Tier  extract.Tier  `json:"tier"`
	Pages []batchPageIn `json:"pages"`
	// The browser's id for this submission. A retry with the same id (after a
	// lost response) returns the batch already paid for instead of a new one.
	Submission string `json:"submission"`
}

var submissionPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{0,64}$`)

type batchPageOut struct {
	Key      string `json:"key"`
	CustomID string `json:"custom_id"`
	Source   string `json:"source"` // byok | free | credits
	Held     int64  `json:"held_micros"`
}

type batchRejected struct {
	Key   string `json:"key"`
	Error string `json:"error"`
}

type batchSubmitOut struct {
	ID       string          `json:"id"`
	Pages    []batchPageOut  `json:"pages"`
	Rejected []batchRejected `json:"rejected"`
	Balance  *int64          `json:"balance_micros,omitempty"`
}

func (s *Server) submitBatch(w http.ResponseWriter, r *http.Request) {
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
		// Per submission, before reading the body; pages are counted below.
		if !s.allow(w, r, st, "batch-submit:"+uid, 1, s.cfg.ExtractPerMinute) {
			return
		}
	}

	var in batchSubmitIn
	if !decode(w, r, 4_400_000, &in) {
		return
	}
	if _, ok := extract.ModelFor(in.Tier); !ok {
		writeErr(w, http.StatusBadRequest, "invalid", fmt.Sprintf("unknown tier %q", in.Tier))
		return
	}
	if !submissionPattern.MatchString(in.Submission) {
		writeErr(w, http.StatusBadRequest, "invalid", "bad submission id")
		return
	}
	if len(in.Pages) == 0 || len(in.Pages) > extract.BatchMaxItems {
		writeErr(w, http.StatusBadRequest, "invalid", fmt.Sprintf("send 1 to %d pages at a time", extract.BatchMaxItems))
		return
	}
	if st != nil && !s.allow(w, r, st, "batch-pages:"+uid, len(in.Pages), s.cfg.BatchPagesPerMinute) {
		return
	}

	// The same checks as a single page, page by page; a bad page is reported
	// back and the rest go ahead.
	out := batchSubmitOut{Pages: []batchPageOut{}, Rejected: []batchRejected{}}
	type valid struct {
		key, customID string
		req           extract.Request
		est           int64
	}
	var ok []valid
	seen := map[string]bool{}
	for i, p := range in.Pages {
		req := p.Request
		req.Tier = in.Tier
		err := req.Validate()
		switch {
		case p.Key == "" || len(p.Key) > 128 || seen[p.Key]:
			err = errors.New("each page needs its own key")
		case len(req.Current) > 0 || req.Instruction != "":
			err = errors.New("corrections are read one page at a time, not in a batch")
		}
		var est int64
		if err == nil {
			est, err = req.EstimateInputTokens()
		}
		if err == nil && st != nil {
			err = req.ValidateHosted()
		}
		if err != nil {
			out.Rejected = append(out.Rejected, batchRejected{Key: p.Key, Error: err.Error()})
			continue
		}
		seen[p.Key] = true
		ok = append(ok, valid{key: p.Key, customID: fmt.Sprintf("p%d", i), req: req, est: est})
	}
	if len(ok) == 0 {
		writeJSON(w, http.StatusOK, out)
		return
	}

	// Not cancelled when the browser goes away: once credits are held the
	// submission must finish and be recorded (a retry then finds it).
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 90*time.Second)
	defer cancel()

	if st == nil {
		items := make([]batchItemIn, len(ok))
		for i, v := range ok {
			items[i] = batchItemIn{customID: v.customID, req: v.req}
			out.Pages = append(out.Pages, batchPageOut{Key: v.key, CustomID: v.customID, Source: "byok"})
		}
		id, err := submitItems(ctx, byokKey, items)
		if err != nil {
			s.modelError(w, r, err)
			return
		}
		out.ID = id
		writeJSON(w, http.StatusOK, out)
		return
	}

	model, _ := extract.ModelFor(in.Tier)
	pages := make([]store.BatchPage, len(ok))
	for i, v := range ok {
		worst, err := pricing.BatchCost(pricing.Usage{Model: model, Input: v.est, Output: extract.MaxOutputTokens})
		if err != nil {
			s.internal(w, r, "pricing", err)
			return
		}
		pages[i] = store.BatchPage{
			CustomID: v.customID, Key: v.key, PageNumber: v.req.PageNumber,
			TryFree: in.Tier == extract.TierFast, PaidHold: pricing.WithMarkup(worst, s.cfg.MarkupBps),
		}
	}
	// Credits of a crashed earlier submission come back first, in their own
	// transaction, so they count towards this one.
	if _, err := st.ReleaseStaleReservations(r.Context(), uid); err != nil {
		s.log.Error("release stale batch reservations", "err", err)
	}
	res, err := st.ReserveBatch(r.Context(), uid, string(in.Tier), in.Submission, store.FreeQuota{
		PerUser: s.cfg.FreePagesPerDay, PerIP: s.cfg.FreePagesPerIP, Global: s.cfg.FreePagesGlobal,
		IPHash: ipHash(s.cfg.IPHashSecret, clientIP(r)),
	}, pages)
	switch {
	case errors.Is(err, store.ErrDuplicateSubmission):
		s.writeSubmission(w, r, st, uid, in.Submission)
		return
	case errors.Is(err, store.ErrFreePaused):
		writeErr(w, http.StatusPaymentRequired, "balance_negative", "free AI pages are paused while your credit balance is negative; add credits to settle it")
		return
	case errors.Is(err, store.ErrInsufficientCredits):
		writeErr(w, http.StatusPaymentRequired, "insufficient_credits", "not enough credits for these pages; top up or send fewer pages")
		return
	case err != nil:
		s.internal(w, r, "could not reserve credits", err)
		return
	}

	items := make([]batchItemIn, len(ok))
	for i, v := range ok {
		rp := res.Pages[i]
		if rp.Source == "free" {
			v.req.MaxTokens = extract.FreeMaxOutputTokens
		}
		items[i] = batchItemIn{customID: v.customID, req: v.req}
		out.Pages = append(out.Pages, batchPageOut{Key: v.key, CustomID: v.customID, Source: rp.Source, Held: rp.Held})
	}
	id, err := submitItems(ctx, s.cfg.AnthropicKey, items)
	// Money is held from here: record or undo it on a fresh context, started
	// only now so a slow submission can't use up its budget.
	undo, undoCancel := context.WithTimeout(context.WithoutCancel(r.Context()), 20*time.Second)
	defer undoCancel()
	if err != nil {
		if ferr := st.FailBatch(undo, uid, res.BatchID); ferr != nil {
			s.log.Error("release batch holds", "err", ferr, "batch", res.BatchID)
		}
		s.modelError(w, r, err)
		return
	}
	if err := st.MarkBatchSubmitted(undo, uid, res.BatchID, id); err != nil {
		// Anthropic has it but we can't track it: stop it, then give the
		// credits back. Pages it already read are on us.
		if cerr := extract.CancelBatch(undo, s.cfg.AnthropicKey, id); cerr != nil {
			s.log.Error("cancel untracked batch", "err", cerr, "anthropic_batch", id)
		}
		if ferr := st.FailBatch(undo, uid, res.BatchID); ferr != nil {
			s.log.Error("release batch holds", "err", ferr, "batch", res.BatchID)
		}
		s.internal(w, r, "could not record batch", err)
		return
	}
	s.log.Info("batch submitted", "anthropic_batch", id, "pages", len(items), "tier", in.Tier,
		"request_id", middleware.GetReqID(r.Context()))
	out.ID, out.Balance = id, &res.Balance
	writeJSON(w, http.StatusOK, out)
}

// submissionStatus tells the browser what became of a submission whose
// response it never got: the batch it is in, still being sent (409), or not
// sent at all (every page rejected, nothing held). Hosted only: a
// bring-your-own-key submission isn't recorded.
func (s *Server) submissionStatus(w http.ResponseWriter, r *http.Request) {
	uid := userID(r)
	if !s.hostedReady(w, r, uid) {
		return
	}
	sid := chi.URLParam(r, "sid")
	if sid == "" || !submissionPattern.MatchString(sid) {
		notFound(w, r)
		return
	}
	st, err := s.db(r.Context())
	if err != nil {
		s.internal(w, r, "database unavailable", err)
		return
	}
	s.writeSubmission(w, r, st, uid, sid)
}

func (s *Server) writeSubmission(w http.ResponseWriter, r *http.Request, st *store.Store, uid, sid string) {
	sub, err := st.BatchBySubmission(r.Context(), uid, sid)
	if errors.Is(err, store.ErrNoBatch) {
		notFound(w, r)
		return
	}
	if err != nil {
		s.internal(w, r, "could not load submission", err)
		return
	}
	out := batchSubmitOut{Pages: []batchPageOut{}, Rejected: []batchRejected{}}
	switch sub.State {
	case "reserved":
		writeErr(w, http.StatusConflict, "submitting", "this submission is still being sent; ask again shortly")
		return
	case "failed":
		for _, p := range sub.Pages {
			out.Rejected = append(out.Rejected, batchRejected{Key: p.Key, Error: "it wasn’t sent, so nothing was charged"})
		}
	default:
		out.ID = sub.AnthropicID
		for _, p := range sub.Pages {
			out.Pages = append(out.Pages, batchPageOut{Key: p.Key, CustomID: p.CustomID, Source: p.Source, Held: p.Held})
		}
	}
	writeJSON(w, http.StatusOK, out)
}

type anthropicBatchRequest = anthropic.BetaMessageBatchNewParamsRequest

type batchItemIn struct {
	customID string
	req      extract.Request
}

func submitItems(ctx context.Context, apiKey string, items []batchItemIn) (string, error) {
	reqs := make([]anthropicBatchRequest, 0, len(items))
	for _, it := range items {
		b, err := extract.BatchItem(it.customID, it.req)
		if err != nil {
			return "", err
		}
		reqs = append(reqs, b)
	}
	return extract.SubmitBatch(ctx, apiKey, reqs)
}

// batchItemResult is one page of an ended batch.
type batchItemResult struct {
	CustomID string           `json:"custom_id"`
	Status   string           `json:"status"` // done | error
	Code     string           `json:"code,omitempty"`
	Result   *extractResponse `json:"result,omitempty"`
}

type batchStatusOut struct {
	ID      string            `json:"id"`
	Ended   bool              `json:"ended"`
	Status  string            `json:"status"`
	Total   int64             `json:"total"`
	Pending int64             `json:"pending"`
	Items   []batchItemResult `json:"items"`
	Balance *int64            `json:"balance_micros,omitempty"`
}

func (s *Server) batchStatus(w http.ResponseWriter, r *http.Request) {
	byokKey := r.Header.Get("X-Anthropic-Key")
	r.Header.Del("X-Anthropic-Key")
	id := chi.URLParam(r, "id")
	if id == "" || len(id) > 128 {
		notFound(w, r)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 100*time.Second)
	defer cancel()

	if byokKey != "" {
		state, err := extract.BatchStatus(ctx, byokKey, id)
		if err != nil {
			s.modelError(w, r, err)
			return
		}
		out := batchStatusOut{ID: id, Ended: state.Ended, Status: state.Status, Total: state.Total, Pending: state.Pending, Items: []batchItemResult{}}
		if state.Ended {
			err := extract.BatchResults(ctx, byokKey, id, func(o extract.ItemOutcome) {
				out.Items = append(out.Items, itemResult(o, "byok", 0, false))
			})
			if err != nil {
				s.modelError(w, r, err)
				return
			}
		}
		writeJSON(w, http.StatusOK, out)
		return
	}

	uid := userID(r)
	if !s.hostedReady(w, r, uid) {
		return
	}
	st, err := s.db(r.Context())
	if err != nil {
		s.internal(w, r, "database unavailable", err)
		return
	}
	view, err := st.Batch(r.Context(), uid, id)
	if errors.Is(err, store.ErrNoBatch) {
		notFound(w, r)
		return
	}
	if err != nil {
		s.internal(w, r, "could not load batch", err)
		return
	}
	state, err := extract.BatchStatus(ctx, s.cfg.AnthropicKey, id)
	if err != nil {
		s.modelError(w, r, err)
		return
	}
	out := batchStatusOut{ID: id, Ended: state.Ended, Status: state.Status, Total: state.Total, Pending: state.Pending, Items: []batchItemResult{}}
	if !state.Ended {
		writeJSON(w, http.StatusOK, out)
		return
	}
	outcomes, sum, err := s.settleBatch(ctx, st, uid, id, state)
	if err != nil {
		s.internal(w, r, "could not settle batch", err)
		return
	}
	if sum != nil && sum.Settled {
		out.Balance = &sum.Balance
		if view, err = st.Batch(r.Context(), uid, id); err != nil {
			s.internal(w, r, "could not load batch", err)
			return
		}
	}
	for _, p := range view.Pages {
		o, ok := outcomes[p.CustomID]
		if !ok {
			// Results were deleted (29 days) or never came back.
			out.Items = append(out.Items, batchItemResult{CustomID: p.CustomID, Status: "error", Code: "batch_gone"})
			continue
		}
		out.Items = append(out.Items, itemResult(o, p.Source, p.Charged, true))
	}
	writeJSON(w, http.StatusOK, out)
}

// settleBatch reads an ended batch's results and settles its pages (a no-op
// when it was already settled). It returns every page's outcome.
func (s *Server) settleBatch(ctx context.Context, st *store.Store, uid, id string, state *extract.BatchState) (map[string]extract.ItemOutcome, *store.SettleSummary, error) {
	outcomes := map[string]extract.ItemOutcome{}
	if !state.Gone {
		err := extract.BatchResults(ctx, s.cfg.AnthropicKey, id, func(o extract.ItemOutcome) {
			outcomes[o.CustomID] = o
		})
		if err != nil {
			// Never settle on a partial read: a page missing from it would be
			// released although Anthropic billed it.
			return nil, nil, err
		}
	}
	settle := make(map[string]store.BatchItemOutcome, len(outcomes))
	for cid, o := range outcomes {
		so := store.BatchItemOutcome{Billed: o.Billed(), Outcome: outcomeName(o)}
		if so.Billed {
			so.Usage = store.Usage{
				Model: o.Result.Model, InputTokens: o.Result.Input, OutputTokens: o.Result.Output,
				AnthropicCost: o.Result.Cost, Charged: pricing.WithMarkup(o.Result.Cost, s.cfg.MarkupBps),
			}
		} else if o.Kind == extract.OutcomeSucceeded && o.Err != nil {
			s.log.Error("unpriceable batch page", "err", o.Err, "anthropic_batch", id, "custom_id", cid)
		}
		settle[cid] = so
	}
	settleCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()
	sum, err := st.SettleBatch(settleCtx, uid, id, settle)
	if err != nil {
		return nil, nil, err
	}
	if sum.Settled {
		s.log.Info("batch settled", "anthropic_batch", id, "charged_micros", sum.Charged, "released", sum.Released, "results_gone", state.Gone)
	}
	if sum.Capped > 0 || sum.MissingHold > 0 {
		s.log.Error("batch settle anomaly", "anthropic_batch", id, "capped", sum.Capped, "missing_hold", sum.MissingHold)
	}
	return outcomes, &sum, nil
}

// sweepBatches settles a signed-in person's ended batches without the
// client: a closed tab or another device still gets its holds settled.
// Bounded so /api/me stays fast; anything left waits for the next call.
func (s *Server) sweepBatches(ctx context.Context, st *store.Store, uid string) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	if _, err := st.ReleaseStaleReservations(ctx, uid); err != nil {
		s.log.Error("release stale batch reservations", "err", err)
	}
	ids, err := st.UnsettledBatches(ctx, uid, 30*time.Minute, 3)
	if err != nil {
		s.log.Error("list unsettled batches", "err", err)
		return
	}
	for _, id := range ids {
		state, err := extract.BatchStatus(ctx, s.cfg.AnthropicKey, id)
		if err != nil {
			s.log.Warn("batch status", "err", err, "anthropic_batch", id)
			return
		}
		if !state.Ended {
			continue
		}
		if _, _, err := s.settleBatch(ctx, st, uid, id, state); err != nil {
			s.log.Warn("sweep settle", "err", err, "anthropic_batch", id)
			return
		}
	}
}

func outcomeName(o extract.ItemOutcome) string {
	switch {
	case errors.Is(o.Err, extract.ErrRefused):
		return "refused"
	case errors.Is(o.Err, extract.ErrTruncated):
		return "truncated"
	case o.Kind == extract.OutcomeSucceeded && o.Err != nil:
		return "unreadable"
	}
	return o.Kind
}

// itemResult is what the client gets for one page. Hosted results are
// clamped like single pages.
func itemResult(o extract.ItemOutcome, source string, charged int64, hosted bool) batchItemResult {
	out := batchItemResult{CustomID: o.CustomID}
	switch name := outcomeName(o); name {
	case extract.OutcomeSucceeded:
		if hosted {
			extract.Clamp(o.Result)
		}
		out.Status = "done"
		out.Result = &extractResponse{Result: o.Result, Source: source, ChargedMicros: charged}
	default:
		out.Status, out.Code = "error", name
	}
	return out
}

// hostedReady writes the same refusals /api/extract gives a request that
// can't use hosted AI.
func (s *Server) hostedReady(w http.ResponseWriter, r *http.Request, uid string) bool {
	if !s.cfg.Hosted() {
		writeErr(w, http.StatusServiceUnavailable, "hosted_disabled", "hosted AI is not configured on this deployment; add your own Anthropic key in settings")
		return false
	}
	if uid == "" {
		writeErr(w, http.StatusUnauthorized, "sign_in", "sign in to use hosted AI, or add your own Anthropic key")
		return false
	}
	return true
}

func (s *Server) allow(w http.ResponseWriter, r *http.Request, st *store.Store, key string, n, limit int) bool {
	ok, retry, err := st.AllowN(r.Context(), key, n, limit, time.Minute)
	if err != nil {
		s.internal(w, r, "rate limit unavailable", err)
		return false
	}
	if !ok {
		tooMany(w, retry)
		return false
	}
	return true
}
