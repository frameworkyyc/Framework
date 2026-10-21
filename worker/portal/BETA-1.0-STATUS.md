# Client Portal Beta 1.0: running status

Last updated 2026-10-21. Production is untouched and the portal is OFF there (`/portal` answers a plain 404). All work below is on Staging.
Evidence labels: **live** = observed on the real Staging site/Cloudflare/WorkOS; **tests** = automated suite (mocked); **config** = read from a provider's settings; **open** = not done.

## Smallest safe Beta 1.0
One or a few invited organizations; email-code sign-in; Home, Business Profile, Account, Team, portal feedback; read-only staff review in Admin. Invitations by the reviewed runbook
(`migrations/portal-ops`), with Admin writes and invitation sending OFF on Production. Not in Beta 1.0: file sharing, the five "Coming soon" modules, Admin-sent invitations, scheduled monitoring.

## Done and verified
| Area | Evidence |
|---|---|
| Sign-in, sessions, sign-out (portal and WorkOS side) | live (see ACCEPTANCE-LOG.md) |
| Organization isolation (both directions) and Admin not reachable by clients | live |
| Business Profile: validation, save, stale-form protection, progress | live |
| Account, Team, portal feedback | live |
| Accessibility (WCAG 2.x A/AA scan, keyboard) and mobile widths | live |
| WorkOS Production settings: sign-up off, email code on, **all social sign-in off**, password off, redirect/logout/initiate-login URLs exact, 14-day / 12-hour session limits match, API key present and never used, 0 users | config (read-only) |
| Staging health check (on demand) and IP_HASH_SALT on Staging | live |

## Open: must finish before the first real client (P0)
| # | Item | Who | State |
|---|---|---|---|
| 1 | Promote Staging to `main` (inert: portal flags stay off) | Claude prepares, owner approves | open |
| 2 | Production migrations 0002-0004 through the manual workflow | workflow updated and tested on Staging (tail-of-list and exact-table checks; manual, verify-only by default); owner runs it: verify-only, bookmark, apply, verify-only | open: owner to run |
| 3 | Publish the privacy policy (effective date = day of publication) | owner | wording reviewed against the code; corrections merged; owner is named privacy contact. Open: **legal/adviser review (incl. the Business Profile notice approach)**, verify the admin list and Access policy, administrator MFA confirmations, calendar reminders |
| 4 | Client MFA decision | owner | **decided 2026-10-21**: email code only for the initial Beta; reconsider as the portal expands |
| 5 | Production secrets and Cloudflare Access check (names only) | owner / Claude read-only | open |
| 6 | First Production sign-in behind a temporary WAF rule, then isolation check (`verify-organization.sql`) | owner + Claude | open |
| 7 | Time Travel bookmark before first client data; confirm retention window in the dashboard | owner | open |
| 8 | Incident note and named operator | owner | **operator decided** (the owner); note still a draft, owner to read it once |
| 9 | Administrator MFA (decided: required wherever supported) | owner | **WorkOS done** (owner enrolled; dashboard-wide requirement on; client sign-in unchanged). Open, cannot be verified from here: Cloudflare, GitHub, the hello@frameworkco.ca mailbox, the Cloudflare Access sign-in method |
| 10 | Admin area live check (Step 8 of the acceptance test) | owner | in progress |
| 11 | WorkOS email deliverability to an outside inbox (both test inboxes are the owner's) | owner | open |

## Important for Beta (P1)
WAF rate rule on `/portal*`; turn off unused WorkOS SSO / IdP-initiated SSO; `IP_HASH_SALT` on Production; client onboarding email (CLIENT-ONBOARDING.md draft); daily log and feedback review for the first weeks;
`www.frameworkco.ca` behavior; "no sensitive personal information" hint on free-text boxes; secret-rotation note; `secrets.required` in `wrangler.jsonc`; optionally disable social sign-in on the WorkOS Staging environment so it matches Production.

## After launch (P2)
Admin-sent invitations on Production, remaining modules and file sharing, passkeys, feedback notification emails, "not applicable" answers, export/deletion tooling, scheduled session purge, scheduled monitoring, a repeatable authenticated test setup (dedicated test users and an API-created sign-in code).

## Recommended order
1 Workflow update (PR to Staging) -> 2 owner decisions (MFA, privacy, operator) -> 3 promote to `main` (inert) -> 4 Production migrations via the workflow (bookmark first) -> 5 Production configuration checks and WAF rule ->
6 launch change (two flags) with approval -> 7 internal Production sign-in and isolation test -> 8 invite the first client. Rollback at any point: revert the launch change; `/portal` returns the plain 404.
