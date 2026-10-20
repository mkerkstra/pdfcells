-- Managed Payments lets Stripe refund customers directly; reverse the
-- unspent credit by payment intent when that happens.
ALTER TABLE ledger ADD COLUMN stripe_payment_intent text;
ALTER TABLE ledger DROP CONSTRAINT ledger_kind_check;
ALTER TABLE ledger ADD CONSTRAINT ledger_kind_check
    CHECK (kind IN ('topup', 'hold', 'usage', 'free', 'adjust', 'refund'));
CREATE INDEX ledger_payment_intent ON ledger (stripe_payment_intent) WHERE stripe_payment_intent IS NOT NULL;
