// Package billing sells prepaid credits through Stripe Checkout with Managed
// Payments, so Stripe is merchant of record (sales tax/VAT, fraud, disputes).
//
// Top-ups convert 1:1 into credits; the markup is applied when a page is
// charged, so the ledger shows Anthropic's exact cost next to what was billed.
package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"

	"github.com/stripe/stripe-go/v87"
	"github.com/stripe/stripe-go/v87/webhook"
)

// TopupAmountsCents are the purchasable credit packs. $10 is the floor: with
// Managed Payments (≈2.9% + 30¢ + 3.5%) a $5 pack loses ~12% to fees.
var TopupAmountsCents = []int64{1000, 2500, 5000}

// taxCode is Stripe's "AI as a Service - cloud based - personal use", an
// eligible Managed Payments category. Personal use is the conservative choice
// for US states that tax consumer digital services.
const taxCode = "txcd_10105001"

const metaCredit = "credit_cents"

type Billing struct {
	client        *stripe.Client
	webhookSecret string
	appURL        string
}

func New(secretKey, webhookSecret, appURL string) *Billing {
	return &Billing{client: stripe.NewClient(secretKey), webhookSecret: webhookSecret, appURL: appURL}
}

// Checkout creates a hosted Managed Payments Checkout session for a credit pack.
func (b *Billing) Checkout(ctx context.Context, userID string, amountCents int64) (string, error) {
	if !slices.Contains(TopupAmountsCents, amountCents) {
		return "", fmt.Errorf("amount must be one of %v cents", TopupAmountsCents)
	}
	s, err := b.client.V1CheckoutSessions.Create(ctx, &stripe.CheckoutSessionCreateParams{
		Mode:              stripe.String(string(stripe.CheckoutSessionModePayment)),
		ManagedPayments:   &stripe.CheckoutSessionCreateManagedPaymentsParams{Enabled: stripe.Bool(true)},
		ClientReferenceID: stripe.String(userID),
		// The credit amount is fixed here, server-side: with Managed Payments
		// the customer may pay in local currency plus tax, so the charged
		// amount is not the credit amount.
		Metadata:   map[string]string{"user_id": userID, metaCredit: strconv.FormatInt(amountCents, 10)},
		SuccessURL: stripe.String(b.appURL + "/?topup=success"),
		CancelURL:  stripe.String(b.appURL + "/?topup=cancelled"),
		LineItems: []*stripe.CheckoutSessionCreateLineItemParams{{
			Quantity: stripe.Int64(1),
			PriceData: &stripe.CheckoutSessionCreateLineItemPriceDataParams{
				Currency:   stripe.String("usd"),
				UnitAmount: stripe.Int64(amountCents),
				ProductData: &stripe.CheckoutSessionCreateLineItemPriceDataProductDataParams{
					Name:        stripe.String(fmt.Sprintf("PDFCells AI credits ($%d)", amountCents/100)),
					Description: stripe.String("Prepaid credits for AI page conversions. Credits never expire."),
					TaxCode:     stripe.String(taxCode),
				},
			},
		}},
	})
	if err != nil {
		return "", err
	}
	return s.URL, nil
}

// Topup is a verified, paid Checkout session.
type Topup struct {
	SessionID     string
	PaymentIntent string
	UserID        string
	AmountMicros  int64
}

// Refund is a (possibly partial, cumulative) refund of a top-up's charge.
type Refund struct {
	PaymentIntent string
	Refunded      int64 // charge currency units, cumulative
	Total         int64
}

// Event is the one actionable thing a webhook carries.
type Event struct {
	Topup  *Topup
	Refund *Refund
}

// ErrIgnored marks webhook events that need no action.
var ErrIgnored = errors.New("event ignored")

// ParseWebhook verifies the signature and extracts a top-up or refund.
func (b *Billing) ParseWebhook(payload []byte, signature string) (*Event, error) {
	ev, err := webhook.ConstructEventWithOptions(payload, signature, b.webhookSecret,
		webhook.ConstructEventOptions{IgnoreAPIVersionMismatch: true})
	if err != nil {
		return nil, fmt.Errorf("webhook signature: %w", err)
	}
	switch ev.Type {
	case "checkout.session.completed", "checkout.session.async_payment_succeeded":
		var s stripe.CheckoutSession
		if err := json.Unmarshal(ev.Data.Raw, &s); err != nil {
			return nil, err
		}
		if s.PaymentStatus != stripe.CheckoutSessionPaymentStatusPaid {
			return nil, ErrIgnored
		}
		cents, err := strconv.ParseInt(s.Metadata[metaCredit], 10, 64)
		if err != nil || !slices.Contains(TopupAmountsCents, cents) {
			return nil, fmt.Errorf("checkout session %s has no valid %s metadata", s.ID, metaCredit)
		}
		if s.ClientReferenceID == "" {
			return nil, errors.New("checkout session has no client_reference_id")
		}
		t := &Topup{SessionID: s.ID, UserID: s.ClientReferenceID, AmountMicros: cents * 10_000}
		if s.PaymentIntent != nil {
			t.PaymentIntent = s.PaymentIntent.ID
		}
		return &Event{Topup: t}, nil
	case "charge.refunded":
		var c stripe.Charge
		if err := json.Unmarshal(ev.Data.Raw, &c); err != nil {
			return nil, err
		}
		if c.PaymentIntent == nil {
			return nil, ErrIgnored
		}
		return &Event{Refund: &Refund{PaymentIntent: c.PaymentIntent.ID, Refunded: c.AmountRefunded, Total: c.Amount}}, nil
	}
	return nil, ErrIgnored
}
