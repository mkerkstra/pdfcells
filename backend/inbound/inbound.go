// Package inbound forwards mail received at @pdfcells.com (via Resend
// receiving) to the owner's inbox.
//
// Resend posts an email.received webhook carrying only metadata; we fetch the
// message and its attachments and re-send it from support@ with Reply-To set
// to the original sender, so replying from the inbox answers them directly.
package inbound

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Forwarder holds the Resend credentials and routing.
type Forwarder struct {
	APIKey        string
	WebhookSecret string // whsec_…
	To            string // destination inbox
	From          string // e.g. "PDFCells support <support@pdfcells.com>"
	BaseURL       string // https://api.resend.com (overridable in tests)
	HTTP          *http.Client
	Now           func() time.Time
}

// ErrBadSignature means the webhook did not come from Resend (or was replayed).
var ErrBadSignature = errors.New("inbound: bad webhook signature")

// ErrIgnored marks events that need no action.
var ErrIgnored = errors.New("inbound: event ignored")

const tolerance = 5 * time.Minute

// Verify checks a Svix-signed webhook (the scheme Resend uses): HMAC-SHA256
// over "id.timestamp.body" keyed with the base64 part of the whsec_ secret.
func (f *Forwarder) Verify(h http.Header, body []byte) error {
	id, ts, sigs := h.Get("svix-id"), h.Get("svix-timestamp"), h.Get("svix-signature")
	if id == "" || ts == "" || sigs == "" {
		return ErrBadSignature
	}
	secs, err := strconv.ParseInt(ts, 10, 64)
	if err != nil {
		return ErrBadSignature
	}
	if d := f.now().Sub(time.Unix(secs, 0)); d > tolerance || d < -tolerance {
		return ErrBadSignature
	}
	key, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(f.WebhookSecret, "whsec_"))
	if err != nil || len(key) == 0 {
		return fmt.Errorf("inbound: webhook secret is not valid base64: %w", err)
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(id + "." + ts + "."))
	mac.Write(body)
	want := mac.Sum(nil)
	// The header may carry several space-separated "v1,<base64>" signatures.
	for _, s := range strings.Fields(sigs) {
		v, sig, ok := strings.Cut(s, ",")
		if !ok || v != "v1" {
			continue
		}
		got, err := base64.StdEncoding.DecodeString(sig)
		if err == nil && hmac.Equal(got, want) {
			return nil
		}
	}
	return ErrBadSignature
}

// EmailID extracts the received email's ID from an email.received event.
func EmailID(body []byte) (string, error) {
	var ev struct {
		Type string `json:"type"`
		Data struct {
			EmailID string `json:"email_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &ev); err != nil {
		return "", err
	}
	if ev.Type != "email.received" || ev.Data.EmailID == "" {
		return "", ErrIgnored
	}
	return ev.Data.EmailID, nil
}

type received struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html"`
	Text    *string  `json:"text"`
}

type attachment struct {
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	ContentID   string `json:"content_id"`
	DownloadURL string `json:"download_url"`
}

type outgoing struct {
	From        string           `json:"from"`
	To          []string         `json:"to"`
	ReplyTo     string           `json:"reply_to,omitempty"`
	Subject     string           `json:"subject"`
	HTML        string           `json:"html,omitempty"`
	Text        string           `json:"text"`
	Attachments []map[string]any `json:"attachments,omitempty"`
}

// Forward fetches the received email and re-sends it to f.To. The email ID is
// the idempotency key, so a retried webhook can't deliver twice.
func (f *Forwarder) Forward(ctx context.Context, emailID string) error {
	// The ID comes from a verified webhook, but it is interpolated into API
	// paths called with our key, so accept only the UUID-like shape Resend uses.
	if !validID(emailID) {
		return fmt.Errorf("inbound: malformed email id")
	}
	var msg received
	if err := f.call(ctx, http.MethodGet, "/emails/receiving/"+emailID, nil, "", &msg); err != nil {
		return fmt.Errorf("fetch received email: %w", err)
	}
	var atts struct {
		Data []attachment `json:"data"`
	}
	if err := f.call(ctx, http.MethodGet, "/emails/receiving/"+emailID+"/attachments", nil, "", &atts); err != nil {
		return fmt.Errorf("list attachments: %w", err)
	}

	to := strings.Join(msg.To, ", ")
	banner := fmt.Sprintf("Forwarded from %s to %s", msg.From, to)
	out := outgoing{
		From:    f.From,
		To:      []string{f.To},
		ReplyTo: msg.From,
		Subject: msg.Subject,
		Text:    banner + "\n\n",
	}
	if out.Subject == "" {
		out.Subject = "(no subject)"
	}
	if msg.Text != nil {
		out.Text += *msg.Text
	}
	if msg.HTML != "" {
		out.HTML = `<p style="color:#5a6b62;font:13px sans-serif">` + htmlEscape(banner) + "</p>" + msg.HTML
	}
	for _, a := range atts.Data {
		m := map[string]any{"filename": a.Filename, "path": a.DownloadURL}
		if a.ContentType != "" {
			m["content_type"] = a.ContentType
		}
		if a.ContentID != "" {
			m["content_id"] = a.ContentID
		}
		out.Attachments = append(out.Attachments, m)
	}
	if err := f.call(ctx, http.MethodPost, "/emails", out, "fwd-"+emailID, nil); err != nil {
		return fmt.Errorf("send forward: %w", err)
	}
	return nil
}

func (f *Forwarder) call(ctx context.Context, method, path string, body any, idem string, out any) error {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, f.baseURL()+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+f.APIKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if idem != "" {
		req.Header.Set("Idempotency-Key", idem)
	}
	res, err := f.client().Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = res.Body.Close() }()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode >= 300 {
		// Error bodies end up in logs; keep them short so message content can't.
		msg := strings.TrimSpace(string(raw))
		if len(msg) > 300 {
			msg = msg[:300] + "…"
		}
		return fmt.Errorf("resend %s %s: %d %s", method, path, res.StatusCode, msg)
	}
	if out != nil {
		return json.Unmarshal(raw, out)
	}
	return nil
}

func (f *Forwarder) baseURL() string {
	if f.BaseURL != "" {
		return f.BaseURL
	}
	return "https://api.resend.com"
}

func (f *Forwarder) client() *http.Client {
	if f.HTTP != nil {
		return f.HTTP
	}
	return &http.Client{Timeout: 20 * time.Second}
}

func (f *Forwarder) now() time.Time {
	if f.Now != nil {
		return f.Now()
	}
	return time.Now()
}

func validID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, c := range id {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '-', c == '_':
		default:
			return false
		}
	}
	return true
}

func htmlEscape(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(s)
}
