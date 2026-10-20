package inbound

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

var secretKey = []byte("0123456789abcdef0123456789abcdef")

func signed(id string, ts time.Time, body []byte) http.Header {
	mac := hmac.New(sha256.New, secretKey)
	mac.Write([]byte(id + "." + strconv.FormatInt(ts.Unix(), 10) + "."))
	mac.Write(body)
	h := http.Header{}
	h.Set("svix-id", id)
	h.Set("svix-timestamp", strconv.FormatInt(ts.Unix(), 10))
	h.Set("svix-signature", "v1,bm90LWl0 v1,"+base64.StdEncoding.EncodeToString(mac.Sum(nil)))
	return h
}

func forwarder(now time.Time) *Forwarder {
	return &Forwarder{WebhookSecret: "whsec_" + base64.StdEncoding.EncodeToString(secretKey), Now: func() time.Time { return now }}
}

func TestVerify(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	body := []byte(`{"type":"email.received","data":{"email_id":"e_1"}}`)
	f := forwarder(now)
	if err := f.Verify(signed("msg_1", now, body), body); err != nil {
		t.Fatalf("valid signature rejected: %v", err)
	}
	if err := f.Verify(signed("msg_1", now, body), []byte(`{"tampered":true}`)); !errors.Is(err, ErrBadSignature) {
		t.Fatal("tampered body accepted")
	}
	if err := f.Verify(signed("msg_1", now.Add(-10*time.Minute), body), body); !errors.Is(err, ErrBadSignature) {
		t.Fatal("stale timestamp accepted (replay)")
	}
	if err := f.Verify(http.Header{}, body); !errors.Is(err, ErrBadSignature) {
		t.Fatal("unsigned request accepted")
	}
}

func TestEmailID(t *testing.T) {
	if id, err := EmailID([]byte(`{"type":"email.received","data":{"email_id":"e_9"}}`)); err != nil || id != "e_9" {
		t.Fatalf("%q %v", id, err)
	}
	if _, err := EmailID([]byte(`{"type":"email.sent","data":{"email_id":"e_9"}}`)); !errors.Is(err, ErrIgnored) {
		t.Fatal("non-received events should be ignored")
	}
}

func TestForward(t *testing.T) {
	var sent outgoing
	var idem string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer re_test" {
			t.Errorf("missing auth on %s", r.URL.Path)
		}
		switch r.Method + " " + r.URL.Path {
		case "GET /emails/receiving/e_1":
			_, _ = io.WriteString(w, `{"from":"Ada <ada@example.org>","to":["support@pdfcells.com"],"subject":"Refund?","html":"<p>Hi</p>","text":"Hi"}`)
		case "GET /emails/receiving/e_1/attachments":
			_, _ = io.WriteString(w, `{"data":[{"filename":"receipt.pdf","content_type":"application/pdf","download_url":"https://cdn/x"}]}`)
		case "POST /emails":
			idem = r.Header.Get("Idempotency-Key")
			_ = json.NewDecoder(r.Body).Decode(&sent)
			_, _ = io.WriteString(w, `{"id":"out_1"}`)
		default:
			http.Error(w, "unexpected "+r.URL.Path, http.StatusNotFound)
		}
	}))
	defer srv.Close()

	f := &Forwarder{APIKey: "re_test", To: "owner@example.com", From: "PDFCells support <support@pdfcells.com>", BaseURL: srv.URL}
	if err := f.Forward(context.Background(), "e_1"); err != nil {
		t.Fatal(err)
	}
	if sent.ReplyTo != "Ada <ada@example.org>" || sent.To[0] != "owner@example.com" || sent.Subject != "Refund?" {
		t.Fatalf("routing wrong: %+v", sent)
	}
	if idem != "fwd-e_1" {
		t.Fatalf("idempotency key %q", idem)
	}
	if len(sent.Attachments) != 1 || sent.Attachments[0]["path"] != "https://cdn/x" {
		t.Fatalf("attachments %+v", sent.Attachments)
	}
	if sent.Text != "Forwarded from Ada <ada@example.org> to support@pdfcells.com\n\nHi" {
		t.Fatalf("text %q", sent.Text)
	}
}

func TestForwardRejectsMalformedID(t *testing.T) {
	called := false
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
	defer srv.Close()
	f := &Forwarder{APIKey: "re_test", To: "a@b.c", BaseURL: srv.URL}
	for _, id := range []string{"", "../../domains", "abc/def", "a?b=c", "x y"} {
		if err := f.Forward(context.Background(), id); err == nil {
			t.Errorf("id %q accepted", id)
		}
	}
	if called {
		t.Fatal("a malformed id reached the Resend API")
	}
}
