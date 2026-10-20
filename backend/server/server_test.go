package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func do(t *testing.T, h http.Handler, method, path, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

func TestUnconfiguredDeployServesLocalOnly(t *testing.T) {
	h := New(Config{MarkupBps: 1500, FreePagesPerDay: 25}).Router()

	rec, cfg := do(t, h, http.MethodGet, "/api/config", "")
	if rec.Code != 200 || cfg["hosted"] != false || cfg["clerk_publishable_key"] != nil {
		t.Fatalf("config: %d %v", rec.Code, cfg)
	}
	if tiers, _ := cfg["tiers"].([]any); len(tiers) != 3 {
		t.Fatalf("want 3 tiers, got %v", cfg["tiers"])
	}

	rec, body := do(t, h, http.MethodPost, "/api/extract", `{"tier":"fast","image_base64":"aGk="}`)
	if rec.Code != http.StatusBadRequest {
		// "hi" is not an image: rejected before any model call or billing.
		t.Fatalf("non-image: %d %v", rec.Code, body)
	}

	rec, _ = do(t, h, http.MethodPost, "/api/checkout", `{"amount_cents":500}`)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("checkout without stripe: %d", rec.Code)
	}
	rec, _ = do(t, h, http.MethodPost, "/api/stripe/webhook", `{}`)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("webhook without stripe: %d", rec.Code)
	}
}

func TestBadRequests(t *testing.T) {
	h := New(Config{}).Router()
	if rec, _ := do(t, h, http.MethodPost, "/api/extract", `{`); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad json: %d", rec.Code)
	}
	if rec, _ := do(t, h, http.MethodPost, "/api/extract", `{"tier":"turbo"}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad tier: %d", rec.Code)
	}
}
