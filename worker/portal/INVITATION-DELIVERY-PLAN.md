# Invitation delivery: design, WorkOS findings and the proposed migration

Status: **design implemented and tested with mocks; nothing is wired to a route, nothing is applied, nothing was sent.**
Read with `worker/portal/BETA-READINESS.md`. Staging only.

## Principles
* **D1 decides access.** An invitation grants access only while it is `pending` in D1 and unexpired, and only to a sign-in whose **verified** email equals the
  invited address (`activatePendingInvitations`). WorkOS and email only *inform* the person. Nothing in delivery grants, extends or restores access.
* **Delivery is not acceptance.** They are separate fields. "Submitted" means a provider accepted our request; it is never reported as delivered to an inbox
  (neither WorkOS nor Resend confirmation is read back).
* **A failed request is never a success.** Every WorkOS or email failure, timeout, malformed or empty response is recorded `failed` with a short code.

## What is confirmed about WorkOS (and what is not)
Sources: the WorkOS public documentation as far as it could be read from this environment (workos.com itself was not reachable; search summaries only),
plus read-only queries of the Staging environment.

| Question | Answer | Confidence |
| --- | --- | --- |
| Can an invitation open sign-up while `allowSignUp:false`? | Yes: "when a valid invitation code is present in the sign-in flow, registration is opened up", per the invite-only sign-up guide. | Documented |
| Staging already did this successfully | One AuthKit invitation to the test address is in state *Accepted* (2026-10-18); invitation emails are enabled. | Verified read-only |
| Endpoints | `POST /user_management/invitations` (email; optional organization_id, expires_in_days 1-30 default 7, inviter_user_id, role_slug), `POST .../{id}/resend`, `POST .../{id}/revoke`, `GET .../invitations/by_token/{token}`; the object carries `token` and `accept_invitation_url`. | Documented in summaries; **parameter and response names unverified against a live call** |
| Does an invitation for an **existing** WorkOS user work? | **Not confirmed.** The docs only say invited people "may be invited to join an organization if they already have an account", which concerns organization membership. A third party reports `user_already_exists` (400) for an existing user, and `email_already_invited` for a pending one: not official. | **Unconfirmed: needs one live Staging test** |
| Can WorkOS tell us in advance if a user exists? | `GET /user_management/users?email=` (read-only). | Documented |
| Does WorkOS confirm inbox delivery? | Not through the invitation API. Staging shows per-email delivery events in the dashboard (`environmentSentEmails`), not in the invitation object. | Observed |
| Staging email sender | WorkOS default sandbox domain (`workos.dev`); no custom email domain. Whether sandbox mail reaches arbitrary recipients is **unverified** (only the owner's address has been proven). | Observed / unverified |
| API key scope | A WorkOS API key is environment-wide: it cannot be limited to invitations. The Worker already holds it (`PORTAL_AUTH_CLIENT_SECRET`), so reuse adds no new secret, but it is a high-privilege credential. | Documented |

### Decision for existing users (design, because WorkOS support is unconfirmed)
1. Ask WorkOS **read-only** whether a user with that email exists (not guessing from an error message).
2. **No user** -> create a WorkOS invitation (WorkOS emails it; the portal's login already forwards `?invitation_token=`).
3. **User exists** -> Framework sends its own notice through the existing Resend integration with a plain link to `/portal/login` (no token, nothing secret).
   The person signs in with a one-time code to the same address and the pending D1 invitation activates. Never silent: the email says who invited them.
4. If a live test later shows WorkOS handles existing users well, step 3 can switch to it; the state model does not change.
5. A lookup that fails means we cannot tell which path is right: the attempt is recorded `failed` (no guess, nothing sent).

## Resend and replace
* **Resend** re-sends through the same channel and **never changes `expires_at`**. It needs a prior successful submission. A failed attempt is retried with *send*.
* **Expired** (by date or status) cannot be sent or resent: the administrator must **replace** it (new invitation, seven days, `delivery_status` back to `not_sent`,
  no provider id carried over). Replacement already exists and is audited (Phase 1).
* A WorkOS invitation created for an address stays valid at WorkOS until revoked there. Revoking in D1 already stops access; Phase 3 should also call WorkOS
  revoke so a stale link cannot create an unused WorkOS user.

## Migration `0004` (prepared in `migrations/portal/0004_invitation_delivery.sql`; NOT yet applied to any database)
Four additive columns on `invitations`:

| Column | Type | Purpose |
| --- | --- | --- |
| `delivery_status` | TEXT NOT NULL DEFAULT `'not_sent'`, CHECK in (`not_sent`,`submitted`,`failed`) | separate from acceptance |
| `delivery_channel` | TEXT NULL, CHECK in (`workos`,`resend`) | which provider was asked |
| `delivery_attempted_at` | TEXT NULL | latest attempt (UTC ISO, same format as the rest) |
| `delivery_error` | TEXT NULL, CHECK short `[a-z0-9_]` code, 1-40 chars | latest failure code; never provider text or addresses |

**Impact review**
* *Existing invitations.* Every row becomes `not_sent` (true: the system never sent them) with NULL elsewhere. The one Staging invitation (accepted) stays
  `accepted`; it was created outside this system (WorkOS dashboard or earlier testing), which the new fields correctly do not claim. No existing column, constraint, index or row changes. Tested in
  `worker/test/portal-invite-delivery.test.mjs` (all four statuses migrated, columns unchanged, constraints enforced).
* *D1 mechanics.* `ALTER TABLE ... ADD COLUMN` with a constant default is a metadata change in SQLite/D1: no rebuild, no copy, no downtime. A CHECK on an added
  column is validated against existing rows (all `not_sent`, so it passes).
* *Rollback.* Additive and unused by the running code until wired, so leaving it in place is harmless. SQLite can drop columns (3.35+) but there is no need.
  Take a D1 Time Travel bookmark first as for any migration.
* *Code that must change when approved:* move the file to `migrations/portal/0004_...`; update the pinned migration lists in the tests
  (`portal-migration`, `portal-d1-workflow` expectations) and `migrations/portal/README.md`; then wire reads of the new columns (the access listing returns
  `delivery: not_sent` constant until then).
* *Migration workflows.* **Production is not affected by this proposal and is not ready regardless:** `.github/workflows/portal-production-d1-migration.yml` and
  `.github/scripts/portal-d1-check.mjs` accept exactly `0001` and fail closed when any other migration is pending, which is already the case for 0002 and 0003.
  Production needs its own reviewed migration change (0001 to 0004) before the portal is ever enabled there. Staging is applied with Wrangler as before
  (`-c migrations/portal/wrangler.migrate.staging.jsonc`), after your approval, with a bookmark and a before/after `d1_migrations` check.
* *Fallback without a migration.* Delivery state could be derived from audit entries (`invitation.delivery_submitted|failed`) at the cost of an N+1 query per
  invitation; rejected: the columns are small, and the status must be queryable and constrained.

## What is blocked
| Item | Blocked on |
| --- | --- |
| Recording delivery state (`recordDeliveryAttempt`) in any real database | approval to apply migration 0004 |
| Admin routes that send or resend (not built) | migration 0004, then Phase 3 wiring |
| The WorkOS client's exact request and response shapes | one live Staging call (create, resend, revoke; and an existing-user case) |
| Whether WorkOS can invite an existing user (would replace the Resend path) | the same live test |
| Staging email deliverability to arbitrary addresses (WorkOS sandbox sender) | a live test to a second inbox, or a custom email domain in WorkOS |
| Enabling the write routes | `PORTAL_ADMIN_WRITES=1`, set by a separate approved config change; absent everywhere now |
