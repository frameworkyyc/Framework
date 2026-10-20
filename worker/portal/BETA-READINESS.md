# Business Profile beta: what exists, and what is still needed

Status: Staging only. The Production portal stays disabled; migration `0002_business_profile.sql` is **not** approved for Production.

Staging database `framework-portal-staging` (`1edda8a2-5249-4f40-9dbc-d29aa44e21f8`): 0002 was applied on 2026-10-20 as its single `CREATE TABLE IF NOT EXISTS business_profile_answers` statement (identical to the file; a test pins that), executed through the Cloudflare tool with the owner's explicit approval. It is therefore **not recorded in `d1_migrations`**; running `wrangler d1 migrations apply` against Staging later is harmless (IF NOT EXISTS) and will record it. Production was not touched.

## What is functional (signed-in clients)
* Home: the six workspace blocks. Business Profile is real; Branding, Website, Marketing, Content & Photography and Files & Deliverables are Coming Soon pages.
* Business Profile: seven steps (schema `worker/portal/profile-schema.js`, version 1). Server-side validation, saved per organization, resumable, re-openable, unsaved-changes warning and a Saving state (`assets/js/portal-profile.js`, optional enhancement).
* The earlier project pages (`/progress`, `/projects`, `/activity`, `/documents`, `/account`, `/members`) keep their routes and authorization. They hold no demonstration data.
* The fictional demo at `/portal/demo` is separate (no database, Staging only).

## Completion
A step is **complete** when every required question has a saved answer; a step with no required questions is complete once any of its questions is answered; otherwise it is in progress (some answers) or not started. Overall progress = complete steps / 7. It is calculated on every request from the saved rows and stored nowhere, and projects, files and requests cannot affect it.

## Data
`business_profile_answers (organization_id, field_id, value, schema_version, updated_by, updated_at)`, one row per answered question, primary key (organization_id, field_id). An unanswered optional question has no row. Each step is saved in one atomic batch together with an internal `profile.updated` audit entry that carries the step id only.

## Security model
* Organization comes only from the active membership (`requireOrgAccess`), never from the form or URL; actions `profile.view`, `profile.edit`, `workspace.view` (owner and member). No membership: the same 404 as an unknown organization.
* POST: size pre-check, same-site check, rate limit (`profile` bucket), session + membership + role, body read with a streaming 24 KB cap (urlencoded only, duplicate field names refused), session-bound CSRF token, then schema validation. Unknown fields are ignored; invalid answers save nothing.
* Logs carry fixed fields only (never answers). Errors show a generic message and keep what the person typed.
* CSP: profile pages add `script-src 'self'` (no inline); all other portal pages keep no scripts.

## Staff administration (Admin > Clients, read-only)
* Same Worker, same `/admin` app, same locks: a verified Cloudflare Access token AND an email on `ADMIN_EMAILS` (`worker/admin/access.js`). The new `/api/admin/clients` routes (`worker/portal/admin-clients.js`) are reached only after that check.
* The admin Worker reads the portal database through the existing `PORTAL_DB` binding (bound for Staging and, separately, for Production). Access goes through `readOnlyDb()`, which refuses anything but a single SELECT. Every route is GET; there is no edit, no sending, no impersonation. Client answers are never logged.
* Lists organizations (active members, invitation summary, Business Profile steps complete) and shows one organization: all seven sections with saved answers (complete / partial / missing), members, and invitations as the database records them.
* Invitations: the system can record and read them (`invitations` table: pending, accepted, revoked, expired), but cannot create them from the admin. Missing pieces for safe creation: (1) a WorkOS management client in the Worker (a server-side API key with user-management scope; today the Worker only completes user sign-ins), because public sign-up is off and the person must exist in WorkOS with the same email first; (2) an admin write route with its own confirmation, CSRF and audit entry; (3) a decision on who may invite and for which role. Until then use the reviewed runbook in `migrations/portal-ops`.

## Staging migration history (reconciliation)
`d1_migrations` is `(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)` and holds only `0001_portal_foundation.sql`. The `business_profile_answers` table already exists with exactly the DDL of 0002. Recommended, supported fix (needs a Cloudflare login; nothing was changed): `npx wrangler d1 migrations list PORTAL_DB --remote -c migrations/portal/wrangler.migrate.staging.jsonc` (expect only 0002 pending, and the prompt must name `framework-portal-staging`), then `... migrations apply ...`. 0002 is `CREATE TABLE IF NOT EXISTS`, so it changes nothing and Wrangler records it in its own format. Do not hand-insert a history row unless Wrangler cannot be used.

## Portal feedback (built) and applying 0003
Signed-in clients send feedback from the footer link on every portal page (`/portal/o/<slug>/feedback`): type (problem, suggestion, other), message, optional section from a fixed list. Stored in `portal_feedback` (migration `0003_portal_feedback.sql`) with the organization and person from the session, never from the form. Staff read it at Admin > Portal Feedback (read-only; separate from the website "Client Feedback" survey).

**Applying 0003.** Staging's migration history lists only 0001 although the 0002 table exists. The safe plan, needing a Cloudflare login (nothing here has been applied): run `npx wrangler d1 migrations list PORTAL_DB --remote -c migrations/portal/wrangler.migrate.staging.jsonc`; it must name `framework-portal-staging` and list exactly `0002_business_profile.sql` and `0003_portal_feedback.sql` as pending; then `... migrations apply ...`. Wrangler applies them in order: 0002 is `CREATE TABLE IF NOT EXISTS` so it is a no-op that Wrangler then records in its own format, and 0003 creates the feedback table. That resolves the history and applies 0003 in one supported step. Do not hand-insert history rows. Until then the portal shows its "try again" message when someone sends feedback, and Admin > Portal Feedback says the feature is not available yet. Production is untouched, and its migration check still fails closed while 0002 and 0003 are pending.

## Beta feedback: original design note (superseded by the above)
A single "Send feedback" link in the footer opens `/portal/o/<slug>/feedback`: one textarea (max 2000 characters) and an optional "page you were on" chosen from a fixed list, POSTed with the same CSRF, size, rate-limit and membership checks as the profile. Backend: one table `beta_feedback (id, organization_id, user_id, page, message, created_at)` in the portal database (migration 0003), tenant-scoped, internal audit entry without the message text, and the same staff read page as above. No external service.

## Required before inviting the first beta client
1. Approve and apply `0002_business_profile.sql` to the Staging portal database (done only on explicit approval), then run a full Staging sign-in test with a test user.
2. Decide the Production plan for 0002 (the Production migration check deliberately fails closed while 0002 is pending), and a Production launch approval (flags, WorkOS settings, MFA, privacy notice review: see `LAUNCH.md`, `PRIVACY-DRAFT.md`).
3. Reconcile the Staging migration history (above) and deploy-test Admin > Clients with a real admin sign-in.
4. Build the feedback mechanism (above).
5. Add a short consent and privacy notice to the Business Profile (what is collected, why, who sees it).
6. Optional: data export and deletion procedure for a profile; a "mark section as not applicable" control for questions a client cannot answer.
