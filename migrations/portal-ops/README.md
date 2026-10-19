# Portal operations SQL (emergency offboarding)

These files are **operational runbooks**, not migrations. They live outside `migrations/portal/` so `wrangler d1 migrations apply` can never run
them, and `migrations/` is excluded from the public site. They have **not** been run against any live database. They target the portal database
only (`framework-portal-staging` now; the Production portal database later, only when the portal is approved there).

| file | purpose |
| --- | --- |
| `emergency-offboard.sql` | Disable one user, revoke all their sessions, revoke all their organization memberships, revoke the pending invitations addressed to their email, and write internal audit entries. |
| `emergency-reenable.sql` | Re-enable a disabled user. Revokes any leftover session. **Never restores memberships or invitations.** |

The same operations exist in code (`worker/portal/repo/offboarding.js`: `offboardUser`, `reenableUser`, each one atomic D1 batch) for a future admin
screen; `worker/test/portal-offboarding.test.mjs` proves the SQL files and the code do the same thing.

## Safety properties
* **One user only.** Every statement is scoped to the single user id you paste in. Nothing else (other users, other organizations, other
  people's sessions) is touched; a test proves this against a database with several organizations and users.
* **A mistake changes nothing.** If `__USER_ID__` is left unreplaced or wrong, every statement matches no rows. The checks below then show the user
  still active, which is your signal.
* **Safe to repeat.** Every statement is idempotent. Audit entries are only written when that change has not been recorded yet, so repeating the
  file does not add duplicates.
* **Do not assume the D1 Console is atomic.** It may run the statements one at a time. The file is ordered most-urgent-first (disable, sessions,
  memberships, invitations, then audit) so that a partial run has already removed access. Recovery is simply running the whole file again.
* **Paste only the UUID.** The placeholder sits inside quotes in the SQL. Paste exactly the 36-character id returned by the lookup query, never an email
  address or other text. The `__ACTOR__` label may contain only letters, digits and `. _ @ : -` (up to 100 characters), for example `admin:jj`.

## Emergency offboarding: step by step
1. **Confirm the database.** In the D1 Console, open the portal database and check its name in the header (`framework-portal-staging`). Stop if it
   is any other database.
2. **Find the user (read-only)** and copy the `id`. Confirm exactly one row:
   ```sql
   SELECT id, email, status, disabled_at FROM portal_users WHERE email = 'person@example.com';
   ```
3. **Baseline (read-only)**, replacing `<USER-ID>`:
   ```sql
   SELECT (SELECT count(*) FROM portal_sessions WHERE user_id = '<USER-ID>' AND revoked_at IS NULL) AS unrevoked_sessions,
          (SELECT count(*) FROM memberships WHERE user_id = '<USER-ID>' AND status = 'active') AS active_memberships,
          (SELECT count(*) FROM invitations WHERE status = 'pending' AND email = (SELECT email FROM portal_users WHERE id = '<USER-ID>')) AS pending_invitations;
   ```
4. **Run.** Copy `emergency-offboard.sql` to a scratch location **outside the repository**, replace every `__USER_ID__` and `__ACTOR__`, and run
   the whole file. Do not commit the edited copy.
5. **Verify (read-only)**; every number must be 0 and the status `disabled`:
   ```sql
   SELECT id, email, status, disabled_at FROM portal_users WHERE id = '<USER-ID>';
   SELECT (SELECT count(*) FROM portal_sessions WHERE user_id = '<USER-ID>' AND revoked_at IS NULL) AS unrevoked_sessions,
          (SELECT count(*) FROM memberships WHERE user_id = '<USER-ID>' AND status = 'active') AS active_memberships,
          (SELECT count(*) FROM invitations WHERE status = 'pending' AND email = (SELECT email FROM portal_users WHERE id = '<USER-ID>')) AS pending_invitations;
   SELECT action, organization_id, actor_ref, created_at FROM activity_log
    WHERE entity_id = '<USER-ID>' AND action IN ('user.offboarded', 'member.offboarded') ORDER BY created_at;
   ```
   You should see one `user.offboarded` entry and one `member.offboarded` entry per organization the user belonged to.
6. **Check the effect.** The person's next request lands on the sign-in page; a new sign-in attempt shows "Account unavailable".
7. **Then do the WorkOS side by hand** (this file does not touch WorkOS): remove or deactivate the user in the WorkOS dashboard and revoke their
   WorkOS sessions. WorkOS alone does **not** end a Framework session; the steps above do.

## If the run stops part-way (partial-failure recovery)
Run the **entire** file again, then repeat the verification. It cannot make things worse and does not duplicate audit entries. How to read a
half-finished state before rerunning:
* user still `active` -> the first statement did not run; nothing else has happened yet. Rerun.
* user `disabled` but unrevoked sessions or active memberships remain -> the middle of the file did not run. Rerun.
* everything is 0 but the audit query shows fewer entries than organizations -> only the audit statements did not run. Rerun.
Do **not** rerun an old copy of the file after the user has been re-enabled: it would offboard them again.

## Re-enabling a user
1. Look up the id (step 2). 2. Replace the placeholders in `emergency-reenable.sql` and run the whole file (safe to repeat).
3. Verify: `SELECT status, disabled_at FROM portal_users WHERE id = '<USER-ID>';` shows `active`, and the user's old sessions all stay revoked.
4. Re-enabling restores **no** access. To give the person access to an organization again, create a new invitation (preferred) or restore the
   membership deliberately; until then they sign in to a "no access" page.

## Wider emergencies
Rotating the `PORTAL_SESSION_PEPPER` secret invalidates **every** portal session at once (everyone must sign in again). It needs a new deployment
and is a last resort. It is not a substitute for offboarding one person.
