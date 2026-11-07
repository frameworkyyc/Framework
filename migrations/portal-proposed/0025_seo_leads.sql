-- 0025 (seo leads): Admin Leads finds businesses by SEO opportunity. PROPOSED. Not applied anywhere. Show for review and wait for approval before applying it to
-- Staging; Production only through the manual "Portal Production D1 migration" workflow, after its own approval. Needs 0024 (outreach_leads).
--
-- Four additive, nullable columns on outreach_leads. No new table, nothing existing changes, every existing lead, note, approval and timeline row is kept as it is.
--   seo_score        the SEO Opportunity Score (0-100), computed in Admin from the stored snapshot; NULL = not assessed or not enough measured data
--   seo_data         the finder's measured snapshot (JSON: Maps position, on-page facts, PageSpeed, competitors, optional organic rank) used to build the report and emails
--   seo_assessed_at  when the snapshot was measured
--   site_verified_at set when the owner marks the website as working by hand; the automatic website check then leaves it alone
-- Until this is applied the SEO parts of Admin -> Leads stay dormant (leads keep working exactly as before).
ALTER TABLE outreach_leads ADD COLUMN seo_score INTEGER;
ALTER TABLE outreach_leads ADD COLUMN seo_data TEXT;
ALTER TABLE outreach_leads ADD COLUMN seo_assessed_at TEXT;
ALTER TABLE outreach_leads ADD COLUMN site_verified_at TEXT;
CREATE INDEX IF NOT EXISTS idx_outreach_leads_seo ON outreach_leads (seo_score);
