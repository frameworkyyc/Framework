-- 0030 (website review workspace): PROPOSED. Not applied anywhere. Needs 0011 (websites) and 0001 (activity_log).
-- Staging: only after review and approval, after a Time Travel bookmark. Production: only through the manual "Portal Production D1 migration" workflow, after its own approval.
--
-- Additive only: one nullable column and two new tables. No UPDATE, no DELETE, no table rebuild; no existing row changes (every website keeps NULL in staging_url).
--
--   websites.staging_url   The https address of the website's Staging (review) version. Nullable: NULL means "no staging address yet", and the client page shows the Staging card as "Not set up yet".
--
--   website_updates        What Framework changed, published to the client for a look. kind 'approval' needs the client's decision (awaiting_review -> approved | rejected, a rejection always carries the
--                          client's revision notes); kind 'info' is informational only. A draft (published = 0) is invisible to the client. Admin can ask for another review after a rejection (status goes back to
--                          awaiting_review); every decision is also written to activity_log, so the earlier rejection reasons stay on record.
--   website_tasks          What Framework needs from the client (a photo, a logo, a service description, an approval of copy). cta says what the client does about it: 'upload' (opens the existing change
--                          request form, which accepts files), 'respond' (a short written answer on the page), 'review' (a written answer after looking at Staging), 'none' (just so they know). The client's
--                          answer sets status 'submitted'; Admin then marks it 'done' or reopens it. Unpublished tasks are invisible to the client.
--
-- Both tables are tied to their website AND organization by a composite key (a row can never name another organization's website), and are read by the Worker only with organization_id in every statement.

ALTER TABLE websites ADD COLUMN staging_url TEXT CHECK (staging_url IS NULL OR (length(staging_url) BETWEEN 8 AND 300 AND staging_url LIKE 'https://%' AND staging_url NOT GLOB '*[ <>"''\\]*'));

CREATE TABLE IF NOT EXISTS website_updates (
  id               TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id  TEXT NOT NULL,
  website_id       TEXT NOT NULL,
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  detail           TEXT CHECK (detail IS NULL OR length(detail) <= 600),
  environment      TEXT NOT NULL DEFAULT 'staging' CHECK (environment IN ('staging', 'production')),
  kind             TEXT NOT NULL DEFAULT 'approval' CHECK (kind IN ('approval', 'info')),
  status           TEXT NOT NULL DEFAULT 'awaiting_review' CHECK (status IN ('awaiting_review', 'approved', 'rejected', 'info')),
  decision_note    TEXT CHECK (decision_note IS NULL OR length(decision_note) <= 1000),
  decided_at       TEXT,
  decided_by       TEXT CHECK (decided_by IS NULL OR length(decided_by) BETWEEN 1 AND 254),
  published        INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  published_at     TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by       TEXT CHECK (updated_by IS NULL OR length(updated_by) BETWEEN 1 AND 254),
  archived_at      TEXT,
  FOREIGN KEY (website_id, organization_id) REFERENCES websites (id, organization_id) ON DELETE RESTRICT,
  UNIQUE (id, organization_id),
  CHECK ((kind = 'info') = (status = 'info')),                                   -- informational updates have no decision; approval updates always do
  CHECK ((status IN ('approved', 'rejected')) = (decided_at IS NOT NULL)),        -- a decision has a time
  CHECK (status <> 'rejected' OR (decision_note IS NOT NULL AND length(decision_note) >= 3)),  -- a rejection always says why
  CHECK ((published = 1) = (published_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_website_updates_site ON website_updates (website_id, published, archived_at, created_at DESC);

CREATE TABLE IF NOT EXISTS website_tasks (
  id               TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id  TEXT NOT NULL,
  website_id       TEXT NOT NULL,
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  detail           TEXT CHECK (detail IS NULL OR length(detail) <= 600),
  cta              TEXT NOT NULL DEFAULT 'respond' CHECK (cta IN ('upload', 'respond', 'review', 'none')),
  due_date         TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'done', 'cancelled')),
  response_text    TEXT CHECK (response_text IS NULL OR length(response_text) <= 1000),
  responded_at     TEXT,
  responded_by     TEXT CHECK (responded_by IS NULL OR length(responded_by) BETWEEN 1 AND 254),
  published        INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  published_at     TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by       TEXT CHECK (updated_by IS NULL OR length(updated_by) BETWEEN 1 AND 254),
  archived_at      TEXT,
  FOREIGN KEY (website_id, organization_id) REFERENCES websites (id, organization_id) ON DELETE RESTRICT,
  UNIQUE (id, organization_id),
  CHECK (status <> 'submitted' OR (response_text IS NOT NULL AND responded_at IS NOT NULL)),
  CHECK ((published = 1) = (published_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_website_tasks_site ON website_tasks (website_id, published, archived_at, status, due_date);
