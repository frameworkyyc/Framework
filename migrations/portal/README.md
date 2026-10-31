# Client portal database migrations

These migrations belong to the **portal database only** (`framework-portal-staging` now; `framework-portal` for Production, later).
They are never applied to `framework-staging` / `framework-feedback` (the feedback, assessment and revenue database), and the
older SQL files in `../` are never applied here.

* `0001_portal_foundation.sql`: organizations, portal_users, memberships, invitations, portal_sessions, projects, activity_log.
* `0002_business_profile.sql`: business_profile_answers (Business Profile answers, one row per answered question). Applied on Staging. **Production**: pending; it is applied only through the manual Production workflow below, in order after 0001, after the owner's approval.
* `0003_portal_feedback.sql`: portal_feedback (feedback sent from inside the portal). Same status as 0002.
* `0004_invitation_delivery.sql`: four additive columns on `invitations` (`delivery_status` default `not_sent`, `delivery_channel`, `delivery_attempted_at`,
  `delivery_error`) that track whether an invitation email was handed to a provider, separately from the invitation's own status. **Staging only for now.**
  Existing rows become `not_sent`; nothing existing is changed. Nothing in the running code reads these columns yet.
* `0005_branding.sql`: four additive tables for Branding (`brand_kits`, `brand_assets`, `brand_uploads`, `service_requests`). **Approved for Staging only.** Production: NOT applied, and the Production
  workflow's expected list (`.github/scripts/portal-d1-check.mjs`) now knows it (added in the Production rollout preparation); it is applied to Production only by the manual workflow, after approval. See `worker/portal/BRANDING-FILES.md`.
* `0006_brand_name.sql`: one nullable column `brand_name` on `brand_kits` (the optional brand name used in generated file names). **Approved for Staging only; applied to Staging.** Production: NOT applied yet; the Production workflow's expected list now knows it (added in the Production rollout preparation) and applies it only when run manually, after approval.
* `0007_client_services.sql`: five additive tables for Client Services (`invoices`, `support_requests`, `support_messages`, `support_attachments`, `service_notifications`). **Approved for Staging only; applied to Staging** (target `framework-portal-staging` confirmed, Time Travel bookmark recorded first, five tables and indexes verified, no existing row changed). Production: NOT applied yet; the Production workflow's expected list now knows it (added in the Production rollout preparation). See `worker/portal/CLIENT-SERVICES.md`.
* `0008_approved_emails.sql`: one additive table, `approved_emails` (the addresses that may be invited and emailed, managed in Admin -> Approved Emails and used together with the `PORTAL_INVITE_ALLOWLIST` secret). Approved for Staging; Production: NOT applied yet. The Production workflow's expected list (`.github/scripts/portal-d1-check.mjs`) now knows it; it is applied only by the manual workflow, after approval. The Worker treats a missing table as an empty list, so the code is safe to deploy before the migration. See `worker/portal/APPROVED-EMAILS.md`.
* `0009_brand_sections.sql`: one nullable column, `sections_json`, on `brand_kits` (short text sections of a brand kit; today the tagline: primary, alternates, usage guidelines). Applied to Staging. Existing rows get NULL and nothing existing changes. The Worker works with or without the column. Production: applied only by the manual workflow, after approval; the Production check knows it.
* `0010_service_pricing.sql`: one additive table, `service_prices` (the global, Admin-editable price of each Branding design service, seeded with the 13 starting prices), and one nullable column `price_snapshot` on `service_requests` (the price wording shown with a request). Applied to Staging. Production: applied only by the manual workflow, after approval; the Production check knows it. The Worker shows no prices and behaves as before without it.
* `0011_websites.sql`: two additive tables, `websites` (a client's websites: several per client, status separate from "managed by Framework", optional private screenshot) and `website_milestones`; one nullable column `website_id` (with a partial index) on `support_requests`; and four default custom-quote rows in `service_prices` (`INSERT OR IGNORE`, no existing price is touched). Applied to Staging. Production: applied only by the manual workflow, after approval; the Production check knows it. Nothing is shown to clients until `PORTAL_WEBSITE` is on. See `worker/portal/WEBSITES.md`.
* `0012_website_management.sql`: two additive tables, `website_packages` (the one downloadable ZIP per website, unpublished until Admin publishes it) and `portal_services` (the editable Additional Services catalogue, four seed rows; no price is seeded). Needs 0011 first. Applied to Staging. Production: applied only by the manual workflow, after approval, in order after 0011.
* `wrangler.migrate.staging.jsonc`: a migration-only Wrangler config that binds **only** the Staging portal database. Use it with
  `-c` so Wrangler cannot fall back to the main `wrangler.jsonc` (which also binds Production's database).
* `wrangler.migrate.production.jsonc`: the same, binding **only** the Production portal database `framework-portal`.

## Apply to the Staging portal database

Run from the repository root, signed in to the Cloudflare account (`npx wrangler login`). **`--remote` is required**; without it
Wrangler works on a throw-away local copy and Cloudflare is not touched.

```
# 1. See what is pending. Expect exactly one file: 0001_portal_foundation.sql
npx wrangler d1 migrations list PORTAL_DB --remote -c migrations/portal/wrangler.migrate.staging.jsonc

# 2. Apply it (confirm the prompt; the output should name framework-portal-staging)
npx wrangler d1 migrations apply PORTAL_DB --remote -c migrations/portal/wrangler.migrate.staging.jsonc

# 3. Check the tables (expect activity_log, d1_migrations, invitations, memberships, organizations, portal_sessions, portal_users, projects)
npx wrangler d1 execute PORTAL_DB --remote -c migrations/portal/wrangler.migrate.staging.jsonc --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"

# 4. Run step 1 again: it should now say there is nothing to apply
```

**Stop and do not apply** if step 1 lists anything other than `0001_portal_foundation.sql` (for example
`0001_create_feedback_responses.sql`), or if any output names `framework-staging` or `framework-feedback`.

Alternative without the command line: Cloudflare dashboard, Storage & Databases, D1, `framework-portal-staging`, Console, paste the
contents of `0001_portal_foundation.sql` and run it. That path does not record the migration in `d1_migrations`; every statement is
`IF NOT EXISTS`, so running the file again through Wrangler later is harmless.

## Apply 0004 (invitation delivery) to the Staging portal database

Staging already has 0001, 0002 and 0003 recorded in `d1_migrations`; only 0004 is pending. Run from the repository root, signed in to Cloudflare
(`npx wrangler login`; in a Codespace this opens a browser sign-in). **`--remote` and `-c migrations/portal/wrangler.migrate.staging.jsonc` are both required.**

```
# 0. Record a Time Travel bookmark first (write the value down; it is not kept in the repository).
npx wrangler d1 time-travel info PORTAL_DB -c migrations/portal/wrangler.migrate.staging.jsonc

# 1. See what is pending. Expect exactly one file: 0004_invitation_delivery.sql
npx wrangler d1 migrations list PORTAL_DB --remote -c migrations/portal/wrangler.migrate.staging.jsonc

# 2. Apply it. The prompt must name framework-portal-staging (answer no if it names anything else).
npx wrangler d1 migrations apply PORTAL_DB --remote -c migrations/portal/wrangler.migrate.staging.jsonc

# 3. Verify. Step 1 again must say there is nothing to apply, and the four columns must exist.
npx wrangler d1 migrations list PORTAL_DB --remote -c migrations/portal/wrangler.migrate.staging.jsonc
npx wrangler d1 execute PORTAL_DB --remote -c migrations/portal/wrangler.migrate.staging.jsonc --command "SELECT name FROM pragma_table_info('invitations') WHERE name LIKE 'delivery_%' ORDER BY cid"
npx wrangler d1 execute PORTAL_DB --remote -c migrations/portal/wrangler.migrate.staging.jsonc --command "SELECT id, name FROM d1_migrations ORDER BY id"
```

**Stop and do not apply** if step 1 lists anything other than `0004_invitation_delivery.sql`, if any output or prompt names `framework-portal` (Production),
`framework-staging` or `framework-feedback`, or if a command was run without `-c`. If the migration fails part-way, check the columns before re-running,
and restore from the bookmark if the database is in doubt. The Production workflow applies 0002 to 0004 to Production only when someone runs it by hand.

## Apply to the Production portal database (`framework-portal`)

Run only when the launch plan says so; creating the config file applied nothing. The initial D1 Time Travel bookmark of the empty
database has already been recorded (its value is not kept in the repository). Record a new bookmark before any later migration:
`npx wrangler d1 time-travel info PORTAL_DB -c migrations/portal/wrangler.migrate.production.jsonc`.

Run from the repository root, signed in to the Cloudflare account. **`--remote` and `-c migrations/portal/wrangler.migrate.production.jsonc`
are both required**; never run these commands without `-c`.

```
# 0. VERIFY THE TARGET. The config must name exactly: binding PORTAL_DB, database framework-portal,
#    id b213b7db-ed29-4ab6-946c-0728dd6709e8. Anything else (a different name or id): stop.
npx wrangler d1 info PORTAL_DB -c migrations/portal/wrangler.migrate.production.jsonc

# 1. See what is pending. Expect the NEXT migrations in order and nothing else (Production today: 0002, 0003 and 0004; a brand-new empty database: all four).
npx wrangler d1 migrations list PORTAL_DB --remote -c migrations/portal/wrangler.migrate.production.jsonc

# 2. Apply them. Read the prompt: it must name framework-portal. Answer no if it names anything else.
npx wrangler d1 migrations apply PORTAL_DB --remote -c migrations/portal/wrangler.migrate.production.jsonc

# 3. Verify completion. Step 1 again must say there is nothing to apply, and the tables must be exactly
#    activity_log, business_profile_answers, d1_migrations, invitations, memberships, organizations, portal_feedback, portal_sessions, portal_users, projects
npx wrangler d1 migrations list PORTAL_DB --remote -c migrations/portal/wrangler.migrate.production.jsonc
npx wrangler d1 execute PORTAL_DB --remote -c migrations/portal/wrangler.migrate.production.jsonc --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

**Stop and do not apply** if step 0 or the step 2 prompt names `framework-portal-staging`, `framework-staging` or `framework-feedback`, if
step 1 lists anything other than the next migrations in order (an unknown file, a skipped one, or one already applied), or if a command was run without `-c`. If a migration fails part-way, do
not re-run it blindly: check the tables, then restore from the Time Travel bookmark if the database is in doubt.

### Optional: apply through the manual GitHub Actions workflow

`.github/workflows/portal-production-d1-migration.yml` ("Portal Production D1 migration") runs the same checks and the same apply from GitHub.
It is `workflow_dispatch` only, so nothing runs until someone starts it from the Actions tab. It has two inputs: the database name typed
exactly (`framework-portal`) and a mode, **verify-only** (default; read-only) or **apply**. It fails closed on a name/id mismatch, on a pending list that is not the **next migrations in order** (0001, 0002, 0003, 0004; an unknown file, a skipped one or an out-of-order one is refused), on output it cannot read,
on a database whose tables are not exactly what the already-applied migrations created, and for apply when nothing is pending. After an apply it checks that nothing is pending and that exactly the 9 tables and 15 indexes of
the four migrations exist (0004 only adds columns). **Order of use on Production: run verify-only first, read its report, record a Time Travel bookmark, then run apply, then run verify-only again.** Only one run can
be active at a time. It refuses any ref except `Staging` (the migration config and SQL live there); Wrangler is installed in a step
without secrets, with install scripts disabled, at an exact pinned version.

**Before it can be used (a person does these; the repository cannot):**
1. Create the GitHub environment `production-portal-d1` and add **required reviewers**. This needs a public repository or a GitHub plan that
   supports environment protection on private repositories; check Settings > Environments after creating it. Without reviewers the typed
   confirmation is the only gate.
2. In that environment (not as repository secrets) add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. The token should be a custom token
   limited to this account with **D1: Edit** only. Cloudflare cannot restrict a D1 token to one database, so treat it as powerful: delete it
   (or expire it) after the migration.
3. Run **verify-only** first, read the log, then run **apply**. Record a Time Travel bookmark afterwards. Wrangler also takes its own backup
   when it applies, and skips its interactive prompt in CI, so the approval gate is the environment reviewers, not Wrangler.

## Rules for future migrations

Forward-only and additive; one numbered file each; no BEGIN/COMMIT, PRAGMA or triggers (D1); every tenant-owned table gets a NOT NULL
`organization_id`, an index that starts with it, and references projects through `(project_id, organization_id)`. Rollback is a D1
Time Travel restore, so note the Time Travel bookmark (`npx wrangler d1 time-travel info <database>`) before applying anything to a
database that holds real data.

## Apply 0005 (Branding) to the Staging portal database (approved for Staging only)

The file is in `migrations/portal/`. The Production database must NOT be touched. Checked read-only on 2026-10-26: Staging (`framework-portal-staging`,
id `1edda8a2-5249-4f40-9dbc-d29aa44e21f8`) has 0001 to 0004 recorded and no branding tables, so only 0005 would be pending. Run from the repository root, signed in to Cloudflare;
**`--remote` and `-c migrations/portal/wrangler.migrate.staging.jsonc` are both required.**

```
# 0. Record a Time Travel bookmark first (write the value down; it is not kept in the repository). This is the recovery point.
npx wrangler d1 time-travel info PORTAL_DB -c migrations/portal/wrangler.migrate.staging.jsonc

# 1. See what is pending. Expect exactly one file: 0005_branding.sql
npx wrangler d1 migrations list PORTAL_DB --remote -c migrations/portal/wrangler.migrate.staging.jsonc

# 2. Apply it. The prompt must name framework-portal-staging (answer no if it names anything else, especially framework-portal).
npx wrangler d1 migrations apply PORTAL_DB --remote -c migrations/portal/wrangler.migrate.staging.jsonc

# 3. Verify: nothing pending, the four tables exist, and the migration is recorded.
npx wrangler d1 migrations list PORTAL_DB --remote -c migrations/portal/wrangler.migrate.staging.jsonc
npx wrangler d1 execute PORTAL_DB --remote -c migrations/portal/wrangler.migrate.staging.jsonc --command "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'brand_%' OR name = 'service_requests') ORDER BY name"
npx wrangler d1 execute PORTAL_DB --remote -c migrations/portal/wrangler.migrate.staging.jsonc --command "SELECT id, name FROM d1_migrations ORDER BY id"
```

**Recovery.** The migration only creates new tables, so the normal undo is to leave them unused. To return the database to its exact earlier state,
`npx wrangler d1 time-travel restore PORTAL_DB --bookmark=<value from step 0> -c migrations/portal/wrangler.migrate.staging.jsonc` (this rewinds ALL data in that database to that moment, so use it only straight after a failed apply).
**Stop** if step 1 lists anything other than 0005, or any output names `framework-portal`, `framework-staging` or `framework-feedback`.
* `0013_staff_access.sql`: one additive table, `portal_staff` (Master Client Access grants: a grant starts as an email and binds once to the portal user id at that person's first verified sign-in), and one seed row, a pending grant for hello@frameworkco.ca. No membership is ever created by it. Applied to Staging. Production only by the manual workflow. See `worker/portal/STAFF-ACCESS.md`.
* `0014_brand_requirements.sql`: one additive table, `brand_requirements` (per-client Branding requirement overrides: Required, Recommended, Optional or Not applicable, with an optional client-facing note; Automatic is no row), no seed rows. Applied to Staging. Production only by the manual workflow.
