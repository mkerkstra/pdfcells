package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mkerkstra/pdfcells/backend/extract"
	"github.com/mkerkstra/pdfcells/backend/store"
)

// fakeBatches stands in for Anthropic's Message Batches and Messages APIs.
type fakeBatches struct {
	mu       sync.Mutex
	id       string // batch id, unique per test run (the column is UNIQUE)
	key      string
	creates  int
	failNew  bool
	requests []map[string]any // params of the last batch, by position
	ids      []string         // custom ids of the last batch
	ended    bool
	// result for a custom id: a JSON "result" object.
	result  func(customID string) string
	message string // body for POST /v1/messages
	sent    []string
}

func newFakeBatches(t *testing.T) *fakeBatches {
	t.Helper()
	f := &fakeBatches{id: fmt.Sprintf("msgbatch_fake_%d", time.Now().UnixNano())}
	srv := httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(srv.Close)
	old := extract.BaseURL
	extract.BaseURL = srv.URL + "/"
	t.Cleanup(func() { extract.BaseURL = old })
	return f
}

func (f *fakeBatches) batchJSON() string {
	status, url, counts := "in_progress", "null", fmt.Sprintf(`{"processing":%d,"succeeded":0,"errored":0,"canceled":0,"expired":0}`, len(f.ids))
	if f.ended {
		status, url = "ended", `"https://example.test/results"`
		counts = fmt.Sprintf(`{"processing":0,"succeeded":%d,"errored":0,"canceled":0,"expired":0}`, len(f.ids))
	}
	return `{"id":"` + f.id + `","type":"message_batch","processing_status":"` + status + `","request_counts":` + counts +
		`,"created_at":"2026-10-20T00:00:00Z","expires_at":"2026-10-21T00:00:00Z","archived_at":null,"cancel_initiated_at":null,"ended_at":null,"results_url":` + url + `}`
}

func (f *fakeBatches) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.key = r.Header.Get("X-Api-Key")
	body, _ := io.ReadAll(r.Body)
	w.Header().Set("Content-Type", "application/json")
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/v1/messages/batches":
		f.creates++
		if f.failNew {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"type":"error","error":{"type":"invalid_request_error","message":"nope"}}`))
			return
		}
		var in struct {
			Requests []struct {
				CustomID string         `json:"custom_id"`
				Params   map[string]any `json:"params"`
			} `json:"requests"`
		}
		_ = json.Unmarshal(body, &in)
		f.ids, f.requests = nil, nil
		for _, q := range in.Requests {
			f.ids = append(f.ids, q.CustomID)
			f.requests = append(f.requests, q.Params)
		}
		_, _ = w.Write([]byte(f.batchJSON()))
	case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/results"):
		w.Header().Set("Content-Type", "application/x-jsonl")
		for _, id := range f.ids {
			_, _ = w.Write([]byte(`{"custom_id":"` + id + `","result":` + f.result(id) + "}\n"))
		}
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/messages/batches/"):
		_, _ = w.Write([]byte(f.batchJSON()))
	case r.Method == http.MethodPost && r.URL.Path == "/v1/messages":
		f.sent = append(f.sent, string(body))
		_, _ = w.Write([]byte(f.message))
	default:
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"type":"error","error":{"type":"not_found_error","message":"no"}}`))
	}
}

func succeeded(model string, in, out int) string {
	text := `{\"page_kind\":\"table\",\"tables\":[{\"title\":\"Fees\",\"header_rows\":1,\"rows\":[[\"Fee\",\"9\"]],\"notes\":\"\"}],\"warnings\":[]}`
	return fmt.Sprintf(`{"type":"succeeded","message":{"id":"m","type":"message","role":"assistant","model":"%s","stop_reason":"end_turn","content":[{"type":"text","text":"%s"}],"usage":{"input_tokens":%d,"output_tokens":%d}}}`, model, text, in, out)
}

func batchBody(t *testing.T, tier string, n int) string {
	t.Helper()
	img := pageB64(t, 800, 1000, true)
	pages := make([]string, n)
	for i := range pages {
		pages[i] = fmt.Sprintf(`{"key":"f1-p%d","image_base64":"%s","text_layer":"Fee 9","page_number":%d}`, i+1, img, i+1)
	}
	return `{"tier":"` + tier + `","pages":[` + strings.Join(pages, ",") + `]}`
}

func ledgerStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(context.Background(), os.Getenv("TEST_DATABASE_URL"), "")
	if err != nil {
		t.Fatal(err)
	}
	return st
}

func balance(t *testing.T, st *store.Store, uid string) int64 {
	t.Helper()
	a, err := st.Account(context.Background(), uid)
	if err != nil {
		t.Fatal(err)
	}
	return a.BalanceMicros
}

func TestHostedBatchHoldsSettlesOnceAndReleasesFailures(t *testing.T) {
	uid := "user_bt_" + time.Now().Format("150405.000000000")
	h := hostedServer(t, Config{FreePagesPerDay: 25, FreePagesPerIP: -1, FreePagesGlobal: -1, ExtractPerMinute: 30, BatchPagesPerMinute: 300}, uid)
	f := newFakeBatches(t)
	st := ledgerStore(t)
	if _, err := st.CreditTopup(context.Background(), uid, "cs_"+uid, "pi_"+uid, 2_000_000); err != nil {
		t.Fatal(err)
	}

	rec, body := do(t, h, http.MethodPost, "/api/batches", batchBody(t, "accurate", 3))
	if rec.Code != http.StatusOK || body["id"] != f.id {
		t.Fatalf("submit: %d %v", rec.Code, body)
	}
	if f.key != "sk-ant-server" || len(f.ids) != 3 {
		t.Fatalf("batch not sent with the server key: key=%q ids=%v", f.key, f.ids)
	}
	for _, p := range f.requests {
		if _, ok := p["fallbacks"]; ok {
			t.Fatal("fallbacks sent in a batch")
		}
	}
	held := 2_000_000 - balance(t, st, uid)
	if held <= 0 {
		t.Fatalf("nothing held for 3 Accurate pages")
	}

	// Still running: nothing settles.
	if rec, body := do(t, h, http.MethodGet, "/api/batches/"+f.id, ""); rec.Code != 200 || body["ended"] != false {
		t.Fatalf("in progress: %d %v", rec.Code, body)
	}

	f.mu.Lock()
	f.ended = true
	f.result = func(id string) string {
		switch id {
		case "p0":
			return succeeded("claude-sonnet-5-5", 3000, 1000) // batch cost 3000+5000 = 8000 µ$
		case "p1":
			return `{"type":"errored","error":{"type":"error","error":{"type":"api_error","message":"boom"}}}`
		}
		return `{"type":"expired"}`
	}
	f.mu.Unlock()

	var want int64 = 8_000 + 1_200 // 15% markup
	for range 2 {
		rec, body = do(t, h, http.MethodGet, "/api/batches/"+f.id, "")
		if rec.Code != 200 || body["ended"] != true {
			t.Fatalf("ended: %d %v", rec.Code, body)
		}
		items, _ := body["items"].([]any)
		if len(items) != 3 {
			t.Fatalf("items %v", body["items"])
		}
		codes := map[string]string{}
		for _, it := range items {
			m := it.(map[string]any)
			code, _ := m["code"].(string)
			codes[m["custom_id"].(string)] = m["status"].(string) + ":" + code
			if m["custom_id"] == "p0" {
				res := m["result"].(map[string]any)
				if res["charged_micros"].(float64) != float64(want) || res["source"] != "credits" {
					t.Fatalf("p0 result %v", res)
				}
			}
		}
		if codes["p0"] != "done:" || codes["p1"] != "error:errored" || codes["p2"] != "error:expired" {
			t.Fatalf("codes %v", codes)
		}
		if got := balance(t, st, uid); got != 2_000_000-want {
			t.Fatalf("balance %d, want %d (failed pages free, settled once)", got, 2_000_000-want)
		}
	}

	// Someone else can't read or settle it.
	other := hostedServer(t, Config{ExtractPerMinute: 30, BatchPagesPerMinute: 300}, uid+"_other")
	if rec, _ := do(t, other, http.MethodGet, "/api/batches/"+f.id, ""); rec.Code != http.StatusNotFound {
		t.Fatalf("another user's batch: %d", rec.Code)
	}
}

func TestBatchWithoutCreditsSendsNothing(t *testing.T) {
	uid := "user_bn_" + time.Now().Format("150405.000000000")
	h := hostedServer(t, Config{FreePagesPerDay: 25, FreePagesPerIP: -1, FreePagesGlobal: -1, ExtractPerMinute: 30, BatchPagesPerMinute: 300}, uid)
	f := newFakeBatches(t)
	rec, body := do(t, h, http.MethodPost, "/api/batches", batchBody(t, "max", 2))
	if rec.Code != http.StatusPaymentRequired || body["code"] != "insufficient_credits" || f.creates != 0 {
		t.Fatalf("no credits: %d %v (creates %d)", rec.Code, body, f.creates)
	}
}

func TestRejectedBatchGivesCreditsBack(t *testing.T) {
	uid := "user_br_" + time.Now().Format("150405.000000000")
	h := hostedServer(t, Config{ExtractPerMinute: 30, BatchPagesPerMinute: 300}, uid)
	f := newFakeBatches(t)
	f.failNew = true
	st := ledgerStore(t)
	if _, err := st.CreditTopup(context.Background(), uid, "cs_"+uid, "pi_"+uid, 1_000_000); err != nil {
		t.Fatal(err)
	}
	if rec, _ := do(t, h, http.MethodPost, "/api/batches", batchBody(t, "accurate", 2)); rec.Code != http.StatusBadRequest {
		t.Fatalf("anthropic 400: %d", rec.Code)
	}
	if got := balance(t, st, uid); got != 1_000_000 {
		t.Fatalf("balance %d after a refused batch", got)
	}
}

func TestBatchPageRateLimit(t *testing.T) {
	uid := "user_bl_" + time.Now().Format("150405.000000000")
	h := hostedServer(t, Config{ExtractPerMinute: 30, BatchPagesPerMinute: 3}, uid)
	newFakeBatches(t)
	if rec, _ := do(t, h, http.MethodPost, "/api/batches", batchBody(t, "accurate", 4)); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("4 pages with a limit of 3 a minute: %d", rec.Code)
	}
}

// Bring-your-own-key batches are passed straight through with the caller's
// key, need no database, and report each page's result.
func TestBYOKBatchPassThrough(t *testing.T) {
	f := newFakeBatches(t)
	h := New(Config{}).Router()
	const key = "sk-ant-byok-SECRET"
	req := httptest.NewRequest(http.MethodPost, "/api/batches", strings.NewReader(batchBody(t, "fast", 2)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Anthropic-Key", key)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 || f.key != key || len(f.ids) != 2 {
		t.Fatalf("byok submit: %d %s (key %q)", rec.Code, rec.Body, f.key)
	}
	f.ended = true
	f.result = func(string) string { return succeeded("claude-haiku-5-5", 1000, 100) }
	req = httptest.NewRequest(http.MethodGet, "/api/batches/"+f.id, nil)
	req.Header.Set("X-Anthropic-Key", key)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out batchStatusOut
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if rec.Code != 200 || len(out.Items) != 2 || out.Items[0].Result == nil || out.Items[0].Result.Source != "byok" {
		t.Fatalf("byok status: %d %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "SECRET") {
		t.Fatal("key echoed back")
	}
}

func TestNameTablesIsTextOnly(t *testing.T) {
	f := newFakeBatches(t)
	f.message = `{"id":"m","type":"message","role":"assistant","model":"claude-haiku-5-5","stop_reason":"end_turn","content":[{"type":"text","text":"{\"titles\":[{\"index\":0,\"title\":\"Line items\"}]}"}],"usage":{"input_tokens":400,"output_tokens":20}}`
	h := New(Config{}).Router()
	req := httptest.NewRequest(http.MethodPost, "/api/name-tables", strings.NewReader(`{"tables":[{"header":["Item","Qty"],"rows":[["Widget","2"]]}]}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Anthropic-Key", "sk-ant-byok")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "Line items") {
		t.Fatalf("naming: %d %s", rec.Code, rec.Body)
	}
	if len(f.sent) != 1 || strings.Contains(f.sent[0], `"image"`) || !strings.Contains(f.sent[0], "claude-haiku-5-5") {
		t.Fatalf("naming must be one text-only Fast call: %v", f.sent)
	}
	// Bounded: more sample rows than allowed is refused before any call.
	req = httptest.NewRequest(http.MethodPost, "/api/name-tables", strings.NewReader(`{"tables":[{"header":["a"],"rows":[["1"],["2"],["3"],["4"]]}]}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Anthropic-Key", "sk-ant-byok")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest || len(f.sent) != 1 {
		t.Fatalf("oversized naming request: %d", rec.Code)
	}
}

func TestHostedNamingUsesTheFreeQuota(t *testing.T) {
	uid := "user_nm_" + time.Now().Format("150405.000000000")
	h := hostedServer(t, Config{FreePagesPerDay: 1, FreePagesPerIP: -1, FreePagesGlobal: -1, ExtractPerMinute: 30}, uid)
	f := newFakeBatches(t)
	f.message = `{"id":"m","type":"message","role":"assistant","model":"claude-haiku-5-5","stop_reason":"end_turn","content":[{"type":"text","text":"{\"titles\":[]}"}],"usage":{"input_tokens":400,"output_tokens":20}}`
	body := `{"tables":[{"header":["Item"],"rows":[]}]}`
	if rec, out := do(t, h, http.MethodPost, "/api/name-tables", body); rec.Code != 200 || out["source"] != "free" {
		t.Fatalf("first naming call: %d %v", rec.Code, out)
	}
	// Quota used up and no credits: the same refusal as a page.
	if rec, out := do(t, h, http.MethodPost, "/api/name-tables", body); rec.Code != http.StatusPaymentRequired || out["code"] != "insufficient_credits" {
		t.Fatalf("second naming call: %d %v", rec.Code, out)
	}
}
