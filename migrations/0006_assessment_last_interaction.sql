-- Adds the date of the last meaningful interaction to assessment requests (used by the manual 24-month retention review).
-- Additive and safe: one new NULLable column. No existing row is changed (NULL = "none recorded"; retention reviews then use
-- created_at, the original submission time, which is never altered).
-- The Worker applies this automatically the first time it touches the table (Staging and Production alike), so running
-- this file is optional. SQLite has no "ADD COLUMN IF NOT EXISTS": a second run fails harmlessly with "duplicate column name".
ALTER TABLE assessment_requests ADD COLUMN last_interaction_at TEXT;
