/**
 * What is copied, what is not, and why. Every table that exists in Production must appear in COPIED or EXCLUDED; a new Production table that is in neither
 * stops the preflight until someone decides (so new client data is never copied, or ignored, by accident).
 * COPIED is in dependency order (parents first); deletions run in reverse.
 */
export const COPIED = [
  { table: "organizations", pk: ["id"], org: "id", nullify: ["revenue_client_id"] }, // revenue_client_id points into another database Staging does not have
  { table: "business_profile_answers", pk: ["organization_id", "field_id"], org: "organization_id", userRefs: ["updated_by"] },
  { table: "projects", pk: ["id"], org: "organization_id" },
  { table: "brand_kits", pk: ["organization_id"], org: "organization_id" },
  { table: "brand_assets", pk: ["id"], org: "organization_id", file: { key: "storage_key", sha: "sha256", size: "size_bytes" } },
  { table: "brand_uploads", pk: ["id"], org: "organization_id", userRefs: ["uploaded_by"], file: { key: "storage_key", sha: "sha256", size: "size_bytes" } },
  { table: "websites", pk: ["id"], org: "organization_id", file: { key: "screenshot_key", sha: "screenshot_sha256", size: "screenshot_size" } },
  { table: "website_milestones", pk: ["id"], org: "organization_id" },
  { table: "website_packages", pk: ["website_id"], org: "organization_id", file: { key: "storage_key", sha: "sha256", size: "size_bytes" } },
  // Global configuration (not per client). Staging may have its own edits and extra rows, so differences are reported as conflicts, never overwritten silently.
  { table: "portal_services", pk: ["service_key"], org: null },
  { table: "service_prices", pk: ["service_key"], org: null },
];

export const EXCLUDED = {
  portal_users: "authentication records (Staging has its own WorkOS environment)",
  memberships: "who may sign in; clients get no Staging access",
  invitations: "live invitation tokens and recipients",
  portal_sessions: "session hashes",
  approved_emails: "recipient approvals belong to each environment",
  portal_staff: "Master Client Access is Staging's own",
  activity_log: "Staging keeps its own audit history",
  service_notifications: "the queue that could send email",
  service_requests: "client service history, not part of this refresh",
  invoices: "financial documents, excluded by decision",
  support_requests: "support history, excluded by decision",
  support_messages: "support history, excluded by decision",
  support_attachments: "support history, excluded by decision",
  portal_feedback: "client feedback, excluded",
  // Discovery (migration 0018; not in Production yet): links are credentials, answers and files are client material, and Admin content edits belong to each environment.
  discovery_assessments: "per-environment assessments; not part of this refresh",
  discovery_links: "secret-link hashes (credentials)",
  discovery_answers: "client answers; not part of this refresh",
  discovery_content: "Admin edits to questions, per environment",
  discovery_uploads: "client inspiration files; not part of this refresh",
  // Requests (migration 0020; not in Production yet): client requests, files, quotes and private notes are client material; per-service settings belong to each environment.
  requests: "client requests; not part of this refresh",
  request_events: "request conversations and private staff notes; not part of this refresh",
  request_files: "client reference files and designs; not part of this refresh",
  request_quotes: "quotes and agreements; not part of this refresh",
  request_type_settings: "per-environment service settings",
  // Service links (migration 0023): the address of a client's own digital business card, entered by Admin per environment.
  client_service_links: "per-client addresses entered in Admin; not part of this refresh",
};

/** Tables SQLite/D1 manage themselves. */
export const SYSTEM = new Set(["d1_migrations", "sqlite_sequence", "_cf_KV"]);

/** Tables the apply step may write to at all (the target client refuses anything else). */
export const WRITABLE = new Set([...COPIED.map((t) => t.table), "portal_users", "activity_log"]);

/** Counted before and after an apply; none of them may change (portal_users gains at most the one disabled placeholder). */
export const MUST_NOT_CHANGE = ["memberships", "invitations", "portal_sessions", "approved_emails", "portal_staff", "service_notifications", "invoices", "support_requests", "support_messages"];
