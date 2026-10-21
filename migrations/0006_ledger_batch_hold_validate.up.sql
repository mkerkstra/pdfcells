-- Validates 0005's constraint under SHARE UPDATE EXCLUSIVE, which doesn't
-- block reads or writes of the ledger.
SET lock_timeout = '5s';
ALTER TABLE ledger VALIDATE CONSTRAINT ledger_kind_check;
