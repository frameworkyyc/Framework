# Client portal database migrations

These migrations belong to the **portal database only** (`framework-portal-staging` now; `framework-portal` for Production, later).
They are never applied to `framework-staging` / `framework-feedback` (the feedback, assessment and revenue database), and the
older SQL files in `../` are never applied here.

* `0001_portal_foundation.sql`: organizations, portal_users, memberships, invitations, portal_sessions, projects, activity_log.
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

# 1. See what is pending. Expect exactly one file: 0001_portal_foundation.sql
npx wrangler d1 migrations list PORTAL_DB --remote -c migrations/portal/wrangler.migrate.production.jsonc

# 2. Apply it. Read the prompt: it must name framework-portal. Answer no if it names anything else.
npx wrangler d1 migrations apply PORTAL_DB --remote -c migrations/portal/wrangler.migrate.production.jsonc

# 3. Verify completion. Step 1 again must say there is nothing to apply, and the tables must be exactly
#    activity_log, d1_migrations, invitations, memberships, organizations, portal_sessions, portal_users, projects
npx wrangler d1 migrations list PORTAL_DB --remote -c migrations/portal/wrangler.migrate.production.jsonc
npx wrangler d1 execute PORTAL_DB --remote -c migrations/portal/wrangler.migrate.production.jsonc --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

**Stop and do not apply** if step 0 or the step 2 prompt names `framework-portal-staging`, `framework-staging` or `framework-feedback`, if
step 1 lists anything other than `0001_portal_foundation.sql`, or if a command was run without `-c`. If a migration fails part-way, do
not re-run it blindly: check the tables, then restore from the Time Travel bookmark if the database is in doubt.

## Rules for future migrations

Forward-only and additive; one numbered file each; no BEGIN/COMMIT, PRAGMA or triggers (D1); every tenant-owned table gets a NOT NULL
`organization_id`, an index that starts with it, and references projects through `(project_id, organization_id)`. Rollback is a D1
Time Travel restore, so note the Time Travel bookmark (`npx wrangler d1 time-travel info <database>`) before applying anything to a
database that holds real data.
