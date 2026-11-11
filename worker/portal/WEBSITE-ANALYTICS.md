# Website Analytics (Client Portal, under each website)

Status: **built on Staging; migration 0028 applied to Staging; dormant until credentials and per-website settings exist.** It needs two sets of server credentials. Until then the client page does not exist and the Website page does not offer it; nothing else changes.

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

## Credentials: Worker secrets, never in the database or the repository
| Name | Kind | Purpose |
| --- | --- | --- |
| `CF_ANALYTICS_API_TOKEN` | secret | Cloudflare API token, **Account > Account Analytics > Read** only |
| `CF_ANALYTICS_ACCOUNT_ID` | plain variable | the Cloudflare account id (32 hex characters) |
| `GSC_SERVICE_ACCOUNT_JSON` | secret | the whole key file of a Google service account |
Admin sees only whether each is present (a green "Server ready"), plus the service account's email (needed to add it in Search Console; not a secret). Errors are short codes (`unauthorized`, `property_not_found`, `rate_limited`, `query_failed`, `unreachable`): no key, token, tag or response text is ever logged, stored or shown to a client.

## Owner checklist
1. ~~Approve migration 0028~~ **Done on Staging** (applied after a Time Travel bookmark; tables verified). Production: only through the manual workflow, later, after its own approval.
2. **Cloudflare**: create an API token (Account Analytics: Read, limited to the account); add `CF_ANALYTICS_API_TOKEN` as a Worker secret and `CF_ANALYTICS_ACCOUNT_ID` as a variable on Staging. In Cloudflare, enable **Web Analytics** for each client website (adds a small snippet; for a client's own site the client or their host adds it) and copy the site's tag.
3. **Google**: create a Google Cloud project, enable the **Search Console API**, create a service account and a JSON key (no cost); add the key as the `GSC_SERVICE_ACCOUNT_JSON` secret. For each client website, have the property verified in Search Console and add the service account's email under Settings, Users and permissions as a **Restricted** (read-only) user.
4. **Admin**: Clients, the client, Website, the website card, **Analytics**: enter the site tag and property, Save, then **Test** each. The client sees a source as soon as its setting is saved and the server credentials exist.
5. After the secrets exist, add their names to `scripts/ops/staging-expected.json` (`secrets.optional`, `plainVars`) so the health check knows them.

## Verification status
Verified: the GraphQL query against Cloudflare's live schema (dataset, dimensions, filters, types; a query for a non-existent site tag returned an empty, error-free answer); the request shapes, parsing, errors, caching, tenant isolation, page states and routes by automated tests against mocked provider answers; the page in a browser at desktop, iPad and phone widths. **Not verified until credentials exist:** a real read from either provider (Search Console in particular has not been called at all).
