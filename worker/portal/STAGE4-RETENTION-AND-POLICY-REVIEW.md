# Stage 4: backup retention analysis and privacy policy review notes (DRAFT FOR OWNER REVIEW)

**Status:** analysis and a proposal only. No Production storage setting, code or policy has been changed or published. The Staging `privacy.html` carries the proposed wording with a "pending" effective date, so it cannot be published by accident (the privacy tests fail under `PRIVACY_PUBLISH=1` until a real date is set). Not legal advice.

## 1. Can Cloudflare R2 enforce "deleted files and their backup copies are gone within 90 days"?
**Not by itself, and not with the current lock.** What the Cloudflare documentation says (checked 2026-10-27):
- A **bucket lock** rule protects objects from overwrite and deletion for a period measured **from each object's creation** (`Age`), until a date, or indefinitely. Where several rules apply, the longest wins. Lock rules also override lifecycle rules. A bucket cannot be emptied while any lock rule exists.
- A **lifecycle** rule can delete objects by age (or on a date), within about 24 hours, but only by an object's age, never by "the file was deleted in the portal".
- Neither knows when a client deleted a file. "90 days after deletion" therefore needs the application's own record: the database already keeps it. `brand_assets` and `brand_uploads` keep a tombstone row (`deleted_at`, `storage_key`) after the file is removed from the main bucket. (Invoice files are archived, not deleted; support attachments cannot be deleted individually.)
- Today's backup bucket rule is **indefinite**, so nothing can ever remove a backup copy, not even the application. That contradicts the 90-day promise. It also means a lifecycle rule would not help.

**Facts that make a clean design possible**
1. An `Age` lock of N days never blocks a deletion made later than N days after the object was created. A file deleted on day D was created on or before D, so a purge at D+90 is always allowed when N is at most 90.
2. The application already knows which backup copies belong to deleted files (tombstones), and the object keys are random ids with no client text.

## 2. Proposed implementation (needs your approval; Production unchanged until then)
**A. Replace the indefinite lock with a 90-day `Age` lock on the backup bucket.** Every backup copy then cannot be overwritten or deleted by anyone, including a mistake or a compromised credential, for its first 90 days; after that only a deliberate action can remove it. Cloudflare allows the rule to be changed or removed in the dashboard (Bucket → Settings → Bucket lock rules). I will not touch it until you approve.
**B. A small, tightly limited purge step in the Worker's 5-minute job (code, tested on Staging first).** It would delete a backup object only when ALL are true: its key belongs to a database row with `deleted_at` at least 90 days ago; the key is absent from the main bucket; it is at most N objects per run. It never lists-and-deletes by age, never touches keys without a tombstone, never touches the reserved test corner, logs counts only, and is switched off by default until you approve. This is a deliberate exception to the current "backup code never deletes" rule, which is why it needs your sign-off.
**C. "Restore missing files" must skip tombstoned keys.** Today it would copy a deliberately deleted file from the backup back into the main bucket (invisible in the portal, but present). I would change it so it restores only files the database still considers live.
**D. Process for a deletion request:** the owner uses a short procedure in `PRIVACY-OPERATIONS.md`: delete the file in Admin, and the backup copy is removed within 90 days (or sooner by an owner-run purge once the lock period has passed). A client who needs an earlier removal is told the real timing.
**What this does not cover**
- Cloudflare D1 backups (Time Travel) and Worker logs have their own retention set by Cloudflare. The policy already says so.
- Files in the 90 days after a relationship ends, invoices (6 years), support requests (24 months), quote requests and deletion records (24 months) are **not automated**: today they are reviewed and deleted manually. The policy says that, except for the backup purge. Automating them is a separate piece of work if you want it.
- Objects created during the first 90 days cannot be purged early, whatever the policy promises; the promise is "within 90 days after deletion", which holds because the purge runs after both clocks.

**Risks:** weaker long-term protection of old backups than an indefinite lock (traded for real deletion); a bug in the purge could delete a backup copy, which is why the rules above are strict, the step is off by default, and it is covered by tests with fake buckets before it is enabled; the lock change is reversible only for future objects.

## 3. Privacy policy: what changed in the Staging draft
New plain-language disclosures: uploaded files (and that they may contain personal information of colleagues), deliverables, quote requests, invoices, support and change requests with attachments and private staff notes, file and notification records, who can see what (organization members vs Owners vs Framework personnel), private storage and backup copies, notification emails (no amounts or details), the "no marketing, portfolio or promotional use without separate permission" commitment, providers (Cloudflare storage, Resend notifications), and retention for files (relationship + 90 days), deleted-file records (24 months), invoices (6+ years), requests (24 months after completion) and backup copies (within 90 days of deletion).

## 4. Clauses to send for professional legal or privacy review before publication
1. **Notice versus consent** for uploaded files that contain colleagues' personal information (business cards, signatures), the same judgement already flagged for the Business Profile.
2. **Storage outside Alberta and Canada** for files and the backup copies; the policy keeps the "we have not confirmed a location" wording.
3. **Retention periods:** 90 days after the relationship ends (what counts as "ends"? who decides?), 24 months for requests and deletion records, "at least six years" for invoices (confirm with an accountant) and the "unless a longer period is legally required" wording.
4. **Backup copies:** the 90-day removal promise and the exception to "we delete manually", including whether to promise anything about D1 Time Travel recovery points.
5. **Staff access wording** for files and private internal notes, and the commitment that clients cannot see them.
6. **Quote requests:** decided: 24 months after completion or closure, unless legally required longer (wording updated).
7. **Deletion records:** decided: minimum information only. The Staging code now scrubs the original file name, the content hash and the free-text notes from a file's record when it is deleted; the policy says the record keeps only type, size, the uploading and deleting account and the times.
8. The beta/"private beta" framing and the 5-business-day acknowledgement and 30-day completion targets, which now also cover files.

## 5. What needs your approval
- The backup lock change (A) and the purge code (B, C, D): approve the design before I write any code. Code would go to Staging first, with tests; the Production lock change and enabling the purge are separate approvals.
- Quote request retention (item 6) and the tombstone wording (item 7).
- Professional review of section 4, then a separate approval to publish: set the effective date, run `PRIVACY_PUBLISH=1 node --test worker/test/privacy.test.mjs`, promote to `main`. Nothing client-facing is enabled before the policy is published.
