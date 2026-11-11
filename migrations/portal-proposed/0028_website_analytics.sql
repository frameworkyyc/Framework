-- 0028 (website analytics): "Analytics" under each client's Website page. PROPOSED. Not applied anywhere: show it for review, then Staging only after approval;
-- Production only through the manual "Portal Production D1 migration" workflow, after its own approval. Needs 0011 (websites).
--
-- Two additive tables. Nothing existing changes. NO credentials are stored here: the Cloudflare API token and the Google service account key are Worker secrets.
--   website_analytics        one row per website: WHICH Cloudflare Web Analytics site (its 32-character site tag) and WHICH Google Search Console property to read.
--                            No row, or an empty column, means that source is not connected for the website (the client sees a setup message, never invented numbers).
--   website_analytics_cache  the last answer from each source for each website and period (7, 30 or 90 days): aggregated figures only, so the portal does not call the
--                            providers on every page view. `ref` is the site tag or property the answer was read for; an answer for a different one is never used.
-- Every statement names organization_id, and a row can only exist for a website of that organization (composite foreign key, as for website_seo).
-- Until it is applied the client Analytics section and the Admin panel stay dormant, and the rest of the Website section works as before.
CREATE TABLE IF NOT EXISTS website_analytics (
  website_id      TEXT PRIMARY KEY CHECK (length(website_id) = 36),
  organization_id TEXT NOT NULL,
  cf_site_tag     TEXT CHECK (cf_site_tag IS NULL OR (length(cf_site_tag) = 32 AND cf_site_tag NOT GLOB '*[^0-9a-f]*')),
  gsc_property    TEXT CHECK (gsc_property IS NULL OR (length(gsc_property) BETWEEN 10 AND 200 AND (gsc_property LIKE 'sc-domain:%' OR gsc_property LIKE 'https://%'))),
  updated_at      TEXT NOT NULL,
  updated_by      TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 254),
  FOREIGN KEY (website_id, organization_id) REFERENCES websites (id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS website_analytics_cache (
  website_id      TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('cloudflare', 'search_console')),
  range_days      INTEGER NOT NULL CHECK (range_days IN (7, 30, 90)),
  ref             TEXT NOT NULL CHECK (length(ref) BETWEEN 1 AND 200),
  payload         TEXT NOT NULL CHECK (length(payload) BETWEEN 2 AND 100000),
  fetched_at      TEXT NOT NULL,
  PRIMARY KEY (website_id, source, range_days),
  FOREIGN KEY (website_id, organization_id) REFERENCES websites (id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_website_analytics_cache_org ON website_analytics_cache (organization_id, website_id);
