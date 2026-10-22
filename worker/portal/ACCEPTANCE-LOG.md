# Staging live acceptance test: Client Portal Beta 1.0 (2026-10-20/21)

Run against the live Staging site (`staging.frameworkco.ca`) with a real browser (headless Chromium, Playwright) signed in through WorkOS email codes as two existing test accounts
(A: owner of "Framework Staging Live Test", B: owner of "Framework Test Organization"). Every browser step was checked against the Staging portal database (read-only SELECTs) and,
where relevant, WorkOS (read-only). Production was not touched. `PORTAL_ADMIN_WRITES` and `PORTAL_INVITE_SENDING` stayed off. Nothing was deleted; no organizations or users were created.

| # | Step | Result | Evidence (live) |
|---|---|---|---|
| 0 | Baseline | PASS | Health check 25 PASS / 1 WARN / 0 FAIL; both switches absent; row counts recorded |
| 1 | Invitation and onboarding record | PASS | Audit chain `invitation.created` -> `delivery_submitted` (WorkOS) -> accepted; WorkOS invitation Accepted, email verified. (Not repeated: creating invitations is switched off.) |
| 2 | Sign-in | PASS | New session, `auth.signed_in`, 14-day absolute limit, method magic_auth; `__Host-` cookie Secure/HttpOnly/SameSite=Lax and security headers on the live site; email arrived in ~2 s |
| 3 | Dashboard | PASS | Progress shown (57% then 71%) equals `profileProgress()` on the live rows; five modules "Coming soon"; no demo data |
| 4 | Business Profile | PASS | Empty required answer: optional answers kept, step stays in progress. Invalid email: 422, error summary takes focus, input kept, nothing saved. Valid save: stored, progress 71%. Audit holds step id and schema version only (no answers) |
| 4b | Stale form | PASS | Second tab answered 409; the first tab's value stayed in the database |
| 5 | Sign-out and return | PASS | Session revoked, protected page and Back go to sign-in, replaying the pre-sign-out cookie gives `/portal/login?r=ended`; the WorkOS session ended too; a new sign-in showed the saved answers |
| 6 | Account and Team | PASS | Name change persisted (and was reverted); Team lists the owner |
| 7 | Feedback | PASS | Empty message refused (422); valid message stored against the right organization and person; audit holds the kind only |
| 8 | Admin review | PASS | Verified by the owner in the browser (2026-10-21), signed in to the Staging Admin through Cloudflare Access: the dashboard loads; all three test organizations are listed; Framework Staging Live Test shows the right details, the accepted invitation and the active Owner; the Business Profile shows the saved answers and 71%; the write controls are disabled; Portal Feedback shows both test messages (including the automated one). Minor UX note: hide the disabled invitation form (done in a follow-up PR) |
| 9 | Isolation | PASS | As A and as B: every page and write (feedback, profile, account) for another or unknown organization answered the same 404; nothing written; `/admin` and `/api/admin/*` redirect to Cloudflare Access |
| 10 | Mobile and accessibility | PASS | axe (WCAG 2.0/2.1/2.2 A and AA plus best practice): 0 violations on 10 signed-in pages x 4 widths (320, 390, 768, 1280) and the login page; no sideways scroll; logical tab order with visible focus |

## Findings
* F1 (Staging only): WorkOS Staging also allows Google, Microsoft, GitHub and Apple sign-in and SSO; MFA is off. **The WorkOS Production environment already has every social provider off** (read-only check, 2026-10-21), so the privacy policy statement (email code only) is accurate for Production. Optionally turn the providers off on Staging so it matches.
* F2 (fixed, PR 5): the sign-in page brand bar was outside every landmark.
* F3 (P2): `<main>` has no `tabindex="-1"`, so the "Skip to content" link leaves focus on the page body in some browsers.
* F4 (P2): the sign-in page links to the portal demo on Staging (intended on Staging; the demo is refused on the live hosts).

## Not covered (needs an invitation, a new user or a person)
A brand-new user's first sign-in; the existing-user email (Resend) invitation path; delivery to an outside inbox; Member (non-owner) restrictions; the multi-organization picker; session expiry timing; MFA.
