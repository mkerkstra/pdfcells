-- Credits ledger. Money is int64 micro-dollars (1 USD = 1,000,000).
CREATE TABLE accounts (
    user_id        text PRIMARY KEY,
    balance_micros bigint      NOT NULL DEFAULT 0,
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- kind:
--   topup  Stripe Checkout credit (positive amount, unique session id)
--   hold   in-flight reservation for a paid page (negative, settled to usage or deleted)
--   usage  settled paid page (negative; Anthropic cost + markup)
--   free   a page served from the daily free quota (amount 0)
--   adjust manual correction
CREATE TABLE ledger (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id               text        NOT NULL REFERENCES accounts (user_id),
    kind                  text        NOT NULL CHECK (kind IN ('topup', 'hold', 'usage', 'free', 'adjust')),
    amount_micros         bigint      NOT NULL,
    anthropic_cost_micros bigint      NOT NULL DEFAULT 0,
    model                 text        NOT NULL DEFAULT '',
    input_tokens          bigint      NOT NULL DEFAULT 0,
    output_tokens         bigint      NOT NULL DEFAULT 0,
    stripe_session_id     text UNIQUE,
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ledger_user_created ON ledger (user_id, created_at DESC);
