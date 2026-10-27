-- Client Services (Staging first). Approved for Staging only; NOT applied to Production, which follows the manual Production workflow after its own approval
-- (that workflow's expected list deliberately does not know 0007). See worker/portal/CLIENT-SERVICES.md. Five ADDITIVE tables; nothing existing is altered.
--
--   invoices             invoices entered by Framework Admin. Amount, date and payment status are typed in by staff (CAD, no tax calculation); the PDF is only a file.
--                        A draft (published_at IS NULL) is invisible to clients. Invoices are ARCHIVED, never routinely deleted (see CLIENT-SERVICES.md, retention).
--   support_requests     a client's support or change request. `scope` separates technical support from work that may be billable; "quoted" and "approved" only exist for
--                        the latter, and nothing here ever means "authorized" until Framework records approval after a quote.
--   support_messages     the complete, append-only conversation: client messages, Framework replies, status changes and private staff notes (visibility = 'internal').
--   support_attachments  metadata for files on a request (content lives in private R2 under org/<id>/support/<uuid>); at most 3 per request.
--   service_notifications  a small outbox of "who should be told what" (staff email on a client submit/reply; client email on a published invoice or a Framework reply).
--
-- Every table is scoped by organization_id (ON DELETE RESTRICT) and rows are addressed by (id, organization_id).

CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  invoice_number  TEXT NOT NULL CHECK (length(invoice_number) BETWEEN 1 AND 40 AND invoice_number NOT GLOB '*[^A-Za-z0-9._/-]*'),
  issue_date      TEXT NOT NULL CHECK (issue_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  due_date        TEXT CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  amount_cents    INTEGER NOT NULL CHECK (amount_cents BETWEEN 0 AND 100000000000),
  currency        TEXT NOT NULL DEFAULT 'CAD' CHECK (currency = 'CAD'),
  payment_status  TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'void')),
  paid_at         TEXT,
  description     TEXT CHECK (description IS NULL OR length(description) <= 300),
  internal_note   TEXT CHECK (internal_note IS NULL OR length(internal_note) <= 500),
  format          TEXT CHECK (format IS NULL OR (length(format) BETWEEN 1 AND 8 AND format NOT GLOB '*[^a-z0-9]*')),
  content_type    TEXT CHECK (content_type IS NULL OR length(content_type) BETWEEN 3 AND 100),
  size_bytes      INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  sha256          TEXT CHECK (sha256 IS NULL OR (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')),
  storage_key     TEXT UNIQUE CHECK (storage_key IS NULL OR length(storage_key) BETWEEN 40 AND 200),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by      TEXT NOT NULL CHECK (length(created_by) BETWEEN 1 AND 254),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by      TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 254),
  published_at    TEXT,
  published_by    TEXT CHECK (published_by IS NULL OR length(published_by) BETWEEN 1 AND 254),
  archived_at     TEXT,
  archived_by     TEXT CHECK (archived_by IS NULL OR length(archived_by) BETWEEN 1 AND 254),
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, invoice_number),
  CHECK ((published_at IS NULL) = (published_by IS NULL)),
  CHECK ((archived_at IS NULL) = (archived_by IS NULL)),
  CHECK (payment_status <> 'paid' OR paid_at IS NOT NULL),
  CHECK ((storage_key IS NULL) = (sha256 IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_invoices_org ON invoices (organization_id, archived_at, issue_date DESC);

CREATE TABLE IF NOT EXISTS support_requests (
  id               TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id  TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  category         TEXT NOT NULL CHECK (category IN ('website_change', 'design_revision', 'technical_issue', 'general')),
  scope            TEXT NOT NULL CHECK (scope IN ('support', 'change')),
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  status           TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_review', 'quoted', 'approved', 'in_progress', 'completed', 'declined')),
  submitted_by     TEXT NOT NULL REFERENCES portal_users (id) ON DELETE RESTRICT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  status_changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_message_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_message_by  TEXT NOT NULL DEFAULT 'client' CHECK (last_message_by IN ('client', 'staff')),
  client_read_at   TEXT,
  admin_seen_at    TEXT,
  UNIQUE (id, organization_id),
  CHECK ((category IN ('website_change', 'design_revision')) = (scope = 'change')),
  CHECK (scope = 'change' OR status NOT IN ('quoted', 'approved'))
);
CREATE INDEX IF NOT EXISTS idx_support_requests_org ON support_requests (organization_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id              TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  request_id      TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('message', 'status')),
  author_type     TEXT NOT NULL CHECK (author_type IN ('client', 'staff')),
  author_user_id  TEXT REFERENCES portal_users (id) ON DELETE RESTRICT,
  author_label    TEXT CHECK (author_label IS NULL OR length(author_label) BETWEEN 1 AND 254),
  visibility      TEXT NOT NULL DEFAULT 'client' CHECK (visibility IN ('client', 'internal')),
  body            TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
  status_to       TEXT CHECK (status_to IS NULL OR status_to IN ('new', 'in_review', 'quoted', 'approved', 'in_progress', 'completed', 'declined')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (request_id, organization_id) REFERENCES support_requests (id, organization_id) ON DELETE RESTRICT,
  UNIQUE (id, organization_id),
  CHECK (author_type = 'staff' OR visibility = 'client'),
  CHECK (author_type <> 'client' OR author_user_id IS NOT NULL),
  CHECK (author_type <> 'staff' OR author_label IS NOT NULL),
  CHECK (kind <> 'status' OR (status_to IS NOT NULL AND author_type = 'staff'))
);
CREATE INDEX IF NOT EXISTS idx_support_messages_request ON support_messages (organization_id, request_id, created_at);

CREATE TABLE IF NOT EXISTS support_attachments (
  id              TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL,
  request_id      TEXT NOT NULL,
  message_id      TEXT NOT NULL,
  original_name   TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 120),
  format          TEXT NOT NULL CHECK (length(format) BETWEEN 1 AND 8 AND format NOT GLOB '*[^a-z0-9]*'),
  content_type    TEXT NOT NULL CHECK (length(content_type) BETWEEN 3 AND 100),
  size_bytes      INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256          TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  storage_key     TEXT NOT NULL UNIQUE CHECK (length(storage_key) BETWEEN 40 AND 200),
  uploaded_by_type TEXT NOT NULL CHECK (uploaded_by_type IN ('client', 'staff')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (request_id, organization_id) REFERENCES support_requests (id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (message_id, organization_id) REFERENCES support_messages (id, organization_id) ON DELETE RESTRICT,
  UNIQUE (id, organization_id)
);
CREATE INDEX IF NOT EXISTS idx_support_attachments_request ON support_attachments (organization_id, request_id);

CREATE TABLE IF NOT EXISTS service_notifications (
  id              TEXT PRIMARY KEY CHECK (length(id) = 36),
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  audience        TEXT NOT NULL CHECK (audience IN ('staff', 'client')),
  event           TEXT NOT NULL CHECK (event IN ('request_submitted', 'request_client_reply', 'request_staff_reply', 'request_status', 'invoice_published')),
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('support_request', 'invoice')),
  entity_id       TEXT NOT NULL CHECK (length(entity_id) = 36),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  last_error      TEXT CHECK (last_error IS NULL OR length(last_error) <= 200),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sent_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_service_notifications_pending ON service_notifications (status, created_at);
