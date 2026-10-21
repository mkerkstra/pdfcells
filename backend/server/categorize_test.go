package server

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mkerkstra/pdfcells/backend/extract"
)

func postCategorize(t *testing.T, h http.Handler, body, key string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/categorize", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("X-Anthropic-Key", key)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestCategorizeBYOKKeyOnlyForwardedNeverLogged(t *testing.T) {
	gotKey := fakeAnthropic(t)
	s := New(Config{})
	var logs bytes.Buffer
	s.log = slog.New(slog.NewJSONHandler(&logs, nil))
	const key = "sk-ant-test-SECRET-1234567890"
	rec := postCategorize(t, s.Router(), `{"tier":"fast","payees":["Blue Bottle Coffee"]}`, key)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want the fake's 400 mapped through, got %d %s", rec.Code, rec.Body)
	}
	if gotKey() != key {
		t.Fatalf("key not forwarded to the pinned base URL (got %q)", gotKey())
	}
	if strings.Contains(logs.String(), "SECRET") || strings.Contains(rec.Body.String(), "SECRET") {
		t.Fatalf("BYOK key leaked: logs=%s body=%s", logs.String(), rec.Body)
	}
}

func TestCategorizeBadRequests(t *testing.T) {
	h := New(Config{}).Router()
	for name, body := range map[string]string{
		"bad json":   `{"tier":`,
		"bad tier":   `{"tier":"turbo","payees":["a"]}`,
		"no payees":  `{"tier":"fast","payees":[]}`,
		"too long":   `{"tier":"fast","payees":["` + strings.Repeat("x", extract.MaxPayeeRunes+1) + `"]}`,
		"empty name": `{"tier":"fast","payees":["  "]}`,
	} {
		if rec := postCategorize(t, h, body, "sk-ant-test"); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: want 400, got %d %s", name, rec.Code, rec.Body)
		}
	}
	// Too big a body is refused before decoding.
	big := `{"tier":"fast","payees":["` + strings.Repeat("x", categorizeBody) + `"]}`
	if rec := postCategorize(t, h, big, "sk-ant-test"); rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized body: want 413, got %d", rec.Code)
	}
}

func TestCategorizeLocalOnlyDeployHasNoHostedPath(t *testing.T) {
	h := New(Config{}).Router()
	rec := postCategorize(t, h, `{"tier":"fast","payees":["Shop"]}`, "")
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "hosted_disabled") {
		t.Fatalf("no key on a local-only deploy: %d %s", rec.Code, rec.Body)
	}
}

func TestCategorizeRequiresJSON(t *testing.T) {
	h := New(Config{}).Router()
	req := httptest.NewRequest(http.MethodPost, "/api/categorize", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "text/plain")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("text/plain: %d", rec.Code)
	}
}

func TestCategorizeHostedGuardsAndRateLimit(t *testing.T) {
	uid := "user_cat_" + time.Now().Format("150405.000000000")
	h := hostedServer(t, Config{FreePagesPerDay: 25, FreePagesPerIP: -1, FreePagesGlobal: -1, ExtractPerMinute: 2}, uid)
	many := make([]string, extract.HostedMaxPayees+1)
	for i := range many {
		many[i] = `"Shop"`
	}
	rec, body := do(t, h, http.MethodPost, "/api/categorize", `{"tier":"fast","payees":[`+strings.Join(many, ",")+`]}`)
	if rec.Code != http.StatusBadRequest || !strings.Contains(body["error"].(string), "too many payees") {
		t.Fatalf("hosted cap must refuse before any reservation: %d %v", rec.Code, body)
	}
	// The fake upstream rejects the call: the free page is released, the error mapped.
	if rec, body := do(t, h, http.MethodPost, "/api/categorize", `{"tier":"fast","payees":["Shop"]}`); rec.Code != http.StatusBadRequest || body["code"] != "model_rejected" {
		t.Fatalf("upstream 400: %d %v", rec.Code, body)
	}
	rec, _ = do(t, h, http.MethodPost, "/api/categorize", `{"tier":"fast","payees":["Shop"]}`)
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("third call in a minute with limit 2: %d", rec.Code)
	}
}

func TestCategorizeHostedNoCreditsNoCall(t *testing.T) {
	uid := "user_catc_" + time.Now().Format("150405.000000000")
	h := hostedServer(t, Config{FreePagesPerDay: 25, FreePagesPerIP: -1, FreePagesGlobal: -1, ExtractPerMinute: 10}, uid)
	rec, body := do(t, h, http.MethodPost, "/api/categorize", `{"tier":"max","payees":["Shop"]}`)
	if rec.Code != http.StatusPaymentRequired || body["code"] != "insufficient_credits" {
		t.Fatalf("paid tier with no credits: %d %v", rec.Code, body)
	}
}
