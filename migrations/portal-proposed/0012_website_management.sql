-- Website management and Additional Services (Website Phase 3).
-- PROPOSED, NOT APPLIED anywhere. Staging first, after approval; Production follows the manual Production workflow after its own approval. See worker/portal/WEBSITES.md.
-- Additive only: two new tables and a few seed rows. Nothing that exists is changed or removed (no ALTER, no UPDATE, no DELETE).
--
--   website_packages  The downloadable website files (one ZIP) Framework Admin uploads for a website. At most ONE current file per website (website_id is the key); replacing it replaces
--                     the row. `published` decides whether the client can download it: a client sees it only while the website is published and not archived AND this file is published.
--                     The ZIP is one private object in the files bucket under org/<id>/websites/ (storage_key); it is never extracted or run. Composite foreign key: a package always belongs
--                     to a website of the same organization.
--   portal_services   The catalogue of optional Additional Services shown on the client's Website page (name, short description, shown or hidden, order). Global: it belongs to
--                     Framework, not to a client. Admin edits it in Settings. The four services below are the only keys the Worker accepts a request for; requests reuse the existing
--                     service_requests table (key "svc-<service_key>") and prices reuse service_prices (Admin -> Settings -> Service Pricing). No price is seeded: a price shows only
--                     once Admin has set one.
CREATE TABLE IF NOT EXISTS website_packages (
  website_id      TEXT PRIMARY KEY CHECK (length(website_id) = 36),
  organization_id TEXT NOT NULL,
  name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  format          TEXT NOT NULL CHECK (format = 'zip'),
  content_type    TEXT NOT NULL CHECK (length(content_type) BETWEEN 3 AND 100),
  size_bytes      INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 104857600),
  sha256          TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  storage_key     TEXT NOT NULL UNIQUE CHECK (length(storage_key) BETWEEN 40 AND 200),
  published       INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
  published_at    TEXT,
  uploaded_at     TEXT NOT NULL,
  uploaded_by     TEXT NOT NULL CHECK (length(uploaded_by) BETWEEN 1 AND 254),
  updated_at      TEXT NOT NULL,
  updated_by      TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 254),
  FOREIGN KEY (website_id, organization_id) REFERENCES websites (id, organization_id) ON DELETE RESTRICT,
  CHECK ((published = 1) = (published_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_website_packages_org ON website_packages (organization_id);

CREATE TABLE IF NOT EXISTS portal_services (
  service_key TEXT PRIMARY KEY CHECK (length(service_key) BETWEEN 2 AND 40 AND service_key NOT GLOB '*[^a-z0-9-]*'),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 240),
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  sort_order  INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 9999),
  updated_by  TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 254),
  updated_at  TEXT NOT NULL
);

INSERT OR IGNORE INTO portal_services (service_key, name, description, enabled, sort_order, updated_by, updated_at) VALUES
  ('client-admin-portal', 'Client Admin Portal', 'A secure, branded workspace where you manage your customers, projects and records in one place.', 1, 10, 'migration 0012', '2026-10-29T00:00:00.000Z'),
  ('invoice-sender', 'Invoice Sender', 'Create and send professional invoices to your customers, and see which have been paid.', 1, 20, 'migration 0012', '2026-10-29T00:00:00.000Z'),
  ('digital-business-cards', 'Digital Business Cards', 'A shareable digital card with your details and links, always up to date.', 1, 30, 'migration 0012', '2026-10-29T00:00:00.000Z'),
  ('seo-visibility', 'SEO & Visibility', 'Help the right customers find your business in search, with a plan to improve how you show up online.', 1, 40, 'migration 0012', '2026-10-29T00:00:00.000Z');
