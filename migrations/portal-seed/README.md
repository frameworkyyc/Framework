# Staging-only portal test data (NOT executed, NOT a migration)

`staging-test-org.sql` creates one test organization (`framework-test`), a sample project, one client-visible activity entry and one
pending **owner** invitation for a test email address. It targets **`framework-portal-staging` only**.

It lives outside `migrations/portal/` deliberately, so `wrangler d1 migrations apply` can never run it. It has not been run.

## Procedure (when authorized)

1. Copy the file, replace `__INVITEE_EMAIL__` with the lower-case test address (one place). Do not commit the edited copy.
2. Run it with the migration-only Staging config, which binds only the Staging portal database:
   `npx wrangler d1 execute PORTAL_DB --remote -c migrations/portal/wrangler.migrate.staging.jsonc --file <your edited copy>`
   Confirm the output names `framework-portal-staging`. Stop if it names anything else.
3. Verify with the two SELECTs at the bottom of the file.
4. Sign in at `https://staging.frameworkco.ca/portal/login` with that address. The invitation is matched on the verified email, the
   membership is created, and the browser lands on `/portal/o/framework-test`.
5. To remove everything afterwards, run `staging-test-org-cleanup.sql` the same way.

For a second test person (multi-user or multi-organization testing), repeat with a new fixed-id copy (change the ids and slug) or
create the organization and invitation through the admin tooling once it exists.
