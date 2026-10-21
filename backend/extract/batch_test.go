package extract

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/anthropics/anthropic-sdk-go"
)

// A batch page must be the very request the per-page path sends: same system
// prompt, same image and text (so the same area crop and filtered hint), same
// output schema and effort. Only the refusal fallback differs.
func TestBatchItemMatchesPageRequest(t *testing.T) {
	for _, tier := range []Tier{TierFast, TierAccurate, TierMax} {
		req := Request{
			Tier: tier, ImageBase64: jpegB64(t, 800, 1000), MediaType: "image/jpeg",
			TextLayer: "Fee 9", TextLayerTrusted: true, PageNumber: 3, MaxTokens: FreeMaxOutputTokens,
		}
		item, err := BatchItem("i42", req)
		if err != nil {
			t.Fatal(err)
		}
		page := pageParams(req)
		want, _ := json.Marshal(map[string]any{
			"model": page.Model, "max_tokens": page.MaxTokens, "system": page.System,
			"messages": page.Messages, "output_config": page.OutputConfig,
		})
		got, _ := json.Marshal(item.Params)
		var w, g map[string]any
		_ = json.Unmarshal(want, &w)
		_ = json.Unmarshal(got, &g)
		for _, k := range []string{"model", "max_tokens", "system", "messages", "output_config"} {
			wk, _ := json.Marshal(w[k])
			gk, _ := json.Marshal(g[k])
			if string(wk) != string(gk) {
				t.Fatalf("%s: batch %s differs from the per-page request:\n got %s\nwant %s", tier, k, gk, wk)
			}
		}
		if _, ok := g["fallbacks"]; ok {
			t.Fatalf("%s: the Batches API rejects fallbacks; got %s", tier, got)
		}
	}
}

func TestBatchItemRejectsBadCustomID(t *testing.T) {
	for _, id := range []string{"", "has space", strings.Repeat("x", 65), "a/b"} {
		if _, err := BatchItem(id, Request{Tier: TierFast}); err == nil {
			t.Errorf("custom id %q accepted", id)
		}
	}
}

func line(t *testing.T, s string) anthropic.BetaMessageBatchIndividualResponse {
	t.Helper()
	var r anthropic.BetaMessageBatchIndividualResponse
	if err := json.Unmarshal([]byte(s), &r); err != nil {
		t.Fatal(err)
	}
	return r
}

func TestOutcomeOf(t *testing.T) {
	ok := outcomeOf(line(t, `{"custom_id":"i1","result":{"type":"succeeded","message":{"id":"m","type":"message","role":"assistant","model":"claude-haiku-5-5","stop_reason":"end_turn","content":[{"type":"text","text":"{\"page_kind\":\"table\",\"tables\":[{\"title\":\"Fees\",\"header_rows\":1,\"rows\":[[\"Fee\",\"9\"]],\"notes\":\"\"}],\"warnings\":[]}"}],"usage":{"input_tokens":2000,"output_tokens":1000}}}}`))
	if ok.Err != nil || !ok.Billed() || ok.Result.Cost != 350 || len(ok.Result.Tables) != 1 {
		t.Fatalf("succeeded: %+v %v (want batch-rate cost 350)", ok.Result, ok.Err)
	}
	refused := outcomeOf(line(t, `{"custom_id":"i2","result":{"type":"succeeded","message":{"id":"m","type":"message","role":"assistant","model":"claude-opus-5-5","stop_reason":"refusal","content":[],"usage":{"input_tokens":1000,"output_tokens":10}}}}`))
	if !errors.Is(refused.Err, ErrRefused) || !refused.Billed() {
		t.Fatalf("a refusal is billed like on the per-page path: %+v", refused)
	}
	for _, kind := range []string{"errored", "expired", "canceled"} {
		body := `{"custom_id":"i3","result":{"type":"` + kind + `"}}`
		if kind == "errored" {
			body = `{"custom_id":"i3","result":{"type":"errored","error":{"type":"error","error":{"type":"invalid_request_error","message":"bad"}}}}`
		}
		o := outcomeOf(line(t, body))
		if o.Billed() || !errors.Is(o.Err, ErrBatchItemFailed) || o.Kind != kind {
			t.Fatalf("%s must not be billed: %+v", kind, o)
		}
	}
}
