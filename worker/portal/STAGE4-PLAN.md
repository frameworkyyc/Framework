# Production Stage 4: enable client features (DRAFT FOR OWNER REVIEW)

**Status: plan only.** Nothing here is enabled or published. `privacy.html` is unchanged. This is not legal advice.

## Where Production stands (verified 2026-10-27)
Stages 0-3 and 5 are done: migrations 0005-0008 applied, both private R2 buckets bound, the new Admin live, the 5-minute Cron Trigger running (it backs up files; it sends no emails while `PORTAL_SERVICES` is off), the backup proven end to end by the owner. Clients still see only the Business Profile and team pages. `PORTAL_BRANDING` and `PORTAL_SERVICES` are absent.

## What Stage 4 switches on
Two top-level vars, `"PORTAL_BRANDING": "1"` and `"PORTAL_SERVICES": "1"`, in one small PR each:
- **4b Branding** (client-visible): view and download published brand assets, upload existing brand materials (files stored in R2, copied to the backup bucket within 5 minutes), quote requests.
- **4c Client Services**: owner-only invoices (staff-entered PDFs, no payments), support and change requests with up to 3 attachments of 10 MB, reply threads, and notification emails through Resend. With this switch the cron also runs the email retry sweep.
Rollback for either: revert its PR. Tables and files stay; clients lose the pages immediately.

## Recommended order
1. **4a, privacy policy first** (below). Nothing client-facing is enabled until the policy that describes it is published.
2. **4b Branding**, verify, wait one cron cycle and one day.
3. **4c Services**, verify, then watch.
Splitting keeps each risk small: Branding adds file uploads, Services is the first thing that emails clients automatically.

## 4a. Privacy policy: what must change before enabling
The live policy (effective 2026-10-21) covers the website and the Business Profile. It does not mention uploaded files, invoices, support requests, attachments, notification emails, or backup copies. Proposed amendments are already drafted: `PRIVACY-BRANDING-DRAFT.md` and `PRIVACY-SERVICES-DRAFT.md`. They are publish-ready except for the decisions below.

**One new issue found while preparing this.** The backup bucket has a "retain everything" lock, so a file a client deletes (or that we delete after the 90-day period) still exists in the backup bucket and cannot be removed by the application. The Branding draft's retention section assumes deleted files are not recoverable. Choose one before publishing:
- **(A, recommended)** Disclose it: "Backup copies of files are kept for X after deletion, then removed." Then set a matching bucket-lock/lifecycle rule in Cloudflare (the lock currently has no end date), and add a manual "purge a client's backup copies" step to `PRIVACY-OPERATIONS.md` for deletion requests.
- **(B)** Shorten or remove the lock so deletion is real. This weakens protection against mistakes.
Whichever you pick, the policy and the bucket rule must say the same thing.

**Owner decisions needed**
1. D1: uploads and quote requests used only to provide the service (no marketing or portfolio use without asking).
2. D3 retention: files 90 days after the relationship (decided); deliverables and deletion records (open); the backup statement above (open).
3. Invoices: retained 6 years after the calendar year issued (confirm with an accountant). Support requests and attachments: proposed 24 months after completion (confirm).
4. Staff access wording and the request-handling promise (acknowledge in 5 business days, complete in 30), already in the live policy, now also cover files.
5. Adviser review of notice-only for uploads that may contain colleagues' personal information (business cards, signatures), disclosure of storage outside Alberta/Canada for files, and the retention wording.

**Publication mechanics.** Add the approved text to `privacy.html` on Staging, set a new effective date, run the privacy tests (`PRIVACY_PUBLISH=1 node --test worker/test/privacy.test.mjs`), review on Staging, then promote to `main` as its own approved step, before 4b.

## 4b / 4c verification checklist (after each deploy)
Sign-in page 200 and headers; existing client signs in and the Business Profile is intact; a client in the test organization sees the new pages and a different organization cannot see them; Branding: upload, download, quote request; the file appears in the backup bucket within 10 minutes with no manual action; 4c adds: invoice published and visible to an owner only, support request round trip with an attachment, emails delivered to approved addresses only (links, no amounts or details), Admin notification counts, iPhone Safari. Use "Framework Internal Testing" for tests, never a real client.

## Needs from you
Privacy decisions 1-5 and the backup-retention choice A or B; adviser review (or your explicit decision to proceed without it); go-ahead for 4a, 4b and 4c separately. Optional: whether to keep or archive the Stage 5 test file in Framework Internal Testing.

## Known risks
New client data (files, invoices, messages) starts to be collected: the main reason for the policy first. Backups live in the same Cloudflare account. Email volume is capped (one reply email per side per conversation per 10 minutes). The cron has a 10 ms CPU budget on the Free plan, mostly waiting on the network; errors would show in Logs and retry next run.
