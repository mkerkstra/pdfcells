# Security policy

## Reporting a vulnerability

Email **support@pdfcells.com** with "security" in the subject, or use GitHub's
[private vulnerability reporting](https://github.com/mkerkstra/pdfcells/security/advisories/new).
Please don't open a public issue for anything exploitable.

Include what you found, how to reproduce it, and what an attacker could do with
it. We aim to acknowledge reports within a few days. There is no bug bounty;
reporters can be credited in the fix if they'd like.

## Scope

In scope:

- The pdfcells.com web app and its API (`/api/*`), including the credits
  ledger, Stripe and Resend webhooks, and Clerk session handling.
- Anything that uploads a PDF or page image without the user choosing AI for
  that page, or that exposes one user's pages, balance or history to another.
- Ways to spend server-paid AI (free pages or another user's credits) beyond
  the limits below.
- This repository's code and CI.

Out of scope: denial of service by volume, findings that need a compromised
device or browser, missing headers without a concrete impact, and the
third-party services themselves (Clerk, Stripe, Anthropic, Resend, Vercel,
Neon). Report those to the vendor.

Only test against your own account. Don't access other users' data, and stop
and report as soon as you see something you shouldn't.

## Abuse controls

Every limit applies to hosted (server-paid) AI only. Bring-your-own-key
requests are billed to the caller's Anthropic account and only forwarded to
`api.anthropic.com`; the key is never logged or stored.

| Control | Default | Env var |
|---|---|---|
| Free Fast pages per signed-in user per UTC day | 25 | `FREE_PAGES_PER_DAY` |
| Free pages per caller IP per UTC day, across accounts (IPs stored only as an HMAC; IPv6 grouped by /64) | 40 | `FREE_PAGES_PER_IP_PER_DAY` (-1 = unlimited) |
| Free pages across all users per UTC day. **`0` is the kill switch.** | 2000 | `FREE_PAGES_GLOBAL_PER_DAY` (-1 = unlimited) |
| Key for the IP HMAC | derived from `CLERK_SECRET_KEY` | `IP_HASH_SECRET` |
| Hosted `/api/extract` calls per user per minute | 30 | `RATE_EXTRACT_PER_MINUTE` (0 = off) |
| `/api/checkout` calls per user per minute | 5 | `RATE_CHECKOUT_PER_MINUTE` (0 = off) |
| Clerk token origins accepted (`azp`) | pdfcells.com, www, localhost:5173 | `CLERK_AUTHORIZED_PARTIES` |
| Paid pages | worst-case hold before the call, settled to the exact cost | none |

When a free page is refused by the IP or global cap, the request falls back
to the user's credits, the same as an exhausted personal quota.

Fixed limits on every hosted request, applied before any money is reserved:

- Page image: at least 400 px on the long side, at most 40 MP, and not blank
  or a single solid colour.
- Text layer at most 20,000 characters, correction instruction at most 500,
  correction tables at most 5,000 cells.
- Output: 6,000 tokens for a free page (16,000 for paid), cells cut at 500
  characters, and at most 5,000 cells per response. Truncation is logged as
  counts only.
- Request bodies at most 4.4 MB. Model calls time out at 280 s, all other API
  calls at 60 s.

All counters live in Postgres, so they hold across serverless instances.

### Owner-side settings

These sit outside the code and should stay on:

- **Clerk** (Dashboard → Configure): enable bot protection on sign-up,
  block disposable email domains, require a verified email address before
  a session is issued, and keep the allowed origins limited to pdfcells.com.
- **Anthropic** (Console → Limits): set a monthly spend limit on the
  workspace that holds `ANTHROPIC_API_KEY`, sized a little above expected
  free plus paid usage. That cap holds even if every other control fails.
- **Stripe**: keep Radar on. The webhook only credits sessions this API created.

## Supply chain

`.github/workflows/security.yml` runs govulncheck, OSV-Scanner (over `go.mod`
and `pnpm-lock.yaml`) and CodeQL on every push, every pull request and once a
week. CI also runs gitleaks. Every action is pinned to a full commit SHA, and
pnpm refuses packages younger than 7 days (`pnpm-workspace.yaml`).
