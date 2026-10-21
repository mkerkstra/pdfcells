package extract

import (
	"context"
	"errors"
	"fmt"
	"regexp"

	"github.com/anthropics/anthropic-sdk-go"

	"github.com/mkerkstra/pdfcells/backend/pricing"
)

// Pages sent through the Message Batches API: half the price, results within
// hours (24 at most). Each page is the exact request Run would send, built by
// the same pageParams, so the prompt, the image crop and the output schema
// are identical. Only the refusal fallback is left out, because the Batches
// API rejects it; a refused page on Accurate or Max comes back as refused.

// BatchMaxItems bounds one submission. With pages up to MaxImageBytes the
// 4.5 MB request body is the real limit; this keeps a response of results
// well inside Vercel's response limit too.
const BatchMaxItems = 25

var customIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

// BatchItem is one page as a batch request under customID.
func BatchItem(customID string, req Request) (anthropic.BetaMessageBatchNewParamsRequest, error) {
	if !customIDPattern.MatchString(customID) {
		return anthropic.BetaMessageBatchNewParamsRequest{}, fmt.Errorf("extract: bad batch custom id %q", customID)
	}
	p := pageParams(req)
	return anthropic.BetaMessageBatchNewParamsRequest{
		CustomID: customID,
		Params: anthropic.BetaMessageBatchNewParamsRequestParams{
			Model:        p.Model,
			MaxTokens:    p.MaxTokens,
			System:       p.System,
			Messages:     p.Messages,
			OutputConfig: p.OutputConfig,
		},
	}, nil
}

// SubmitBatch creates the batch and returns its id.
func SubmitBatch(ctx context.Context, apiKey string, items []anthropic.BetaMessageBatchNewParamsRequest) (string, error) {
	if len(items) == 0 || len(items) > BatchMaxItems {
		return "", fmt.Errorf("extract: a batch takes 1 to %d pages, got %d", BatchMaxItems, len(items))
	}
	client := newClient(apiKey)
	b, err := client.Beta.Messages.Batches.New(ctx, anthropic.BetaMessageBatchNewParams{Requests: items})
	if err != nil {
		return "", err
	}
	return b.ID, nil
}

// CancelBatch asks Anthropic to stop a batch; pages not yet started are not billed.
func CancelBatch(ctx context.Context, apiKey, id string) error {
	client := newClient(apiKey)
	_, err := client.Beta.Messages.Batches.Cancel(ctx, id, anthropic.BetaMessageBatchCancelParams{})
	return err
}

// BatchState is a batch's processing status and request counts.
type BatchState struct {
	ID        string `json:"id"`
	Ended     bool   `json:"ended"`
	Status    string `json:"status"` // in_progress | canceling | ended
	Total     int64  `json:"total"`
	Pending   int64  `json:"pending"`
	Succeeded int64  `json:"succeeded"`
	Failed    int64  `json:"failed"` // errored + expired + canceled
	// Gone means the batch ended so long ago that its results were deleted.
	Gone bool `json:"-"`
}

// BatchStatus fetches a batch's status.
func BatchStatus(ctx context.Context, apiKey, id string) (*BatchState, error) {
	client := newClient(apiKey)
	b, err := client.Beta.Messages.Batches.Get(ctx, id, anthropic.BetaMessageBatchGetParams{})
	if err != nil {
		return nil, err
	}
	c := b.RequestCounts
	return &BatchState{
		ID:        b.ID,
		Ended:     b.ProcessingStatus == anthropic.BetaMessageBatchProcessingStatusEnded,
		Status:    string(b.ProcessingStatus),
		Total:     c.Processing + c.Succeeded + c.Errored + c.Expired + c.Canceled,
		Pending:   c.Processing,
		Succeeded: c.Succeeded,
		Failed:    c.Errored + c.Expired + c.Canceled,
		Gone:      !b.ArchivedAt.IsZero() || (b.ProcessingStatus == anthropic.BetaMessageBatchProcessingStatusEnded && b.ResultsURL == ""),
	}, nil
}

// Outcome kinds of one batch item. Only OutcomeSucceeded was billed by
// Anthropic; the others were never run (or failed before a message existed).
const (
	OutcomeSucceeded = "succeeded"
	OutcomeErrored   = "errored"
	OutcomeExpired   = "expired"
	OutcomeCanceled  = "canceled"
)

// ItemOutcome is one page's batch result. For succeeded items Result is
// priced at batch rates; Err is set for a refusal, truncation or unreadable
// output (those were still billed, as on the per-page path).
type ItemOutcome struct {
	CustomID string
	Kind     string
	Result   *Result
	Err      error
}

// Billed reports whether Anthropic charged for this item.
func (o ItemOutcome) Billed() bool {
	return o.Kind == OutcomeSucceeded && o.Result != nil && (o.Result.Input > 0 || o.Result.Output > 0)
}

// ErrBatchItemFailed is an errored, expired or canceled item: nothing was billed.
var ErrBatchItemFailed = errors.New("extract: the batch did not read this page")

// BatchResults streams an ended batch's results, in any order.
func BatchResults(ctx context.Context, apiKey, id string, fn func(ItemOutcome)) error {
	client := newClient(apiKey)
	stream := client.Beta.Messages.Batches.ResultsStreaming(ctx, id, anthropic.BetaMessageBatchResultsParams{})
	defer func() { _ = stream.Close() }()
	for stream.Next() {
		fn(outcomeOf(stream.Current()))
	}
	return stream.Err()
}

func outcomeOf(r anthropic.BetaMessageBatchIndividualResponse) ItemOutcome {
	o := ItemOutcome{CustomID: r.CustomID, Kind: r.Result.Type}
	switch r.Result.Type {
	case OutcomeSucceeded:
		msg := r.Result.AsSucceeded().Message
		// An unpriceable model leaves Result nil: like Run, the hold is
		// released and the error logged, never settled at $0.
		o.Result, o.Err = resultOf(&msg, pricing.BatchCost)
	case OutcomeErrored, OutcomeExpired, OutcomeCanceled:
		o.Err = ErrBatchItemFailed
	default:
		o.Kind, o.Err = OutcomeErrored, ErrBatchItemFailed
	}
	return o
}
