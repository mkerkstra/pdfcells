DROP INDEX ledger_free_ip;
DROP INDEX ledger_free_created;
ALTER TABLE ledger DROP COLUMN ip_hash;
DROP TABLE rate_limits;
