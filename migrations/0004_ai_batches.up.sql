-- Hosted AI pages sent through Anthropic's Message Batches API (half price,
-- results within hours). One ai_batches row per Anthropic batch, one
-- ai_batch_items row per page. Only billing state lives here: page images,
-- text and extracted tables never do (results are read back from Anthropic).
-- New tables only; nothing here locks ledger or accounts.
CREATE TABLE IF NOT EXISTS ai_batches (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id            text        NOT NULL,
    tier               text        NOT NULL,
    -- Set once Anthropic accepted the batch; NULL while credits are reserved.
    anthropic_batch_id text UNIQUE,
    -- reserved: holds placed, not yet accepted by Anthropic
    -- submitted: running at Anthropic
    -- settled: every page charged or released
    -- failed: never accepted, every hold released
    state              text        NOT NULL DEFAULT 'reserved'
        CHECK (state IN ('reserved', 'submitted', 'settled', 'failed')),
    -- The browser's id for this submission, so a retry after a lost response
    -- finds the batch it already paid for instead of sending the pages twice.
    submission_id      text        NOT NULL DEFAULT '',
    created_at         timestamptz NOT NULL DEFAULT now(),
    settled_at         timestamptz
);
CREATE INDEX IF NOT EXISTS ai_batches_user_state ON ai_batches (user_id, state, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ai_batches_submission ON ai_batches (user_id, submission_id)
    WHERE submission_id <> '';

CREATE TABLE IF NOT EXISTS ai_batch_items (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    batch_id       bigint  NOT NULL REFERENCES ai_batches (id) ON DELETE CASCADE,
    -- Server-generated, unique within the batch; Anthropic echoes it back.
    custom_id      text    NOT NULL,
    -- The browser's key for the page (opaque, e.g. "p12").
    item_key       text    NOT NULL DEFAULT '',
    page_number    integer NOT NULL DEFAULT 0,
    source         text    NOT NULL CHECK (source IN ('free', 'credits')),
    -- The page's 'batch_hold' or 'free' ledger row. No foreign key, so these
    -- tables never take locks on ledger.
    ledger_id      bigint  NOT NULL,
    held_micros    bigint  NOT NULL,
    -- pending until the batch ends; then charged (billed by Anthropic) or
    -- released (errored, expired or canceled: not billed, hold returned).
    state          text    NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'charged', 'released')),
    charged_micros bigint  NOT NULL DEFAULT 0,
    outcome        text    NOT NULL DEFAULT '',
    UNIQUE (batch_id, custom_id)
);
