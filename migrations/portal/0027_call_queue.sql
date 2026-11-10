-- 0027 (call queue): "Queue Call" in Admin -> Leads. Applied to Staging. Not applied to Production:
-- only through the manual "Portal Production D1 migration" workflow, after its own approval. Needs 0024 (outreach_leads).
--
-- Three additive, nullable columns on outreach_leads, and one partial index. No new table, nothing existing changes: every lead, its approval status,
-- its outreach status and history (0026), contacts, emails, notes and timeline stay exactly as they are. A queued call is a reminder to phone a lead later;
-- it is NOT a contact and never touches status, outreach_status, contact_method, last_contact_at or follow_up_on (the follow-up date belongs to outreach).
--   call_on         the day to phone the lead (YYYY-MM-DD, America/Edmonton). NULL = not in the call queue
--   call_note       why the owner wants to call (optional, up to 300 characters)
--   call_queued_at  when it was first queued (kept when rescheduled)
-- Until it is applied (it is not on Production yet) the Call Queue stays dormant: the Queue Call button explains why and the rest of Leads works exactly as before.
ALTER TABLE outreach_leads ADD COLUMN call_on TEXT CHECK (call_on IS NULL OR length(call_on) = 10);
ALTER TABLE outreach_leads ADD COLUMN call_note TEXT CHECK (call_note IS NULL OR length(call_note) <= 300);
ALTER TABLE outreach_leads ADD COLUMN call_queued_at TEXT;
CREATE INDEX IF NOT EXISTS idx_outreach_leads_call ON outreach_leads (call_on) WHERE call_on IS NOT NULL;
