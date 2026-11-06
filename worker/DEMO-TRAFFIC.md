# Demo traffic reporting

Private, first-party reporting on the demo landing page (`/demos/`). Prospects get an opaque tracking link; Framework sees, in Admin only, which link was used and what the visitor did on the page. Code: `worker/demo-traffic.js` (public side), `worker/admin/demo-traffic-api.js` (Admin API), `admin/assets/demo-traffic.js` (Admin page). Tests: `worker/test/demo-traffic.test.mjs`.

## An indication, not proof

A link visit shows **which link was used, not who visited**. Links get forwarded, previewed by chat apps and scanned by email security. Treat "Summit Fencing's link was opened and a colour was chosen" as a strong hint, not identification. Google Analytics is not used (it is consent-gated and off).

## What is recorded

Per visit (a "journey"): a random journey id, which link (if any), first and last seen time, coarse **country**, **device class** (mobile, tablet, desktop, other), a **bot flag** with a short reason, and the choices made: discipline, vibe, colour, company name (typed by the visitor), how many times the demo was opened, and whether an enquiry was sent. Per event: time, type, and a short value.

**Not recorded:** IP address, user-agent string, cookies, email address, name, enquiry message or any other contact-form content, referrer. The IP address is used only as the rate limiter's key (`PORTAL_RATE_LIMITER`, key `demo:<network>`) and never stored. The user agent is read to classify the request and discarded.

Retention: journeys not seen for **180 days** (`RETENTION_DAYS`) are deleted with their events, on about 1 in 50 recorded requests.

## Links

Admin -> Demo traffic -> Links -> Manage -> create a link with a private label (and optional note). The label is for Framework only: it never appears in the URL, the email or the CSV filename. The link is `https://<site>/d/<22 characters>`.

The token is `base64url(8 random id bytes)` followed by `base64url(first 8 bytes of HMAC-SHA256(key, "demo-link:" + id))`. It is verified (constant time) before any database lookup, so guessed or junk links never touch the database. The database stores only the 16-hex id; the token is recomputed from it, so Admin can copy a link again at any time and nothing secret is stored. The signing key is `DEMO_LINK_SECRET` if set (16+ characters), otherwise `PORTAL_SESSION_PEPPER`. Changing the key invalidates every issued link.

`/d/<token>` answers `302` to `/demos/#j=<journey id>`. The journey id sits in the URL **fragment**, which browsers never send to servers or logs; the demo page keeps it in memory. A junk, revoked or unavailable link redirects to plain `/demos/` identically, revealing nothing. `HEAD` requests (link checkers) never create a journey. Revoking a link stops new visits; history is kept.

## Events

The demo page posts `{ "j": "<journey id>", "e": [ { "t": "<type>", "v": "<value>" } ] }` to `POST /api/demo-events` (same origin, JSON, at most 4 KB and 12 events). The response is `204` for any well-formed request, including when nothing was stored. Client types: `view`, `active`, `discipline`, `vibe`, `colour`, `company`, `open` (`preview` or `card`). `link_open` and `enquiry` are written by the server only. Invalid events are dropped silently. A client can never set which link a journey belongs to. At most 300 events are kept per journey.

Enquiries: `POST /api/contact` accepts an optional `journey` field. After the email provider accepts the enquiry the journey is marked as having enquired. The response is unchanged and a recording failure can never affect it.

## Bots and scanners

Each request is classified: `HEAD`; no user agent; a crawler, preview, scanner or HTTP-library user agent (`BOT_UA`); a mail-security or data-centre network (`BOT_ORG`); or, on the link visit only, no `Accept-Language`. These are **heuristics** and will miss some bots and flag some people (for example someone on a corporate VPN). The stronger test is a human interaction: a journey is **Verified** when an `active`, choice or `open` event arrives from a request not classified as a bot (a bare page `view` does not count). The first four reasons are sticky; the `Accept-Language` one is cleared by a later human interaction. An accepted enquiry always marks the journey verified. Admin hides likely bots by default; "Include likely bots and scanners" shows them.

## Setup still to do

1. Migration `migrations/portal-proposed/0021_demo_traffic.sql` is **proposed and not applied anywhere**. Until it is, the Worker records nothing (events get `204`, links still redirect) and Admin shows "not set up". After approval: apply to Staging with the documented commands in `migrations/portal/README.md` (Time Travel bookmark, `migrations list`, `apply`, verify, `--remote -c migrations/portal/wrangler.migrate.staging.jsonc`), moving the file into `migrations/portal/` as part of that reviewed change. Production only through the manual "Portal Production D1 migration" workflow.
2. Optionally set the secret `DEMO_LINK_SECRET` in Cloudflare (otherwise `PORTAL_SESSION_PEPPER` is used). Never put it in a file.
3. The demo page must send the events and the `journey` id on enquiries.

## CSV export

Admin -> Demo traffic -> Export CSV (`/api/admin/demo-traffic/export.csv?days=&link=&bots=`), one row per event, UTF-8 with BOM, `framework-demo-traffic-<date>.csv`, newest first, at most 50,000 rows (`X-Export-Truncated: 1` if cut). Cells starting with `=`, `+`, `-`, `@` are neutralised against spreadsheet formulas. Columns: `timestamp_utc, journey_id, source (link|direct), prospect_label, verified_human, likely_bot, bot_reason, country, device, event, value, discipline, vibe, colour, company` (the last four are the journey's current choices).

## Deleting a prospect's data

Admin -> Demo traffic -> Links -> Manage -> Delete on that prospect's link. It permanently removes the link, every journey that came through it and their events (after a confirmation). Direct visits carry no link and cannot be tied to a prospect; they expire after 180 days.
