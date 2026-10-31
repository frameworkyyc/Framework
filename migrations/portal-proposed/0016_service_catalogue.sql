-- The Additional Services catalogue as a sales experience: richer content per service, images, and what a client already has.
-- PROPOSED, NOT APPLIED anywhere. Staging first, after approval; Production follows the manual Production workflow after its own approval. Needs 0012 (portal_services).
-- Additive only: new nullable columns on portal_services, two new tables. Nothing that exists is changed or removed (no UPDATE, no DELETE). The four service keys stay fixed.
--
--   portal_services new columns   tagline (the one-line promise), problem (the problem it solves), why (why a client might need it), benefits_json (a JSON list of up to 5 short benefits),
--                                 cta_label (the button text; the request workflow behind it is unchanged), featured (Admin highlights it), demo_url / demo_label (an optional https
--                                 link to a live demo or real example). All optional: a service with none of them shows exactly what it shows today.
--   portal_service_media          Screenshots, product previews and examples for a service (a caption, alt text, and one private image object in the files bucket under the reserved
--                                 catalogue area; any signed-in client may see a picture of an ENABLED service, nothing else). Global, like the catalogue itself.
--   client_service_state          What Admin knows about ONE client and ONE service: 'owned' (they already have it: it is not promoted to them) or 'hidden' (do not show it to them).
--                                 No row = the normal behaviour. Only Framework Admin writes it; the client portal only reads its own organization's rows.
ALTER TABLE portal_services ADD COLUMN tagline TEXT CHECK (tagline IS NULL OR length(tagline) BETWEEN 1 AND 160);
ALTER TABLE portal_services ADD COLUMN problem TEXT CHECK (problem IS NULL OR length(problem) BETWEEN 1 AND 400);
ALTER TABLE portal_services ADD COLUMN why TEXT CHECK (why IS NULL OR length(why) BETWEEN 1 AND 400);
ALTER TABLE portal_services ADD COLUMN benefits_json TEXT CHECK (benefits_json IS NULL OR (json_valid(benefits_json) AND length(benefits_json) <= 1200));
ALTER TABLE portal_services ADD COLUMN cta_label TEXT CHECK (cta_label IS NULL OR length(cta_label) BETWEEN 1 AND 40);
ALTER TABLE portal_services ADD COLUMN featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1));
ALTER TABLE portal_services ADD COLUMN demo_url TEXT CHECK (demo_url IS NULL OR (length(demo_url) BETWEEN 12 AND 300 AND demo_url LIKE 'https://%' AND demo_url NOT GLOB '*[ <>"''\\]*'));
ALTER TABLE portal_services ADD COLUMN demo_label TEXT CHECK (demo_label IS NULL OR length(demo_label) BETWEEN 1 AND 60);

CREATE TABLE IF NOT EXISTS portal_service_media (
  id           TEXT PRIMARY KEY CHECK (length(id) = 36),
  service_key  TEXT NOT NULL REFERENCES portal_services (service_key) ON DELETE RESTRICT,
  caption      TEXT CHECK (caption IS NULL OR length(caption) BETWEEN 1 AND 120),
  alt          TEXT NOT NULL CHECK (length(alt) BETWEEN 1 AND 160),
  storage_key  TEXT NOT NULL UNIQUE CHECK (length(storage_key) BETWEEN 40 AND 200),
  format       TEXT NOT NULL CHECK (length(format) BETWEEN 1 AND 8 AND format NOT GLOB '*[^a-z0-9]*'),
  content_type TEXT NOT NULL CHECK (length(content_type) BETWEEN 3 AND 100),
  size_bytes   INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  sha256       TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  sort_order   INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 9999),
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL CHECK (length(created_by) BETWEEN 1 AND 254)
);
CREATE INDEX IF NOT EXISTS idx_portal_service_media_service ON portal_service_media (service_key, sort_order, created_at);

CREATE TABLE IF NOT EXISTS client_service_state (
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  service_key     TEXT NOT NULL REFERENCES portal_services (service_key) ON DELETE RESTRICT,
  state           TEXT NOT NULL CHECK (state IN ('owned', 'hidden')),
  note            TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 300),
  updated_by      TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 254),
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (organization_id, service_key)
);
