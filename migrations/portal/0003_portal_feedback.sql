-- Portal feedback (private beta). NOT applied by this change: see the plan in worker/portal/BETA-READINESS.md ("Applying 0003").
--
-- One row per message a signed-in client sends from the portal. The organization and the person always come from the server-side membership and
-- session, never from the form. `page` is one of a fixed list of section keys (worker/portal/repo/portal-feedback.js), not free text.
CREATE TABLE IF NOT EXISTS portal_feedback (
  id              TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  user_id         TEXT NOT NULL REFERENCES portal_users (id) ON DELETE RESTRICT,
  kind            TEXT NOT NULL CHECK (kind IN ('problem', 'suggestion', 'other')),
  message         TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  page            TEXT CHECK (page IS NULL OR (length(page) BETWEEN 1 AND 40 AND page NOT GLOB '*[^a-z0-9-]*')),
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_portal_feedback_created ON portal_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_feedback_user ON portal_feedback (user_id, created_at DESC);
