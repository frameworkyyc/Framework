# Client Services (Invoices, Support & Change Requests, Contact)

Status: **Phase 1 (foundation) on Staging.** Switched on only where `PORTAL_SERVICES = "1"` (Staging `previews.vars`; never the top-level vars, so never Production).

## Phases
1. **Foundation** (this change): migration 0007 (written, **not yet applied**), data layers, permissions, the flag, the hub and Contact page, Home card, privacy draft.
2. Invoices: Admin entry/publish/archive, PDF storage, owner-only list and download.
3. Support & Change Requests: client flow with attachments, Admin review/reply/status.
4. Notifications (Resend), Home/Admin badges, polish, end-to-end tests.

## What exists in Phase 1
| Piece | Where |
| --- | --- |
| Tables | `migrations/portal/0007_client_services.sql` |
| Invoices data layer | `worker/portal/repo/invoices.js` |
| Support data layer | `worker/portal/repo/support.js` |
| Permissions | `services.view`, `support.view`, `support.submit` (owner, member); `invoices.view` (owner only) in `policy.js` |
| Pages | `/portal/o/:slug/services` (hub), `/services/contact`; `services-live.js` |
| Flag | `servicesEnabled(env)` in `config.js` |

Invoices and requests have **no routes yet**. On the hub they are quiet "Coming soon" cards (not links).

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
