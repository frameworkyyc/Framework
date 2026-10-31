-- Per-client Branding requirements (Admin -> Clients -> [Client] -> Branding -> Requirements).
-- Applied to Staging. Production only by the manual Production workflow, after its own approval.
-- Additive only: one new table, no seed rows. Nothing that exists is changed or removed (no ALTER, no UPDATE, no DELETE).
--
--   brand_requirements  An OVERRIDE of how important one Branding item is for ONE client: Required, Recommended, Optional or Not applicable, with an optional note the client sees.
--                       "Automatic" is simply NO ROW: a client with no rows behaves exactly as before (the defaults and the open-request dependencies in brand-requirements.js).
--                       `item_key` is one of the nine sections or one of the four logo variations (logo.primary, logo.secondary, logo.simplified, logo.submark). The requirement is
--                       only a label and a note: it is separate from completion (that is computed from the client's real content), it never creates a request, never blocks
--                       anything and never touches an uploaded file. Only Framework Admin writes it; the client portal only reads it, scoped to the member's own organization.
CREATE TABLE IF NOT EXISTS brand_requirements (
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  item_key        TEXT NOT NULL CHECK (item_key IN ('logo', 'typography', 'colours', 'tagline', 'imagery', 'layout', 'textures', 'iconography', 'style', 'logo.primary', 'logo.secondary', 'logo.simplified', 'logo.submark')),
  level           TEXT NOT NULL CHECK (level IN ('required', 'recommended', 'optional', 'not_applicable')),
  note            TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 300),
  updated_by      TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 254),
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (organization_id, item_key)
);
