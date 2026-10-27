# Production rollout plan (DRAFT: nothing here has been done; each stage needs its own approval)

Brings what is on Staging into Production in small stages, with a backup before the first change and a check between stages. Production is the live site for the first real client. The privacy policy page (`privacy.html`) is NOT part of this plan and stays unpublished-as-drafts (`PRIVACY-*-DRAFT.md`) until separately approved.

## What differs today (read-only review)
| Area | Production | Staging | Needed |
|---|---|---|---|
| Portal database `framework-portal` | migrations 0001-0004; 2 organizations, 2 users | 0001-0008 | apply 0005-0008 (all additive: 0005 four tables, 0006 one column on a 0005 table, 0007 five tables, 0008 one table; nothing existing is altered) |
| Migration workflow | knows only 0001-0004 and refuses anything else | n/a | extend `.github/scripts/portal-d1-check.mjs` STAGES with 0005-0008 (tables/indexes below) |
| File storage (R2) | no bucket, no binding | `framework-portal-files-staging` | create a private bucket and bind it as `PORTAL_FILES` at the top level of `wrangler.jsonc` |
| Switches | `PORTAL_BRANDING`, `PORTAL_SERVICES` absent | both "1" (previews.vars) | add to top-level vars in their own stage |
| Secrets | all 8 required are present (names checked read-only) | same | none |
| Cron | none | none (Previews cannot run cron) | `triggers.crons` + a `scheduled()` handler on the Production Worker |
| Code | `main` | `Staging` (about 90 files ahead; `main` has 4 promotion merges not in `Staging`, no conflicts) | merge `main` into `Staging` first, then promote |

Expected objects after 0005-0008: tables `brand_kits, brand_assets, brand_uploads, service_requests` (0005), `invoices, support_requests, support_messages, support_attachments, service_notifications` (0007), `approved_emails` (0008); indexes `idx_brand_assets_org, idx_brand_uploads_org, idx_service_requests_open, idx_service_requests_org` (0005), `idx_invoices_org, idx_support_requests_org, idx_support_messages_request, idx_support_attachments_request, idx_service_notifications_pending` (0007).

## Stages
**Stage 0: preparation on Staging (no Production change).** Merge `main` into `Staging`. Extend the migration checker (STAGES) and its tests. Add the `scheduled()` handler (does nothing unless `PORTAL_SERVICES` is "1"), with a test. Update the config tests only in the stage PR that changes Production config. Staging health check green. *Stop if:* any test fails.

**Stage 1: backup, then schema.** (a) Record a Time Travel bookmark for `framework-portal` and, optionally, download a SQL export from the dashboard; confirm the Time Travel retention window in the dashboard. (b) Run "Portal Production D1 migration" in verify-only mode (required reviewers on the `production-portal-d1` environment approve). (c) Run it in apply mode: 0005-0008. (d) Verify: no pending migrations, exactly the expected tables and indexes, row counts of existing tables unchanged (2 organizations, 2 users, existing profile answers). The running Production code ignores the new tables, so nothing visible changes. *Rollback:* leave the empty tables (harmless) or Time Travel restore to the bookmark (discards anything written after it).

**Stage 2: storage.** Create a private R2 bucket `framework-portal-files` (no public access, no custom domain). Nothing is bound yet. Verify it exists and is private.

**Stage 3: new code, client features OFF.** Promotion PR Staging -> `main` plus the `PORTAL_FILES` binding; no new switches, no cron. Production deploys through Workers Builds. Immediately live: the redesigned Admin, Client Delete/Restore, Approved Emails, and the Admin Branding/Invoices/Support pages. Clients see no change (their Branding and Services pages stay "coming soon" without the switches). Verify: sign-in page 200 and security headers, `/admin` and `/api/admin/*` not public, the existing client can still sign in and use the Business Profile, Admin Clients list loads, Approved Emails opens and "Add to the list" copies the secret's addresses, the R2 storage check in Admin passes. Optional: create one clearly named test organization, delete it, restore it, delete it again (the real client is never used for this). *Rollback:* revert the promotion PR (or roll the Worker back in the dashboard); the schema stays.

**Stage 4: enable client features.** One small PR adding `PORTAL_BRANDING` and `PORTAL_SERVICES` ("1") to the top-level vars. Verify together: Branding upload/download, an invoice published and visible to an owner only, a support request round trip with an attachment, emails delivered to approved addresses, iPhone Safari. *Rollback:* revert the PR; tables and files stay.

**Stage 5: background email retries (native Cron Trigger).** One small PR adding `"triggers": { "crons": ["*/5 * * * *"] }` at the top level. Each run executes the same notification sweep that Admin page loads already run (atomic claim, no duplicate emails, backoff 1/4/9/16 minutes, at most 5 attempts). Verify: the cron shows under the Worker's Triggers, runs appear in Logs with counts, unsent emails go out with nobody visiting. *Rollback:* `"crons": []` removes it.

**Stage 6: watch.** 24-48 hours of Logs and the Admin notification counts; decide separately on the privacy policy, file backups (R2 has none) and the Cloudflare secret (can be deleted once its addresses are in Approved Emails).

## Needs you
Approval of each stage; the GitHub environment approval for the migration run; confirm Cloudflare Access covers all of `/admin/*` and `/api/admin/*` on the live host (this session cannot reach it); your client's address approved (Stage 3); the staff notification address; the Workers plan (cron CPU limits); the privacy decision; file-backup acceptance.

## Known risks
New client data (invoices, messages, attachments, brand files) is collected before the published privacy policy mentions it. R2 has no backup. Production runs the new Admin immediately at Stage 3. The cron's CPU limit on a Free plan is 10 ms per run (mostly waiting on network). Time Travel restore also discards anything written after the bookmark.
