# Dependencies

Renovate (`renovate.json`) opens the update PRs. Dependabot version updates are off; Dependabot security alerts stay on.

## Policy

- Non-security updates arrive weekly, Monday before 5am Chicago, one PR per group: dev tooling, React, Go modules, GitHub Actions. `pdfjs-dist`, `tesseract.js` and Clerk each get their own PR.
- Majors are always separate and never automerged. So are all runtime npm and Go updates.
- Automerge (only when CI is green): minor/patch devDependencies and GitHub Actions bumps.
- Actions stay pinned by full commit SHA with a `# vX.Y.Z` comment. Renovate keeps both in sync.
- The lockfile is refreshed monthly. Vulnerability PRs open immediately and are never automerged.
- `dependency-review.yml` fails a PR that adds a dependency with a high-severity advisory.

## The 7-day quarantine

`pnpm-workspace.yaml` sets `minimumReleaseAge: 10080` with `minimumReleaseAgeStrict: true`, so pnpm refuses any release younger than 7 days. Renovate uses the same 7 days for npm and only opens the PR once the release is old enough. Go waits 3 days.

## Approving a build script

`allowBuilds` in `pnpm-workspace.yaml` is an allowlist. If an update adds a package with an install script, pnpm skips it and CI may fail. Read the script, then add `package-name: true` under `allowBuilds` in the PR (`false` records a deliberate refusal, as for `tesseract.js`). Renovate never edits this list.

## A security fix younger than 7 days

The vulnerability PR will fail install under the quarantine. Add a temporary exception in `pnpm-workspace.yaml`:

```yaml
minimumReleaseAgeExclude:
  - vulnerable-package@1.2.4 # expires: 2026-11-01 (CVE-XXXX-YYYY), remove once 7 days old
```

Pin the exact fixed version, set the expiry to the date the release turns 7 days old, and remove the entry then.
