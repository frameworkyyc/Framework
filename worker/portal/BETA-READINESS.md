# Business Profile beta: what exists, and what is still needed

Status: Staging only. The Production portal stays disabled; migration `0002_business_profile.sql` is **not** approved for Production.

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

## Staff (admin) findings
* Staff authorization exists for `/admin` (Cloudflare Access token check, `worker/admin/access.js`), but the admin Worker does not read the portal database (`PORTAL_DB`) and there is no portal staff UI.
* Minimum needed, not built here: a read-only admin page or API that (1) lists organizations with member and pending-invitation counts, (2) shows each organization's profile completion (steps done of 7) and answers, (3) lists incomplete profiles. It needs the `PORTAL_DB` binding on the admin route, a cross-tenant read module with the repository's `cross-tenant:` marking and test pin, and reuse of `profileProgress`. Until then staff can use the reviewed SQL in `migrations/portal-ops` (`verify-organization.sql`).
* Inviting clients uses the existing reviewed runbooks in `migrations/portal-ops` plus the WorkOS flow; no invitation was created or sent.

## Beta feedback (design only, not built)
A single "Send feedback" link in the footer opens `/portal/o/<slug>/feedback`: one textarea (max 2000 characters) and an optional "page you were on" chosen from a fixed list, POSTed with the same CSRF, size, rate-limit and membership checks as the profile. Backend: one table `beta_feedback (id, organization_id, user_id, page, message, created_at)` in the portal database (migration 0003), tenant-scoped, internal audit entry without the message text, and the same staff read page as above. No external service.

## Required before inviting the first beta client
1. Approve and apply `0002_business_profile.sql` to the Staging portal database (done only on explicit approval), then run a full Staging sign-in test with a test user.
2. Decide the Production plan for 0002 (the Production migration check deliberately fails closed while 0002 is pending), and a Production launch approval (flags, WorkOS settings, MFA, privacy notice review: see `LAUNCH.md`, `PRIVACY-DRAFT.md`).
3. Build the staff read page (above) so Framework can see who has completed what.
4. Build the feedback mechanism (above).
5. Add a short consent and privacy notice to the Business Profile (what is collected, why, who sees it).
6. Optional: data export and deletion procedure for a profile; a "mark section as not applicable" control for questions a client cannot answer.
