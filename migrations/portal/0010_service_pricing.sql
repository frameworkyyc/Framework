-- Branding service pricing: one global, Admin-editable price per Branding service, and a record of the price shown with each service request.
-- Approved; applied to Staging. Production: only by the manual Production workflow. See worker/portal/BRANDING-FILES.md.
-- Two additive changes, nothing existing is altered or removed:
--   1. service_prices: one row per service (13: the four logos, the other eight sections, the complete brand kit), holding a price type (starting_at, custom_quote
--      or included) and, for starting_at only, a whole-dollar CAD amount. Global: it belongs to Framework, not to a client. Seeded with Framework's starting prices.
--      The client page shows a price only for a service that has a row here, so a database without this table shows no prices at all.
--   2. service_requests.price_snapshot: a small JSON object with the service and the price wording the client was shown when they sent the request. NULL for every
--      existing request. The Worker reads requests with SELECT *, so it works with or without this column.
CREATE TABLE IF NOT EXISTS service_prices (
  service_key  TEXT PRIMARY KEY CHECK (length(service_key) BETWEEN 2 AND 40 AND service_key NOT GLOB '*[^a-z0-9-]*'),
  price_type   TEXT NOT NULL CHECK (price_type IN ('starting_at', 'custom_quote', 'included')),
  price_cad    INTEGER CHECK (price_cad IS NULL OR price_cad BETWEEN 1 AND 1000000),
  updated_by   TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 254),
  updated_at   TEXT NOT NULL,
  CHECK ((price_type = 'starting_at') = (price_cad IS NOT NULL))  -- an amount only with "Starting at"
);

INSERT OR IGNORE INTO service_prices (service_key, price_type, price_cad, updated_by, updated_at) VALUES
  ('logo-primary', 'starting_at', 500, 'migration 0010', '2026-10-29T00:00:00.000Z'),
  ('logo-secondary', 'starting_at', 150, 'migration 0010', '2026-10-29T00:00:00.000Z'),
  ('logo-simplified', 'starting_at', 150, 'migration 0010', '2026-10-29T00:00:00.000Z'),
  ('logo-submark', 'starting_at', 150, 'migration 0010', '2026-10-29T00:00:00.000Z'),
  ('typography', 'starting_at', 250, 'migration 0010', '2026-10-29T00:00:00.000Z'),
  ('colours', 'starting_at', 200, 'migration 0010', '2026-10-29T00:00:00.000Z'),
  ('tagline', 'starting_at', 250, 'migration 0010', '2026-10-29T00:00:00.000Z'),
  ('imagery', 'starting_at', 300, 'migration 0010', '2026-10-29T00:00:00.000Z'),
  ('layout', 'starting_at', 350, 'migration 0010', '2026-10-29T00:00:00.000Z'),
  ('textures', 'starting_at', 150, 'migration 0010', '2026-10-29T00:00:00.000Z'),
  ('iconography', 'starting_at', 250, 'migration 0010', '2026-10-29T00:00:00.000Z'),
  ('style', 'starting_at', 350, 'migration 0010', '2026-10-29T00:00:00.000Z'),
  ('brand-kit', 'starting_at', 2500, 'migration 0010', '2026-10-29T00:00:00.000Z');

ALTER TABLE service_requests ADD COLUMN price_snapshot TEXT CHECK (price_snapshot IS NULL OR (json_valid(price_snapshot) AND json_type(price_snapshot) = 'object' AND length(price_snapshot) <= 600));
