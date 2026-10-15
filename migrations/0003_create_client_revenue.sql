-- Private client revenue figures behind the homepage "Combined annual client revenue" total.
-- One row per client: the lower bound of the annual revenue they agreed to share, in CAD.
-- The public site only ever sees the rounded-down SUM (GET /api/client-revenue); never these rows.
CREATE TABLE IF NOT EXISTS client_revenue (
  client_id  TEXT PRIMARY KEY,
  revenue    INTEGER NOT NULL CHECK (revenue > 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
