SET lock_timeout = '5s';
ALTER TABLE ledger DROP CONSTRAINT ledger_kind_check;
ALTER TABLE ledger ADD CONSTRAINT ledger_kind_check
    CHECK (kind IN ('topup', 'hold', 'usage', 'free', 'adjust', 'refund')) NOT VALID;
