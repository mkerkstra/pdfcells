// Package billing sells prepaid credits through Stripe Checkout.
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

	"github.com/stripe/stripe-go/v87"
	"github.com/stripe/stripe-go/v87/webhook"
)

// TopupAmountsCents are the purchasable credit packs. $5 is the floor because
// Stripe's fixed fee makes smaller charges mostly fee.
var TopupAmountsCents = []int64{500, 1000, 2500}

type Billing struct {
	client        *stripe.Client
	webhookSecret string
	appURL        string
}

func New(secretKey, webhookSecret, appURL string) *Billing {
	return &Billing{client: stripe.NewClient(secretKey), webhookSecret: webhookSecret, appURL: appURL}
}

// Checkout creates a hosted Checkout session for a credit pack.
func (b *Billing) Checkout(ctx context.Context, userID, email string, amountCents int64) (string, error) {
	if !slices.Contains(TopupAmountsCents, amountCents) {
		return "", fmt.Errorf("amount must be one of %v cents", TopupAmountsCents)
	}
	params := &stripe.CheckoutSessionCreateParams{
		Mode:              stripe.String(string(stripe.CheckoutSessionModePayment)),
		ClientReferenceID: stripe.String(userID),
		Metadata:          map[string]string{"user_id": userID},
		SuccessURL:        stripe.String(b.appURL + "/?topup=success"),
		CancelURL:         stripe.String(b.appURL + "/?topup=cancelled"),
		LineItems: []*stripe.CheckoutSessionCreateLineItemParams{{
			Quantity: stripe.Int64(1),
			PriceData: &stripe.CheckoutSessionCreateLineItemPriceDataParams{
				Currency:   stripe.String("usd"),
				UnitAmount: stripe.Int64(amountCents),
				ProductData: &stripe.CheckoutSessionCreateLineItemPriceDataProductDataParams{
					Name: stripe.String(fmt.Sprintf("PDFCells credits ($%d)", amountCents/100)),
				},
			},
		}},
	}
	if email != "" {
		params.CustomerEmail = stripe.String(email)
	}
	s, err := b.client.V1CheckoutSessions.Create(ctx, params)
	if err != nil {
		return "", err
	}
	return s.URL, nil
}

// Topup is a verified, paid Checkout session.
type Topup struct {
	SessionID    string
	UserID       string
	AmountMicros int64
}

// ErrIgnored marks webhook events that need no action.
var ErrIgnored = errors.New("event ignored")

// ParseWebhook verifies the signature and extracts a completed top-up.
func (b *Billing) ParseWebhook(payload []byte, signature string) (*Topup, error) {
	ev, err := webhook.ConstructEventWithOptions(payload, signature, b.webhookSecret,
		webhook.ConstructEventOptions{IgnoreAPIVersionMismatch: true})
	if err != nil {
		return nil, fmt.Errorf("webhook signature: %w", err)
	}
	if ev.Type != "checkout.session.completed" && ev.Type != "checkout.session.async_payment_succeeded" {
		return nil, ErrIgnored
	}
	var s stripe.CheckoutSession
	if err := json.Unmarshal(ev.Data.Raw, &s); err != nil {
		return nil, err
	}
	if s.PaymentStatus != stripe.CheckoutSessionPaymentStatusPaid {
		return nil, ErrIgnored
	}
	if s.ClientReferenceID == "" {
		return nil, errors.New("checkout session has no client_reference_id")
	}
	return &Topup{SessionID: s.ID, UserID: s.ClientReferenceID, AmountMicros: s.AmountTotal * 10_000}, nil
}
