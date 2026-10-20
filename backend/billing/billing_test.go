package billing

import (
	"errors"
	"testing"
	"time"

	"github.com/stripe/stripe-go/v87/webhook"
)

const secret = "whsec_test"

func sign(t *testing.T, body string) (string, []byte) {
	t.Helper()
	p := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: []byte(body), Secret: secret, Timestamp: time.Now()})
	return p.Header, p.Payload
}

func TestTopupCreditsMetadataNotChargedAmount(t *testing.T) {
	b := New("sk_test", secret, "https://pdfcells.com", nil)
	// Paid in EUR with VAT: amount_total must not drive the credit.
	sig, body := sign(t, `{"id":"evt_1","object":"event","type":"checkout.session.completed","data":{"object":{
		"id":"cs_1","object":"checkout.session","payment_status":"paid","client_reference_id":"user_1",
		"amount_total":1104,"currency":"eur","payment_intent":"pi_1","metadata":{"credit_cents":"1000"}}}}`)
	ev, err := b.ParseWebhook(body, sig)
	if err != nil {
		t.Fatal(err)
	}
	if ev.Topup == nil || ev.Topup.AmountMicros != 10_000_000 || ev.Topup.PaymentIntent != "pi_1" || ev.Topup.UserID != "user_1" {
		t.Fatalf("topup = %+v", ev.Topup)
	}
}

func TestTopupRejectsUnknownPack(t *testing.T) {
	b := New("sk_test", secret, "", nil)
	sig, body := sign(t, `{"id":"evt_2","object":"event","type":"checkout.session.completed","data":{"object":{
		"id":"cs_2","object":"checkout.session","payment_status":"paid","client_reference_id":"u","metadata":{"credit_cents":"999999"}}}}`)
	if _, err := b.ParseWebhook(body, sig); err == nil || errors.Is(err, ErrIgnored) {
		t.Fatalf("expected hard error for unknown pack, got %v", err)
	}
}

func TestRefundEvent(t *testing.T) {
	b := New("sk_test", secret, "", nil)
	sig, body := sign(t, `{"id":"evt_3","object":"event","type":"charge.refunded","data":{"object":{
		"id":"ch_1","object":"charge","amount":1104,"amount_refunded":552,"payment_intent":"pi_1"}}}`)
	ev, err := b.ParseWebhook(body, sig)
	if err != nil {
		t.Fatal(err)
	}
	if ev.Refund == nil || ev.Refund.Refunded != 552 || ev.Refund.Total != 1104 || ev.Refund.PaymentIntent != "pi_1" {
		t.Fatalf("refund = %+v", ev.Refund)
	}
}

func TestUnpaidAndOtherEventsIgnored(t *testing.T) {
	b := New("sk_test", secret, "", nil)
	for _, body := range []string{
		`{"id":"e","object":"event","type":"checkout.session.completed","data":{"object":{"id":"cs","object":"checkout.session","payment_status":"unpaid"}}}`,
		`{"id":"e","object":"event","type":"customer.created","data":{"object":{"id":"cus","object":"customer"}}}`,
	} {
		sig, payload := sign(t, body)
		if _, err := b.ParseWebhook(payload, sig); !errors.Is(err, ErrIgnored) {
			t.Fatalf("want ErrIgnored, got %v", err)
		}
	}
	if _, err := b.ParseWebhook([]byte(`{}`), "t=1,v1=bad"); err == nil {
		t.Fatal("bad signature must fail")
	}
}

func TestParsePriceIDs(t *testing.T) {
	m, err := ParsePriceIDs(" 1000=price_a, 2500=price_b ,5000=price_c")
	if err != nil || m[1000] != "price_a" || m[5000] != "price_c" {
		t.Fatalf("%v %v", m, err)
	}
	if m, err := ParsePriceIDs(""); err != nil || len(m) != 0 {
		t.Fatal("empty should be allowed")
	}
	for _, bad := range []string{"999=price_a", "1000=prod_x", "1000"} {
		if _, err := ParsePriceIDs(bad); err == nil {
			t.Errorf("%q should fail", bad)
		}
	}
}
