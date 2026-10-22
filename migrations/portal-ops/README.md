# Portal operations SQL (onboarding and emergency offboarding)

These files are **operational runbooks**, not migrations. They live outside `migrations/portal/` so `wrangler d1 migrations apply` can never run
them, and `migrations/` is excluded from the public site. They have **not** been run against any live database. They target the portal database
only (`framework-portal-staging` now; the Production portal database later, only when the portal is approved there).

| file | purpose |
| --- | --- |
| `emergency-offboard.sql` | Disable one user, revoke all their sessions, revoke all their organization memberships, revoke the pending invitations addressed to their email, and write internal audit entries. |
| `emergency-reenable.sql` | Re-enable a disabled user. Revokes any leftover session. **Never restores memberships or invitations.** |
| `onboard-organization.sql` | Create ONE organization and its first OWNER invitation (valid 7 days) plus an internal audit entry. Refuses to add an owner to an organization that already has members or a live invitation. |
| `add-first-project.sql` | Add one project to an existing active organization, with one client-visible "project created" entry. |
| `invite-member.sql` | Invite ONE more person (member or owner) into an existing active organization, e.g. a second user or a replacement after an email change. |
| `verify-organization.sql` | READ-ONLY checks of one organization (and tenant-isolation sanity numbers). Changes nothing. |

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


---

# Onboarding a new organization (first client)

Everything here applies to Staging first (database `framework-portal-staging`); repeat it unchanged on Production (`framework-portal`) only after the
Production portal has been approved and tested (see `worker/portal/LAUNCH.md`). The four onboarding files are proven by
`worker/test/portal-onboarding.test.mjs` to do the same as the data-layer functions, to be safe to repeat, to resume correctly after a partial run,
and to be unable to touch any other organization. **Do not assume the D1 Console runs a file as one transaction**: if a run stops part-way, run the
**whole** file again, then run `verify-organization.sql`.

## Who does what
| step | who / tool | can the existing tools do it? |
| --- | --- | --- |
| Decide slug, name, owner email, actor label | you | n/a |
| Create the WorkOS user (see below) | you in the WorkOS dashboard, or the WorkOS connector after your explicit approval | **No application tool**: WorkOS sign-up is disabled, so the account must be created for the person |
| Create organization + first owner invitation | you paste `onboard-organization.sql` into the D1 Console (or the reviewed workflow pattern) | SQL runbook only: the portal has no admin screen yet |
| Add the first project | `add-first-project.sql` | SQL runbook only |
| Verify | `verify-organization.sql` | SQL runbook only |
| Tell the person | you, outside the portal | manual |
| First sign-in, session, logout | the owner, in a browser | the portal itself |
| Add more people / replace an email | `invite-member.sql` (+ WorkOS user) | SQL runbook only |
| Remove someone | `emergency-offboard.sql` (+ revoke their WorkOS sessions) | SQL runbook; WorkOS part manual |

## Create the WorkOS user (before the person first signs in)
WorkOS public sign-up is OFF, so the person must exist in WorkOS first, with the **same email address** (lower case) as the D1 invitation. Create or
invite them in the WorkOS **Production** environment (dashboard: Users, Invite user; or the `inviteUser` / `createUser` operations of the WorkOS
connector, with your approval). Rehearse this once on Staging first: confirm that the email link lands on `/portal/login` (the app forwards an
`invitation_token` parameter when present) and that the person ends up on their organization. **Never delete the WorkOS user afterwards** (see
"Account recovery" below): deleting and re-creating a user changes their WorkOS id, and the portal then refuses the sign-in with `email_conflict`
because the old portal row still holds that email.

## Steps
1. **Confirm the database** in the D1 Console header (`framework-portal-staging` or `framework-portal`). Stop if it is anything else.
2. **Pre-checks (read-only).** `SELECT slug, name, status FROM organizations;` and make sure the slug is not taken and the name is right.
   `SELECT email, status FROM portal_users WHERE email = '<email>';` (if the person already exists they will gain the new organization at their next sign-in: confirm that is intended).
3. **Copy `onboard-organization.sql` OUTSIDE the repository**, replace the four placeholders (every occurrence), and run the whole file. Never commit the edited copy.
   Names must not contain apostrophes or quotes. A placeholder left in place makes the database reject the statement and nothing is created.
4. **(Optional) Copy and run `add-first-project.sql`** the same way: the project name appears to the client.
5. **Run `verify-organization.sql`** (replace `__SLUG__`). Expect: one active organization; exactly one pending OWNER invitation for the right address
   with `expires_at` about 7 days ahead; no members yet; the project; the audit entries `org.onboarded` (internal) and `project.created` (client-visible).
6. **Tell the owner**, through your normal channel (not the portal): the address `https://frameworkco.ca/portal/login`, that they will receive a one-time
   code by email (and, if enabled, set up a second factor), and where the privacy notice is. If the 7 days pass unused, run `onboard-organization.sql`
   again: the expired invitation is closed and a new one is issued.
7. **First sign-in** by the owner. Then run `verify-organization.sql` again: the invitation is `accepted` and the owner is an `active` member.

## Tenant isolation check (do this before the first real client, on Production)
The code is tested for isolation (`portal-isolation.test.mjs`, `portal-tenant-security.test.mjs`, the end-to-end test in `portal-onboarding.test.mjs`); this
live check proves the Production deployment behaves the same.
1. Create two internal organizations with the runbook, for example `framework-internal-a` (owner: your own address) and `framework-internal-b`
   (owner: a separate alias you control, or leave its invitation unused), each with a clearly named project.
2. Sign in as the owner of A. Expect: the portal opens A directly; B's project name appears nowhere.
3. Open `/portal/o/framework-internal-b` and `/portal/o/framework-internal-b/projects`: expect **404** (not found, not "forbidden").
4. Sign out and open `/portal/o/framework-internal-a`: expect a redirect to sign-in. Open a private window with no session: same.
5. `verify-organization.sql` query 6 shows each organization with the right member counts and nobody in the wrong place.
Keep the internal organizations as permanent smoke-test fixtures (set unused invitations to revoked with `emergency-offboard.sql` or leave them pending for an alias you control).

## Account recovery, email changes and removing people
* The portal has no passwords. Signing in means receiving a one-time code at the invited email (plus a second factor if the WorkOS environment requires one).
  **Access to the mailbox is the recovery path.** If a person loses their mailbox, verify who they are out of band (phone or a known contact), then:
  1. remove the old identity: `emergency-offboard.sql` for their portal user id, and revoke their WorkOS sessions;
  2. create the **new** WorkOS user for the new address; 3. `invite-member.sql` with the new address (same role) after the owner of that organization has confirmed it.
* **Never delete the WorkOS user** of an offboarded person: keep it, and keep the portal user disabled. If a person truly must be re-created in WorkOS with
  the same address, the old portal row must first be handled by an administrator (sign-in shows "Account needs attention" with reason `email_conflict`).
* An offboarded user's portal access ends immediately (sessions and memberships are revoked in D1), independent of WorkOS. Revoking the WorkOS sessions as well
  is good hygiene (WorkOS dashboard: the user's Sessions, or the `revokeUserSessions` operation, with your approval).
