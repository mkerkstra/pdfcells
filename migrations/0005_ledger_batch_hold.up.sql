-- 'batch_hold' holds credits for a page sent in a Message Batch. It lives up
-- to 24 hours (Anthropic's batch window), so it must never be swept by the
-- 15-minute stale-hold release that applies to 'hold'.
-- Touches ledger: bounded lock wait, and the constraint is added NOT VALID
-- here and validated in 0006 under a weaker lock.
SET lock_timeout = '5s';
ALTER TABLE ledger DROP CONSTRAINT ledger_kind_check;
ALTER TABLE ledger ADD CONSTRAINT ledger_kind_check
    CHECK (kind IN ('topup', 'hold', 'usage', 'free', 'adjust', 'refund', 'batch_hold')) NOT VALID;
