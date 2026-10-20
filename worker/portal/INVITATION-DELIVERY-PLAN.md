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

## Phase 3: wired behind two switches (both OFF everywhere)
Migration 0004 is applied on Staging (confirmed by the owner: ids 1-4 recorded, four columns present, nothing pending). The delivery code is now reachable from
the admin API, but nothing can send until **both** `PORTAL_ADMIN_WRITES` and `PORTAL_INVITE_SENDING` are exactly `"1"`; neither is in any checked-in configuration.

| Route (under `/api/admin/clients/:org/invitations/:id/`) | Behaviour |
| --- | --- |
| `send` | first send, or retry after a failure. Read-only WorkOS lookup, then WorkOS invitation (new user) or Framework email (existing user). Needs delivery state `not_sent` or `failed`. |
| `resend` | needs `submitted`; same channel; **expiry never changes**. |
| `revoke` | D1 first (ends access), then cancel the WorkOS invitation. A WorkOS failure is reported (`workos: revoke_failed`, audited) and never undoes the revoke; repeating `revoke` retries only WorkOS. With sending off, D1 only and `revoke_failed: sending_disabled`. |
| `replace` (unchanged) | an expired or revoked invitation becomes a fresh seven-day, `not_sent` invitation. |

Safety properties (all tested with mocks): a provider failure of any kind is a recorded `failed` with a short code, never a success; provider text, addresses and keys
never reach responses or the audit trail; simultaneous sends make ONE provider request (compare-and-swap claim on `delivery_attempted_at`); missing configuration
(WorkOS key, portal address, migration 0004) answers 503 before anything is attempted; a database without 0004 (Production today) still lists invitations
(`not_tracked`) and revokes in D1. Access is unchanged: D1 + a verified, matching email.

### WorkOS behaviour that still needs ONE live Staging verification before sending is enabled
1. `POST /user_management/invitations` accepts `{email, expires_in_days}` and returns an object with `id` (`invitation_...`). Any other shape is treated as failure by design.
2. The `expires_in_days` we send (remaining days, rounded up, 1-30) matches the D1 expiry closely enough; WorkOS may count differently.
3. What WorkOS answers for an **existing** user (documentation unconfirmed). The design never relies on it (a read-only lookup decides), but a 4xx there is recorded as failed.
4. `GET /user_management/users?email=` returns `{data: [...]}` and matches case-insensitively.
5. `POST .../{id}/resend` really re-sends without extending the WorkOS expiry, and returns the invitation object.
6. `POST .../{id}/revoke` and what it answers for an already revoked, accepted or expired invitation (we treat any non-2xx as `revoke_failed`: harmless, because D1 already blocks access, but it means a cleanup retry would keep reporting failure).
7. The invitation email link leads to `/portal/login?invitation_token=...` (the portal forwards the token) and the invitee can complete sign-up with `allowSignUp:false`.
8. Staging email deliverability to a second, non-owner inbox (WorkOS sandbox sender), and Resend deliverability for the existing-user notice.
9. The WorkOS API key in the Worker (`PORTAL_AUTH_CLIENT_SECRET`) is permitted to create, resend and revoke invitations (it is environment-wide, so expected).

Enabling procedure (not done): set both switches in `previews.vars` through a reviewed change, run one invitation to an inbox you control, watch the WorkOS dashboard's
sent-email events, then remove or keep the switches as decided.

## Phase 4: the Admin interface (Admin -> Clients)
`admin/assets/clients.js` (list and detail, Business Profile review unchanged and read-only) now uses `admin/assets/clients-access.js`:
* **List:** New client (business name, optional website, optional URL name; a bare domain gets `https://` the way the portal's own field does; field-level server errors); on success the administrator lands on the client with a "next step: invite its first owner" prompt and focus in the invite field.
* **Detail:** Organization facts; **Invitations** (invite form with Owner/Member, a confirmation that says creating does not email anyone; table with invitation status and delivery state in separate columns; Send, Try again, Resend, Replace, Revoke, Retry WorkOS cancel as appropriate); **Members** (Make owner/member, Remove access with a confirmation that says the organization's data is kept; the only active owner's buttons are disabled with a reason); Business Profile review.
* **Honesty rules in the copy:** "Submitted to WorkOS / Framework email" always comes with "the provider accepted the request; arrival in the inbox isn't confirmed"; failures say "Nothing was sent" with a plain reason; an expired invitation says it can't be sent again and must be replaced; a revoke whose WorkOS cancel failed says access is closed, the cancel failed, and how to finish.
* **Safety:** all rules stay server-side (the page only reads `last_active_owner`, `past_expiry`, `capabilities`, `workos_cleanup`); controls lock while a request runs; no raw server text, ids or provider messages are displayed; no inline styles or HTML injection (the admin CSP is unchanged and was observed clean in the browser).
* **Additive API changes:** `capabilities` (booleans) on the clients list and the access listing; `workos_cleanup` (`none|pending|done`, from the audit trail) on invitations; `api()` in `ui.js` now carries the server's short error code and message on 403/409/422/500/502/503 (existing codes are unchanged).
* **With both switches off (today on Staging)** the interface renders fully and explains itself: banners say changes/sending are switched off and the relevant buttons are disabled.

### Before a controlled live Staging onboarding test
1. Resolve the WorkOS live-verification list above with one invitation to an inbox you control.
2. Decide how the invitee reaches the portal from the WorkOS email (the link must land on `/portal/login?invitation_token=...`).
3. Set `PORTAL_ADMIN_WRITES` and `PORTAL_INVITE_SENDING` in `previews.vars` through a reviewed change (and confirm `RESEND_API_KEY`, `ASSESSMENT_FROM`, `PORTAL_AUTH_CLIENT_SECRET` exist on Staging).
4. Confirm the Cloudflare Access policy for `/admin*` and `/api/admin/*`.
5. Run the onboarding checklist: create client, invite, send, receive, sign in, save a profile answer, remove access, re-invite.

## Phase 5B: temporary recipient allowlist for the controlled live test
`PORTAL_INVITE_ALLOWLIST` (a Cloudflare **secret** on the Staging Preview; see "Invitation recipient allowlist (secret)" below) restricts every operation that could email a portal invitation:
**create, replace, send and resend** are refused unless the address is on the list (`403 recipient_not_allowed`), and **all four are locked** when the list is missing,
empty or malformed (`403 recipient_allowlist_missing`: fail closed; there is no allow-everyone value; one bad entry refuses the whole list). Matching is exact after the portal's usual normalization: no plus-address,
dot, domain or wildcard matching. The check runs in the Worker (`worker/portal/admin-access.js`, again inside `invite-delivery.js`), after authentication, CSRF and input validation and
before any database change or provider call; send, resend and replace check the address STORED on the invitation, so an older invitation for another address can never be sent.
Revoke, role changes, removing access and creating an organization email nobody and are not restricted. The existing admin "feedback request" email is a separate feature (a link to the public
feedback form) and is unchanged.
The Admin interface shows whether recipients are `configured` or `missing` (never the addresses) and explains refusals in plain words.
**Lifting the restriction after the test is an explicit, reviewed code change**, by design: remove the setting AND change the policy, rather than leaving a setting unset.
The two administrative switches are still not set anywhere.


## Invitation recipient allowlist (secret)
The repository is public, so the list of people who may be invited is **not** kept in `wrangler.jsonc` (it used to be a `previews.vars` entry named `PORTAL_INVITE_ALLOWED_EMAILS`; that
name is no longer read anywhere). It is now the Cloudflare secret **`PORTAL_INVITE_ALLOWLIST`** on the Staging Preview. Nothing about the portal itself depends on it: a missing list
only locks invitations (which are off anyway while `PORTAL_ADMIN_WRITES` and `PORTAL_INVITE_SENDING` are unset); sign-in, sessions and the Business Profile do not read it.

**Format.** Exact email addresses separated by commas, semicolons or whitespace, for example `first@example.test,second@example.test` (use real addresses only when you set it). No wildcards, domains, quotes,
display names ("Name <a@b.co>") or other punctuation: **any** unusable entry (or a value over 4096 characters) makes the whole list malformed, and a malformed, empty or missing list refuses create, replace, send and resend (`recipient_allowlist_missing`).
The Admin screen only ever shows `configured` or `missing`, never the addresses.

**Set or change it (a person does this; never paste the value into chat, a ticket, a commit, a document or a command line):**
1. Use Wrangler 4.135.0 or newer, signed in to the Cloudflare account (`npx wrangler login`).
2. Run `npx wrangler preview secret put PORTAL_INVITE_ALLOWLIST --name Staging`. Wrangler asks for the value with a hidden prompt: type or paste the list there. (`--name Staging` is the Preview for the `Staging` branch, as in the README's other Staging secrets. Confirm the name in the dashboard: Workers & Pages > framework > the Preview menu.)
   Setting a secret on a Preview creates a new deployment of that Preview with the same code.
3. Check that it exists (names only, never values): `npx wrangler preview secret list --name Staging` must list `PORTAL_INVITE_ALLOWLIST`.
4. Do not use `--var`, an `.env` file in the repository, a shell variable on the command line, or the dashboard's plain "variable" field: only a **secret** is hidden from the dashboard and never written to the Wrangler file. Secrets are not removed by later deployments; plain variables and anything in `wrangler.jsonc` are.
5. To remove it (invitations lock at once): `npx wrangler preview secret delete PORTAL_INVITE_ALLOWLIST --name Staging`.

**Rules.** Keep the list to the people you have decided to invite for this beta; add an address only when you are about to invite that person; remove it afterwards. Do not add an address to any file in the repository, including tests, docs and this page (use `example.test` addresses in
examples). Git history is public and permanent: addresses committed earlier remain visible in old commits.

**Transition for this change (no gap).** Create the secret under the NEW name (`PORTAL_INVITE_ALLOWLIST`) first, then deploy the code that reads it: there is never a moment
without a list, and the old plain variable is dropped by the same deployment that removes it from `wrangler.jsonc`. If the secret were ever missing at deploy time the result is the safe one (invitations locked).
