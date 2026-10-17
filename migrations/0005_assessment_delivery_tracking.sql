-- Delivery tracking for assessment requests: why a notification email did not go out, and when it finally did.
-- The Worker applies this automatically the first time it touches the table (ensureAssessmentSchema), so running
-- this file is optional. SQLite has no "ADD COLUMN IF NOT EXISTS": a second run fails harmlessly with "duplicate column name".
ALTER TABLE assessment_requests ADD COLUMN notify_error TEXT;
ALTER TABLE assessment_requests ADD COLUMN notified_at TEXT;
ALTER TABLE assessment_requests ADD COLUMN notify_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assessment_requests ADD COLUMN confirm_error TEXT;
UPDATE assessment_requests SET notify_status = 'not_configured' WHERE notify_status = 'skipped';
UPDATE assessment_requests SET confirm_status = 'not_configured' WHERE confirm_status = 'skipped';
