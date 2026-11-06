-- 0021: private traffic reporting for the demo landing page (/demos/): opaque tracking links, anonymous journeys and their events.
-- PROPOSED. Not applied anywhere. Show for review and wait for approval before applying it to Staging; Production only through the manual
-- "Portal Production D1 migration" workflow, after its own approval.
--
-- Three additive tables. Nothing existing changes. No IP address and no user-agent string is stored: only a coarse country, a device class,
-- a bot flag and a short reason. A link visit shows WHICH LINK was used, not who visited. Shown only in the authenticated Admin area.
-- Until this is applied the Worker drops events silently and /d/<token> still redirects (worker/demo-traffic.js).
-- Retention: rows older than 180 days are purged by the Worker (worker/DEMO-TRAFFIC.md).
CREATE TABLE IF NOT EXISTS demo_links (
  id         TEXT PRIMARY KEY CHECK (length(id) = 16),          -- 16 hex characters: the random id bytes (the public token is derived from it, never stored)
  label      TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 120), -- private prospect label, Admin only
  note       TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS demo_journeys (
  id            TEXT PRIMARY KEY CHECK (length(id) = 22),       -- random, 22-character base64url; held in the visitor's page, not a cookie
  link_id       TEXT REFERENCES demo_links (id) ON DELETE CASCADE, -- set only by /d/<token>; NULL for direct visits
  source        TEXT NOT NULL CHECK (source IN ('link', 'direct')),
  first_seen_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  country       TEXT,
  device        TEXT CHECK (device IN ('mobile', 'tablet', 'desktop', 'other')),
  bot           INTEGER NOT NULL DEFAULT 0,
  bot_reason    TEXT,
  human         INTEGER NOT NULL DEFAULT 0,                      -- 1 once a real interaction was seen from a non-bot request
  discipline    TEXT,
  vibe          TEXT,
  colour        TEXT,
  company       TEXT,
  demo_opens    INTEGER NOT NULL DEFAULT 0,
  enquired      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS demo_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  journey_id TEXT NOT NULL REFERENCES demo_journeys (id) ON DELETE CASCADE,
  at         TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('link_open', 'view', 'active', 'discipline', 'vibe', 'colour', 'company', 'open', 'enquiry')),
  value      TEXT CHECK (value IS NULL OR length(value) <= 80),
  bot        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_demo_events_journey ON demo_events (journey_id, at);
CREATE INDEX IF NOT EXISTS idx_demo_events_at ON demo_events (at);
CREATE INDEX IF NOT EXISTS idx_demo_journeys_link ON demo_journeys (link_id);
CREATE INDEX IF NOT EXISTS idx_demo_journeys_last_seen ON demo_journeys (last_seen_at);
