-- Websites: the foundation for the Client Portal Website section (Phase 1: the database and Framework Admin; nothing is shown to clients yet).
-- PROPOSED, NOT APPLIED anywhere. Staging first, after approval; Production follows the manual Production workflow after its own approval. See worker/portal/WEBSITES.md.
-- Additive only: two new tables and one nullable column, nothing existing is changed or removed.
--
--   websites           One row per website of a client (a client can have several). "No website" is NOT stored: it is simply a client with no rows.
--                      status (existing | in_development | live) says where the website is; managed_by_framework is a separate yes/no, so a client's own live website that Framework
--                      does not manage, and a live website that it does, are different rows of the same status. `origin` says who built it. Domain and hosting facts are plain
--                      information (provider, who owns it, renewal date): never a password or login. The optional screenshot is one private object in the files bucket (all
--                      screenshot_* columns are set together or all empty). `published` controls whether the client may see the website once the Website section is switched on.
--   website_milestones The development milestones of a website (title, status, due date, order). Used by the Admin editor and the client's progress view in later phases.
--   support_requests.website_id
--                      A website change request can name the website it is about. Nullable (every existing request stays NULL); the Worker only accepts a website of the same
--                      organization, and the foreign key stops a website that has requests from being removed.
CREATE TABLE IF NOT EXISTS websites (
  id                  TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id     TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  name                TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  url                 TEXT CHECK (url IS NULL OR (length(url) BETWEEN 8 AND 300 AND (url LIKE 'https://%' OR url LIKE 'http://%') AND url NOT GLOB '*[ <>"''\\]*')),
  origin              TEXT NOT NULL CHECK (origin IN ('framework', 'client')),
  status              TEXT NOT NULL CHECK (status IN ('existing', 'in_development', 'live')),
  managed_by_framework INTEGER NOT NULL DEFAULT 0 CHECK (managed_by_framework IN (0, 1)),
  launch_date         TEXT CHECK (launch_date IS NULL OR launch_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  domain_registrar    TEXT CHECK (domain_registrar IS NULL OR length(domain_registrar) <= 120),
  domain_owner        TEXT NOT NULL DEFAULT 'unknown' CHECK (domain_owner IN ('framework', 'client', 'unknown')),
  domain_renewal      TEXT CHECK (domain_renewal IS NULL OR domain_renewal GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  hosting_provider    TEXT CHECK (hosting_provider IS NULL OR length(hosting_provider) <= 120),
  hosting_owner       TEXT NOT NULL DEFAULT 'unknown' CHECK (hosting_owner IN ('framework', 'client', 'unknown')),
  hosting_renewal     TEXT CHECK (hosting_renewal IS NULL OR hosting_renewal GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  management_notes    TEXT CHECK (management_notes IS NULL OR length(management_notes) <= 1000),
  screenshot_key      TEXT UNIQUE CHECK (screenshot_key IS NULL OR length(screenshot_key) BETWEEN 40 AND 200),
  screenshot_name     TEXT CHECK (screenshot_name IS NULL OR length(screenshot_name) BETWEEN 1 AND 120),
  screenshot_format   TEXT CHECK (screenshot_format IS NULL OR (length(screenshot_format) BETWEEN 1 AND 8 AND screenshot_format NOT GLOB '*[^a-z0-9]*')),
  screenshot_type     TEXT CHECK (screenshot_type IS NULL OR length(screenshot_type) BETWEEN 3 AND 100),
  screenshot_size     INTEGER CHECK (screenshot_size IS NULL OR screenshot_size >= 0),
  screenshot_sha256   TEXT CHECK (screenshot_sha256 IS NULL OR (length(screenshot_sha256) = 64 AND screenshot_sha256 NOT GLOB '*[^0-9a-f]*')),
  published           INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  sort_order          INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 9999),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by          TEXT CHECK (updated_by IS NULL OR length(updated_by) BETWEEN 1 AND 254),
  archived_at         TEXT,
  UNIQUE (id, organization_id),
  CHECK (status = 'in_development' OR url IS NOT NULL),                      -- an existing or live website has an address; one still being built may not yet
  CHECK (status <> 'in_development' OR origin = 'framework'),               -- Framework is the one building it
  CHECK ((screenshot_key IS NULL) = (screenshot_name IS NULL) AND (screenshot_key IS NULL) = (screenshot_format IS NULL) AND (screenshot_key IS NULL) = (screenshot_type IS NULL)
         AND (screenshot_key IS NULL) = (screenshot_size IS NULL) AND (screenshot_key IS NULL) = (screenshot_sha256 IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_websites_org ON websites (organization_id, archived_at, sort_order, created_at);

CREATE TABLE IF NOT EXISTS website_milestones (
  id              TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  website_id      TEXT NOT NULL,
  title           TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  detail          TEXT CHECK (detail IS NULL OR length(detail) <= 500),
  status          TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  due_date        TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  sort_order      INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 9999),
  completed_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by      TEXT CHECK (updated_by IS NULL OR length(updated_by) BETWEEN 1 AND 254),
  FOREIGN KEY (website_id, organization_id) REFERENCES websites (id, organization_id) ON DELETE RESTRICT,
  UNIQUE (id, organization_id),
  CHECK ((status = 'done') = (completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_website_milestones_site ON website_milestones (website_id, sort_order, created_at);

ALTER TABLE support_requests ADD COLUMN website_id TEXT REFERENCES websites (id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_support_requests_website ON support_requests (website_id) WHERE website_id IS NOT NULL;

-- The four website services join the central service pricing editor (migration 0010's service_prices), each defaulting to a custom quote (no amount). Existing rows are untouched.
INSERT OR IGNORE INTO service_prices (service_key, price_type, price_cad, updated_by, updated_at) VALUES
  ('website-design', 'custom_quote', NULL, 'migration 0011', '2026-10-29T00:00:00.000Z'),
  ('website-redesign', 'custom_quote', NULL, 'migration 0011', '2026-10-29T00:00:00.000Z'),
  ('website-seo', 'custom_quote', NULL, 'migration 0011', '2026-10-29T00:00:00.000Z'),
  ('website-maintenance', 'custom_quote', NULL, 'migration 0011', '2026-10-29T00:00:00.000Z');
