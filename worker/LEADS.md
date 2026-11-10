# Leads workspace

Admin -> Leads. Prospects found by the separate finder Worker (`framework-leadgen`) are imported, reviewed, given a personal demo tracking link, pitched with an email the owner approves word for word, and followed through to a reply or a no. Code: `worker/leads.js` (rules, finder import, drafting, sending, unsubscribe page, delivery webhook), `worker/admin/leads-api.js` (Admin API, `/api/admin/leads/*`). Tests: `worker/test/leads.test.mjs`. Migration: `migrations/portal-proposed/0024_leads.sql` (PROPOSED, not applied anywhere).

## How it works

1. **Import.** `POST /api/admin/leads/sync` (the page calls it on load) reads the finder database (`LEADGEN_DB`) and imports rows with `status IN ('qualified','approved')`, `no_solicit = 0` and `site_status <> 'ok'`, at most 500 per call, oldest first. Rows already imported (same place, same website host, or same name and city) are skipped; an existing lead is never re-opened or overwritten, so a dismissed lead stays dismissed. A finder row approved in the old finder dashboard arrives as `new` with that note in its reason. The finder database is **only read**: every statement goes through `finderSelect`, which refuses anything but one `SELECT`, and a test pins it.
2. **Review.** Each lead carries a one-sentence `reason` built only from the finder's data ("No website; 4.6★ from 77 reviews, latest review 28 days ago."). The owner approves or dismisses (one at a time, or up to 50 in bulk).
3. **Approve.** Creates the lead's tracking link (a row in `demo_links`, migration 0021, `created_by` = the signed-in admin) and the first email draft, in one step, once (a double click or a repeat changes nothing). Without a signing key this fails with `409 secret_missing` and changes nothing.
4. **Draft.** Three deterministic templates (not AI), chosen in the panel: *observation*, *demo*, *reputation*. They use the business name, trade, city, the facts behind the reason, the rating and review count, the lead's demo link, and the owner's own background (a Calgary carpenter, about 10,000 hours in the trade, now building websites for trades). Plain text, 90 to 150 words, one ask, no pricing. The owner can edit the subject and body freely.
5. **Approve the exact email.** Approving stores a SHA-256 over the recipient, subject, body and compliance footer. Editing afterwards returns the message to `draft` and the lead from `ready` to `approved`. Approval needs an **eligible recipient** and, for a first email, no pricing words (422 `pricing_in_first_email`).
6. **Send** (up to 10 at a time, one after the other). Preview first (`POST /send/preview`) shows exactly what goes out and its hash; `POST /send` sends only if that hash still equals the stored approved hash and the text recomputed now. The message is claimed with `UPDATE ... SET status = 'sending' WHERE id = ? AND status = 'approved'` (must change exactly one row), so a double click or a retry cannot send twice; the Resend `Idempotency-Key` is `lead-msg-<message id>`.
7. **After sending.** The lead becomes `contacted`. Delivery, bounce and spam-complaint events come from the Resend webhook. Replies are marked by hand (see below). One follow-up is possible 5 days after the first email if there is no reply and no opt-out.

Lifecycle: `new` -> `approved` -> `ready` -> `contacted` -> `replied` -> `won`; `dismissed` from anywhere (reopen -> `new`, only if never contacted and not opted out).

## Mark as Contacted (outreach tracking)

For leads you reach yourself (text, phone, Facebook, ...). On a lead's page, **Mark as Contacted** sits next to Approve email and Dismiss (for a New, Approved or Ready lead that is not contacted, dismissed or opted out). The dialog asks how (Text, Email, Phone, Facebook or Other), an optional note and an optional follow-up date; **the date and time are recorded automatically**. The lead's **status (its approval) is not changed**, and nothing else on it is touched. A **Contacted · Phone** chip shows in the header and an Outreach card shows the details (method, when, follow-up date with Due today / Overdue, notes); from there the status moves to **Replied, Interested, Not interested or Follow-up needed**, with a note and a new follow-up date (not kept for Not interested). Every step adds one address-free line to the lead's timeline.

* **Reuses** `outreach_leads` (`contacted_at` = the first contact, kept) and `outreach_events` (type `note`); no new table. Migration **0026** (`migrations/portal/0026_outreach_tracking.sql`, applied to Staging; Production only through the manual workflow after approval) adds five nullable columns: `contact_method`, `last_contact_at`, `outreach_status`, `follow_up_on`, `outreach_note`. Where it is not applied (Production today) the button is disabled with the reason, the list and filter keep working, and a lead emailed from Leads already reads as Contacted (Email) or Replied from its lifecycle (no backfill needed).
* **Filter.** The Leads list has an *outreach* filter (All, Contacted (any status), Not contacted yet, and each status) with counts; it works across every lifecycle status, so contacted leads always stay reachable. `GET /api/admin/leads/list?outreach=any|none|contacted|replied|interested|not_interested|follow_up`.
* **API.** `POST /api/admin/leads/:id/contacted { method, note?, follow_up_on? }` and `POST /api/admin/leads/:id/outreach { status, note?, follow_up_on? }` (same-origin writes only). Refused with a reason: dismissed, opted-out, already contacted (for `contacted`), not yet contacted (for `outreach`), bad method or status, a follow-up date that is not a real date or is before yesterday.
* A hand-logged *Replied* on a lead whose lifecycle status is `contacted` also moves it to `replied` (as Mark replied does) and stops follow-up emails; on any other lead the approval stays.

## Copy Lead Info

A **Copy lead info** button sits in the action bar of every lead. It copies a Markdown prospect brief to the clipboard, laid out for pasting into ChatGPT: business profile, Google presence, SEO assessment (with dates), website weaknesses and opportunities, priority, public contacts, outreach status and history, and the Framework demo. It is built in the browser (`admin/assets/lead-brief.js`) from the lead detail the page already loaded, so there is no new request, endpoint or database field. Each figure is tagged `[Verified]`, `[Measured]`, `[Estimate]` or `[Internal record]`, and anything not recorded reads "Not available". Left out on purpose: internal ids, the dedupe key, the demo tracking link (it carries a token), email bodies and anything a demo visitor typed. If the browser refuses clipboard access, the brief appears in a text box to copy by hand.

## What is recorded

`outreach_leads` (the prospect and its state), `outreach_contacts` (each email or phone with where it came from and whether it may be emailed), `outreach_suppressions` (addresses that must never be emailed again: unsubscribed, bounced, complained, manual), `outreach_messages` (every draft and send; the editable body without the footer), `outreach_events` (the timeline). The timeline holds short notes only: **never an email body, never a recipient address** (an address that slips into a note is replaced before it is stored; a test checks this). The tracking link's visits, company names and design choices come from the existing `demo_journeys` / `demo_events` (see `DEMO-TRAFFIC.md`); the panel counts exclude likely bots unless asked.

## Sending modes

Set in `wrangler.jsonc` (non-secret) and shown in `GET /status`:

| Mode | When | Behaviour |
| --- | --- | --- |
| `off` | `LEADS_SENDING` is not exactly `"1"` | Send is disabled; the UI says awaiting setup. |
| `test` | `LEADS_SENDING` = `"1"` and `LEADS_TEST_RECIPIENT` is set | Every email goes **only** to that address, subject prefixed `[TEST for <real address>] `. A test copy is recorded (`is_test = 1`, `sent`); the approved message and the lead's status do not change, so it can be repeated. The unsubscribe link in a test email belongs to the test copy and does nothing. A bounce or complaint of a test email never suppresses the real address. |
| `live` | `LEADS_SENDING` = `"1"`, no test recipient | Needs `LEADS_MAILING_ADDRESS`, an email provider, a signing key and an eligible, unsuppressed recipient; otherwise the send is blocked with a stated reason. |

**Staging** (`previews.vars`) sets `LEADS_SENDING` and `LEADS_TEST_RECIPIENT` (the owner's inbox), so Staging can never email a real business. **Production** sets neither (mode `off`).

## Rules enforced on the server

No send to a dismissed, replied, won or opted-out lead; none to a suppressed, blocked or unconfirmed address; none unless the message is `approved` and the recomputed hash equals the stored one; at most one live first email and one live follow-up per lead (a partial unique index in the database, not only code). Follow-up: lead is `contacted`, no reply, not opted out, last live send at least 5 days ago, none sent yet.

A bounced or complained first email stays in the unique index (as the contract specifies), so no second first email can be created for that lead; the panel's next action then says to add another address or phone them.

## Eligibility, CASL and the product rules

Each contact records its source and an eligibility: `eligible`, `review` or `blocked`.

* **Eligible:** an email the finder found on the business's own website (`source_url` on that site), for a lead that is not do-not-solicit. The note records the page ("Published at ...": conspicuous publication under CASL).
* **Review:** an email without a source page, found elsewhere (a directory or social page), or typed in by hand. The owner confirms it (`POST /:id/contacts/:cid {eligibility:"eligible"}`, recorded as `contact_confirmed`). Phone numbers are stored as `review` ("Phone only: not emailed") and never emailed.
* **Blocked:** any suppressed or opted-out address. Confirming can never un-block it.

Every email carries an automatic, non-editable footer: who is writing ("Framework"), the mailing address (`LEADS_MAILING_ADDRESS`), why the recipient is being written to (the page their address is published on), and a one-click unsubscribe link; the message also has `List-Unsubscribe` and `List-Unsubscribe-Post` headers. An unsubscribe is honoured immediately: the address is suppressed, every lead that shares it is blocked, the lead is dismissed as "Opted out" and any approved email goes back to draft. `GET /u/<token>` only shows a page with a button (mail scanners prefetch links, so a GET never opts anyone out); `POST /u/<token>` (the button, and the RFC 8058 one-click post) records it. The token is 22 characters: the message id plus a truncated HMAC under a label distinct from the demo links', verified before any database access. The page has no scripts and makes no external requests, is `noindex`, and has a strict CSP.

**No pricing, rates, "free" or discounts in a first email is a product rule** (not a legal one): the server rejects it on approve and again on send, in the subject as well as the body.

## Awaiting setup (checklist)

`GET /api/admin/leads/status` reports each of these accurately.

1. **Approve migration 0024** (`migrations/portal-proposed/0024_leads.sql`) for Staging; it needs 0021 (already on Staging). Until then Admin -> Leads says "not set up: migration 0024", and `/u/<token>` and the webhook do nothing.
2. **`LEADGEN_DB` binding**: in `wrangler.jsonc` under `previews.d1_databases` (`framework-leadgen`, Staging only). Cloudflare cannot make a D1 binding read-only; the code only ever reads.
3. **`DEMO_LINK_SECRET`** (secret; the portal session pepper is the fallback): signs tracking links and unsubscribe tokens. Without it approve fails with `secret_missing` and nothing can be sent.
4. **`LEADS_MAILING_ADDRESS`**: the postal address in every footer. Live sending is blocked without it. Store it as a Cloudflare secret or add it to `wrangler.jsonc` in a reviewed change: a plain variable that exists only in the dashboard is deleted on the next deploy. It is not needed in Staging test mode.
5. **`LEADS_SENDER_NAME`** (optional, same storage rule): used in the signature ("- Name", then "Framework"); without it the signature is "- Framework".
6. **`RESEND_WEBHOOK_SECRET`** (secret, Svix `whsec_...`) and register `https://<site>/api/leads/webhook` in Resend for `email.delivered`, `email.bounced`, `email.failed` and `email.complained`. Without the secret the endpoint answers `503 not_configured` and stores nothing. The signature (`svix-id`, `svix-timestamp` within 5 minutes, `svix-signature` v1) is verified in constant time; every valid signature gets a 200 (unknown message ids are ignored), except a storage fault, which returns 500 so Resend retries and a bounce is not lost.
7. **Replies are not captured automatically.** Inbound email is not connected; replies land in the normal inbox (`Reply-To` is `ASSESSMENT_NOTIFY_TO`) and the owner marks the lead replied (`POST /:id/status {status:"replied"}`, a "Mark replied" button).
8. **Staging test-mode safety.** With the Staging settings above, nothing reaches a real business. Check `GET /status` shows `sending.mode: "test"` before the first send.
9. **Production** would need its own migration run through the manual "Portal Production D1 migration" workflow (verify-only first, then apply, each run approved), its own `LEADGEN_DB` binding, `LEADS_MAILING_ADDRESS`, a webhook registration, and a separate reviewed change that sets `LEADS_SENDING` (and deliberately no test recipient). Nothing about Leads is at the top level of `wrangler.jsonc` today.

## Website check: Online, Offline or Unverified

The finder's `site_status` of `broken` ("doesn't load") is a **claim**, not a fact: a robot that is refused (bot protection, rate limit, a firewall that blocks cloud addresses) looks exactly like a site that is down. Leads imported with it are stored as `broken` and worded as "Finder reported the website as not loading; not confirmed yet". `worker/site-check.js` then checks the site itself and the lead becomes one of:

| Status | Meaning | Evidence required |
| --- | --- | --- |
| `online` | A normal page was served, after any redirects (http to https, www or apex, several hops, cookie-setting redirects). | HTTP 2xx and no challenge page, on any address a visitor might use. |
| `offline` | The site itself is missing or broken. | The domain does not exist (DNS NXDOMAIN, asked of 1.1.1.1 for the host and its www/apex twin), a real 404/410 home page, or Cloudflare reporting the origin down for every visitor (521-526, 530). A plain 5xx, and Cloudflare's 520, are **not** proof: a firewall that refuses robots answers the same way (seen live: working sites answered the finder with 520), so they are `unverified`. |
| `unverified` | We could not tell. **Never treated as offline.** | Bot protection or rate limiting (401/403/405/406/429/451/999, a challenge page even with HTTP 200, Cloudflare/DataDome/Sucuri/Imperva/PerimeterX/Akamai markers), a 520 or a 5xx on every try, a redirect loop, or a failure to connect that could be our own address being refused. |

What a check does: normalises the address (tracking parameters and fragments dropped), refuses anything that is not a public web host on port 80/443 (no IP literals, `localhost`, internal names, credentials; each redirect hop is checked too), tries `https://host/`, then the www/apex twin, then plain `http://`, stopping at the first that proves the site online; sends a browser-compatible `User-Agent` that still names `FrameworkSiteCheck/1.0 (+https://frameworkco.ca)`, never any credential; reads at most 24 KB of a page (only to recognise a challenge page).

What is recorded (no migration): `site_status`, `site_issues` (the checked date and result, the HTTP status and number of redirects, the bot protection recognised, the failure reason), the rebuilt one-sentence `reason`, and one `note` on the lead's timeline ("Website check: Unverified: blocked or protected (HTTP 403, Cloudflare challenge) at host. Not treated as offline."). The finder's score is kept only for a confirmed `offline` site; an `online` or `unverified` site is no longer scored as a broken-site prospect (`site_score` is set to empty). Only a lead with status `new` is changed, so an email already drafted is never made untrue; a draft made from an unconfirmed, unverified or online site never says the site "doesn't load" or "looks dated".

How it runs: the Leads page checks every unconfirmed lead in batches of five when it opens (and the "Check websites" button does the same); a lead's page has "Check website again". API: `POST /api/admin/leads/recheck-sites` with `{}` (next unconfirmed leads) or `{ "ids": [up to 5 lead ids] }` returns `{ checked, remaining, results: [{ id, state, was, httpStatus, protection, summary, changed }] }`. Same Origin and `X-Framework-Admin` rules as every write; nothing is written to the finder. Tests: `worker/test/site-check.test.mjs` (scripted responses) and `worker/test/leads.test.mjs`; `worker/test/site-check-live.mjs` probes real sites by hand.

**Known limit:** one place on the internet cannot prove a timeout is not our own address being refused, so a site that never answers us is `unverified` unless DNS says the domain is gone. The finder (`framework-leadgen`) is a separate Worker that still assigns the original `broken` label to new candidates; this check corrects them when they reach Admin.
