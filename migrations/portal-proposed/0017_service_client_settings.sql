-- Additional Services, per client: a client's own order and Recommended flag; and the fifth service, Nexus Fleet Tracker, with a category.
-- PROPOSED, NOT APPLIED anywhere. Staging first, after approval; Production follows the manual Production workflow after its own approval.
-- Needs 0012 (portal_services) and 0016 (the sales-content columns and client_service_state). Additive only: one nullable column, one new table, one seed row. Nothing that exists is
-- changed or removed (no UPDATE, no DELETE, no table rebuild).
--
--   portal_services.category   An optional short category shown above a service's name (for example "Fleet Management Software"). NULL for the four existing services: nothing changes for them.
--   client_service_settings    What Admin chose for ONE client and ONE service, besides Show/Hide and "already has it" (those stay in client_service_state, migration 0016):
--                              `recommended` (the service carries a Recommended label for this client) and `sort_order` (this client's own position; NULL = follow the global order).
--                              A row exists only while it carries something. Only Framework Admin writes it; the portal only reads its own organization's rows.
--   portal_services seed       'nexus-fleet-tracker': name, description, headline and its six features exactly as supplied, shown to clients, last in the global order. NO price is
--                              seeded (a price appears only once Admin sets one in Service Pricing), and no problem or "why" text: nothing is written that was not provided.
ALTER TABLE portal_services ADD COLUMN category TEXT CHECK (category IS NULL OR length(category) BETWEEN 1 AND 60);

CREATE TABLE IF NOT EXISTS client_service_settings (
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  service_key     TEXT NOT NULL REFERENCES portal_services (service_key) ON DELETE RESTRICT,
  recommended     INTEGER NOT NULL DEFAULT 0 CHECK (recommended IN (0, 1)),
  sort_order      INTEGER CHECK (sort_order IS NULL OR sort_order BETWEEN 0 AND 9999),
  updated_by      TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 254),
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (organization_id, service_key),
  CHECK (recommended = 1 OR sort_order IS NOT NULL)
);

INSERT OR IGNORE INTO portal_services (service_key, name, description, enabled, sort_order, updated_by, updated_at, tagline, category, benefits_json) VALUES
  ('nexus-fleet-tracker', 'Nexus Fleet Tracker', 'Manage vehicles, monitor maintenance and organize fleet operations from one dashboard.', 1, 50, 'migration 0017', '2026-10-31T00:00:00.000Z',
   'Take control of your fleet.', 'Fleet Management Software',
   '["Vehicle life expectancy","Odometer tracking","Oil change reminders","Damage reporting","Maintenance requests","Service scheduling"]');
