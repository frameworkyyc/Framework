# Framework operations: automation audit, credentials and runbooks

Names only. No token, secret value or client data belongs in this file. Last audited 2026-11-22.

## What exists (audit)

**GitHub Actions** (`.github/workflows/`)
| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | push / PR on `Staging` and `main` | "Node tests" (the required check). No secrets. |
| `portal-production-d1-migration.yml` | manual only | Production D1 (`framework-portal`): verify-only / apply, automatic Time Travel bookmark, environment `production-portal-d1` (my approval per run). |
| `portal-staging-d1-migration.yml` | manual only | Same for `framework-portal-staging`, environment `staging-portal-d1` (optional backup path, see below). |
| `staging-data-sync.yml` | manual | Production-to-Staging data sync (see `scripts/ops/staging-sync/`). |

**Cloudflare** (`wrangler.jsonc`): one Worker, `framework` (Production = top level, Staging = the `Staging` preview, deployed by **Workers Builds**, which also posts the "Workers Builds: framework" check). Static files are Worker assets (no Pages project in the repo).
D1: `framework-portal` (Production portal), `framework-portal-staging` (Staging portal), `framework-feedback` (Production website), `framework-staging` (Staging website), `framework-leadgen` (**the same database for Production and Staging**). R2: `framework-portal-files` / `-backup` (Production), `-staging` / `-staging-backup` (Staging).

**Credentials, by name and where they live**
- GitHub environment `production-portal-d1`: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (Production D1 workflow only; approval gate).
- Cloudflare Workers Builds: its own managed build credential (GitHub to Cloudflare deploys; nothing to maintain).
- Claude Code cloud environment: the Cloudflare credential is **injected by the network proxy** for `api.cloudflare.com`. Processes see only a placeholder; nothing is stored in the repository, the logs or this file. This is the permanent Staging D1 access.
- Worker secrets (WorkOS, session pepper, invitation allow-list, and so on) live in Cloudflare only; `scripts/ops/staging-health.mjs` checks their names.
- The Cloudflare MCP connector needs its own sign-in and is **not needed** by any workflow.

## Findings

1. **Staging D1 access was the manual bottleneck** (a token request for every migration). Fixed: `scripts/ops/staging-migrate.mjs` uses the proxy-injected credential and the Staging config only.
2. **The proxy credential can reach Production resources** (same account). The guard is in code, not in the token: the runner and the Staging workflow accept only `framework-portal-staging` (name and id), refuse the Production ids, and only ever pass the Staging migration config. A test pins this. Narrowing the token to the Staging resources (or two tokens) would be better still; that is an account-level choice for the owner.
3. **Duplicate credential paths**: the proxy credential and the GitHub environment secrets are two copies of "Cloudflare D1 access". The Production one is deliberate (it sits behind an approval). The Staging GitHub environment (`staging-portal-d1`) is optional now; it is only useful for running Staging migrations from GitHub without a Claude session.
4. **Manual steps removed**: Staging bookmark and migration (one command), the "run health until the deployed commit matches" loop (`staging-ready.mjs`), per-migration Staging approvals (additive-only lint plus the reviewed list instead).
5. **Not automatable from a Claude session** (needs the owner once, if wanted): creating GitHub environments, GitHub secrets, branch protection and the repository "allow auto-merge" setting. Merging is already automatic: Claude merges its own PR after both required checks pass on the current head.
6. **Open risk, not changed**: `framework-leadgen` is shared by Production and Staging. Staging code and tests must not write real lead data there.
7. The Production D1 workflow records its own bookmark and still stops for my approval in GitHub; Production is never touched by any Staging script.

## Runbook: Staging (no routine approvals)

1. Branch from `origin/Staging`; implement; `node --test worker/test/*.test.mjs`; push; PR into `Staging`.
2. Wait for **Node tests** and **Workers Builds: framework** on the current head; merge with the real head sha.
3. New migration? It must be additive (the runner refuses DROP, DELETE, UPDATE, RENAME, PRAGMA, REPLACE). Put it in `migrations/portal/` and in `.github/scripts/portal-d1-check.mjs` (the Production list; a test keeps both identical), merge, then:
   - `NODE_USE_ENV_PROXY=1 node scripts/ops/staging-migrate.mjs verify` (read-only; prints the bookmark)
   - `NODE_USE_ENV_PROXY=1 node scripts/ops/staging-migrate.mjs apply`
   Every failure prints a `NEXT:` line and nothing is applied unless all checks passed. Cloudflare occasionally throttles (code 971): the runner waits and retries.
4. `NODE_USE_ENV_PROXY=1 node scripts/ops/staging-ready.mjs` (READY = deployed commit is the Staging head and no FAIL).
5. Report "ready for visual review" with the Staging URL.

A migration that needs DROP, DELETE, UPDATE, RENAME or a data rewrite is not automatic: ask the owner.

## Runbook: Production (explicit approval for every release)

1. Owner approves the release. Branch from `origin/main` with only approved work; PR into `main`; wait for both checks.
2. Migration? Dispatch "Portal Production D1 migration" with ref `Staging`: verify-only, read the report, then apply (the owner approves each run in GitHub). Do not merge before the migration is verified.
3. Merge the release PR; wait for the Production deploy.
4. `NODE_USE_ENV_PROXY=1 node scripts/ops/production-indexability.mjs`, plus the live checks (Admin and portal not public, preview tags, headers).
5. History-only sync of `main` into Staging (`-s ours` merge on a branch from `origin/Staging`), PR, merge, `staging-ready.mjs`.
6. Report: deployed commit, CI, migration status, checks, remaining tasks.

## Recovery

A Time Travel bookmark is printed by every migration run. Restoring is destructive and always needs the owner's approval: `wrangler d1 time-travel restore PORTAL_DB --bookmark=<value> -c <the matching migration config>`.
