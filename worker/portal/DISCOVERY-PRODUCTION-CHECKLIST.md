# Brand Discovery: Production readiness checklist

Status on 5 November 2026. Production is untouched. Nothing below is done on Production until the owner approves that step. Tick a line only when it is true.

## 0. Decisions already made
- Release scope: all of Staging (PR #156), migrations 0014 to 0018, `PORTAL_DISCOVERY` on in Production. `PORTAL_SERVICES` and `PORTAL_DEMO` stay off.
- Retention rule: answers and files kept while the client relationship continues and for 90 days after it ends, unless the law requires longer.
- Launch first, automate later: nothing below that "can follow" blocks the launch.

## 1. Application
- [x] Staging healthy on the Staging head (26 PASS, 1 usual retention WARN, 0 FAIL); full suite passes.
- [x] PR #156 (main <- Staging + `PORTAL_DISCOVERY`) had Node tests and Workers Builds green on its head. **It must be refreshed with the newest Staging (privacy PR #157 and the retention PR) and re-tested before merge.**
- [ ] Owner has looked at Brand Discovery on Staging at phone and desktop width (the visual and Codex changes were checked by tests, not by the owner).
- [ ] After the merge, owner checks Production: sign in, Branding page shows the Brand Discovery card only where an assessment exists, Admin > Brand Discovery loads, create a test assessment for a test client, open its guest link in a private window, complete one step, then delete the test assessment ("Delete permanently").

## 2. Database migrations (Production is at 0013)
- [ ] 0014 to 0018 reviewed by the owner (additive only: new tables, indexes, nullable columns, one `INSERT OR IGNORE` seed row "Nexus Fleet Tracker" in 0017 that Admin can hide per client).
- [ ] Production restore bookmark recorded (Cloudflare dashboard > D1 > framework-portal > Time Travel, or `wrangler d1 time-travel info framework-portal`): ______________
- [ ] Production before-snapshot recorded (row counts taken 5 Nov: 6 organizations, 6 memberships, 6 portal users, 4 brand kits, 10 brand assets, 2 websites, 4 portal services, 4 service requests, 217 activity-log rows; 26 tables; last migration 0013).
- [ ] Workflow "Portal Production D1 migration", ref Staging, **verify-only** run approved and read (expect exactly 0014 to 0018 pending, nothing unexpected).
- [ ] Owner explicitly approves the **apply** run; it is run; the workflow's own after-checks pass (nothing pending, expected tables and indexes).
- [ ] Only then: PR #156 merged. (Never before: the new code expects the tables.)
- 0019 (client relationship end date) is **not** part of this release: it stays in `migrations/portal-proposed/` and can follow.

## 3. Image licensing (see `DISCOVERY-IMAGES.md`)
- [x] Owner confirmed: photos and textures are from Unsplash (commercial use under its standard licence); the 12 logo examples are AI-generated. All existing images stay.
- [ ] Quick rights review of the 7 flagged files (identifiable people or trademarks: lifestyle, flatlay, documentary, abstract3d, blank, and the direction images bold and dark). Each is keep-or-swap; none blocks the release if the owner accepts it for illustrative use.
- [ ] Owner keeps the Unsplash page URL and photographer for each photo and texture, and the generation records and terms for the AI-generated images.
- [ ] Owner states the source of the 20 design-direction images (most look AI-generated).

## 4. Privacy
- [x] Guest welcome page shows a plain-language privacy notice; `privacy.html` has a "Brand Discovery" section and retention entry (PR #157, on Staging).
- [x] The policy no longer claims an automated backup purge (that switch is off), and says an Admin deletion removes answers, links, files and backup copies together.
- [ ] Effective date in `privacy.html` set to the real publication date (`PRIVACY_PUBLISH=1 node --test worker/test/privacy.test.mjs`).
- [ ] Owner (or a lawyer) has read the new wording.
- [ ] The deletion-request routine in `PRIVACY-OPERATIONS.md` section 7 is understood: a guest emails hello@frameworkco.ca; Admin finds the assessment and uses **Delete permanently** (tested: removes files and backup copies, fails closed, counts-only audit entry); the reply and the request log are recorded.

## 5. Retention
- [x] Admin **Delete permanently** exists and works without any new migration.
- [x] Automatic retention is built but **OFF** and needs two things that are not part of this release: migration 0019 and the switch `PORTAL_DISCOVERY_RETENTION` = "1". It acts only on a recorded relationship end date, never on archiving; dry run by default; 3 assessments per run; clears itself if the date is cleared.
- [ ] Until it is on: a manual review at least every 3 months for organizations whose relationship ended 90+ days ago (PRIVACY-OPERATIONS.md section 7). Put a recurring reminder in a calendar.
- [ ] Before turning the automatic job on: apply 0019 (own approval), set end dates, run the dry run, read it, change the policy sentence "We review and delete records manually", then approve the switch.
- Backup copies: `PORTAL_BACKUP_PURGE` is **not set**, so the scheduled purge of deleted files' backup copies is off. Until it is turned on by a reviewed change, run Admin > Branding > Storage > backup purge (dry run, then type PURGE) at least monthly so the 90-day promise holds. Guest-removed files wait for this purge; Admin-deleted assessments do not.

## 6. Rollback
Know these before the apply run.
- **Hide Discovery at once (fastest, no deploy of old code):** a one-line change removing `PORTAL_DISCOVERY` from `wrangler.jsonc`. Guest links then return the same plain 404 and the Branding card disappears. Data is kept.
- **Roll the code back:** Cloudflare dashboard > Workers & Pages > framework > Deployments > roll back to the version recorded below, or revert the merge commit by PR. Migrations are additive, so the previous code runs fine on the new tables.
  - Previous Production release: main `ec4ea510124553af4b2a7bf185dad50f15f3b162` (PR #130). Production deployment/version ID to record: ______________
- **Database:** do not restore unless data is damaged. A Time Travel restore to the recorded bookmark is destructive (it loses changes made since) and needs the owner's explicit approval.
- **Files:** the private backup bucket holds copies; restore is Admin > Branding > Storage.
- A failed apply run: the workflow fails closed before changes when checks fail; if it fails part-way, stop, do not re-run, and decide with the Time Travel bookmark.

## 7. Approvals needed, in order
1. Approve the PRs on Staging (this retention PR) so the release branch can be refreshed.
2. Record the bookmark and the Production deployment ID.
3. Approve verify-only run, then read it.
4. Approve the apply run.
5. Approve merging the refreshed PR #156.
6. Set the privacy effective date and decide the flagged-image reviews before step 5.
