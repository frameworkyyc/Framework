-- 0023: a link per client and service (today: the address of a client's own digital business card).
-- Additive only: one new table. No existing table, row or constraint changes, and nothing is copied or moved.
-- Applied to Staging (target framework-portal-staging). Production: NOT applied; only through the manual "Portal Production D1 migration" workflow, after approval.
--
--   client_service_links   What Framework Admin entered for ONE client and ONE Additional Service: an https address. The Worker only accepts addresses for services that take one
--                          (digital-business-cards), and the portal shows a client only their OWN organization's row. A row exists only while a link is set: removing it deletes the row
--                          (the change is kept in the activity log). It lives beside client_service_state and client_service_settings (migrations 0016 and 0017) because it is the
--                          same kind of fact: something Admin knows about one client's situation with one service.
CREATE TABLE IF NOT EXISTS client_service_links (
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  service_key     TEXT NOT NULL REFERENCES portal_services (service_key) ON DELETE RESTRICT,
  url             TEXT NOT NULL CHECK (length(url) BETWEEN 12 AND 300 AND url LIKE 'https://%' AND url NOT GLOB '*[ <>"''\\]*'),
  updated_by      TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 254),
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (organization_id, service_key)
);
