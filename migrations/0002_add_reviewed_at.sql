-- Framework Admin: lets you mark a feedback response as reviewed.
-- Adds one nullable column; existing rows and the public form are unaffected (NULL = not yet reviewed).
-- Run ONCE. SQLite has no "ADD COLUMN IF NOT EXISTS", so a second run fails harmlessly with "duplicate column name".
-- The admin works without this column (the Reviewed controls just stay hidden) and notices it within ~30 seconds
-- of the migration being applied.
ALTER TABLE feedback_responses ADD COLUMN reviewed_at TEXT;
