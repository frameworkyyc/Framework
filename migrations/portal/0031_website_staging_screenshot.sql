-- 0031 (website Staging screenshot): PROPOSED. Not applied anywhere. Needs 0011 (websites).
-- Staging: only after review and approval, after a Time Travel bookmark. Production: only through the manual "Portal Production D1 migration" workflow, after its own approval.
--
-- Six nullable columns on `websites`, a second set that mirrors the existing screenshot_* columns (migration 0011), for the picture of the STAGING site.
-- The Staging site is often password protected, so it cannot be captured automatically: Framework uploads the picture by hand in Admin.
-- Nothing existing changes and no row is rewritten: the Production screenshot_* columns and every stored Production screenshot stay exactly as they are, and every website
-- starts with NULL in all six (no Staging picture yet). Same rules as the Production set: the six values are set together or all empty (enforced by the Worker, because SQLite cannot
-- add a table-level CHECK with ADD COLUMN), the object itself is one private file in the files bucket, and no storage key ever reaches a client.
-- Until this migration is applied the Worker treats the Staging picture as "not available": Admin shows a plain notice, the client Preview card shows its neutral panel, and nothing else changes.
-- (SQLite cannot ADD COLUMN ... UNIQUE; the key is a random object name, and the Worker never reuses one.)
ALTER TABLE websites ADD COLUMN staging_screenshot_key    TEXT CHECK (staging_screenshot_key IS NULL OR length(staging_screenshot_key) BETWEEN 40 AND 200);
ALTER TABLE websites ADD COLUMN staging_screenshot_name   TEXT CHECK (staging_screenshot_name IS NULL OR length(staging_screenshot_name) BETWEEN 1 AND 120);
ALTER TABLE websites ADD COLUMN staging_screenshot_format TEXT CHECK (staging_screenshot_format IS NULL OR (length(staging_screenshot_format) BETWEEN 1 AND 8 AND staging_screenshot_format NOT GLOB '*[^a-z0-9]*'));
ALTER TABLE websites ADD COLUMN staging_screenshot_type   TEXT CHECK (staging_screenshot_type IS NULL OR length(staging_screenshot_type) BETWEEN 3 AND 100);
ALTER TABLE websites ADD COLUMN staging_screenshot_size   INTEGER CHECK (staging_screenshot_size IS NULL OR staging_screenshot_size >= 0);
ALTER TABLE websites ADD COLUMN staging_screenshot_sha256 TEXT CHECK (staging_screenshot_sha256 IS NULL OR (length(staging_screenshot_sha256) = 64 AND staging_screenshot_sha256 NOT GLOB '*[^0-9a-f]*'));
