-- 0024 (leads): the Leads workspace in Framework Admin: prospects imported from the separate finder Worker, their contacts and consent status, the drafted and sent emails, and a timeline.
-- Applied to Staging. Not applied to Production: Production only through the manual
-- "Portal Production D1 migration" workflow, after its own approval. (The file name is distinct from 0022_seo_keywords.sql, also proposed: both can wait side by side.)
--
-- Five additive tables and eight indexes. Nothing existing changes. Needs 0021 (demo_links): an approved lead gets one tracking link.
-- Until this is applied every public and Admin path degrades gracefully: Admin -> Leads says "not set up: migration 0024", /u/<token> and the
-- delivery webhook do nothing. The finder database is never written to; it is only read (worker/leads.js).
-- What is NOT stored: email bodies or recipient addresses in outreach_events (the timeline holds short, address-free notes only).
CREATE TABLE IF NOT EXISTS outreach_leads (
  id             TEXT PRIMARY KEY CHECK (length(id) = 16),                          -- 16 hex characters
  source         TEXT NOT NULL CHECK (source IN ('finder', 'manual')),
  source_ref     TEXT,                                                              -- the finder's place_id
  dedupe_key     TEXT NOT NULL UNIQUE,                                              -- website host without "www." for a real site, else lower(name)|lower(city)
  name           TEXT NOT NULL,
  trade          TEXT,
  city           TEXT,
  address        TEXT,
  website        TEXT,
  maps_url       TEXT,
  rating         REAL,
  review_count   INTEGER,
  last_review_at TEXT,
  site_status    TEXT,
  site_score     INTEGER,
  site_issues    TEXT,                                                              -- JSON array of strings
  reason         TEXT NOT NULL,                                                     -- why this business is a prospect, built from the data
  status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'approved', 'ready', 'contacted', 'replied', 'won', 'dismissed')),
  dismiss_reason TEXT,
  demo_link_id   TEXT REFERENCES demo_links (id) ON DELETE SET NULL,
  notes          TEXT,
  next_action_note TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  approved_at    TEXT,
  dismissed_at   TEXT,
  contacted_at   TEXT,
  replied_at     TEXT,
  won_at         TEXT
);

CREATE TABLE IF NOT EXISTS outreach_contacts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id          TEXT NOT NULL REFERENCES outreach_leads (id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN ('email', 'phone')),
  value            TEXT NOT NULL,                                                   -- emails lower-cased
  source           TEXT NOT NULL CHECK (source IN ('finder', 'manual')),
  source_url       TEXT,                                                            -- where the address is published (CASL conspicuous publication)
  eligibility      TEXT NOT NULL CHECK (eligibility IN ('eligible', 'review', 'blocked')),
  eligibility_note TEXT,
  found_at         TEXT,
  opted_out_at     TEXT,
  UNIQUE (lead_id, type, value)
);

CREATE TABLE IF NOT EXISTS outreach_suppressions (
  email  TEXT PRIMARY KEY,                                                          -- lower-case
  reason TEXT NOT NULL CHECK (reason IN ('optout', 'bounce', 'complaint', 'manual')),
  at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outreach_messages (
  id           TEXT PRIMARY KEY CHECK (length(id) = 16),
  lead_id      TEXT NOT NULL REFERENCES outreach_leads (id) ON DELETE CASCADE,
  contact_id   INTEGER,
  to_email     TEXT,
  kind         TEXT NOT NULL CHECK (kind IN ('first', 'followup')),
  approach     TEXT,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,                                                       -- the editable body WITHOUT the compliance footer
  status       TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'sending', 'sent', 'failed', 'bounced', 'complained')),
  content_hash TEXT,                                                                -- sha-256 hex over to_email, subject, body and footer text, set when the owner approves
  is_test      INTEGER NOT NULL DEFAULT 0,
  provider_id  TEXT,
  error        TEXT,
  created_at   TEXT NOT NULL,
  edited_at    TEXT,
  approved_at  TEXT,
  sent_at      TEXT,
  delivered_at TEXT,
  failed_at    TEXT
);

CREATE TABLE IF NOT EXISTS outreach_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL REFERENCES outreach_leads (id) ON DELETE CASCADE,
  at      TEXT NOT NULL,
  type    TEXT NOT NULL CHECK (type IN ('imported', 'approved', 'dismissed', 'reopened', 'draft', 'edited', 'email_approved', 'email_unapproved', 'sent', 'test_sent', 'delivered', 'failed', 'bounced', 'complained', 'replied', 'opted_out', 'won', 'note', 'contact_added', 'contact_confirmed', 'followup_drafted')),
  detail  TEXT CHECK (detail IS NULL OR length(detail) <= 300)                      -- never an email body or a recipient address
);

-- A lead can have only one live (non-test) message per kind: a second first email can never be sent, and there is at most one follow-up.
CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_leads_source_ref ON outreach_leads (source_ref) WHERE source_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_messages_live ON outreach_messages (lead_id, kind) WHERE is_test = 0 AND status IN ('approved', 'sending', 'sent', 'bounced', 'complained');
CREATE INDEX IF NOT EXISTS idx_outreach_leads_status ON outreach_leads (status);
CREATE INDEX IF NOT EXISTS idx_outreach_leads_updated ON outreach_leads (updated_at);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_lead ON outreach_messages (lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_provider ON outreach_messages (provider_id);
CREATE INDEX IF NOT EXISTS idx_outreach_events_lead ON outreach_events (lead_id, at);
CREATE INDEX IF NOT EXISTS idx_outreach_contacts_lead ON outreach_contacts (lead_id);
