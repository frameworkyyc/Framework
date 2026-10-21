# Framework — privacy operations (internal)

This file is for Framework staff. It is **not** served by the website (it is listed in `.assetsignore`). It records what the
website really collects, who processes it, and the manual procedures for retention, deletion and consent. The public policy
is `privacy.html`. Keep the two in step: if the website changes what it collects, update both.

Status key: **ACTIVE** = running today · **BUILT, OFF** = implemented but disabled until configured · **PLANNED** = not built.

## 1. Data inventory

### Forms

| Form | Where it goes | Fields | Status |
|---|---|---|---|
| Free Online Presence Assessment (`/assessment`) | Cloudflare D1 table `assessment_requests`, plus an email to hello@frameworkco.ca, plus a confirmation email to the applicant (via Resend) | business name, website, contact name, business email, city/province, industry; optional phone, services, service area, profile links, main concern, additional information; privacy acknowledgement (required, stored as yes/no); marketing opt-in (optional, stored as yes/no); request time; campaign parameters (`utm_source/medium/campaign/term/content`, `fbclid`, `gclid`); landing path; referring site (origin only); hashed IP; email delivery status/error | ACTIVE |
| Client feedback (`/client-feedback`, private, noindex) | Cloudflare D1 table `feedback_responses` | ratings, written answers, optional revenue *range*, testimonial, testimonial permission (4 options), name/title/business (only when attribution allowed), logo permission, future services, comments | ACTIVE |
| Contact (`/contact.html`) | Nothing is sent by the website. It opens the visitor's own email app (`mailto:`) | name, email, optional business, optional project type, message (composed in the visitor's email app) | ACTIVE |
| Client revenue figure (`client_revenue`) | Cloudflare D1, entered manually by an admin from what a client reported | client id + a revenue number. Only the combined total is exposed publicly (`/api/client-revenue`, homepage) | ACTIVE |

### Technical data and logs

| Data | Where | Notes | Status |
|---|---|---|---|
| IP, user agent, request metadata | Cloudflare (hosting/CDN/security) | ordinary hosting logs, controlled by Cloudflare | ACTIVE |
| Hashed IP (`ip_hash`) | D1, assessment requests only | SHA-256 of `salt:ip`, first 12 bytes. Used for the 5-per-hour limit. The salt is the secret `IP_HASH_SALT` if set, otherwise a fixed built-in value, so treat it as pseudonymised, not anonymous. Set `IP_HASH_SALT` | ACTIVE |
| Worker logs | Cloudflare Workers Logs (`observability` is on in `wrangler.jsonc`) | code logs error reasons only, no names/emails. Provider error text (e.g. a Resend message) can occasionally mention an address; it is also stored in `notify_error` | ACTIVE |
| Admin sign-in | Cloudflare Access (cookie `CF_Authorization`, staff only) | not visible to ordinary visitors | ACTIVE |
| Spam checks | hidden honeypot field, minimum fill time, rate limits | the fill time is not stored | ACTIVE |
| Cloudflare Turnstile | script from `challenges.cloudflare.com` on the assessment page | only when both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` are set | ACTIVE on Staging; configured for Production (site key in `vars`, secret in Cloudflare) from the next deploy |

### Browser storage (nothing else is used; there are no first-party cookies on public pages)

| Item | Type | Purpose | When set |
|---|---|---|---|
| `fw_attribution` | sessionStorage | campaign parameters, landing path and referrer origin for this visit, attached to a request only if the visitor submits one. **Set before any consent**, treated as first-party and not shared until submit (disclosed in the policy) | on loading `/assessment` |
| `fw_meta_consent` | localStorage (`granted`/`denied`) | remembers the advertising-measurement choice | only when the visitor chooses, and only when the Pixel is configured |

### Third parties

| Party | What it receives | Status |
|---|---|---|
| Cloudflare | everything hosted, stored (D1) and logged; Access sign-in | ACTIVE |
| Resend (api.resend.com) | recipient, sender, subject and body of the notification (all submitted fields) and the applicant confirmation | ACTIVE once `RESEND_API_KEY` is set (it is on Staging) |
| Fontshare (`api.fontshare.com`, `cdn.fontshare.com`) | visitor IP, browser details and referrer, on **every page load, before any consent** | ACTIVE. Options to remove it: self-host the fonts (licence allows it) |
| Meta (`connect.facebook.net`, Meta Pixel) | loads only after "Allow"; page view of the assessment page and a `Lead` event (event name only, no form contents) | BUILT, OFF until `META_PIXEL_ID` is set |
| Framework mailbox provider | notifications and correspondence at hello@frameworkco.ca | ACTIVE. Name it in the policy if you want to |
| `aurora.frameworkco.ca` (portfolio live preview, an iframe) | a Framework-run address showing a client's site | ACTIVE on Production. Confirm the demo page sets no cookies or trackers |
| Website analytics | none | **PLANNED / not built.** No analytics code exists. Do not describe any in the policy until it does |
| Mailing-list / marketing platform | none | **PLANNED / not built** |

## 2. Consent behaviour (audited)

* The Pixel script is **not requested** until the visitor clicks Allow. Verified in the browser tests (no request to Meta before consent, after "No thanks", or with a Global Privacy Control/Do Not Track signal).
* The notice appears only on `/assessment`, and only when `META_PIXEL_ID` is configured. With no Pixel configured nothing loads and no control is shown.
* **Fixed in this change:** the choice can now be changed later ("Privacy preferences" in the assessment footer, and a control on the privacy policy page). Previously a visitor who had chosen could not revisit it. Allow and No thanks now have equal visual weight. Withdrawing after loading tells the Pixel to revoke (`fbq('consent','revoke')`).
* The `Lead` conversion event is sent only after the server has confirmed the request, and only while consent is in place.
* The assessment form's privacy acknowledgement is required and is **separate** from the marketing box. The marketing box is optional and **unticked by default** (tested).
* **Legal ambiguity to decide, not assumed:** Alberta's PIPA is generally not a prior-consent (opt-in cookie banner) regime like the EU's, but Meta's own terms, Quebec's Law 25 and other jurisdictions' visitors may require opt-in. The site takes the stricter route (opt-in) for the Pixel. If you also add site-wide analytics, the same pattern should be extended to every page.

## 3. Retention and deletion (manual)

Record types are handled differently. There is **no automatic deletion** of any of them; a person runs the review.

| Record type | Where | Rule |
|---|---|---|
| Assessment inquiries / prospect information | `assessment_requests`, hello@ mailbox | Up to **24 months after the last meaningful interaction**. Reference date = `COALESCE(last_interaction_at, created_at)` (the submission date if no interaction is recorded) |
| Client feedback | `feedback_responses` | Up to **24 months after the last meaningful interaction with the client**, **except**: (a) it contains a testimonial the client authorized us to publish (keep the testimonial and the consent record while it is in use); (b) an ongoing client relationship; (c) a contractual or legal requirement to keep it |
| Published testimonials / logos | website + the feedback record that holds the permission | Used only while permitted. On withdrawal remove from the site and keep the permission/withdrawal record |
| Other business records (agreements, invoices, project correspondence) | accounting / mailbox / drive | As business, tax and legal rules require. Not covered by the 24-month rule |

The feedback table has no interaction-date column. Use the client relationship (mailbox, projects) as the "last interaction" test, and `created_at` as the earliest possible date.

### Recording the last meaningful interaction (assessments)

* **Admin → Assessments → Show all details → Last interaction.** Pick a date and *Save date* (or *Today*; *Clear* removes it). The date cannot be in the future or before the request was submitted. The submission time `created_at` is never changed.
* Record it when something meaningful happens: a reply from the applicant, a call or meeting, a quote, a project starting. Automated emails and our own outbound messages that get no response do not count.
* Column: `assessment_requests.last_interaction_at` (nullable `YYYY-MM-DD`). NULL means none recorded and the submission date is used. It was added as an additive, nullable column: the Worker adds it automatically on first use, and `migrations/0006_assessment_last_interaction.sql` is the optional manual equivalent (safe on Staging and Production, existing rows stay NULL).
* The list can be searched by business name, contact name or email (Admin → Assessments → search box). It searches the whole table, not only the 200 newest rows.

### Simple review routine (every 3 months, 15 minutes)

1. In the D1 console (`framework-feedback` for Production) run the read-only queries below.
2. For each assessment row: search the hello@ mailbox for that email address. If there has been a meaningful interaction since the reference date, record it (Last interaction) and keep the row.
3. For each feedback row: apply the exceptions above before deleting (published testimonial + consent, ongoing client, contractual/legal).
4. Delete what is due (Admin → trash icon, or SQL below), one at a time. Then clean up the other locations in "What the admin delete does not remove" for those people.
5. Note the review date and counts in the request log (below).

```sql
-- Assessment requests whose reference date is more than 24 months ago (candidates only)
SELECT id, created_at, last_interaction_at, business_name, contact_name, email
FROM assessment_requests
WHERE COALESCE(last_interaction_at || 'T00:00:00.000Z', created_at) < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 months')
ORDER BY COALESCE(last_interaction_at, created_at);

-- Client feedback older than 24 months (candidates; apply the exceptions before deleting)
SELECT id, created_at, attribution_business, testimonial_permission FROM feedback_responses
WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 months') ORDER BY created_at;
```

### Handling an individual request (access, correction, deletion, withdrawal)

1. Log it (date received, who, what asked, how you checked identity: reply from the address they used is normally enough).
2. **Find everything:** use the Admin → Assessments search box (name, business or email), or SQL:
   ```sql
   SELECT id, created_at, business_name, email FROM assessment_requests WHERE lower(email) = lower('person@example.com');
   SELECT id, created_at, attribution_name, attribution_business FROM feedback_responses WHERE lower(attribution_name) LIKE '%name%';
   ```
   Also search the hello@ mailbox (notifications are titled "New Assessment Request | <business>").
3. **Access:** copy the record (Admin → Assessments → "Show all details", or the SELECT above) and send it to them. Feedback has a per-record CSV/JSON export.
4. **Correction:** edit in the D1 console (`UPDATE assessment_requests SET email = '...' WHERE id = '...'`), after checking with them.
5. **Deletion:** Admin → Assessments → trash icon (permanent, confirmation dialog), or `DELETE FROM assessment_requests WHERE id = '...'`; Admin → Feedback → Delete for feedback. Do not delete if a contractual or legal requirement applies; tell the person why.
6. **Withdrawing marketing consent:** `UPDATE assessment_requests SET marketing_opt_in = 0 WHERE lower(email) = lower('...')`, and remove them from any promotional list you have.
7. **Withdrawing testimonial/logo permission:** stop using it, remove it from the site (homepage/portfolio) and update the feedback record.
8. **Review every location in the next section**, delete or note each one (subject to retention requirements), then reply to the person and close the log entry.

### What the admin delete does not remove (review each, subject to retention requirements)

The admin delete removes **only the record in the main D1 database**. The public policy says exactly this and must not claim more. For each deletion request, review these places, remove what you can and may, and note what remains and when it expires:

| Place | What to do |
|---|---|
| Framework mailbox (notifications, replies) | search and delete (including archives/trash) |
| Resend email log | open the Resend dashboard → Emails and remove the entries if the plan allows; otherwise they expire on Resend's schedule. Confirm the retention shown in Resend |
| D1 point-in-time backups (Time Travel) | not deletable on demand; they age out (limited window, set by Cloudflare). Say so if asked |
| Cloudflare Workers Logs / hosting logs | expire on Cloudflare's schedule; code logs avoid personal data |
| Downloaded exports (feedback CSV/JSON) | delete local copies, including downloads and cloud drives |
| Other third parties that received the data | Meta (only if the Pixel was allowed): governed by Meta; the person can use Meta's tools and you can delete Events data in Events Manager. Any other recipient you shared it with |
| Published testimonial / logo | remove from the website and redeploy |
| `client_revenue` | business data, not the person's; remove the client's row only if they withdraw permission |

A contractual or legal requirement (for example a signed client agreement or tax records) can justify keeping some of this. Record the reason in the request log and tell the person.

### Is the current admin deletion enough for individual requests?

It deletes one record permanently and safely, so **yes for the database record**, provided the locations above are also reviewed. Remaining gaps: no deletion log (keep the request log), no per-record export for assessments (use "Show all details"/SQL), and no reach into the mailbox, Resend or backups. Suggested future improvements (not built, need approval): a per-record export, and a last-interaction date for feedback records.

### Request log (keep outside the website, e.g. a private spreadsheet)

`date received | requester | request type | identity check | systems cleaned (D1 / mailbox / Resend / site) | date completed`

## 4. Before sending any promotional email (nothing is built yet)

The website records only a yes/no `marketing_opt_in` and the request time. Before the first campaign you need, at minimum (Canada's Anti-Spam Legislation, CASL, check with a lawyer):

* **Proof of consent:** who, when, how, and the exact wording they agreed to. Today only yes/no + timestamp is stored; add a consent-text version and source to the record, or keep the wording history with dates.
* **Express consent only** for people who ticked the box (implied consent from an inquiry expires and is narrower; do not rely on it for promotions).
* **Each promotional email must** identify Framework and give contact information including a **mailing address** (a postal address or PO box; the policy deliberately states none), and include a working **unsubscribe** that you honour within 10 business days.
* **A system to record and apply withdrawals** (a mailing tool or a list you maintain), and suppression of anyone who unsubscribed or asked to be deleted.
* Keep transactional emails (the assessment confirmation, the assessment itself) free of promotion. They currently are.
* Do not import assessment applicants into a list unless they opted in. Never treat the privacy acknowledgement as marketing consent.

## 5. Statements to keep true (update the policy first if any changes)

* "We do not currently use website analytics": true only while no analytics code or Cloudflare Web Analytics is enabled. Check the Cloudflare dashboard (Analytics → Web Analytics) is off.
* "The Pixel is off unless you allow it": true while `consent.js` + `assessment.js` are unchanged and `META_PIXEL_ID` gating stays.
* "We do not set cookies ourselves": true while no code sets cookies.
* The effective date at the top of `privacy.html` must be the actual Production publication date. It is set to October 17, 2026; if deployment slips, change it and run `PRIVACY_PUBLISH=1 node --test worker/test/privacy.test.mjs`.
* The homepage "$2.5M+" figure is a combined, client-reported total; it never names or attributes an individual client's figure.

## 6. Client portal (private beta): data inventory and request handling

Public wording: `privacy.html` ("The client portal" and the portal items elsewhere). Owner decisions and open confirmations: `worker/portal/PRIVACY-DRAFT.md`.

| data | where | notes |
| --- | --- | --- |
| email, name, WorkOS user id, status, last sign-in | D1 `portal_users` | name is optional; email is the identity |
| organization, role, membership status | D1 `organizations`, `memberships` | per-organization role (Owner or Member) |
| invitations (email, role, who invited, delivery status) | D1 `invitations` | delivery channel is WorkOS or Resend |
| sessions (hashed token, WorkOS session id, sign-in method, hashed network value, times) | D1 `portal_sessions` | ended sessions are purged only by hand (`purgeEndedSessions`) |
| Business Profile answers | D1 `business_profile_answers` | one row per answered question per organization |
| portal feedback | D1 `portal_feedback` | message, kind, section, organization, person |
| activity records | D1 `activity_log` | who and when; never answers or message text |
| one-time codes, sign-in records | WorkOS | not stored by Framework; WorkOS retention applies |
| invitation emails | WorkOS, or Resend | Resend keeps delivery logs |
| Worker logs, D1 backups | Cloudflare | fixed-field logs only; backups age out on Cloudflare's schedule |

**Requests** (`hello@frameworkco.ca`; the owner is the initial privacy and incident contact and handles them by hand): acknowledge within 5 business days; complete eligible deletion within 30 calendar days (targets; legal and operational exceptions).
1. Confirm the person's identity from the portal email address (reply to that address; do not act on an unverified request).
2. Access or correction: read the organization in Admin > Clients; correct through the person (Business Profile answers are editable by the client) or by a reviewed manual SQL change.
3. Removal of access: `migrations/portal-ops/emergency-offboard.sql` (revokes membership and sessions). Never delete the WorkOS user afterwards (a re-created user is refused as `email_conflict`).
4. Erasure: only after the retention need has passed; reviewed manual deletion of the organization's answers, feedback and the person's portal user row (foreign keys protect history, so order matters); then the WorkOS user in the WorkOS dashboard; note that backups and provider logs expire on their own schedules. Record the request, the dates and what was removed.
5. Inactive beta accounts: review every 12 months (calendar reminder); delete information no longer needed, subject to legal and operational requirements.
