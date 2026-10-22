-- Business Profile answers (Staging first; NOT applied to Production until a separate, reviewed Production change).
--
-- One row per answered question, owned by exactly one organization. Only the server writes here, and only values that passed the
-- questionnaire schema in worker/portal/profile-schema.js (field ids, types, lengths, allowed options). Unanswered optional questions have
-- no row. Completion is calculated from these rows, never stored, so it cannot drift from the answers.
CREATE TABLE IF NOT EXISTS business_profile_answers (
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  field_id        TEXT NOT NULL CHECK (length(field_id) BETWEEN 1 AND 40 AND field_id NOT GLOB '*[^a-z0-9_]*'),
  value           TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 2000),
  schema_version  INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
  updated_by      TEXT NOT NULL REFERENCES portal_users (id) ON DELETE RESTRICT,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (organization_id, field_id)
) WITHOUT ROWID;
