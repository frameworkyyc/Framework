# SEO monitoring: how it works today, and what live ranking needs

The client's SEO page (`/portal/o/<slug>/seo`, behind `PORTAL_REQUESTS`) opens with **Search performance**, then **Keyword rankings**, then **Connections**. It shows only stored, verified data and says where each figure came from. Nothing is estimated, imported or invented anywhere in this code.

## Two different measurements (the page says so to clients)

| | What it is | Where it comes from | Shown as |
| --- | --- | --- | --- |
| **Search performance** (clicks, impressions, average position) | Google's own totals for the site over a period. *Average position* averages every search, place and device where the site appeared. | Google Search Console. Today Framework types the figures in Admin (`website_seo_metrics.source = 'manual'`); an import would fill the same table with `source = 'search_console'`. | "Entered by Framework" or "Google Search Console" tag, change from the previous period, trend charts |
| **Keyword ranking** | The position of the site for ONE search phrase in ONE place on ONE day. | A rank check. Today Framework looks it up and records it (`seo_rank_checks.source = 'manual'`). An automatic checker would write `source = 'provider'`. | "#7", change since the previous check, "Checked Nov 2, 2026 by Framework", and "Not checked yet" until a check exists |

Search Console cannot answer "where do I rank for *fences and decks* in *Calgary*": it has no per-location position for one query. A true local rank needs a SERP lookup made from that location.

## What is built (Staging)

- Dashboard with setup states: no figures gives a plain "not connected yet" panel and a button to ask Framework to set it up; one period shows the figures and says trends need a second; two or more show the change (words and arrows, never colour alone) and charts. Sources are never mixed into one line.
- Keyword + place tracking: owners add and stop tracking (max 20 per organization, duplicates refused, case ignored); members can see. "Stop tracking" archives; the history stays.
- Admin records checks per keyword (Admin, Websites, SEO details, Keyword rankings): date, position 1 to 200 or empty for "not found in the results checked", optional page. A check cannot be dated in the future. Mistaken checks can be removed. Everything is audited.
- Migration **0022_seo_keywords.sql** (two additive tables) is applied to Staging; Production only by the manual workflow. Without it the page says keyword tracking is being set up and shows no form; the rest of SEO works.

> **Update:** live Search Console figures (and Cloudflare Web Analytics traffic) are now built as the separate Analytics page under each website, read on demand through the APIs and cached, not imported into `website_seo_metrics`. See `WEBSITE-ANALYTICS.md`. The section below is the earlier plan for a monthly import and is kept for reference.

## Google Search Console: how it is connected (built for Website Analytics; see WEBSITE-ANALYTICS.md)

Framework signs in to Google **once, as a dedicated Google account**, with an OAuth refresh token (scope `webmasters.readonly`). No service account key is used: the organisation policy `iam.managed.disableServiceAccountKeyCreation` blocks them, and a refresh token is the simplest secure alternative.
1. Framework uses one Google Cloud project with the Search Console API on and an OAuth client. No cost.
2. The OAuth client id and secret and the refresh token are Worker secrets (`GSC_OAUTH_CLIENT_ID`, `GSC_OAUTH_CLIENT_SECRET`, `GSC_OAUTH_REFRESH_TOKEN`). Never in the repository.
3. For each website the client adds that Google account under Search Console, Settings, Users and permissions as a *Restricted* (read-only) user. Framework records the property (for example `sc-domain:example.com`): this needs one small migration (a property column on `websites` or a `seo_connections` table).
4. A scheduled Worker (Cron Trigger, no extra cost) calls `searchanalytics.query` once a month (or weekly) and upserts a row into `website_seo_metrics` with `source = 'search_console'`, `published = 1`. The dashboard already renders it and labels it.
5. Search Console data lags by about two to three days and only covers verified properties. A client without a Search Console property needs one created and verified first (a DNS record or an HTML tag).

Later alternative: per-client Google OAuth ("Connect with Google"), which is better self-service but needs Google's OAuth consent-screen verification and encrypted refresh-token storage in the database.

## Location-specific rank tracking: options and cost (not built, needs approval)

A rank provider adapter is the clean seam: one module with `check({ keyword, location, domain, country, device }) -> { position|null, url }`, called by a scheduled job, writing `seo_rank_checks` rows with `source = 'provider'`. Candidates are SERP APIs with geo-targeting (for example DataForSEO, SerpApi, ValueSERP, Zenserp) or a rank-tracking product with an API (for example BrightLocal). They are paid per lookup or per plan; **confirm current pricing before choosing** (this document does not quote prices). Cost scales as keywords x places x checks per month, so a cap per organization (already 20 keywords) and a weekly cadence keep it predictable. Local-pack and Maps rank (Google Business Profile) are separate lookups some providers charge differently for.

Decisions this needs from the owner:
1. Which provider (or none: keep Framework recording ranks by hand).
2. Who pays: included in Ongoing monthly SEO, or an add-on price per keyword. No price is invented in the portal.
3. Credentials: an API key as a Worker secret, added by the owner.
4. Check cadence (weekly recommended) and the keyword cap per client.
5. Terms: wording for what a "rank" means (a snapshot from one location at one time; Google results vary by person and device).

## Safety properties (tested)

Every statement names `organization_id`; another organization's website, keyword or check is "not found". Only owners change tracked keywords (`seo.keywords`). Clients cannot write a rank. Admin writes need Cloudflare Access, `PORTAL_ADMIN_WRITES`, same origin. The dashboard builds no inline style or script.
