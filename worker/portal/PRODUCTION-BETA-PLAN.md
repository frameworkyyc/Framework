# Production private beta: written plan (NOT executed)

Status: a plan only. Nothing here has been run. Production stays disabled (`PORTAL_ENABLED` and `PORTAL_ALLOW_PRODUCTION` are absent from `wrangler.jsonc`) until you
approve each stage in writing. Companion documents: `LAUNCH.md` (earlier launch plan, MFA, first sign-in), `BETA-READINESS.md`, `PRIVACY-DRAFT.md`, `migrations/portal-ops/README.md`.

## 0. Preconditions (all must be true before stage 1)
1. Staging: migrations 0002 and 0003 applied and recorded (see BETA-READINESS "Applying 0003"); the manual acceptance checklist below passed on Staging by a real person.
2. The mandatory privacy items in BETA-READINESS "Readiness review" are decided and the website privacy policy has been updated and published through the normal Staging-to-`main` process.
3. You have approved, in writing, merging the Staging branch to `main` (the code is already merged to `main` for the portal foundation; the Business Profile, feedback and admin work in Staging is not).

## 1. Production migrations (Production database `framework-portal`, id `b213b7db-ed29-4ab6-946c-0728dd6709e8`)
Current state (from the earlier reviewed run): 0001 applied and recorded; no portal data. Needed: `0002_business_profile.sql`, `0003_portal_feedback.sql` and `0004_invitation_delivery.sql` (all additive: `CREATE ... IF NOT EXISTS` and `ADD COLUMN`; no destructive statements).
* The manual workflow (`.github/workflows/portal-production-d1-migration.yml`, `.github/scripts/portal-d1-check.mjs`) was updated (Staging PR, tested) to apply the NEXT migrations in order: it accepts only a pending list that is a tail of 0001 to 0004, requires the existing tables to match exactly what the already-applied migrations created, refuses to apply when nothing is pending, and verifies 9 tables and 15 indexes afterwards. Do not bypass it with ad-hoc commands.
* Procedure once the workflow is updated and merged: (1) record a D1 Time Travel bookmark (`wrangler d1 time-travel info PORTAL_DB -c migrations/portal/wrangler.migrate.production.jsonc`); (2) run the workflow in `verify-only` mode and read the target name/id, the pending list (exactly 0002, 0003 and 0004) and the table list (the 0001 tables); (3) run `apply` (a named reviewer approves in the GitHub environment); (4) re-run `verify-only`: nothing pending, tables are the 0001 set plus `business_profile_answers` and `portal_feedback`, and `d1_migrations` lists all four.
* The code that reads these tables degrades safely if a table is missing (Admin says "not available", the portal shows "try again"), but do not enable the portal until the migrations are verified.

## 2. Authentication and MFA checks (WorkOS Production environment)
* Confirm in the WorkOS dashboard (read-only review, then a deliberate change by you): public sign-up OFF; Magic Auth ON; redirect URI exactly `https://frameworkco.ca/portal/auth/callback`; logout URI and initiate-login URL exactly as in `wrangler.jsonc`; session limits as in `LAUNCH.md`; **MFA policy: Required** (authenticator TOTP) per `LAUNCH.md` section 1; the Production client id in `wrangler.jsonc` is the Production one, not Staging's.
* Production secrets exist in Cloudflare (names only; never in the repo): `PORTAL_AUTH_CLIENT_SECRET`, `PORTAL_SESSION_PEPPER` (strong, distinct from Staging), `RESEND_API_KEY` (only needed for the website feedback emails), the Access settings below.
* Test: sign in with your own Production WorkOS user (see section 5) and confirm MFA enrolment appears, the session ends on logout, and an unlisted email cannot sign in.

## 3. Admin allowlist and Access
* `/admin` needs both a valid Cloudflare Access token and an email on `ADMIN_EMAILS`. Verify on Production: `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and `ADMIN_EMAILS` are set (names only here), the Access policy covers `/admin*` and `/api/admin*`, and ONLY staff addresses are listed.
* Admin > Clients and Portal Feedback read the Production portal database through `PORTAL_DB`, so they show real client data on Production: confirm the allowlist is exactly the people who may see client Business Profiles.
* A client session cookie must not open any admin route (covered by automated tests; repeat once by hand on Production).

## 4. Enabling the portal (the launch change)
* A separate, reviewed PR adds `PORTAL_ENABLED="1"` and `PORTAL_ALLOW_PRODUCTION="1"` to the top-level `vars` ONLY. `PORTAL_DEMO` stays Staging-only (code refuses it on the live hosts anyway).
* Before merging: put the temporary Cloudflare WAF rule in front of `/portal*` (see `LAUNCH.md` section 3) so only your own network can reach it.
* The portal stays hidden from the public site (no navigation links); it is reachable only by URL and sign-in.

## 5. Invitation procedure (no automation; per client)
1. Create the client's organization and first OWNER invitation with `migrations/portal-ops/onboard-organization.sql` (reviewed runbook; pasted into the D1 console).
2. Create the person in WorkOS Production with the **same lower-case email** (public sign-up is off). The portal admin cannot do this yet (see BETA-READINESS "Staff administration").
3. Send them the sign-in instructions yourself (plain email: the portal address and "use the email address we invited"). First, invite only yourself and one internal tester, run the acceptance checklist, then invite the first real client.
4. Confirm with Admin > Clients (the organization appears, the invitation shows Accepted after their first sign-in) and `verify-organization.sql`.
5. Offboarding or a wrong invite: `emergency-offboard.sql` / revoke the invitation (runbook). Never delete the WorkOS user afterwards.

## 6. Data backup and recovery
* Before each migration and before inviting the first client: record a D1 Time Travel bookmark for `framework-portal` (restore-to-point-in-time is available for the retention window of the D1 plan: confirm the window in the Cloudflare dashboard; do not assume a length).
* Take a read-only export of the Business Profile answers and feedback before any manual database operation (`wrangler d1 export` with the Production migration config, run by you).
* Recovery: Time Travel restore to the bookmark (stops all writes while restoring; test the procedure on Staging first), or restore from the export. Document who is allowed to run a restore.

## 7. Monitoring and error handling
* Workers Logs (already configured with query strings redacted and no invocation logs) show only fixed-field portal events. Watch for: `store.unavailable`, `request.failed`, `rate.limited`, `profile.save` / `feedback.submit` outcomes `store_unavailable`, `config.invalid`.
* Daily during the beta: open Admin > Portal Feedback and Admin > Clients; check there are no unexpected organizations or members.
* Add a Cloudflare notification or a calendar reminder for the first two weeks; decide who responds to a 503 report and within what time (not set yet).

## 8. Rollback
* Fastest: revert the launch PR (removes the two flags): every `/portal` path returns the plain 404 at once.
* Code rollback: redeploy the previous Worker version in Cloudflare.
* Data: the migrations only add tables, so leaving them in place is harmless on rollback. Use Time Travel only for data corruption.
* Access: `emergency-offboard.sql` removes a person; disabling the WorkOS user ends new sign-ins.

## 9. Privacy notice requirements before any real client signs in
See BETA-READINESS "Readiness review": the published policy must cover the portal, Business Profile and portal feedback (collection, purpose, staff access, providers and locations, retention and deletion, cookies). The in-portal Business Profile notice is already plain-language and makes no compliance claims; it does not replace the policy update.

## 10. Manual acceptance checklist (run on Staging first, then on Production with internal users only)
- [ ] Sign in with an email code; MFA appears on Production; wrong email and an expired code are refused.
- [ ] Home shows six blocks and the footer "Send feedback" link; the five other sections say Coming soon.
- [ ] Business Profile: open step 1, leave a required answer empty and save (kept, progress unchanged), complete it and save ("Saved", step complete), refresh, sign out, sign in: answers are still there and progress is 1 of 7.
- [ ] Type in a field and click a link: the browser warns about unsaved changes; after saving there is no warning.
- [ ] Enter an invalid email: a clear message, nothing lost.
- [ ] Send feedback from a Business Profile step: the section is pre-filled; an empty message is refused; a valid one shows the thank-you.
- [ ] Admin (your staff account): Clients lists the organization with the right completion; the detail shows the saved answers; Portal Feedback shows the message with the right organization and section.
- [ ] A client browser cannot open `/admin` or `/api/admin/clients`; a second organization's user cannot open the first organization's pages (404).
- [ ] Sign out ends the session; the old tab redirects to sign-in.
- [ ] Phone check at 320 and 390px: no sideways scrolling; buttons are easy to tap.
- [ ] Logs show no emails, codes or answers.
