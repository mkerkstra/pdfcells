package server

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/clerk/clerk-sdk-go/v2"

	"github.com/mkerkstra/pdfcells/backend/extract"
)

func TestAuthorizedPartyConfig(t *testing.T) {
	t.Setenv("CLERK_AUTHORIZED_PARTIES", "")
	def := ConfigFromEnv().AuthorizedParties
	allow := azpAllowed(def)
	for _, ok := range []string{"https://pdfcells.com", "https://www.pdfcells.com", "http://localhost:5173", "https://pdfcells.com/"} {
		if !allow(ok) {
			t.Errorf("default parties should allow %q", ok)
		}
	}
	for _, bad := range []string{"", "https://evil.com", "https://pdfcells.com.evil.com", "http://pdfcells.com", "https://pdfcells-abc.vercel.app"} {
		if allow(bad) {
			t.Errorf("default parties must reject %q", bad)
		}
	}

	t.Setenv("CLERK_AUTHORIZED_PARTIES", " https://staging.pdfcells.com/ , ,https://pdfcells.com")
	parties := ConfigFromEnv().AuthorizedParties
	if len(parties) != 2 || parties[0] != "https://staging.pdfcells.com" {
		t.Fatalf("parsed %q", parties)
	}
	if allow := azpAllowed(parties); !allow("https://staging.pdfcells.com") || allow("https://www.pdfcells.com") {
		t.Fatal("override must replace the defaults")
	}
}

func TestAbuseDefaults(t *testing.T) {
	for _, k := range []string{"FREE_PAGES_PER_IP_PER_DAY", "FREE_PAGES_GLOBAL_PER_DAY", "RATE_EXTRACT_PER_MINUTE", "RATE_CHECKOUT_PER_MINUTE", "IP_HASH_SECRET"} {
		t.Setenv(k, "")
	}
	t.Setenv("CLERK_SECRET_KEY", "sk_test_x")
	c := ConfigFromEnv()
	if c.FreePagesPerIP != 40 || c.FreePagesGlobal != 2000 || c.ExtractPerMinute != 30 || c.CheckoutPerMinute != 5 {
		t.Fatalf("defaults: %+v", c)
	}
	if c.IPHashSecret == "" || c.IPHashSecret == "sk_test_x" {
		t.Fatal("IP hash secret must be derived, not the raw Clerk key")
	}
	t.Setenv("FREE_PAGES_GLOBAL_PER_DAY", "0")
	if ConfigFromEnv().FreePagesGlobal != 0 {
		t.Fatal("0 must survive as the kill switch")
	}
}

func TestClientIPAndHash(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/api/extract", nil)
	r.Header.Set("X-Vercel-Forwarded-For", "203.0.113.7, 10.0.0.1")
	r.Header.Set("X-Forwarded-For", "198.51.100.1")
	if ip := clientIP(r); ip != "203.0.113.7" {
		t.Fatalf("clientIP=%q", ip)
	}
	r.Header.Del("X-Vercel-Forwarded-For")
	if ip := clientIP(r); ip != "198.51.100.1" {
		t.Fatalf("fallback clientIP=%q", ip)
	}
	a, b := ipHash("k1", "203.0.113.7"), ipHash("k1", "203.0.113.8")
	if a == b || a != ipHash("k1", "203.0.113.7") || a == ipHash("k2", "203.0.113.7") || strings.Contains(a, "203") {
		t.Fatal("hash must be keyed, stable and not reveal the IP")
	}
	if ipHash("k", "2001:db8:1:2::1") != ipHash("k", "2001:db8:1:2:ffff::9") {
		t.Fatal("one IPv6 /64 must share a bucket")
	}
}

func TestAPIHeadersAndStrictRouting(t *testing.T) {
	h := New(Config{}).Router()
	rec, _ := do(t, h, http.MethodGet, "/api/config", "")
	for k, want := range map[string]string{
		"X-Content-Type-Options":  "nosniff",
		"X-Frame-Options":         "DENY",
		"Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
		"Cache-Control":           "no-store",
	} {
		if got := rec.Header().Get(k); got != want {
			t.Errorf("%s=%q want %q", k, got, want)
		}
	}
	if rec, body := do(t, h, http.MethodGet, "/api/extract", ""); rec.Code != http.StatusMethodNotAllowed || body["code"] != "method_not_allowed" {
		t.Errorf("GET /api/extract: %d %v", rec.Code, body)
	}
	if rec, body := do(t, h, http.MethodGet, "/api/nope", ""); rec.Code != http.StatusNotFound || body["code"] != "not_found" {
		t.Errorf("unknown route: %d %v", rec.Code, body)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/extract", strings.NewReader(`{"tier":"fast"}`))
	req.Header.Set("Content-Type", "text/plain")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Errorf("text/plain POST: %d", rec.Code)
	}
}

func pageB64(t *testing.T, w, h int, ink bool) string {
	t.Helper()
	img := image.NewGray(image.Rect(0, 0, w, h))
	for i := range img.Pix {
		img.Pix[i] = 255
	}
	if ink {
		for y := 100; y < 400; y += 20 {
			for x := 100; x < w-100; x++ {
				img.SetGray(x, y, color.Gray{})
				img.SetGray(x, y+1, color.Gray{})
			}
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

// fakeAnthropic stands in for api.anthropic.com and records which key it got.
func fakeAnthropic(t *testing.T) (gotKey func() string) {
	t.Helper()
	var mu sync.Mutex
	var key string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		key = r.Header.Get("X-Api-Key")
		mu.Unlock()
		_, _ = io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"type":"error","error":{"type":"invalid_request_error","message":"nope"}}`))
	}))
	t.Cleanup(srv.Close)
	old := extract.BaseURL
	extract.BaseURL = srv.URL + "/"
	t.Cleanup(func() { extract.BaseURL = old })
	return func() string { mu.Lock(); defer mu.Unlock(); return key }
}

func TestBYOKKeyOnlyForwardedNeverLogged(t *testing.T) {
	gotKey := fakeAnthropic(t)
	s := New(Config{})
	var logs bytes.Buffer
	s.log = slog.New(slog.NewJSONHandler(&logs, nil))
	const key = "sk-ant-test-SECRET-1234567890"
	body := `{"tier":"fast","image_base64":"` + pageB64(t, 800, 1000, true) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/extract", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Anthropic-Key", key)
	rec := httptest.NewRecorder()
	s.Router().ServeHTTP(rec, req)
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

// hostedServer is a hosted deployment against TEST_DATABASE_URL with the
// Clerk session injected directly (no real JWTs in tests).
func hostedServer(t *testing.T, cfg Config, uid string) http.Handler {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	fakeAnthropic(t)
	cfg.AnthropicKey, cfg.DatabaseURL, cfg.ClerkSecretKey, cfg.ClerkPublishableKey = "sk-ant-server", url, "sk_test_fake", "pk_test_fake"
	cfg.MarkupBps, cfg.IPHashSecret = 1500, "test"
	s := New(cfg)
	s.log = slog.New(slog.NewJSONHandler(io.Discard, nil))
	router := s.Router()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := clerk.ContextWithSessionClaims(r.Context(), &clerk.SessionClaims{
			RegisteredClaims: clerk.RegisteredClaims{Subject: uid},
		})
		router.ServeHTTP(w, r.WithContext(ctx))
	})
}

func TestHostedGuardsAndRateLimit(t *testing.T) {
	uid := "user_rl_" + time.Now().Format("150405.000000000")
	h := hostedServer(t, Config{FreePagesPerDay: 25, FreePagesPerIP: -1, FreePagesGlobal: -1, ExtractPerMinute: 2}, uid)
	blank := `{"tier":"fast","image_base64":"` + pageB64(t, 800, 1000, false) + `"}`
	rec, body := do(t, h, http.MethodPost, "/api/extract", blank)
	if rec.Code != http.StatusBadRequest || !strings.Contains(body["error"].(string), "page") {
		t.Fatalf("blank page must be rejected before any reservation: %d %v", rec.Code, body)
	}
	long := `{"tier":"fast","image_base64":"` + pageB64(t, 800, 1000, true) + `","text_layer":"` + strings.Repeat("x", extract.HostedMaxTextLayer+1) + `"}`
	if rec, _ := do(t, h, http.MethodPost, "/api/extract", long); rec.Code != http.StatusBadRequest {
		t.Fatalf("oversized text layer: %d", rec.Code)
	}
	rec, _ = do(t, h, http.MethodPost, "/api/extract", blank)
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("third call in a minute with limit 2: %d (Retry-After %q)", rec.Code, rec.Header().Get("Retry-After"))
	}
}

func TestGlobalKillSwitchFallsBackToCredits(t *testing.T) {
	uid := "user_ks_" + time.Now().Format("150405.000000000")
	h := hostedServer(t, Config{FreePagesPerDay: 25, FreePagesPerIP: -1, FreePagesGlobal: 0, ExtractPerMinute: 10}, uid)
	page := `{"tier":"fast","image_base64":"` + pageB64(t, 800, 1000, true) + `"}`
	rec, body := do(t, h, http.MethodPost, "/api/extract", page)
	// No free pages today and no credits: the UI's existing top-up path.
	if rec.Code != http.StatusPaymentRequired || body["code"] != "insufficient_credits" {
		t.Fatalf("kill switch: %d %v", rec.Code, body)
	}
}

func TestCheckoutRateLimited(t *testing.T) {
	uid := "user_co_" + time.Now().Format("150405.000000000")
	h := hostedServer(t, Config{CheckoutPerMinute: 1, StripeSecretKey: "sk_test_fake", StripeWebhookSecret: "whsec_fake"}, uid)
	// Bad amount: rejected locally after the limiter counted it.
	if rec, _ := do(t, h, http.MethodPost, "/api/checkout", `{"amount_cents":1}`); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad amount: %d", rec.Code)
	}
	if rec, _ := do(t, h, http.MethodPost, "/api/checkout", `{"amount_cents":1}`); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("second checkout in a minute with limit 1: %d", rec.Code)
	}
}
