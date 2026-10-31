-- Master Client Access: which Framework staff may open ANY client's Client Portal (without being a member of it).
-- Applied to Staging. Production only by the manual Production workflow, after its own approval. See worker/portal/STAFF-ACCESS.md.
-- Additive only: one new table and one seed row. Nothing that exists is changed or removed (no ALTER, no UPDATE, no DELETE).
--
--   portal_staff   One row per Framework staff member who has been GRANTED master access. It is the ONLY thing that grants it: not an email in a request, a URL parameter, a cookie or any
--                  client-side flag, and not membership of the Admin Portal (Cloudflare Access / ADMIN_EMAILS), so more staff can be added later without every Admin user getting it.
--                  A grant starts as an EMAIL (`email`, lower-case): the person who signs in through WorkOS with that exact, verified address is bound to it at their first sign-in
--                  (`user_id` becomes their portal user id, `bound_at` is set, once, and the row never changes hands). From then on access is decided by `user_id` alone, an
--                  immutable id, so changing an email address can neither take nor lose access. `role` is 'master' today (every active client, with a preview of the owner or member
--                  view); the column exists so narrower roles can be added later. Revoking sets `revoked_at`; the portal re-reads this table on every request, so a revoked person
--                  loses access on the very next one.
--                  Master access never creates a membership, so staff never appear in any client's team list and no invitation is ever sent.
--   Seed:          hello@frameworkco.ca, granted by "migration 0013", unbound until that person's first verified sign-in.
CREATE TABLE IF NOT EXISTS portal_staff (
  id          TEXT PRIMARY KEY CHECK (length(id) = 36),
  email       TEXT NOT NULL UNIQUE CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(email) AND email NOT GLOB '*[ <>"''\\,;]*' AND email LIKE '%_@_%._%'),
  user_id     TEXT UNIQUE REFERENCES portal_users (id) ON DELETE RESTRICT,
  role        TEXT NOT NULL DEFAULT 'master' CHECK (role IN ('master')),
  granted_by  TEXT NOT NULL CHECK (length(granted_by) BETWEEN 1 AND 254),
  granted_at  TEXT NOT NULL,
  bound_at    TEXT,
  revoked_at  TEXT,
  revoked_by  TEXT CHECK (revoked_by IS NULL OR length(revoked_by) BETWEEN 1 AND 254),
  CHECK ((user_id IS NULL) = (bound_at IS NULL)),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

INSERT OR IGNORE INTO portal_staff (id, email, user_id, role, granted_by, granted_at) VALUES
  ('5b3e2a7c-0d41-4f6a-9c18-7a2d4e9f1b03', 'hello@frameworkco.ca', NULL, 'master', 'migration 0013', '2026-10-31T00:00:00.000Z');
