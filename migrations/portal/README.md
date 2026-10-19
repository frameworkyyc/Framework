# Client portal database migrations

These migrations belong to the **portal database only** (`framework-portal-staging` now; `framework-portal` for Production, later).
They are never applied to `framework-staging` / `framework-feedback` (the feedback, assessment and revenue database), and the
older SQL files in `../` are never applied here.

* `0001_portal_foundation.sql`: organizations, portal_users, memberships, invitations, portal_sessions, projects, activity_log.
* `wrangler.migrate.staging.jsonc`: a migration-only Wrangler config that binds **only** the Staging portal database. Use it with
  `-c` so Wrangler cannot fall back to the main `wrangler.jsonc` (which also binds Production's database).

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

## Rules for future migrations

Forward-only and additive; one numbered file each; no BEGIN/COMMIT, PRAGMA or triggers (D1); every tenant-owned table gets a NOT NULL
`organization_id`, an index that starts with it, and references projects through `(project_id, organization_id)`. Rollback is a D1
Time Travel restore, so note the Time Travel bookmark (`npx wrangler d1 time-travel info <database>`) before applying anything to a
database that holds real data.
