-- 0020: the unified request engine (Deliverables, SEO services, Custom Development, and, in Phase 2, website and support requests).
-- PROPOSED. Not applied anywhere. Show for review and wait for approval before applying it to Staging; Production only through the manual
-- "Portal Production D1 migration" workflow, after its own approval.
--
-- Additive only: five new tables and one nullable column. No existing table, row or constraint changes, and nothing is copied or moved.
-- Support requests stay in support_requests / support_messages / support_attachments untouched; Phase 2 copies them into this model and the old tables are frozen,
-- never dropped without approval. `kind` already allows 'website' and 'support' so that copy needs no schema change.
--
--   requests               one row per request; the same lifecycle for every kind:
--                          new -> in_review -> quoted -> approved -> in_progress -> client_review -> completed
--                          plus revision_requested (a client asked for changes), declined and cancelled.
--   request_events         the append-only timeline: messages, status changes, quotes, proofs, revisions, approvals, deliveries and private staff notes.
--   request_files          reference files and attachments (client or staff), design proofs and final files (staff only), with versions and an optional preview image.
--   request_quotes         a quote: version, amount in cents (CAD), scope, validity and decision. Amounts are typed by staff; nothing is calculated.
--   request_type_settings  per-service settings Admin can change: enabled, revisions included, fixed price or custom quote, turnaround note.
--   invoices.request_id    nullable link from an invoice to the request it bills (deposits and online payments will build on this).
--
-- Every table is scoped by organization_id (ON DELETE RESTRICT) and rows are addressed by (id, organization_id), like every other portal table.

CREATE TABLE IF NOT EXISTS requests (
  id                  TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id     TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  kind                TEXT NOT NULL CHECK (kind IN ('deliverable', 'seo', 'development', 'website', 'support')),
  type_key            TEXT NOT NULL CHECK (length(type_key) BETWEEN 2 AND 60 AND type_key NOT GLOB '*[^a-z0-9_]*'),
  title               TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  status              TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_review', 'quoted', 'approved', 'in_progress', 'client_review', 'revision_requested', 'completed', 'declined', 'cancelled')),
  details_json        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json) AND json_type(details_json) = 'object' AND length(details_json) <= 12000),
  brand_snapshot_json TEXT CHECK (brand_snapshot_json IS NULL OR (json_valid(brand_snapshot_json) AND json_type(brand_snapshot_json) = 'object' AND length(brand_snapshot_json) <= 8000)),
  website_id          TEXT,
  needed_by           TEXT CHECK (needed_by IS NULL OR needed_by GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  revisions_included  INTEGER NOT NULL DEFAULT 2 CHECK (revisions_included BETWEEN 0 AND 20),   -- copied from the service's setting when the request is made
  revisions_paid      INTEGER NOT NULL DEFAULT 0 CHECK (revisions_paid BETWEEN 0 AND 20),        -- extra rounds Framework has agreed with the client (the hook for paid revisions)
  revisions_used      INTEGER NOT NULL DEFAULT 0 CHECK (revisions_used >= 0),                    -- rounds the client has asked for so far
  submitted_by        TEXT NOT NULL REFERENCES portal_users (id) ON DELETE RESTRICT,
  created_at          TEXT NOT NULL,
  status_changed_at   TEXT NOT NULL,
  last_message_at     TEXT NOT NULL,
  last_message_by     TEXT NOT NULL DEFAULT 'client' CHECK (last_message_by IN ('client', 'staff')),
  client_read_at      TEXT,
  admin_seen_at       TEXT,
  completed_at        TEXT,
  UNIQUE (id, organization_id),
  FOREIGN KEY (website_id, organization_id) REFERENCES websites (id, organization_id) ON DELETE RESTRICT,
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_requests_org ON requests (organization_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests (status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS request_events (
  id              TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  request_id      TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('message', 'status', 'quote', 'proof', 'revision', 'approval', 'delivery')),
  author_type     TEXT NOT NULL CHECK (author_type IN ('client', 'staff')),
  author_user_id  TEXT REFERENCES portal_users (id) ON DELETE RESTRICT,
  author_label    TEXT CHECK (author_label IS NULL OR length(author_label) BETWEEN 1 AND 254),
  visibility      TEXT NOT NULL DEFAULT 'client' CHECK (visibility IN ('client', 'internal')),
  body            TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
  status_to       TEXT CHECK (status_to IS NULL OR status_to IN ('new', 'in_review', 'quoted', 'approved', 'in_progress', 'client_review', 'revision_requested', 'completed', 'declined', 'cancelled')),
  ref_id          TEXT CHECK (ref_id IS NULL OR length(ref_id) = 36),                          -- the quote or file this event is about
  created_at      TEXT NOT NULL,
  FOREIGN KEY (request_id, organization_id) REFERENCES requests (id, organization_id) ON DELETE RESTRICT,
  UNIQUE (id, organization_id),
  CHECK (author_type = 'staff' OR visibility = 'client'),
  CHECK (author_type <> 'client' OR author_user_id IS NOT NULL),
  CHECK (author_type <> 'staff' OR author_label IS NOT NULL),
  CHECK (kind <> 'status' OR status_to IS NOT NULL),
  CHECK (kind NOT IN ('quote', 'proof', 'delivery') OR author_type = 'staff')
);
CREATE INDEX IF NOT EXISTS idx_request_events_request ON request_events (organization_id, request_id, created_at);

CREATE TABLE IF NOT EXISTS request_files (
  id              TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  request_id      TEXT NOT NULL,
  event_id        TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('reference', 'attachment', 'proof', 'final')),
  version         INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),                              -- proofs: 1, 2, 3 ...
  round           INTEGER NOT NULL DEFAULT 0 CHECK (round >= 0),                                -- the revision round a proof belongs to (0 = first design)
  original_name   TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 120),
  format          TEXT NOT NULL CHECK (length(format) BETWEEN 1 AND 8 AND format NOT GLOB '*[^a-z0-9]*'),
  content_type    TEXT NOT NULL CHECK (length(content_type) BETWEEN 3 AND 100),
  size_bytes      INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256          TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  storage_key     TEXT NOT NULL UNIQUE CHECK (length(storage_key) BETWEEN 40 AND 200),
  preview_key     TEXT UNIQUE CHECK (preview_key IS NULL OR length(preview_key) BETWEEN 40 AND 200),   -- an image shown in the portal for a proof that is not itself an image (a PDF)
  preview_format  TEXT CHECK (preview_format IS NULL OR (length(preview_format) BETWEEN 1 AND 8 AND preview_format NOT GLOB '*[^a-z0-9]*')),
  preview_type    TEXT CHECK (preview_type IS NULL OR length(preview_type) BETWEEN 3 AND 100),
  preview_size    INTEGER CHECK (preview_size IS NULL OR preview_size >= 0),
  preview_sha256  TEXT CHECK (preview_sha256 IS NULL OR (length(preview_sha256) = 64 AND preview_sha256 NOT GLOB '*[^0-9a-f]*')),
  uploader_type   TEXT NOT NULL CHECK (uploader_type IN ('client', 'staff')),
  created_at      TEXT NOT NULL,
  FOREIGN KEY (request_id, organization_id) REFERENCES requests (id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (event_id, organization_id) REFERENCES request_events (id, organization_id) ON DELETE RESTRICT,
  UNIQUE (id, organization_id),
  CHECK (role IN ('reference', 'attachment') OR uploader_type = 'staff'),
  CHECK ((preview_key IS NULL) = (preview_format IS NULL) AND (preview_key IS NULL) = (preview_type IS NULL) AND (preview_key IS NULL) = (preview_size IS NULL) AND (preview_key IS NULL) = (preview_sha256 IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_request_files_request ON request_files (organization_id, request_id, role, version);

CREATE TABLE IF NOT EXISTS request_quotes (
  id              TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  request_id      TEXT NOT NULL,
  version         INTEGER NOT NULL CHECK (version >= 1),
  title           TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  scope           TEXT NOT NULL CHECK (length(scope) BETWEEN 1 AND 2000),                       -- what is included, in words; shown to the client
  amount_cents    INTEGER NOT NULL CHECK (amount_cents BETWEEN 0 AND 100000000000),
  currency        TEXT NOT NULL DEFAULT 'CAD' CHECK (currency = 'CAD'),
  tax_cents       INTEGER CHECK (tax_cents IS NULL OR tax_cents BETWEEN 0 AND 100000000000),    -- reserved: stays empty until tax treatment is decided
  tax_label       TEXT CHECK (tax_label IS NULL OR length(tax_label) BETWEEN 1 AND 40),
  valid_until     TEXT CHECK (valid_until IS NULL OR valid_until GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status          TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'accepted', 'declined', 'superseded', 'withdrawn')),
  created_by      TEXT NOT NULL CHECK (length(created_by) BETWEEN 1 AND 254),
  created_at      TEXT NOT NULL,
  decided_at      TEXT,
  decided_by      TEXT REFERENCES portal_users (id) ON DELETE RESTRICT,                         -- the client who accepted or declined in the portal
  decided_via     TEXT CHECK (decided_via IS NULL OR decided_via IN ('portal', 'staff_record')),  -- 'staff_record': Framework recorded an agreement made outside the portal
  accepted_name   TEXT CHECK (accepted_name IS NULL OR length(accepted_name) BETWEEN 1 AND 120), -- the name typed at acceptance
  terms_version   TEXT CHECK (terms_version IS NULL OR length(terms_version) BETWEEN 1 AND 40),  -- which published terms were accepted (empty until terms exist)
  FOREIGN KEY (request_id, organization_id) REFERENCES requests (id, organization_id) ON DELETE RESTRICT,
  UNIQUE (id, organization_id),
  UNIQUE (request_id, version),
  CHECK ((status IN ('accepted', 'declined')) = (decided_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_request_quotes_request ON request_quotes (organization_id, request_id, version);

CREATE TABLE IF NOT EXISTS request_type_settings (
  type_key           TEXT PRIMARY KEY CHECK (length(type_key) BETWEEN 2 AND 60 AND type_key NOT GLOB '*[^a-z0-9_]*'),
  enabled            INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  revisions_included INTEGER CHECK (revisions_included IS NULL OR revisions_included BETWEEN 0 AND 20),   -- empty = the default of two
  pricing_mode       TEXT NOT NULL DEFAULT 'quote' CHECK (pricing_mode IN ('quote', 'fixed')),
  fixed_price_cents  INTEGER CHECK (fixed_price_cents IS NULL OR fixed_price_cents BETWEEN 0 AND 100000000000),
  turnaround_note    TEXT CHECK (turnaround_note IS NULL OR length(turnaround_note) BETWEEN 1 AND 120),
  updated_by         TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 254),
  updated_at         TEXT NOT NULL,
  CHECK (pricing_mode = 'fixed' OR fixed_price_cents IS NULL),
  CHECK (pricing_mode <> 'fixed' OR fixed_price_cents IS NOT NULL)
);

-- A nullable pointer from an invoice to the request it bills. No foreign key (SQLite cannot add one to an existing column's table this way without a rebuild); the Worker only
-- ever sets it to a request of the SAME organization, and an index keeps the lookup cheap.
ALTER TABLE invoices ADD COLUMN request_id TEXT CHECK (request_id IS NULL OR length(request_id) = 36);
CREATE INDEX IF NOT EXISTS idx_invoices_request ON invoices (request_id) WHERE request_id IS NOT NULL;
