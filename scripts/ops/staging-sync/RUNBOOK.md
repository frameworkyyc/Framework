# Production to Staging data refresh: runbook

Copies a read-only snapshot of real client data from Production into Staging so Staging can be tested with realistic content. One direction only: **Production is read, Staging is written, nothing ever flows back.** Not part of CI; it runs only when someone starts the manual workflow *Staging data refresh from Production* and a reviewer approves the run.

## What is copied, kept, excluded

| | Tables |
| --- | --- |
| **Copied** (ids preserved) | `organizations`, `business_profile_answers`, `projects`, `brand_kits`, `brand_assets`, `brand_uploads`, `websites`, `website_milestones`, `website_packages`, `portal_services`, `service_prices`, plus the files behind them (copied, SHA-256 verified, into the Staging bucket) |
| **Never copied** | `portal_users`, `memberships`, `invitations`, `portal_sessions`, `approved_emails`, `portal_staff`, `activity_log`, `service_notifications`, `service_requests`, `invoices`, `support_*`, `portal_feedback` |
| **Staging-only, never touched** | `brand_requirements`, `website_seo*`, `client_service_settings`, `client_service_state`, `portal_service_media`, Staging-only columns (`websites.phase`, service sales content), Staging's own organizations, users, Master Client Access, audit history |

Details of the copy: contact emails and phone numbers are copied as they are (decision recorded). `organizations.revenue_client_id` is cleared (it points into a database Staging does not have). The few columns that reference a Production user (`updated_by`, `uploaded_by` where a foreign key exists) point at one **disabled** placeholder user (`staging-sync@placeholder.invalid`, no WorkOS identity, no membership): it cannot sign in. No client login record exists in Staging, so no client can reach Staging data; access is through Framework's Master Client Access (`hello@frameworkco.ca`), which already lists every organization without membership rows.

## Safety model (enforced in code, pinned by `worker/test/staging-sync.test.mjs`)

- Database and bucket ids are constants (`config.mjs`); no flag or secret can swap source and target.
- The Production client accepts only one read-only statement (`SELECT` / a few read-only `PRAGMA`s) and has no write method. The Production file client can only `get`.
- The Staging client refuses any write outside the copied tables (plus the one disabled placeholder user and one internal audit row). Sessions, invitations, memberships, staff, notification queue and invoices are not writable by the tool.
- Reports and logs hold counts and record keys only, never row values. Nothing is uploaded as a GitHub artifact.
- The apply is gated: reviewed plan hash, Staging restore bookmark, existing non-empty backup, valid approvals; then files first, then **one atomic D1 batch**, then verification (nothing left to do, foreign keys clean, protected tables unchanged).
- Conflicts and deletions never happen implicitly (below).

## Rules for later refreshes

A record kept in the refresh record (`staging-sync/manifest.json` in the private Staging backup bucket) lets the tool tell who changed what since the last refresh.

| Situation | Result |
| --- | --- |
| In Production, not in Staging | inserted |
| Identical | untouched |
| Changed in Production only | updated |
| Changed in Staging only | **kept**, listed as "Staging-edited" |
| Changed in both, or different with no refresh history (first refresh) | **conflict**: untouched unless you approve that exact row in `overwrite` |
| Gone from Production (copied earlier) | **deletion candidate**: untouched unless you approve that exact row in `approve_deletions` |
| Staging-only rows, tables, columns | never touched |
| Slug (or another unique value) already used by a different Staging row | that organization is skipped with its data and reported |

If the refresh record is lost, the next run simply treats every difference as a conflict (nothing is overwritten).

Staging having newer migrations is expected: only columns present in both databases are copied; Staging-only columns keep their values or defaults. The preflight stops if Production has a migration Staging lacks, if a Production table has no copy/exclude decision, or if Staging requires a column Production cannot supply.

## GitHub configuration (once)

1. **Environment** `staging-data-sync` (Settings, Environments): *required reviewers* = you; restrict deployment branches to `Staging`.
2. **Environment secrets** (names exactly):
   - `PRODUCTION_READ_TOKEN`: Cloudflare API token with **read-only** permissions on the account: *D1: Read* and *Workers R2 Storage: Read*. Nothing else. Use a token separate from the one in `production-portal-d1` (that one can edit D1).
   - `STAGING_WRITE_TOKEN`: Cloudflare API token with *D1: Edit*, *Workers R2 Storage: Edit* and *Workers Scripts: Read* (the Staging health check reads configuration).
3. Limits to know: Cloudflare D1 and R2 token permissions are account-wide, so `STAGING_WRITE_TOKEN` can in principle write Production too. The pinned ids, the guards and the required reviewer are what prevent that; for stronger isolation use a separate Cloudflare account for Staging, or bucket-scoped R2 credentials (not set up).
4. After creating the Production read token, confirm in the Cloudflare dashboard that it shows only the two Read permissions.

## Procedure

1. **Dry run**: Actions, *Staging data refresh from Production*, branch `Staging`, `mode = dry-run`, type `framework-portal-staging`. Approve the run. Read the job summary: preflight, per-table counts, conflicts, deletion candidates, Staging-edited rows, file check, and the **Plan hash**.
2. Resolve what you want resolved. A slug collision is fixed by renaming or retiring the Staging test organization in Staging (an explicit, reviewed Staging change), then dry-run again.
3. **Apply**: same workflow, `mode = apply`, `plan_sha` = the hash you reviewed, and (only if you decide so) `overwrite` / `approve_deletions` as `table:key,table:key`. The run records a Time Travel bookmark and a full Staging export (private bucket `framework-portal-files-staging-backup`, key `staging-sync/backups/pre-refresh-<run>.sql`), then applies. If the data moved since the review, the run stops: dry-run again.
4. Check the summary (`ok: true`, no problems), then the post-refresh Staging health check (no FAIL).

## Undo

Staging only: `wrangler d1 time-travel restore PORTAL_DB --bookmark <bookmark from the job summary> -c scripts/ops/staging-sync/wrangler.staging.jsonc` (a restore is a destructive step: ask first), or replay the SQL backup. Copied files are additive and harmless; the file copy never overwrites a different existing object without it matching the recorded checksum.

## Risks and notes

- Staging will hold real client data: keep Cloudflare Access on `/admin`, keep the invitation allowlist (`PORTAL_INVITE_ALLOWLIST`) and `PORTAL_SERVICES` handling as they are, and restrict who can read Staging D1/R2 and the backup bucket (R2 objects are encrypted at rest; the backup is a full copy of the Staging database).
- Staging has no cron and its Worker cannot reach Production resources; client-facing email stays gated by the Staging recipient allowlist.
- The R2 object API used for file copy is account-level; the first workflow dry run (`--check-files`) proves the read token can read the Production files before any apply.
- A Production org that is *archived* or *suspended* is copied with that status.
