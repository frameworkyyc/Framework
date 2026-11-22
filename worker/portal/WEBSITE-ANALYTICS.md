# Website Analytics (Client Portal, under each website)

Status: **built on Staging; migration 0028 applied to Staging; dormant until credentials and per-website settings exist.** A website's **own Cloudflare account** (a client whose Web Analytics site is in their own account, not Framework's) is built on a branch and needs **proposed migration 0029** (not applied anywhere) and the secret `ANALYTICS_CREDENTIALS_KEY`; see [Client's own Cloudflare account](#a-clients-own-cloudflare-account-migration-0029-proposed). It needs two sets of server credentials. Until then the client page does not exist and the Website page does not offer it; nothing else changes.

A client opens **Website, then a website, then Analytics** (`/portal/o/<slug>/website/<id>/analytics`, `website.view`, behind `PORTAL_WEBSITE`). Two sources, shown in separate, named sections and never added together:

| Section | Source | What it shows | Cached |
| --- | --- | --- | --- |
| **Website traffic** | Cloudflare Web Analytics (GraphQL Analytics API) | Visits, page views, traffic sources and referrals, most visited pages, mobile vs desktop (and tablet), a daily chart | 30 minutes |
| **Search performance** | Google Search Console (Search Analytics API) | Clicks, impressions, click-through rate, average position, daily charts of clicks and impressions | 6 hours |

Every figure has a **period-over-period** change (the same number of days just before; words and arrows, never colour alone) and a **7, 30 or 90 day** view (links, so it works without script; `?range=7|30|90`, anything else is 30). Charts are SVG with a table under each; a small script adds hover and arrow-key read-out and fetches nothing.

## What the numbers mean (and what they are not)
* **Visits and page views, not "visitors".** Web Analytics counts page loads (`count`) and visits (`sum.visits`); it has no unique-person count, so the page never says "visitors". Bot traffic is excluded (`bot = 0`, Cloudflare's dashboard default). It is a privacy-friendly counter with no cookies.
* **Newest day.** Web Analytics: yesterday (today is still being counted). Search Console: two days ago (Google's figures arrive about two days late). Each section says which day its figures run through and when they were read.
* **Average position** is Google's average over every search, place and device where the site appeared; it is not the rank for one search (that is the keyword tracking on the SEO page). CTR is clicks divided by impressions. Totals for a period are Google's own (a query with no dimension), not a sum of daily averages.
* Days with no recorded page loads are real zeros; a day Search Console has no impressions for has no position (never an invented one).
* **Nothing is fabricated.** A source that is not set up shows a message and what to do. A source that fails shows "couldn't be loaded" (or, if an earlier answer for that period exists, that answer, labelled with the time it was read). The existing manually entered SEO figures (`website_seo_metrics`) are separate and untouched; they are never mixed into these.

## Reuse
Websites and their tenant-safe keys (`websites (id, organization_id)`), `getClientWebsite` (own organization, published, not archived), the `website.view` permission, the Website page layout, the SEO dashboard's `change()` helper and `sd-*` KPI tiles and set-up panels, the Admin website card and its panel pattern, and the Admin API rules (Cloudflare Access, `PORTAL_ADMIN_WRITES`, same origin). No new navigation, role or permission.

## Data (migration 0028, applied to Staging, additive, no credentials)
* `website_analytics`: one row per website, the Cloudflare **site tag** (32 hex characters) and the Search Console **property** (`sc-domain:example.com` or `https://example.com/`). No row or an empty value = not connected.
* `website_analytics_cache`: the last answer per website, source and period (aggregates only), with `ref` (the tag or property it was read for: an answer for a different one is never used). Changing or removing a setting drops that source's cache.
Both tables reference `websites (id, organization_id)`; every statement names the organization. Multiple websites per client each keep their own rows.

## Credentials: Framework's are Worker secrets; a client's own Cloudflare token is encrypted in the database (0029); none is ever in the repository
| Name | Kind | Purpose |
| --- | --- | --- |
| `CF_ANALYTICS_API_TOKEN` | secret | Cloudflare API token, **Account > Account Analytics > Read** only |
| `CF_ANALYTICS_ACCOUNT_ID` | plain variable **in `wrangler.jsonc` (`previews.vars`)** | the Cloudflare account id (32 hex characters; an identifier, not a secret). It must be in the file: a plain variable set only in the dashboard is deleted by the next deploy |
| `GSC_OAUTH_CLIENT_ID` | secret | the Google OAuth client id (Web application) |
| `GSC_OAUTH_CLIENT_SECRET` | secret | that client's secret |
| `GSC_OAUTH_REFRESH_TOKEN` | secret | the refresh token for the dedicated Google account, scope `webmasters.readonly` only |
| `ANALYTICS_CREDENTIALS_KEY` | secret, needed only for clients' own Cloudflare accounts | 32 random bytes (base64, or 64 hex characters): the AES-256-GCM key that encrypts clients' API tokens in the database. Create with `openssl rand -base64 32`. Never in the database, the repository or `wrangler.jsonc`. Changing it makes every saved client token unreadable (`credentials_unreadable`): each has to be pasted again |
| `GSC_ACCOUNT_EMAIL` | secret, optional | that Google account's email, shown in Admin so it is easy to add in Search Console (display only; never used to sign in). Add it as a secret, not a dashboard variable: dashboard-only variables are deleted by the next deploy, and the repository is public |

No Google service account key exists or is read (the organisation blocks them). Admin sees only whether each source is set up (a green "Server ready"), plus the optional account email. Errors are short codes (`unauthorized` for Cloudflare; `reconnect_needed`, `no_access`, `property_not_found`, `rate_limited`, `query_failed`, `unreachable`): no secret, token, tag or response text is ever logged, stored or shown to a client.

## A client's own Cloudflare account (migration 0029, proposed)
Web Analytics data belongs to the Cloudflare **account** that holds the site. Framework's token can only read Framework's account: a site tag from another account is answered with empty, error-free results, which the page would show as zero visits. (This is why **Eagle's Nest Resort**, whose site is in its own account, showed 0 visits while its tag was saved.) A website can therefore carry its own account:

* **Data (0029, proposed, additive):** three nullable columns on `website_analytics`: `cf_account_id` (32 hex characters, an identifier), `cf_token_enc` (the token, **encrypted**), `cf_token_set_at`. No existing row changes: NULL means "Framework's account", exactly as before. An own account always has both the id and a token; removing it clears both.
* **Encryption:** AES-256-GCM through Web Crypto (`worker/portal/analytics/secret-box.js`), key `ANALYTICS_CREDENTIALS_KEY`, a fresh random 12-byte iv per save, stored as `v1.<iv>.<ciphertext+tag>` (base64url). The organization id and website id are the additional authenticated data, so a value copied to another website or organization does not decrypt. The plain token is never stored, cached, logged or put in an error.
* **Write-only in Admin:** the token field is an empty password field; the API (`cf_api_token`) accepts it, encrypts it on the server and answers only `cf_token_set` and `cf_token_set_at`. No answer contains the token or its encrypted form, and `cf_token_enc` cannot be sent from outside. An empty token field keeps the saved token.
* **Reading:** the token is decrypted only when Cloudflare is actually called (never for a cache hit) and only for that website's own organization. The cache key includes the account (`<account>:<tag>`). A website with its own account does not need Framework's credentials. If the key is missing or changed, the client sees "Framework's access to this source needs attention" (or the last figures, marked with their time) and Admin's Test names the problem.
* **Before 0029 is applied** every website reads as Framework's account and works as before; Admin shows the account choice disabled, and an own account is refused (`accounts_unavailable`) without writing anything.
* **The client's token:** created in the client's Cloudflare account (My Profile, API Tokens, or Manage Account, Account API Tokens) with exactly one permission, **Account, Account Analytics, Read**, limited to that one account. Nothing else. The client can revoke it at any time.

## Admin's Cloudflare test
Because an unknown tag and a real site with no traffic look the same to the analytics API, **Test Cloudflare** asks three questions with the same dataset (Account Analytics: Read is enough): page loads for the tag in the last 7 complete days; any page load for the tag in the last 90 days (today included, so a just-installed snippet counts); and, only if that is empty, a second request for any page load in the whole account. It answers which account it tested (`own` or `framework`) and one of:

| Result | Meaning | What to do |
| --- | --- | --- |
| `receiving` | page views in the last 7 days (the count is shown) | nothing |
| `no_recent_traffic` | the tag has reported before, but nothing in 7 days: **genuine zero traffic** | nothing; the client sees zeros |
| `site_tag_no_data` | the account has Web Analytics data, but never for this tag | check the tag (Manage site; it is **not** the token inside the snippet) and that the site is in this account; check the site carries the snippet |
| `account_no_data` | nothing reached this account in 90 days, for any site | the website is not sending data: add the snippet or turn on automatic setup for the proxied hostname; or the account id is wrong |
| `no_data` | no data for the tag, and the account-wide check could not be made | as for `site_tag_no_data` |
| `unauthorized` | Cloudflare refused the token (wrong, revoked, expired, or without Account Analytics: Read) | create a new read-only token and save it |
| `account_not_accessible` | the token works but cannot read this account id | check the account id, and that the token is limited to this account |
| `credentials_key_missing` / `credentials_unreadable` | the encryption key is not set up / has changed | set the secret / paste the client's token again |

A tag that is wrong cannot be *proven* wrong (the API does not list tags it does not know), so the messages say what was observed. The second request (without a site tag filter) has not yet been run against the live API; if Cloudflare refuses it the test answers `no_data` instead of guessing.

### Token expiry and reconnecting Google
An access token lasts an hour and is reused for 50 minutes; it is never stored. The refresh token does not expire while it is used, but Google rejects it if it is **revoked** (the account removed it at myaccount.google.com/permissions), the account is disabled or loses access, the OAuth client is deleted or its secret changed, it goes **unused for six months**, or the consent screen is left in *Testing* (tokens then last 7 days: use *Internal*, or publish to *In production*). When that happens: clients see "Framework's access to this source needs attention" (or their last figures, marked with the time they were read, while the 6-hour cache lasts); Admin's **Test Search Console** says Google no longer accepts Framework's sign-in (`reconnect_needed`); Cloudflare figures are unaffected. To reconnect, repeat step 5 of the Google setup below and replace the `GSC_OAUTH_REFRESH_TOKEN` secret. `no_access` instead means the connected account is not a user on that property (or the Search Console API is off in the Google project).

## Owner checklist
1. ~~Approve migration 0028~~ **Done on Staging** (applied after a Time Travel bookmark; tables verified). Production: only through the manual workflow, later, after its own approval.
2. **Cloudflare**: create an API token (Account Analytics: Read, limited to the account); add `CF_ANALYTICS_API_TOKEN` as a Worker secret on Staging (`CF_ANALYTICS_ACCOUNT_ID` is in `wrangler.jsonc`). In Cloudflare, enable **Web Analytics** for each client website (adds a small snippet; for a client's own site the client or their host adds it) and copy the site's tag.
3. **Google** (no cost; no service account key): (1) a dedicated Google account; (2) in Google Cloud, enable the **Search Console API**; (3) configure the OAuth consent screen (**Internal** if the organisation is Google Workspace, else External and set to **In production**); (4) create an OAuth client of type **Web application** with the redirect URI `https://developers.google.com/oauthplayground`; (5) in the OAuth 2.0 Playground (own credentials, scope `https://www.googleapis.com/auth/webmasters.readonly`, signed in as the dedicated account) authorise and copy the **refresh token**; (6) store `GSC_OAUTH_CLIENT_ID`, `GSC_OAUTH_CLIENT_SECRET` and `GSC_OAUTH_REFRESH_TOKEN` as Staging secrets (and optionally `GSC_ACCOUNT_EMAIL`, also as a secret). For each client website, have the property verified in Search Console and add the dedicated account under Settings, Users and permissions as a **Restricted** (read-only) user.
4. **Admin**: Clients, the client, Website, the website card, **Analytics**: enter the site tag and property, Save, then **Test** each. The client sees a source as soon as its setting is saved and the server credentials exist.
5. The names are in `scripts/ops/staging-expected.json` (`secrets.optional`, `plainVars`), so the health check knows them.
6. **A client's own Cloudflare account** (after 0029 is approved and applied to Staging): add `ANALYTICS_CREDENTIALS_KEY` as a Staging secret (`openssl rand -base64 32`; keep a copy in the password manager, as losing it means pasting every client token again). The client creates the read-only token described above and makes sure the website reports to Web Analytics. In Admin, choose **The client's own account**, enter the account id, paste the token and the site tag, Save, then **Test Cloudflare**.

**Lesson (Staging, 11 November 2026):** `CF_ANALYTICS_ACCOUNT_ID` was first added only in the dashboard, so the next deploy deleted it. Admin's Test had passed before that deploy; afterwards the client page said "Traffic figures aren't connected yet" (the `not_enabled` state: the server's Cloudflare credentials were incomplete) while Search Console, whose settings are all secrets, kept working. Rule: plain variables go in `wrangler.jsonc`; secrets go in Cloudflare.

## Verification status
Verified: the GraphQL query against Cloudflare's live schema (dataset, dimensions, filters, types; a query for a non-existent site tag returned an empty, error-free answer); the request shapes, parsing, errors, caching, tenant isolation, page states and routes by automated tests against mocked provider answers; the page in a browser at desktop, iPad and phone widths. **Cloudflare Web Analytics** has been connected on Staging and returned real data (through 10 November 2026). **Own Cloudflare accounts:** the encryption, write-only API, reading and test logic are covered by automated tests (`worker/test/portal-analytics-accounts.test.mjs`) against mocked Cloudflare answers; not yet run against a real client account (needs 0029 on Staging, the key and the client's token). **Not verified until the Google sign-in exists:** a real Search Console read (it has not been called at all; the OAuth token exchange and queries are covered by automated tests against mocked Google answers).
