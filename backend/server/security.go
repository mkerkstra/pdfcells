package server

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"mime"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// DefaultAuthorizedParties are the origins whose Clerk session tokens the API
// accepts (the token's azp claim). CLERK_AUTHORIZED_PARTIES overrides it.
var DefaultAuthorizedParties = []string{
	"https://pdfcells.com",
	"https://www.pdfcells.com",
	"http://localhost:5173",
	"http://127.0.0.1:5173",
}

// parseList splits a comma-separated env value, dropping blanks and trailing
// slashes so "https://pdfcells.com/" matches the azp Clerk issues.
func parseList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimRight(strings.TrimSpace(p), "/"); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// azpAllowed returns the check for a session token's azp claim. Unlike the
// SDK's AuthorizedPartyMatches it also rejects a missing azp: every browser
// session token carries one, and the API is only called from the browser.
func azpAllowed(parties []string) func(string) bool {
	set := make(map[string]bool, len(parties))
	for _, p := range parties {
		set[p] = true
	}
	return func(azp string) bool { return set[strings.TrimRight(azp, "/")] }
}

// maxBody is the backstop request-size cap for every route (Vercel itself
// stops at 4.5 MB); handlers apply tighter limits.
const maxBody = 4_500_000

// secure sets defensive headers on every API response, caps the body and
// bounds how long a request may run.
func secure(timeout time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
			h.Set("Referrer-Policy", "no-referrer")
			h.Set("Cross-Origin-Resource-Policy", "same-origin")
			h.Set("Cache-Control", "no-store")
			if r.Body != nil {
				r.Body = http.MaxBytesReader(w, r.Body, maxBody)
			}
			ctx, cancel := context.WithTimeout(r.Context(), timeout)
			defer cancel()
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// requireJSON rejects non-JSON bodies with 415. Besides correctness, it means
// a cross-site form or text/plain POST can't reach a JSON handler without a
// CORS preflight, which this API never grants.
func requireJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mt != "application/json" {
			writeErr(w, http.StatusUnsupportedMediaType, "content_type", "Content-Type must be application/json")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// clientIP is the caller's address as seen by Vercel's edge, which sets
// x-vercel-forwarded-for / x-forwarded-for itself (client-supplied values are
// overwritten). Off Vercel it falls back to the TCP peer.
func clientIP(r *http.Request) string {
	for _, h := range []string{"X-Vercel-Forwarded-For", "X-Forwarded-For", "X-Real-Ip"} {
		if v := r.Header.Get(h); v != "" {
			first, _, _ := strings.Cut(v, ",")
			if ip := net.ParseIP(strings.TrimSpace(first)); ip != nil {
				return ip.String()
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// ipHash keys per-IP quotas without storing addresses: HMAC-SHA256 under a
// server secret. IPv6 addresses are reduced to their /64 so one host can't
// rotate through its own prefix.
func ipHash(secret, ip string) string {
	if p := net.ParseIP(ip); p != nil && p.To4() == nil {
		ip = p.Mask(net.CIDRMask(64, 128)).String() + "/64"
	}
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(ip))
	return hex.EncodeToString(m.Sum(nil))[:32]
}

func notFound(w http.ResponseWriter, _ *http.Request) {
	writeErr(w, http.StatusNotFound, "not_found", "no such endpoint")
}

func methodNotAllowed(w http.ResponseWriter, _ *http.Request) {
	writeErr(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
}

func unauthorized(w http.ResponseWriter, _ *http.Request) {
	writeErr(w, http.StatusUnauthorized, "bad_session", "session token rejected; sign in again")
}

func tooMany(w http.ResponseWriter, retry time.Duration) {
	w.Header().Set("Retry-After", strconv.Itoa(int(retry.Round(time.Second)/time.Second)))
	writeErr(w, http.StatusTooManyRequests, "rate_limited", "too many requests; slow down and retry shortly")
}
