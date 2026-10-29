-- Branding: short text sections of a brand kit (today the tagline: primary, alternates, usage guidelines). Approved; applied to Staging. Production: only by the manual Production workflow. See worker/portal/BRANDING-FILES.md.
-- One additive, nullable column on brand_kits holding a small JSON object, for example {"tagline":{"primary":"...","alternates":["..."],"guidelines":"..."}}.
-- Existing rows get NULL, which means "nothing added": nothing existing changes. The Worker works with or without this column (it reads the row with SELECT *, and saving a
-- tagline without the column is refused with a clear message), so the code can be deployed before the migration. Room is left for other short sections later (limit 12000 characters).
ALTER TABLE brand_kits ADD COLUMN sections_json TEXT CHECK (sections_json IS NULL OR (json_valid(sections_json) AND json_type(sections_json) = 'object' AND length(sections_json) <= 12000));
