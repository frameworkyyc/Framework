-- 0026 (outreach tracking): "Mark as Contacted" in Admin -> Leads. Applied to Staging. Not applied to Production:
-- only through the manual "Portal Production D1 migration" workflow, after its own approval. Needs 0024 (outreach_leads).
--
-- Five additive, nullable columns on outreach_leads. No new table, nothing existing changes: every lead, its approval status, contacts, emails,
-- notes and timeline are kept exactly as they are. Existing leads read as before (a lead emailed from Admin already shows as Contacted, method Email,
-- from its lifecycle status and contacted_at; no backfill is needed).
--   contact_method   how the owner last reached the lead by hand: text, email, phone, facebook or other
--   last_contact_at  when that happened (recorded automatically); contacted_at keeps the FIRST contact
--   outreach_status  where outreach stands: contacted, replied, interested, not_interested or follow_up. NULL = not logged by hand
--                    (the lifecycle status decides: emailed = Contacted, replied = Replied). The lifecycle status (the approval) is never rewritten by it.
--   follow_up_on     the day to follow up (YYYY-MM-DD), optional
--   outreach_note    the latest note about the contact (the timeline keeps every note, address-free)
-- Until it is applied (it is not on Production yet) the "Mark as Contacted" action stays dormant (the button explains why) and the rest of Leads works exactly as before.
ALTER TABLE outreach_leads ADD COLUMN contact_method TEXT CHECK (contact_method IS NULL OR contact_method IN ('text', 'email', 'phone', 'facebook', 'other'));
ALTER TABLE outreach_leads ADD COLUMN last_contact_at TEXT;
ALTER TABLE outreach_leads ADD COLUMN outreach_status TEXT CHECK (outreach_status IS NULL OR outreach_status IN ('contacted', 'replied', 'interested', 'not_interested', 'follow_up'));
ALTER TABLE outreach_leads ADD COLUMN follow_up_on TEXT CHECK (follow_up_on IS NULL OR length(follow_up_on) = 10);
ALTER TABLE outreach_leads ADD COLUMN outreach_note TEXT CHECK (outreach_note IS NULL OR length(outreach_note) <= 300);
CREATE INDEX IF NOT EXISTS idx_outreach_leads_outreach ON outreach_leads (outreach_status, follow_up_on);
