-- Migration 0018: Discovery assessments (Brand Discovery, and later Website and Marketing Discovery).
-- PROPOSED. Not applied anywhere. It needs the approval described in CLAUDE.md (show it, wait for approval, Staging first, Production only through the manual workflow).
--
-- ADDITIVE ONLY: five new tables and their indexes. No existing table, column, row or index is touched, and nothing is deleted or rewritten.
-- Why it is needed: nothing today can hold an assessment, a guest link, saved answers, Admin edits to the questions, or a recipient's inspiration files.
--   * discovery_assessments : one assessment per organization and kind; status Not started / In progress / Submitted / Reviewed. `kind` is validated in code
--                             ("brand" now; "website" and "marketing" later) so new kinds need no migration.
--   * discovery_links       : secure invitation links. Only the SHA-256 of the token is stored (the token itself is shown once, at creation); each link expires and can be revoked.
--   * discovery_answers     : what the recipient picked, one row per question: {"mode","like":[],"dislike":[]} plus an optional comment.
--   * discovery_content     : the Admin's changes to the built-in questions and options (reworded, hidden, reordered, added), and an optional reference picture per option.
--                             Nothing is stored for content nobody has changed. option_key '' means the question itself.
--   * discovery_uploads     : inspiration files the recipient adds (private R2 under org/<id>/discovery/).
-- Discovery preferences never touch brand_kits, brand_assets or brand_requirements: there is no foreign key to them and no code path that writes to them.
-- Reference pictures are stored under the existing reserved catalogue organization (area "catalogue"), exactly like Additional Services pictures.

CREATE TABLE IF NOT EXISTS discovery_assessments (
  id              TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  kind            TEXT NOT NULL CHECK (length(kind) BETWEEN 2 AND 30 AND kind NOT GLOB '*[^a-z-]*'),
  title           TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  recipient_name  TEXT CHECK (recipient_name IS NULL OR length(recipient_name) <= 120),
  status          TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'submitted', 'reviewed')),
  stage           INTEGER NOT NULL DEFAULT 1 CHECK (stage BETWEEN 1 AND 20),          -- where the recipient left off
  overall_comment TEXT CHECK (overall_comment IS NULL OR length(overall_comment) <= 1000),
  review_note     TEXT CHECK (review_note IS NULL OR length(review_note) <= 2000),
  created_at      TEXT NOT NULL,
  created_by      TEXT NOT NULL CHECK (length(created_by) BETWEEN 1 AND 254),
  updated_at      TEXT NOT NULL,
  started_at      TEXT,
  submitted_at    TEXT,
  reviewed_at     TEXT,
  reviewed_by     TEXT CHECK (reviewed_by IS NULL OR length(reviewed_by) BETWEEN 1 AND 254),
  archived_at     TEXT,
  UNIQUE (id, organization_id),
  CHECK ((status IN ('submitted', 'reviewed')) = (submitted_at IS NOT NULL)),
  CHECK ((status = 'reviewed') = (reviewed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_discovery_assessments_org ON discovery_assessments (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS discovery_links (
  id            TEXT PRIMARY KEY CHECK (length(id) = 36),
  assessment_id TEXT NOT NULL REFERENCES discovery_assessments (id) ON DELETE RESTRICT,
  token_hash    TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 43),                  -- base64url SHA-256 of the token; the token is never stored
  label         TEXT CHECK (label IS NULL OR length(label) <= 80),
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT,
  revoked_by    TEXT CHECK (revoked_by IS NULL OR length(revoked_by) BETWEEN 1 AND 254),
  created_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL CHECK (length(created_by) BETWEEN 1 AND 254),
  last_used_at  TEXT,
  use_count     INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_discovery_links_assessment ON discovery_links (assessment_id);

CREATE TABLE IF NOT EXISTS discovery_answers (
  assessment_id TEXT NOT NULL REFERENCES discovery_assessments (id) ON DELETE RESTRICT,
  question_key  TEXT NOT NULL CHECK (length(question_key) BETWEEN 1 AND 60 AND question_key NOT GLOB '*[^a-z0-9.-]*'),
  picks_json    TEXT CHECK (picks_json IS NULL OR (json_valid(picks_json) AND length(picks_json) <= 4000)),
  comment       TEXT CHECK (comment IS NULL OR length(comment) <= 500),
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (assessment_id, question_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS discovery_content (
  id           TEXT PRIMARY KEY CHECK (length(id) = 36),
  kind         TEXT NOT NULL CHECK (length(kind) BETWEEN 2 AND 30 AND kind NOT GLOB '*[^a-z-]*'),
  item_key     TEXT NOT NULL CHECK (length(item_key) BETWEEN 1 AND 60 AND item_key NOT GLOB '*[^a-z0-9.-]*'),   -- the question
  option_key   TEXT NOT NULL CHECK (option_key = '' OR (length(option_key) BETWEEN 1 AND 40 AND option_key NOT GLOB '*[^a-z0-9-]*')),
  label        TEXT CHECK (label IS NULL OR length(label) BETWEEN 1 AND 120),
  description  TEXT CHECK (description IS NULL OR length(description) <= 240),
  enabled      INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sort_order   INTEGER CHECK (sort_order IS NULL OR sort_order BETWEEN 0 AND 9999),
  is_custom    INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0, 1)),
  image_key    TEXT UNIQUE CHECK (image_key IS NULL OR length(image_key) BETWEEN 40 AND 200),
  image_type   TEXT CHECK (image_type IS NULL OR image_type IN ('png', 'jpg', 'webp')),
  image_sha256 TEXT CHECK (image_sha256 IS NULL OR (length(image_sha256) = 64 AND image_sha256 NOT GLOB '*[^0-9a-f]*')),
  image_size   INTEGER CHECK (image_size IS NULL OR image_size BETWEEN 1 AND 5242880),
  image_alt    TEXT CHECK (image_alt IS NULL OR length(image_alt) <= 160),
  updated_by   TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 254),
  updated_at   TEXT NOT NULL,
  UNIQUE (kind, item_key, option_key),
  CHECK ((image_key IS NULL) = (image_sha256 IS NULL) AND (image_key IS NULL) = (image_type IS NULL) AND (image_key IS NULL) = (image_size IS NULL))
);

CREATE TABLE IF NOT EXISTS discovery_uploads (
  id              TEXT PRIMARY KEY CHECK (length(id) = 36),
  assessment_id   TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  original_name   TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 200),
  format          TEXT NOT NULL CHECK (length(format) BETWEEN 1 AND 8 AND format NOT GLOB '*[^a-z0-9]*'),
  content_type    TEXT NOT NULL CHECK (length(content_type) BETWEEN 3 AND 100),
  size_bytes      INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 52428800),
  sha256          TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  storage_key     TEXT NOT NULL UNIQUE CHECK (length(storage_key) BETWEEN 40 AND 200),
  created_at      TEXT NOT NULL,
  deleted_at      TEXT,
  deleted_by      TEXT CHECK (deleted_by IS NULL OR length(deleted_by) BETWEEN 1 AND 254),
  FOREIGN KEY (assessment_id, organization_id) REFERENCES discovery_assessments (id, organization_id) ON DELETE RESTRICT,
  CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_discovery_uploads_assessment ON discovery_uploads (assessment_id, created_at);
