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
- Migration **0021_seo_keywords.sql** (two additive tables) is **proposed, not applied**. Until it is applied the page says keyword tracking is being set up and shows no form; the rest of SEO works.

## Google Search Console: the practical architecture (not built, needs approval)

Recommended first step: a **service account** that each client adds as a *Restricted* user on their Search Console property.
1. Framework creates one Google Cloud project, enables the Search Console API, creates a service account. No cost.
2. The service account's JSON key is stored as a Worker secret (for example `GSC_SERVICE_ACCOUNT_JSON`). Never in the repository.
3. For each website the client adds the service account's email under Search Console, Settings, Users and permissions (read-only). Framework records the property (for example `sc-domain:example.com`): this needs one small migration (a property column on `websites` or a `seo_connections` table).
4. A scheduled Worker (Cron Trigger, no extra cost) calls `searchanalytics.query` once a month (or weekly) and upserts a row into `website_seo_metrics` with `source = 'search_console'`, `published = 1`. The dashboard already renders it and labels it.
5. Search Console data lags by about two to three days and only covers verified properties. A client without a Search Console property needs one created and verified first (a DNS record or an HTML tag).

Later alternative: per-client Google OAuth ("Connect with Google"), which is better self-service but needs Google's OAuth consent-screen verification and encrypted refresh-token storage.

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
