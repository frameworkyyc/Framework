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
| Cloudflare Turnstile | script from `challenges.cloudflare.com` on the assessment page | only when both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` are set | BUILT, OFF |

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

Policy: **assessment inquiries and related prospect information are kept up to 24 months after the last meaningful interaction.** There is no automatic deletion. A person must run the review.

### Simple review routine (every 3 months, 15 minutes)

1. In the D1 console (`framework-feedback` for Production) run the read-only query below.
2. For each row: search the hello@ mailbox for that email address. If there has been a meaningful interaction (a reply, a meeting, a project) in the last 24 months, keep it. The database only records the submission date, not later contact, so this email check is the "last interaction" test.
3. Delete what is due (Admin → Assessments → trash icon, or SQL below). Do not delete in bulk without checking.
4. Note the review date and counts in the request log (below).

```sql
-- Assessment requests submitted more than 24 months ago (candidates only)
SELECT id, created_at, business_name, contact_name, email
FROM assessment_requests
WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 months')
ORDER BY created_at;

-- Client feedback older than 24 months (decide per your feedback retention choice)
SELECT id, created_at, attribution_business FROM feedback_responses
WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 months') ORDER BY created_at;
```

### Handling an individual request (access, correction, deletion, withdrawal)

1. Log it (date received, who, what asked, how you checked identity: reply from the address they used is normally enough).
2. **Find everything** (the admin list shows only the newest 200 and has no search):
   ```sql
   SELECT id, created_at, business_name, email FROM assessment_requests WHERE lower(email) = lower('person@example.com');
   SELECT id, created_at, attribution_name, attribution_business FROM feedback_responses WHERE lower(attribution_name) LIKE '%name%';
   ```
   Also search the hello@ mailbox (notifications are titled "New Assessment Request | <business>").
3. **Access:** copy the record (Admin → Assessments → "Show all details", or the SELECT above) and send it to them. Feedback has a per-record CSV/JSON export.
4. **Correction:** edit in the D1 console (`UPDATE assessment_requests SET email = '...' WHERE id = '...'`), after checking with them.
5. **Deletion:** Admin → Assessments → trash icon (permanent, confirmation dialog), or `DELETE FROM assessment_requests WHERE id = '...'`; Admin → Feedback → Delete for feedback.
6. **Withdrawing marketing consent:** `UPDATE assessment_requests SET marketing_opt_in = 0 WHERE lower(email) = lower('...')`, and remove them from any promotional list you have.
7. **Withdrawing testimonial/logo permission:** stop using it, remove it from the site (homepage/portfolio) and update the feedback record.
8. Clean up the places the admin delete does **not** reach (next section), then reply to the person and close the log entry.

### What the admin delete does not remove (handle separately)

| Place | What to do |
|---|---|
| Framework mailbox (notifications, replies) | search and delete (including archives/trash) |
| Resend email log | open the Resend dashboard → Emails and remove the entries if the plan allows; otherwise they expire on Resend's schedule. Confirm the retention shown in Resend |
| D1 point-in-time backups (Time Travel) | not deletable on demand; they age out (limited window, set by Cloudflare). Say so if asked |
| Cloudflare Workers Logs / hosting logs | expire on Cloudflare's schedule; code logs avoid personal data |
| Downloaded exports (feedback CSV/JSON) | delete local copies, including downloads and cloud drives |
| Meta (only if the Pixel was allowed) | data held by Meta is governed by Meta; the person can use Meta's own tools, and you can delete Events data in Events Manager |
| Published testimonial / logo | remove from the website and redeploy |
| `client_revenue` | business data, not the person's; remove the client's row only if they withdraw permission |

### Is the current admin deletion enough for individual requests?

It deletes one record permanently and safely, so **yes for the database record**. Gaps, in order of importance: no search by name/email (use the SQL above), no deletion log (keep the request log), no per-record export for assessments (use "Show all details"/SQL), and it does not reach the mailbox, Resend or backups. Suggested small future improvements (not built, need approval): a search box on Admin → Assessments, a "last interaction" date field, and a per-record export.

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
* The effective date at the top of `privacy.html` must be the actual publication date.
