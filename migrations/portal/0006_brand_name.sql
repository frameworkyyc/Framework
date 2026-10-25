-- Branding: an optional brand name used when file names are generated (instead of the organization's full name). Staging first; NOT applied to Production,
-- which follows the manual Production workflow after its own approval (that workflow's expected list deliberately does not know 0005 or 0006).
-- One additive, nullable column on brand_kits. Existing rows get NULL, which means "use the organization's name": nothing existing changes, and no existing file is renamed.
ALTER TABLE brand_kits ADD COLUMN brand_name TEXT CHECK (brand_name IS NULL OR length(brand_name) BETWEEN 1 AND 60);
