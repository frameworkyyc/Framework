-- ============================================================================================================
-- FRAMEWORK STAGING DATABASE: idempotent starting schema (framework-staging).
--
--   ONLY run this in the D1 console of the database named  framework-staging.
--   NEVER run it against framework-feedback (Production).
--
-- Every statement is CREATE TABLE IF NOT EXISTS or an INSERT OR IGNORE: there is no ALTER, DROP, DELETE or UPDATE,
-- so it can be run on an empty database, on one where the Worker has already created some tables (it creates
-- assessment_requests itself the first time the admin page loads), and any number of times. It never changes or
-- removes existing tables or rows.
--
-- The tables below are the FINAL structure, i.e. migrations 0001 to 0005 combined (feedback_responses already
-- includes reviewed_at; assessment_requests already includes the email-delivery tracking columns).
-- If a table already exists with an older structure, this file leaves it alone and the Worker upgrades it in
-- place the next time it is used.
--
-- The last statement writes a marker row that Framework Admin shows as "Database environment: staging". It is
-- written only while the database holds NO feedback, assessment or revenue rows, so it can never label a
-- populated database (such as Production) as staging.
-- ============================================================================================================

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
  comments TEXT,
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS client_revenue (
  client_id  TEXT PRIMARY KEY,
  revenue    INTEGER NOT NULL CHECK (revenue > 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS assessment_requests (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  business_name TEXT, website TEXT, contact_name TEXT, email TEXT, location TEXT, industry TEXT,
  phone TEXT, services TEXT, service_area TEXT, profiles TEXT, concern TEXT, additional_info TEXT,
  privacy_ack INTEGER NOT NULL DEFAULT 0,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  tracking TEXT, landing TEXT, referrer TEXT,
  ip_hash TEXT,
  notify_status TEXT NOT NULL DEFAULT 'pending',
  confirm_status TEXT NOT NULL DEFAULT 'pending',
  notify_error TEXT,
  notified_at TEXT,
  notify_attempts INTEGER NOT NULL DEFAULT 0,
  confirm_error TEXT
);

CREATE TABLE IF NOT EXISTS framework_environment (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO framework_environment (key, value)
  SELECT 'environment', 'staging'
  WHERE NOT EXISTS (SELECT 1 FROM feedback_responses)
    AND NOT EXISTS (SELECT 1 FROM assessment_requests)
    AND NOT EXISTS (SELECT 1 FROM client_revenue);
