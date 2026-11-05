-- 0019: the date a client relationship ended (Brand Discovery retention).
-- PROPOSED. Not applied anywhere. Show for review and wait for approval before applying it to Staging; Production only through the manual
-- "Portal Production D1 migration" workflow, after its own approval.
--
-- One row per organization, and only while an end date is recorded: setting the date inserts or updates the row, clearing it deletes the row.
-- Nothing is inferred from archiving or status. The automatic Discovery retention job (off unless PORTAL_DISCOVERY_RETENTION is "1") looks only at this table:
-- an organization with no row here is never touched. Additive: no existing table or row changes.
CREATE TABLE IF NOT EXISTS client_relationships (
  organization_id TEXT PRIMARY KEY CHECK (length(organization_id) = 36) REFERENCES organizations (id) ON DELETE RESTRICT,
  ended_on        TEXT NOT NULL CHECK (ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),   -- YYYY-MM-DD, set by Admin
  set_at          TEXT NOT NULL,
  set_by          TEXT NOT NULL CHECK (length(set_by) BETWEEN 1 AND 254)
);
