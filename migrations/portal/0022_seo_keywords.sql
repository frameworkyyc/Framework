-- 0022: tracked keywords and their rank checks (SEO monitoring).
-- PROPOSED. Not applied anywhere. Show for review and wait for approval before applying it to Staging; Production only through the manual
-- "Portal Production D1 migration" workflow, after its own approval.
--
-- Additive only: two new tables. No existing table, row or constraint changes, and nothing is copied or moved.
--
--   seo_keywords      a keyword a client wants to rank for, with an optional target place ("Calgary, Alberta"), for one of their websites. "Removing" one archives it
--                     (archived_at); its checks are kept. At most one live row per website, keyword and place (case ignored).
--   seo_rank_checks   one verified result for one keyword on one day: the position (1 to 200) or NULL for "not found in the results that were checked", the page that ranked,
--                     and where the result came from: 'manual' (Framework looked it up and typed it) or 'provider' (reserved for an automatic rank checker, which does not exist yet).
--                     Nothing is ever estimated: a keyword with no check row has no ranking, and the portal says so.
--
-- Every row is scoped by organization_id (ON DELETE RESTRICT) and addressed by (id, organization_id), like every other portal table.

CREATE TABLE IF NOT EXISTS seo_keywords (
  id              TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  website_id      TEXT NOT NULL,
  keyword         TEXT NOT NULL CHECK (length(keyword) BETWEEN 2 AND 80),
  location        TEXT NOT NULL DEFAULT '' CHECK (length(location) <= 80),
  created_by      TEXT NOT NULL CHECK (length(created_by) BETWEEN 1 AND 254),
  created_at      TEXT NOT NULL,
  archived_at     TEXT,
  UNIQUE (id, organization_id),
  FOREIGN KEY (website_id, organization_id) REFERENCES websites (id, organization_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_keywords_live ON seo_keywords (website_id, lower(keyword), lower(location)) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_seo_keywords_org ON seo_keywords (organization_id, website_id);

CREATE TABLE IF NOT EXISTS seo_rank_checks (
  id              TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  keyword_id      TEXT NOT NULL,
  checked_on      TEXT NOT NULL CHECK (checked_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  position        INTEGER CHECK (position IS NULL OR position BETWEEN 1 AND 200),
  result_url      TEXT CHECK (result_url IS NULL OR (length(result_url) BETWEEN 12 AND 300 AND result_url LIKE 'https://%' AND result_url NOT GLOB '*[ <>"''\\]*')),
  source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'provider')),
  note            TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 300),
  recorded_by     TEXT NOT NULL CHECK (length(recorded_by) BETWEEN 1 AND 254),
  created_at      TEXT NOT NULL,
  UNIQUE (keyword_id, checked_on, source),
  FOREIGN KEY (keyword_id, organization_id) REFERENCES seo_keywords (id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_seo_rank_checks_kw ON seo_rank_checks (organization_id, keyword_id, checked_on);
