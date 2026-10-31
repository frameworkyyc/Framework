-- Website progress and status, and the SEO & Search Visibility subsection of Website.
-- PROPOSED, NOT APPLIED anywhere. Staging first, after approval; Production follows the manual Production workflow after its own approval.
-- Additive only: one nullable column on websites and four new tables. Nothing that exists is changed or removed (no UPDATE, no DELETE, no table rebuild).
--
--   websites.phase        Refines the existing `status` WITHOUT changing it: for an in_development website NULL means "In development", 'awaiting_feedback' means Awaiting Client Feedback and
--                         'awaiting_approval' means Awaiting Approval; for a live website NULL means "Live" and 'maintenance' means Maintenance. The Worker only accepts the pairings that make sense
--                         (the old CHECKs on `status` stay exactly as they are, which is why this is a new column and not a new status value). Every existing row stays NULL: nothing changes for it.
--                         The progress bar of an in-development website is NOT stored: it is computed from website_milestones (migration 0011), which already exists.
--   website_seo           One row per website: the SEO status (not started, in progress, optimised, monitoring), a short summary, and whether the client may see it.
--   website_seo_items     The checklist and the recommendations of a website (kind), each with a status and, for a recommendation, a priority.
--   website_seo_reports   Written reports (a period, a title, a summary and an optional https link to the full report, e.g. a shared document). No file is stored.
--   website_seo_metrics   Search visibility figures for a period (impressions, clicks, average position, indexed pages). `source` says where they came from: 'manual' today (Admin types them),
--                         'search_console' reserved for a future Google Search Console import, so that import can later fill the SAME table without a schema change. Nothing is imported now.
-- Everything belongs to a website of the SAME organization (composite foreign key). Clients only ever read what Admin has published.
ALTER TABLE websites ADD COLUMN phase TEXT CHECK (phase IS NULL OR phase IN ('awaiting_feedback', 'awaiting_approval', 'maintenance'));

CREATE TABLE IF NOT EXISTS website_seo (
  website_id      TEXT PRIMARY KEY CHECK (length(website_id) = 36),
  organization_id TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'optimised', 'monitoring')),
  summary         TEXT CHECK (summary IS NULL OR length(summary) BETWEEN 1 AND 1000),
  published       INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  updated_at      TEXT NOT NULL,
  updated_by      TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 254),
  FOREIGN KEY (website_id, organization_id) REFERENCES websites (id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS website_seo_items (
  id              TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  website_id      TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('checklist', 'recommendation')),
  title           TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  detail          TEXT CHECK (detail IS NULL OR length(detail) BETWEEN 1 AND 500),
  status          TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  priority        TEXT CHECK (priority IS NULL OR priority IN ('high', 'medium', 'low')),
  sort_order      INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 9999),
  completed_at    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 254),
  FOREIGN KEY (website_id, organization_id) REFERENCES websites (id, organization_id) ON DELETE RESTRICT,
  CHECK ((status = 'done') = (completed_at IS NOT NULL)),
  CHECK (kind = 'recommendation' OR priority IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_website_seo_items_site ON website_seo_items (website_id, kind, sort_order, created_at);

CREATE TABLE IF NOT EXISTS website_seo_reports (
  id              TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  website_id      TEXT NOT NULL,
  title           TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  period_label    TEXT CHECK (period_label IS NULL OR length(period_label) BETWEEN 1 AND 40),
  summary         TEXT CHECK (summary IS NULL OR length(summary) BETWEEN 1 AND 1000),
  link_url        TEXT CHECK (link_url IS NULL OR (length(link_url) BETWEEN 12 AND 300 AND link_url LIKE 'https://%' AND link_url NOT GLOB '*[ <>"''\\]*')),
  published       INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 254),
  FOREIGN KEY (website_id, organization_id) REFERENCES websites (id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_website_seo_reports_site ON website_seo_reports (website_id, created_at);

CREATE TABLE IF NOT EXISTS website_seo_metrics (
  id              TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  website_id      TEXT NOT NULL,
  period_start    TEXT NOT NULL CHECK (period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  period_end      TEXT NOT NULL CHECK (period_end GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND period_end >= period_start),
  source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'search_console')),
  impressions     INTEGER CHECK (impressions IS NULL OR impressions BETWEEN 0 AND 2000000000),
  clicks          INTEGER CHECK (clicks IS NULL OR clicks BETWEEN 0 AND 2000000000),
  avg_position    REAL CHECK (avg_position IS NULL OR (avg_position >= 1 AND avg_position <= 1000)),
  indexed_pages   INTEGER CHECK (indexed_pages IS NULL OR indexed_pages BETWEEN 0 AND 10000000),
  note            TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 300),
  published       INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  updated_at      TEXT NOT NULL,
  updated_by      TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 254),
  FOREIGN KEY (website_id, organization_id) REFERENCES websites (id, organization_id) ON DELETE RESTRICT,
  UNIQUE (website_id, period_start, period_end, source)
);
CREATE INDEX IF NOT EXISTS idx_website_seo_metrics_site ON website_seo_metrics (website_id, period_end);
