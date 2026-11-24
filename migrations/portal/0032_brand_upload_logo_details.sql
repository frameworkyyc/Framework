-- 0032 (logo details on client uploads): additive. Needs 0005 (brand_uploads).
-- Three NULLABLE columns on `brand_uploads` that describe a logo file a client uploaded from Branding > Logos: its type (Primary / full logo, Secondary, Simplified, Sub-mark, Other),
-- its colour (Full colour, Light, Dark) and its background (Transparent, Solid). All three are optional: a client may upload a logo without choosing any of them, and every
-- existing row keeps NULL in all three (nothing is rewritten, no file moves). They only describe a file; they never replace one, so several files of the same type are normal.
-- Until this migration is applied the Worker saves logo uploads without the details and the library shows them without the labels; nothing else changes.
ALTER TABLE brand_uploads ADD COLUMN logo_type       TEXT CHECK (logo_type IS NULL OR logo_type IN ('primary', 'secondary', 'simplified', 'submark', 'other'));
ALTER TABLE brand_uploads ADD COLUMN logo_colour     TEXT CHECK (logo_colour IS NULL OR logo_colour IN ('full', 'light', 'dark'));
ALTER TABLE brand_uploads ADD COLUMN logo_background TEXT CHECK (logo_background IS NULL OR logo_background IN ('transparent', 'solid'));
