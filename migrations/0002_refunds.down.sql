DROP INDEX ledger_payment_intent;
DELETE FROM ledger WHERE kind = 'refund';
ALTER TABLE ledger DROP CONSTRAINT ledger_kind_check;
ALTER TABLE ledger ADD CONSTRAINT ledger_kind_check
    CHECK (kind IN ('topup', 'hold', 'usage', 'free', 'adjust'));
ALTER TABLE ledger DROP COLUMN stripe_payment_intent;
