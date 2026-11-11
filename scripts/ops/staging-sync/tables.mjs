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
  // SEO keywords (migration 0022): what a client tracks and the results Framework recorded; per environment.
  seo_keywords: "tracked keywords entered per environment; not part of this refresh",
  seo_rank_checks: "recorded rank checks; not part of this refresh",
  // Service links (migration 0023): the address of a client's own digital business card, entered by Admin per environment.
  client_service_links: "per-client addresses entered in Admin; not part of this refresh",
  // Demo traffic (migration 0021) and Leads (migrations 0024, 0025): prospect and outreach data, tracking links (credentials), contact addresses and opt-outs. Never copied to Staging, which has its own.
  demo_links: "tracking-link ids and private prospect labels; per environment",
  demo_journeys: "anonymous visitor journeys; per environment",
  demo_events: "anonymous visitor events; per environment",
  // Website Analytics (migration 0028): which analytics site and Search Console property each website reads, and cached provider answers. Configured per environment (a site tag is entered in Admin for the environment that reads it); never copied.
  website_analytics: "per-environment analytics site and Search Console property settings; not part of this refresh",
  website_analytics_cache: "cached provider answers; per environment, rebuilt on demand",
  outreach_leads: "prospects, notes and approvals; never copied to Staging",
  outreach_contacts: "prospect email addresses and phone numbers; never copied to Staging",
  outreach_suppressions: "opt-outs and bounces; must never be mixed between environments",
  outreach_messages: "drafted and sent outreach email; never copied to Staging",
  outreach_events: "outreach timelines; never copied to Staging",
};

/** Tables SQLite/D1 manage themselves. */
export const SYSTEM = new Set(["d1_migrations", "sqlite_sequence", "_cf_KV"]);

/** Tables the apply step may write to at all (the target client refuses anything else). */
export const WRITABLE = new Set([...COPIED.map((t) => t.table), "portal_users", "activity_log"]);

/** Counted before and after an apply; none of them may change (portal_users gains at most the one disabled placeholder). */
export const MUST_NOT_CHANGE = ["memberships", "invitations", "portal_sessions", "approved_emails", "portal_staff", "service_notifications", "invoices", "support_requests", "support_messages"];
