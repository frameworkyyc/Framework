-- ============================================================================================================
-- PRODUCTION (framework-feedback): OPTIONAL pre-creation of the assessment table.
--
-- You do not have to run this. The Worker creates (and, if ever needed, upgrades) assessment_requests by itself the
-- first time the assessment form or Admin > Assessments uses it. Run it only if you want the table to exist before
-- launch so you can check it from the D1 console.
--
-- It is a single CREATE TABLE IF NOT EXISTS: it adds one new table and never alters, updates, deletes or overwrites
-- anything that already exists (feedback_responses, client_revenue and their rows are not touched).
-- Run it in the D1 console of framework-feedback ONLY after reading the read-only checks in the launch checklist.
-- ============================================================================================================

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
