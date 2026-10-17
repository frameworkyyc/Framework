-- ============================================================================================================
-- FRAMEWORK STAGING DATABASE: complete starting schema for a NEW, EMPTY database (framework-staging).
--
--   ONLY run this in the D1 console of the database named  framework-staging.
--   NEVER run it against framework-feedback (Production). It creates tables and adds no customer data, but it
--   is meant for an empty database.
--
-- It is migrations 0001 to 0005 in order, plus a marker row that lets Framework Admin prove which database a
-- deployment is really connected to. The marker is written only if the database has no Framework tables yet, so
-- this file cannot label an existing (populated) database as "staging".
-- The Worker also creates/upgrades these tables by itself on first use; this file just makes the starting point
-- explicit and identical to Production's structure. Statements are safe to repeat except the two ALTERs
-- ("duplicate column name" on a second run is harmless: everything before it has already been applied).
-- ============================================================================================================

-- 0. Environment marker (first, so it can see whether the database is still empty)
CREATE TABLE IF NOT EXISTS framework_environment (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO framework_environment (key, value)
  SELECT 'environment', 'staging'
  WHERE NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name IN ('feedback_responses', 'assessment_requests', 'client_revenue'));

-- 0001 ------------------------------------------------------------------------
-- Optional: the Worker creates this table itself on first use (CREATE TABLE IF NOT EXISTS).
-- Keep in sync with SCHEMA in worker/index.js.
CREATE TABLE IF NOT EXISTS feedback_responses (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  form_version TEXT NOT NULL,
  satisfaction INTEGER NOT NULL,
  rating_visual_design INTEGER NOT NULL,
  rating_ease_of_use INTEGER NOT NULL,
  rating_mobile_experience INTEGER NOT NULL,
  rating_accuracy INTEGER NOT NULL,
  rating_professionalism INTEGER NOT NULL,
  rating_communication INTEGER NOT NULL,
  rating_overall_product INTEGER NOT NULL,
  improvement TEXT NOT NULL,
  impact TEXT NOT NULL,
  impact_other TEXT,
  fair_price TEXT NOT NULL,
  recommend INTEGER NOT NULL,
  revenue TEXT,
  liked TEXT NOT NULL,
  could_improve TEXT,
  testimonial TEXT,
  testimonial_permission TEXT NOT NULL,
  attribution_name TEXT,
  attribution_title TEXT,
  attribution_business TEXT,
  logo_permission TEXT NOT NULL,
  services TEXT NOT NULL,
  services_other TEXT,
  comments TEXT
);

-- 0002 ------------------------------------------------------------------------
-- Framework Admin: lets you mark a feedback response as reviewed.
-- Adds one nullable column; existing rows and the public form are unaffected (NULL = not yet reviewed).
-- Run ONCE. SQLite has no "ADD COLUMN IF NOT EXISTS", so a second run fails harmlessly with "duplicate column name".
-- The admin works without this column (the Reviewed controls just stay hidden) and notices it within ~30 seconds
-- of the migration being applied.
ALTER TABLE feedback_responses ADD COLUMN reviewed_at TEXT;

-- 0003 ------------------------------------------------------------------------
-- Private client revenue figures behind the homepage "Combined annual client revenue" total.
-- One row per client: the lower bound of the annual revenue they agreed to share, in CAD.
-- The public site only ever sees the rounded-down SUM (GET /api/client-revenue); never these rows.
CREATE TABLE IF NOT EXISTS client_revenue (
  client_id  TEXT PRIMARY KEY,
  revenue    INTEGER NOT NULL CHECK (revenue > 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 0004 ------------------------------------------------------------------------
-- Free Online Presence Assessment requests (POST /api/assessment). The Worker also creates this table on first
-- use, so running this file is optional; it is here so the schema is documented and can be applied up front.
-- Holds personal information: keep it private and delete requests you no longer need.
CREATE TABLE IF NOT EXISTS assessment_requests (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  business_name TEXT, website TEXT, contact_name TEXT, email TEXT, location TEXT, industry TEXT,
  phone TEXT, services TEXT, service_area TEXT, profiles TEXT, concern TEXT, additional_info TEXT,
  privacy_ack INTEGER NOT NULL DEFAULT 0,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  tracking TEXT, landing TEXT, referrer TEXT,
  ip_hash TEXT,
  notify_status TEXT NOT NULL DEFAULT 'pending',   -- sent | failed | skipped (email not configured)
  confirm_status TEXT NOT NULL DEFAULT 'pending'
);

-- 0005 ------------------------------------------------------------------------
-- Delivery tracking for assessment requests: why a notification email did not go out, and when it finally did.
-- The Worker applies this automatically the first time it touches the table (ensureAssessmentSchema), so running
-- this file is optional. SQLite has no "ADD COLUMN IF NOT EXISTS": a second run fails harmlessly with "duplicate column name".
ALTER TABLE assessment_requests ADD COLUMN notify_error TEXT;
ALTER TABLE assessment_requests ADD COLUMN notified_at TEXT;
ALTER TABLE assessment_requests ADD COLUMN notify_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assessment_requests ADD COLUMN confirm_error TEXT;
UPDATE assessment_requests SET notify_status = 'not_configured' WHERE notify_status = 'skipped';
UPDATE assessment_requests SET confirm_status = 'not_configured' WHERE confirm_status = 'skipped';

