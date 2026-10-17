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
