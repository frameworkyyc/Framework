# Production rollout plan (APPROVED in stages; Stage 0 done, Stages 1-6 each need their own go-ahead)

Brings what is on Staging into Production in small stages, with a backup before the first change and a check between stages. Production is the live site for the first real client. `privacy.html` is NOT touched by any stage; the privacy drafts (`PRIVACY-*-DRAFT.md`) stay unpublished. The updated policy is reviewed BEFORE Stage 4 (the stage that lets clients enter new kinds of information).

## Decisions (from the owner)
Cloudflare Access must cover all Admin pages and API routes (verified before deployment, below). Client email approvals are managed in Admin -> Approved Emails (existing secret addresses are copied in, not lost). Staff notifications go to `hello@frameworkco.ca`. Privacy policy unchanged during preparation. Production R2 files get a simple backup (below). The WorkOS AuthKit sign-in branding on Production is corrected to match Staging.

## What differs (read-only review)
| Area | Production | Staging | Needed |
|---|---|---|---|
| Portal database `framework-portal` | migrations 0001-0004; 2 organizations, 2 users | 0001-0008 | apply 0005-0008 (all additive; nothing existing is altered) |
| Migration workflow | knew only 0001-0004 | n/a | **done in Stage 0**: `.github/scripts/portal-d1-check.mjs` now lists 0001-0008 with their exact tables and indexes; it still applies only when run manually, with the environment's required reviewers |
| File storage (R2) | no bucket, no binding | `framework-portal-files-staging` | create `framework-portal-files` and `framework-portal-files-backup` (both private); bind `PORTAL_FILES` and `PORTAL_FILES_BACKUP` at the top level of `wrangler.jsonc` |
| Switches | `PORTAL_BRANDING`, `PORTAL_SERVICES` absent | both "1" | add in their own stage |
| Secrets | all 8 required present (names only) | same | none |
| Cron | none | none (Previews cannot run cron) | `triggers.crons` (Stage 5); the `scheduled()` handler is **done in Stage 0** and is inert until then |
| Code | `main` | `Staging` | **done in Stage 0**: `main` merged into `Staging` (no conflicts) |

Expected objects after 0005-0008: tables `brand_kits, brand_assets, brand_uploads, service_requests` (0005), `invoices, support_requests, support_messages, support_attachments, service_notifications` (0007), `approved_emails` (0008); indexes `idx_brand_assets_org, idx_brand_uploads_org, idx_service_requests_open, idx_service_requests_org`, `idx_invoices_org, idx_support_requests_org, idx_support_messages_request, idx_support_attachments_request, idx_service_notifications_pending`.

## Stage 0: preparation on Staging (DONE; nothing on Production changed)
- `main` merged into `Staging`; the migration checker extended to 0001-0008 with its tests (tail rule, exact tables/indexes, no destructive statements).
- `scheduled()` handler (`worker/portal/scheduled.js`): every run (1) sends/retries pending Client Services emails, only when `PORTAL_SERVICES` is "1"; (2) backs up client files, only when both buckets are bound. Independent, never throws, logs counts only. Not scheduled anywhere yet.
- Client-file backup (`worker/portal/file-backup.js`), tested: copy-only (never deletes or overwrites a backup object), keys and metadata unchanged, at most 20 copies per run so a backlog is worked off over several runs, counts only in logs.
- Test that EVERY admin page and API route (including Approved Emails, Delete/Restore, Invoices, Support, Branding) refuses a request with no token, a forged, wrong-audience, expired, wrong-issuer or non-admin token, reveals nothing and writes nothing. The Worker verifies the Cloudflare Access token itself, so even a path the Access policy did not cover would be refused, not exposed.
- Access in front of the site: on the Staging host every `/admin*` and `/api/admin*` path, including the new routes, upper-case and encoded variants, redirects to the Access login. The Production host cannot be reached from this session, and the Access application list is not readable with its token: **please confirm in Zero Trust -> Access -> Applications that the Production application covers `frameworkco.ca/admin*` and `frameworkco.ca/api/admin*` (same policy as Staging).**
- Email: the sender on Production is `Framework <hello@frameworkco.ca>` (same setting as Staging), the staff recipient defaults to `hello@frameworkco.ca` and is pinned explicitly in Stage 3, and the Resend key secret exists. Sender-domain DNS (SPF/DKIM) cannot be read from this session: **Admin -> Assessments on Production shows "Ready to send from ... to ..." (already live); please confirm it names hello@frameworkco.ca for both.**

## Stage 1: backup, then schema
(a) Record a Time Travel bookmark for `framework-portal` and, optionally, download a SQL export from the dashboard; confirm the Time Travel retention window in the dashboard. (b) Run "Portal Production D1 migration" in verify-only mode (required reviewers approve). (c) Run it in apply mode: 0005-0008. (d) Verify: no pending migrations, exactly the expected tables and indexes, row counts of existing tables unchanged. Running Production code ignores the new tables, so nothing visible changes. *Rollback:* leave the empty tables, or Time Travel restore to the bookmark (discards anything written after it).

## Stage 2: storage and its backup (DONE: both Production buckets created, confirmed private, backup bucket locked by the owner; nothing bound yet)
Create two private R2 buckets: `framework-portal-files` (the files) and `framework-portal-files-backup` (copies). No public access and no custom domain on either. Add one bucket lock rule to the BACKUP bucket only (retain all objects indefinitely) so nobody and nothing can delete or overwrite a backup copy by accident; the application never deletes there. (A lock on the primary invoices folder is not possible: lock rules match a literal prefix and keys are `org/<id>/<area>/...`.) Verify both exist, are private and the lock rule is listed. Nothing is bound yet.

## Stage 3: new code, client features OFF
Promotion PR Staging -> `main`, plus in `wrangler.jsonc`: the two R2 bindings and `ASSESSMENT_NOTIFY_TO = "hello@frameworkco.ca"`. No switches, no cron. Production deploys through Workers Builds. Live immediately: the redesigned Admin, Client Delete/Restore, Approved Emails, and the Admin Branding/Invoices/Support pages. Clients see no change. Verify: sign-in page 200 with security headers, `/admin` and `/api/admin/*` not public (Access redirect), the existing client signs in and uses the Business Profile, the Admin Clients list loads, **Approved Emails -> "Add to the list" copies the secret's addresses (including your client's) and the list shows them**, Assessments shows hello@frameworkco.ca, the R2 storage check in Admin passes for both buckets. Optional: create one clearly named test organization, delete it, restore it, delete it again (the real client is never used). *Rollback:* revert the PR or roll the Worker back in the dashboard; the schema stays.

**WorkOS sign-in branding (done in the WorkOS dashboard, any time before Stage 4; no deployment):** Production AuthKit branding is currently entirely unset (default dark page). Set it to match Staging: Theme Light, Border radius None, Link colour `#000000`, and upload the same Logo, Logo icon and Favicon as Staging. Do not touch Authentication, Redirects or Sessions. Compare the Production sign-in page with Staging's afterwards (desktop and phone).

## Stage 4: enable client features (after the privacy policy review)
One small PR adding `PORTAL_BRANDING` and `PORTAL_SERVICES` ("1") to the top-level vars. Verify together: Branding upload/download, an invoice published and visible to an owner only, a support request round trip with an attachment, emails delivered to approved addresses, iPhone Safari. *Rollback:* revert the PR; tables and files stay.

## Stage 5: background email retries and file backup (native Cron Trigger)
One small PR adding `"triggers": { "crons": ["0-59/5 * * * *"] }` (every 5 minutes; written as a range with a step because several tests strip block comments from `wrangler.jsonc` and a literal star-slash would end one early). Each run does the notification sweep (atomic claim, no duplicate emails, retries at 1/4/9/16 minutes, at most 5 attempts) and the file backup. Verify: the cron shows under the Worker's Triggers, runs appear in Logs with counts, unsent emails go out with nobody visiting, and new uploads and invoices appear in the backup bucket within minutes. *Rollback:* `"crons": []` removes it.

## Stage 6: watch
24-48 hours of Logs, the Admin notification counts and the backup bucket's object count against the primary. Decide separately: Time Travel/export routine for the database, deleting the Cloudflare secret once its addresses are in Approved Emails.

## Backup and restore, and how they are proven
- **Names**: every object keeps exactly its name (`org/<organization id>/<area>/<random id>`), so database rows keep working after a restore. Names are random ids (unique), never client text.
- **Backup** (copy-only, never deletes or overwrites a backup object): the schedule (Stage 5) and the Admin button "Back up now".
- **Restore** (Admin -> a client's Branding -> Storage -> Backup -> "Restore missing files", or the same API): copies back ONLY files that are missing from the main bucket; a file that exists is never overwritten. Counts only are shown.
- **Proof** (Admin -> Branding -> Storage -> Backup -> "Run backup check"): writes one tiny test object, copies it to the backup, reads it back FROM the backup and compares, deletes the main copy (simulated loss), restores it from the backup, compares again, cleans up. Run on Staging (real buckets) before Stage 3 and on Production at Stage 3. Each run leaves one ~60-byte test object in the backup bucket (the lock keeps it); the checks' own corner is ignored by normal backup/restore/status.
- **If everything is lost** (not just a file): create the main bucket again with the same name and use "Restore missing files" repeatedly (up to 50 files per click) until it reports 0 remaining.

## Needs you
Go-ahead for each stage; the GitHub environment approval for the migration run; the Access confirmation and the Assessments email check above; your client's address copied in via Approved Emails (Stage 3); the WorkOS branding change; the privacy policy review before Stage 4.

## Known risks
New client data (invoices, messages, attachments, brand files) is collected from Stage 4, so the privacy review comes first. The backup is in the same Cloudflare account (it protects against deletion, overwrite and mistakes, not against losing the account). Production runs the new Admin immediately at Stage 3. The cron's CPU limit on a Free plan is 10 ms per run (mostly waiting on network). Time Travel restore also discards anything written after the bookmark.
