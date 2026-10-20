-- Abuse controls that must hold across serverless instances.
-- Idempotent (IF NOT EXISTS) so it can be re-applied after the schema version
-- was rolled back without removing these objects.

-- Fixed-window request counters (per-user rate limits on /api/extract and
-- /api/checkout). Rows are tiny and old windows are pruned opportunistically.
CREATE TABLE IF NOT EXISTS rate_limits (
    key          text        NOT NULL,
    window_start timestamptz NOT NULL,
    hits         integer     NOT NULL DEFAULT 1,
    PRIMARY KEY (key, window_start)
);
CREATE INDEX IF NOT EXISTS rate_limits_window ON rate_limits (window_start);

-- Free pages also count against the caller's IP (HMAC-hashed, never stored
-- raw) and a global daily cap, both counted from the ledger's 'free' rows so
-- a released reservation frees its slot automatically.
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS ip_hash text;
CREATE INDEX IF NOT EXISTS ledger_free_created ON ledger (created_at) WHERE kind = 'free';
CREATE INDEX IF NOT EXISTS ledger_free_ip ON ledger (ip_hash, created_at) WHERE kind = 'free';
