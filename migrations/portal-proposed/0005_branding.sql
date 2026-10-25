-- PROPOSED, NOT APPLIED ON ANY ENVIRONMENT. Lives outside migrations/portal on purpose: `wrangler d1 migrations apply` only reads migrations/portal, so nothing
-- can apply this file until it is moved there after explicit approval (same procedure as 0004). See worker/portal/BRANDING-FILES.md.
--
-- Branding: official deliverables published by Framework, files submitted by clients, and service requests. Four ADDITIVE tables, no change to any existing table.
-- Every table is scoped by organization_id (ON DELETE RESTRICT: an organization with brand data cannot be deleted by accident). File CONTENT is never stored
-- here: it lives in the private R2 bucket (binding PORTAL_FILES) under the key in storage_key; the database holds metadata only. Original filenames are
-- stored as data (sanitised) and never used in a storage key or a path.
--
--   brand_kits        one row per organization: draft/published status for the whole kit, plus colours and typography (small validated JSON documents)
--   brand_assets      Framework-delivered files (logos, guidelines, documents, fonts, packages). A client sees a row only when the kit AND the asset are published
--   brand_uploads     files a client submitted. Never shown as a deliverable; Admin can hold one back
--   service_requests  "Request a quote" for a service. Generic on purpose (service_key) so other areas can reuse it. One open request per organization and service

CREATE TABLE IF NOT EXISTS brand_kits (
  organization_id TEXT PRIMARY KEY REFERENCES organizations (id) ON DELETE RESTRICT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  colours_json    TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(colours_json) AND json_type(colours_json) = 'array' AND length(colours_json) <= 8000),
  typography_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(typography_json) AND json_type(typography_json) = 'array' AND length(typography_json) <= 12000),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by      TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 254),
  published_at    TEXT,
  published_by    TEXT CHECK (published_by IS NULL OR length(published_by) BETWEEN 1 AND 254),
  CHECK ((status = 'published') = (published_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS brand_assets (
  id              TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  kind            TEXT NOT NULL CHECK (kind IN ('logo', 'guideline', 'document', 'font', 'package', 'other')),
  title           TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  variant_key     TEXT CHECK (variant_key IS NULL OR (length(variant_key) BETWEEN 1 AND 60 AND variant_key NOT GLOB '*[^a-z0-9-]*')),  -- groups the formats of one logo variant
  logo_role       TEXT CHECK (logo_role IS NULL OR logo_role IN ('primary', 'simplified', 'icon')),
  orientation     TEXT CHECK (orientation IS NULL OR orientation IN ('horizontal', 'vertical', 'square')),
  tone            TEXT CHECK (tone IS NULL OR tone IN ('light', 'dark', 'colour', 'mono')),
  transparent     INTEGER NOT NULL DEFAULT 0 CHECK (transparent IN (0, 1)),
  usage_note      TEXT CHECK (usage_note IS NULL OR length(usage_note) <= 300),
  downloadable    INTEGER NOT NULL DEFAULT 1 CHECK (downloadable IN (0, 1)),               -- fonts: 0 unless the licence allows sharing the file
  license_note    TEXT CHECK (license_note IS NULL OR length(license_note) <= 300),
  format          TEXT NOT NULL CHECK (length(format) BETWEEN 1 AND 8 AND format NOT GLOB '*[^a-z0-9]*'),
  content_type    TEXT NOT NULL CHECK (length(content_type) BETWEEN 3 AND 100),            -- decided by the server from the file's content, never by the browser
  size_bytes      INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256          TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  storage_key     TEXT NOT NULL UNIQUE CHECK (length(storage_key) BETWEEN 40 AND 200),
  original_name   TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 120),
  published       INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  sort_order      INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 10000),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by      TEXT NOT NULL CHECK (length(created_by) BETWEEN 1 AND 254),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at      TEXT,                                                                    -- tombstone: the R2 object is deleted at once, the row stays for the audit trail
  UNIQUE (id, organization_id)
);
CREATE INDEX IF NOT EXISTS idx_brand_assets_org ON brand_assets (organization_id, deleted_at, kind, sort_order);

CREATE TABLE IF NOT EXISTS brand_uploads (
  id               TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id  TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  category         TEXT NOT NULL CHECK (category IN ('logo', 'fonts', 'colours', 'guidelines', 'stationery', 'signature', 'other')),
  original_name    TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 120),
  format           TEXT NOT NULL CHECK (length(format) BETWEEN 1 AND 8 AND format NOT GLOB '*[^a-z0-9]*'),
  content_type     TEXT NOT NULL CHECK (length(content_type) BETWEEN 3 AND 100),
  size_bytes       INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256           TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  storage_key      TEXT NOT NULL UNIQUE CHECK (length(storage_key) BETWEEN 40 AND 200),
  uploaded_by      TEXT NOT NULL REFERENCES portal_users (id) ON DELETE RESTRICT,
  font_rights_ack  INTEGER NOT NULL DEFAULT 0 CHECK (font_rights_ack IN (0, 1)),
  status           TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'held')),  -- held: Admin has set it aside; nobody can download it until it is released
  admin_seen_at    TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at       TEXT,
  deleted_by       TEXT CHECK (deleted_by IS NULL OR length(deleted_by) BETWEEN 1 AND 254),
  UNIQUE (id, organization_id),
  CHECK (category <> 'fonts' OR font_rights_ack = 1)                                        -- font files are only accepted with the rights confirmation
);
CREATE INDEX IF NOT EXISTS idx_brand_uploads_org ON brand_uploads (organization_id, deleted_at, created_at DESC);

CREATE TABLE IF NOT EXISTS service_requests (
  id                 TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id    TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  service_key        TEXT NOT NULL CHECK (length(service_key) BETWEEN 2 AND 60 AND service_key NOT GLOB '*[^a-z0-9-]*'),
  status             TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'closed', 'declined')),
  note               TEXT CHECK (note IS NULL OR length(note) <= 1000),
  requested_by       TEXT NOT NULL REFERENCES portal_users (id) ON DELETE RESTRICT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  handled_by         TEXT CHECK (handled_by IS NULL OR length(handled_by) BETWEEN 1 AND 254),
  handled_at         TEXT,
  admin_note         TEXT CHECK (admin_note IS NULL OR length(admin_note) <= 1000),
  UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_requests_open ON service_requests (organization_id, service_key) WHERE status IN ('new', 'contacted');
CREATE INDEX IF NOT EXISTS idx_service_requests_org ON service_requests (organization_id, created_at DESC);
