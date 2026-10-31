# Client Services (Invoices, Support & Change Requests, Contact)

Status: **All four phases on Staging** (foundation, Invoices, Support & Change Requests, notifications and indicators). Switched on only where `PORTAL_SERVICES = "1"` (Staging `previews.vars`; never the top-level vars, so never Production).

## Phases
1. **Foundation** (done): migration 0007, data layers, permissions, the flag, the hub and Contact page, Home card, privacy draft.
2. **Invoices** (done, below): Admin entry/publish/payment/archive, PDF storage, owner-only list and download.
3. **Support & Change Requests** (done, below): client flow with attachments, Admin review/reply/status.
4. **Notifications and indicators** (done, below).

## What exists in Phase 1
| Piece | Where |
| --- | --- |
| Tables | `migrations/portal/0007_client_services.sql` |
| Invoices data layer | `worker/portal/repo/invoices.js` |
| Support data layer | `worker/portal/repo/support.js` |
| Permissions | `services.view`, `support.view`, `support.submit` (owner, member); `invoices.view` (owner only) in `policy.js` |
| Pages | `/portal/o/:slug/services` (hub), `/services/contact`; `services-live.js` |
| Flag | `servicesEnabled(env)` in `config.js` |


## Phase 2: Invoices
- **Admin** (`/admin/clients/:id/invoices`, API `worker/portal/admin-invoices.js`): enter number, dates, amount (typed in dollars, stored as cents, CAD), description (client-visible) and an internal note; attach a PDF (PDF only: type, content and active-content checks); publish (needs the PDF; queues the client notice); record payment (unpaid / paid with date / void); archive and restore. Drafts are staff-only. There is no delete control and no delete route. The client page shows drafts waiting to publish and invoices past due.
- **Client** (`/portal/o/:slug/services/invoices`, owners only): list with number, dates, amount, status (Unpaid / Overdue / Paid; overdue is derived from the due date) and a Download PDF button; downloads are attachments with hardened headers and are recorded. Members and other organizations never see the card or the page.
- **Files:** private R2 under `org/<id>/invoices/<uuid>`. Replacing a PDF removes the old object only after the new one is recorded. Organization-wide file removal and orphan housekeeping **skip invoice files** (retention).
- Emails are not sent yet (Phase 4); publishing only queues the notice.

## Decisions (approved)
- CAD only. Amounts are typed in by staff and stored as whole cents; nothing is calculated (no tax). The PDF is only a file.
- Draft invoices are invisible to clients until published. Publishing needs the PDF and queues the client notice.
- Only organization **owners** may view invoices; members may not see the card or the page. Clients cannot change invoices.
- Owners and members may submit and follow support/change requests: up to 3 attachments of 10 MB each, at most 10 open requests per organization.
- The conversation is complete and append-only: client messages, Framework replies, status changes (visible to the client) and private staff notes (never shown or emailed to the client).
- **Support vs billable work.** `scope` follows the category: technical issue and general support are *support*; website change and logo/design revision are *change* (potentially billable). Only changes can be **Quote sent** or **Approved**; the database enforces it. Approval is Framework's record that a quote was agreed; submitting never approves anything. The form and every change request carry: "Sending a request does not authorize any paid work. Framework will review it and, if it involves extra work, send you a quote to approve before anything starts."
- Emails (Phase 4): Framework is emailed on a client submit or reply; the client is emailed when an invoice is published or Framework replies or changes the status. Emails say something is waiting and never include amounts or request text. Queued in `service_notifications` in the same transaction as the change.

## Invoice retention (proposed; confirm with an accountant)
- Invoices are **archived, never routinely deleted**: there is no delete function. Archiving hides an invoice from the client and the default Admin list; the row and PDF are kept.
- Keep for at least **six years after the end of the calendar year of issue** (`retainUntil(issueDate)` = 31 December of issue year + 6). After that, review before any permanent deletion.
- Offboarding an organization must **not** delete invoices (unlike Branding files); Phase 2 adds this to the offboarding code and tests.
- A paid invoice's number, amount and issue date are locked; correct a mistake by voiding it and issuing a new one.

## Migration 0007 (not applied)
Before applying to Staging: confirm the target is `framework-portal-staging`, record a Time Travel bookmark, apply with `migrations/portal/wrangler.migrate.staging.jsonc`, verify the five tables. Production is a separate, later approval; the Production workflow's expected list does not know 0007 and fails closed while it is pending.

## Phase 3: Support & Change Requests
- **Client** (`/portal/o/:slug/services/requests`, owners and members): list (title, category, status, "New reply" flag), a new-request form (category, title, description up to 4,000 characters, up to 3 attachments of 10 MB: images, PDF, text, Word/Excel/PowerPoint, ZIP download-only), and a conversation page with a reply form (until the request is completed or declined). Rate-limited (`support` bucket), CSRF-protected, same-site checked. Ten open requests per organization at most; three attachments per request in total.
- **Support vs billable change:** the form and every change request say, in these words, "Sending a request does not authorize any paid work. Framework will review it and, if it involves extra work, send you a quote to approve before anything starts." Statuses explain themselves to the client ("Quote sent: nothing goes ahead until you approve it"; "Approved: Framework has recorded that you approved the quote"). There is **no client route that changes a status**; only Admin can mark Quote sent or Approved, and only for changes.
- **Admin** (`/admin/clients/:id/support`, `admin-support.js`): requests open as collapsed rows with the whole conversation (private notes marked); reply (visible, queues a client email), private note (never shown or emailed to the client, also for its attachments), attach one file per reply, change status (confirmation for Quote sent, Approved, Declined, Completed). The client page shows a Support row and an attention item for requests with new activity.
- **History:** nothing edits or deletes a message, attachment or request. Attachment objects live under `org/<id>/support/<uuid>` and are excluded from organization-wide file removal and orphan housekeeping.
- **Retention (approved):** completed support requests are kept 24 months after completion, subject to legal and contractual requirements; deletion after that period is a separate, reviewed step (not built).

## Phase 4: email notifications, indicators, global Admin Support Requests
**Emails** (`service-notifications.js`, sent through the same Resend setup as assessment emails: `RESEND_API_KEY`, `ASSESSMENT_FROM`):
| Event | Goes to | Content |
| --- | --- | --- |
| Client sends a request | Framework (`ASSESSMENT_NOTIFY_TO`, default hello@frameworkco.ca) | client, category, title, link to the Admin conversation |
| Client replies | Framework | same; at most one per request every 10 minutes |
| Framework replies | the person who sent the request + the organization's owners | generic "new reply", link |
| Quote sent (`quoted`) | same | generic "Framework sent you a quote", link |
| Invoice published | the organization's **owners** | generic "new invoice", link |
Never emailed: private notes, routine status changes (in review, in progress, approved, completed, declined), drafts, archived invoices. Client emails never contain request text, invoice numbers or amounts.
- **Saved work first.** The data layers queue a row in `service_notifications` in the same transaction as the change; sending happens afterwards (`ctx.waitUntil` on the platform, awaited in tests), never throws, and can only change that row. A request, reply or invoice is saved whether or not email works.
- **No duplicates.** A row is claimed with a compare-and-swap on its attempt counter (only one sender can win), at most one pending row exists per (organization, audience, event, request), quick replies are throttled (10 minutes), a sent row is never touched again, and every provider call carries an idempotency key `svc-<notice id>-<recipient position>` so a retry after a half-sent notice is dropped by the provider.
- **Automatic delivery and retries.** Each change dispatches right after it is saved (`waitUntil`). Anything still unsent is swept automatically on every Admin page load (the navigation badge asks for counts) and on every client Home visit, after a growing wait (attempt number squared, in minutes, from when it was queued). Up to 5 attempts; a failed attempt keeps the notice pending with a short reason (never a secret); after the limit it is `failed` and shown in Admin. If email is not configured at all, notices wait without using an attempt. "Send pending emails now" (Admin > Support Requests) ignores the wait. A scheduled (cron) trigger is deliberately not used: cron triggers run only on the production deployment, so they cannot serve Staging and adding one would change Production configuration.
- **Client recipients are gated** by the same approved-recipient list as invitations (`PORTAL_INVITE_ALLOWLIST`) while the controlled live test is in force; a notice with nobody allowed is `skipped` (`no_allowed_recipient`). Lifting that restriction later is a reviewed change.
**Indicators.** Client Home's Client Services card (and the hub rows) show a dot with plain words: "1 new reply · 1 quote to review · 1 overdue invoice" (invoices for owners only); opening a request clears its new-reply call-out. Admin Overview has a "Needs attention" list (requests with new activity, draft and overdue invoices, unsent emails) and the navigation shows a count beside Support Requests.
**Global Admin Support Requests** (`/admin/support`, `/admin/support/:client/:request`): requests from every client; tabs Needs attention (default) / Open / Closed / All; each row shows the client, title, why it needs attention ("New request", "Client replied"), status and "May be billable"; opening a row shows the whole conversation (private notes marked) and the same reply, note, attachment and status tools as the per-client page.
**Not built / still manual:** Production (migration 0007, `PORTAL_SERVICES`, secrets) is a separate approval; the privacy draft is not published; deleting support records after their 24-month retention is a reviewed step that does not exist yet.

## Release 3 polish (Staging; owner decisions)
- **Manual payments.** Invoices are paid outside the portal. The client invoice page says: "Payment instructions are included in your invoice PDF. Payments are recorded by Framework, and your invoice status will update once payment is confirmed." No online payment exists or is planned for launch.
- **Overdue in Framework's time zone.** "Today" for overdue is the America/Edmonton date (`todayOf` in `repo/invoices.js`): an invoice is overdue from the day after its due date in Calgary, never on the evening of the due date.
- **Quote approval.** A client approves a quote by replying in the request conversation; no work starts until Framework confirms approval (status wording, the quote email and the Admin confirmation all say so; replying never changes the status by itself).
- **Skipped-notification warning.** When a client notification is skipped because none of its recipients is on the approved list, Admin Overview "Needs attention" names the client and the addresses that are not approved (no message, request or invoice content) and links to Approved Emails. It clears by itself once every one of those addresses is approved (the skipped notices are not re-sent; the portal shows everything), or with "Dismiss" (confirmed, audited as `service.notice.dismissed`, sends nothing) for addresses that will never be approved. The Approved Emails restrictions are unchanged. A notice that reached at least one approved recipient is not flagged.

## Deleting a client (Admin)

"Delete client" in Admin is a reversible archive (`organizations.status = 'archived'`, `archived_at` set), not an erase. The server requires `{"confirm": "DELETE"}`; each change writes one `org.deleted` / `org.restored` entry to `activity_log`. Portal access stops at once because every membership lookup requires an active organization; memberships are kept, so Restore brings the team straight back. Invoices, support requests, brand files and Business Profile answers are never touched (retention). A deleted client is left out of the global Admin support/invoice counts and lists, cannot be invited to, and its queued notification emails are skipped (`client_deleted`). Deleted clients are listed under "Deleted clients" on the Clients page, where they can be restored. Permanent erasure is deliberately not offered.
