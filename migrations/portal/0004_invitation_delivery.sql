-- PROPOSED, NOT APPLIED. Lives outside migrations/portal on purpose: `wrangler d1 migrations apply` only reads migrations/portal, so nothing can
-- apply this file until it is moved there after explicit approval (see worker/portal/INVITATION-DELIVERY-PLAN.md for the impact review).
--
-- Invitation delivery tracking, kept SEPARATE from the invitation's own status (pending / accepted / revoked / expired):
--   delivery_status  not_sent            nothing was handed to an email provider
--                    submitted           a provider accepted our request (WorkOS invitation created, or Resend email accepted).
--                                        This is NOT proof that the message reached an inbox: there is no delivery confirmation.
--                    failed              the provider request failed (see delivery_error); nothing is claimed
--   delivery_channel which provider was asked: workos (AuthKit invitation) or resend (Framework's own email, used for people who already have a WorkOS user)
--   delivery_attempted_at  when the latest attempt was made (UTC, same format as every other timestamp)
--   delivery_error   a short machine code for the latest failure (never provider text, never an address)
-- Four additive columns. Existing rows get delivery_status = 'not_sent' (true: the system has never sent them) and NULL for the rest.
-- No table rebuild, no data copy, no new index, no change to any existing column or constraint.

ALTER TABLE invitations ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'not_sent' CHECK (delivery_status IN ('not_sent', 'submitted', 'failed'));
ALTER TABLE invitations ADD COLUMN delivery_channel TEXT CHECK (delivery_channel IS NULL OR delivery_channel IN ('workos', 'resend'));
ALTER TABLE invitations ADD COLUMN delivery_attempted_at TEXT;
ALTER TABLE invitations ADD COLUMN delivery_error TEXT CHECK (delivery_error IS NULL OR (length(delivery_error) BETWEEN 1 AND 40 AND delivery_error NOT GLOB '*[^a-z0-9_]*'));
