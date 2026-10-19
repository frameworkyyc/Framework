-- Framework client portal, migration 0001: foundation.
--
-- Applies to the PORTAL database ONLY (Cloudflare D1: framework-portal-staging, later framework-portal). It must never be
-- run against the feedback/assessment database (framework-staging / framework-feedback).
--
-- Cloudflare D1 notes honoured here: no BEGIN/COMMIT (D1 wraps migrations itself), no PRAGMA (foreign keys are always enforced on
-- D1), no triggers, only SQLite features D1 supports (partial indexes, CHECK, RETURNING, json_valid). Every statement is
-- IF NOT EXISTS so a re-run is harmless. Ids are random UUIDs (36 chars); times are ISO-8601 UTC text with milliseconds, which
-- sort and compare correctly as plain strings.
--
-- Tenancy rule: every tenant-owned table has a NOT NULL organization_id (memberships, invitations, projects; activity_log is
-- nullable only for user-level events with no organization). Future tenant tables (files, requests, ...) must do the same and
-- reference projects through the composite key (project_id, organization_id) so a child row can never point at another
-- organization's project.

-- ------------------------------------------------------------------ organizations (the tenants)
CREATE TABLE IF NOT EXISTS organizations (
  id                TEXT PRIMARY KEY CHECK (length(id) = 36),
  slug              TEXT NOT NULL UNIQUE CHECK (
                      length(slug) BETWEEN 2 AND 48
                      AND slug NOT GLOB '*[^a-z0-9-]*'
                      AND slug NOT GLOB '-*' AND slug NOT GLOB '*-' AND slug NOT GLOB '*--*'),
  name              TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  website_url       TEXT CHECK (website_url IS NULL OR (website_url LIKE 'https://%' AND length(website_url) <= 300)),
  -- Soft link to client_revenue.client_id in the other database (D1 cannot join across databases). Set by an admin.
  revenue_client_id TEXT CHECK (revenue_client_id IS NULL OR length(revenue_client_id) BETWEEN 1 AND 120),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at       TEXT,
  CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_revenue_client ON organizations (revenue_client_id) WHERE revenue_client_id IS NOT NULL;

-- ------------------------------------------------------------------ portal_users (one row per WorkOS user, however many organizations)
CREATE TABLE IF NOT EXISTS portal_users (
  id             TEXT PRIMARY KEY CHECK (length(id) = 36),
  workos_user_id TEXT NOT NULL UNIQUE CHECK (length(workos_user_id) BETWEEN 5 AND 128),
  email          TEXT NOT NULL UNIQUE CHECK (
                   email = lower(email) AND length(email) BETWEEN 3 AND 254 AND instr(email, '@') > 1 AND instr(email, ' ') = 0),
  name           TEXT CHECK (name IS NULL OR length(name) <= 120),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at  TEXT,
  disabled_at    TEXT,
  CHECK ((status = 'disabled') = (disabled_at IS NOT NULL))
);

-- ------------------------------------------------------------------ memberships (who may see which organization, and as what)
CREATE TABLE IF NOT EXISTS memberships (
  id              TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  user_id         TEXT NOT NULL REFERENCES portal_users (id) ON DELETE RESTRICT,
  role            TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by      TEXT NOT NULL CHECK (length(created_by) BETWEEN 1 AND 254),
  revoked_at      TEXT,
  revoked_by      TEXT,
  UNIQUE (organization_id, user_id),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships (user_id, status);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships (organization_id, status);

-- ------------------------------------------------------------------ invitations (admin-issued; the only way to gain access)
CREATE TABLE IF NOT EXISTS invitations (
  id                   TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id      TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  email                TEXT NOT NULL CHECK (
                         email = lower(email) AND length(email) BETWEEN 3 AND 254 AND instr(email, '@') > 1 AND instr(email, ' ') = 0),
  role                 TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  workos_invitation_id TEXT CHECK (workos_invitation_id IS NULL OR length(workos_invitation_id) BETWEEN 5 AND 128),
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by           TEXT NOT NULL CHECK (length(created_by) BETWEEN 1 AND 254),
  expires_at           TEXT NOT NULL,
  accepted_at          TEXT,
  accepted_user_id     TEXT REFERENCES portal_users (id) ON DELETE RESTRICT,
  revoked_at           TEXT,
  revoked_by           TEXT,
  CHECK (expires_at > created_at),
  CHECK ((status = 'accepted') = (accepted_at IS NOT NULL)),
  CHECK ((status = 'accepted') = (accepted_user_id IS NOT NULL)),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
-- At most one live invitation per organization and email. Accepted, revoked and expired rows are history and do not count.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_one_pending ON invitations (organization_id, email) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_workos ON invitations (workos_invitation_id) WHERE workos_invitation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invitations_pending_email ON invitations (email) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations (organization_id, created_at DESC);

-- ------------------------------------------------------------------ portal_sessions (server-side sessions; used from Stage 2)
CREATE TABLE IF NOT EXISTS portal_sessions (
  id               TEXT PRIMARY KEY CHECK (length(id) = 64),   -- hex HMAC-SHA256 of the cookie token; the token itself is never stored
  user_id          TEXT NOT NULL REFERENCES portal_users (id) ON DELETE RESTRICT,
  workos_session_id TEXT CHECK (workos_session_id IS NULL OR length(workos_session_id) <= 128),
  auth_method      TEXT CHECK (auth_method IS NULL OR length(auth_method) <= 40),
  created_at       TEXT NOT NULL,
  last_seen_at     TEXT NOT NULL,
  idle_expires_at  TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  revoked_at       TEXT,
  revoked_reason   TEXT CHECK (revoked_reason IS NULL OR length(revoked_reason) <= 60),
  ip_hash          TEXT CHECK (ip_hash IS NULL OR length(ip_hash) <= 64),
  CHECK (idle_expires_at <= expires_at),
  CHECK (expires_at > created_at),
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_user ON portal_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_expiry ON portal_sessions (expires_at);

-- ------------------------------------------------------------------ projects
CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  kind            TEXT NOT NULL DEFAULT 'website' CHECK (length(kind) BETWEEN 1 AND 40 AND kind NOT GLOB '*[^a-z0-9_-]*'),
  status          TEXT NOT NULL DEFAULT 'discovery' CHECK (status IN ('discovery', 'design', 'build', 'review', 'live', 'maintenance', 'paused', 'archived')),
  live_url        TEXT CHECK (live_url IS NULL OR (live_url LIKE 'https://%' AND length(live_url) <= 300)),
  summary         TEXT CHECK (summary IS NULL OR length(summary) <= 2000),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Target for future composite foreign keys (project_id, organization_id) from files, requests and issue reports.
  UNIQUE (id, organization_id)
);
CREATE INDEX IF NOT EXISTS idx_projects_org_status ON projects (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_org_created ON projects (organization_id, created_at);

-- ------------------------------------------------------------------ activity_log (append-only; never holds secrets or tokens)
CREATE TABLE IF NOT EXISTS activity_log (
  id              TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT REFERENCES organizations (id) ON DELETE RESTRICT,   -- NULL only for user-level events (for example a sign-in)
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('client', 'admin', 'system')),
  actor_ref       TEXT NOT NULL CHECK (length(actor_ref) BETWEEN 1 AND 254),
  action          TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 60 AND action NOT GLOB '*[^a-z0-9._-]*'),
  entity_type     TEXT CHECK (entity_type IS NULL OR length(entity_type) <= 40),
  entity_id       TEXT CHECK (entity_id IS NULL OR length(entity_id) <= 64),
  detail          TEXT CHECK (detail IS NULL OR (length(detail) <= 2000 AND json_valid(detail))),
  visibility      TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('client', 'internal')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (visibility = 'internal' OR organization_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_activity_org_time ON activity_log (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_org_client_time ON activity_log (organization_id, created_at DESC) WHERE visibility = 'client';
