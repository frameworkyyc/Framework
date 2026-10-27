/**
 * Framework Admin: Clients (read-only). Lets authorised Framework staff see invited client organizations, their members, their invitations (as the
 * portal database records them) and their saved Business Profile answers.
 *
 * Authorization: this handler is only reached from worker/admin/router.js AFTER authenticateAdmin() (a verified Cloudflare Access token for an email on
 * ADMIN_EMAILS). Every route here is GET; there is no write, no invitation sending and no impersonation. Staff can read any organization (that is the
 * job), which is why the organization id from the URL is validated as a UUID and used only in bound, read-only queries.
 *
 * Least privilege: the D1 binding cannot be scoped per operation, so all access goes through readOnlyDb(), which refuses anything that is not a single
 * SELECT statement. Client answers are never logged; errors answer with a generic code.
 */
import { PROFILE_STEPS, profileProgress, stepStatus } from "./profile-schema.js";
import { brandingSummary } from "./repo/brand.js";
import { adminInvoiceSummary } from "./repo/invoices.js";
import { adminSupportSummary } from "./repo/support.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LIST_LIMIT = 500;
const ANSWER_LIMIT = 20000;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });

/** A view of the portal database that can only run one SELECT statement at a time: no writes, no batches, no scripts. */
export function readOnlyDb(db) {
  return {
    prepare(sql) {
      if (typeof sql !== "string" || !/^\s*SELECT\b/i.test(sql) || sql.includes(";")) throw new Error("read_only_database");
      return db.prepare(sql);
    },
  };
}

const STATE_LABEL = { done: "complete", current: "partial", todo: "missing" };

function profileFor(answers, { withAnswers = false } = {}) {
  const saved = {};
  let lastSaved = null;
  for (const a of answers) {
    saved[a.field_id] = a.value;
    if (!lastSaved || a.updated_at > lastSaved) lastSaved = a.updated_at;
  }
  const prog = profileProgress(saved);
  const summary = { done: prog.done, total: prog.total, percent: prog.percent, last_saved: lastSaved };
  if (!withAnswers) return summary;
  return {
    ...summary,
    steps: PROFILE_STEPS.map((step) => {
      const st = stepStatus(step, saved);
      return {
        id: step.id, title: step.title, state: STATE_LABEL[st.state], answered: st.answered, total_questions: step.fields.length,
        missing_required: step.fields.filter((f) => st.missingRequired.includes(f.id)).map((f) => f.label),
        fields: step.fields.map((f) => ({ label: f.label, required: !!f.required, value: typeof saved[f.id] === "string" ? saved[f.id] : null })),
      };
    }),
  };
}

/** The portal database may not have the Business Profile table (a deployment where migration 0002 is not applied): report "not available", never fail the page. */
async function answersFor(rdb, organizationId) {
  try {
    const sql = organizationId ? "SELECT organization_id, field_id, value, updated_at FROM business_profile_answers WHERE organization_id = ?" : `SELECT organization_id, field_id, value, updated_at FROM business_profile_answers LIMIT ${ANSWER_LIMIT}`;
    const stmt = rdb.prepare(sql);
    return { ok: true, rows: (await (organizationId ? stmt.bind(organizationId) : stmt).all()).results };
  } catch {
    return { ok: false, rows: [] };
  }
}

async function list(rdb, now, capabilities) {
  const t = now.toISOString();
  const orgs = (await rdb.prepare(
    `SELECT o.id, o.name, o.slug, o.status, o.created_at, o.archived_at,
       (SELECT count(*) FROM memberships m JOIN portal_users u ON u.id = m.user_id WHERE m.organization_id = o.id AND m.status = 'active' AND u.status = 'active') AS active_members,
       (SELECT count(*) FROM invitations i WHERE i.organization_id = o.id AND i.status = 'pending' AND i.expires_at > ?) AS pending,
       (SELECT count(*) FROM invitations i WHERE i.organization_id = o.id AND i.status = 'pending' AND i.expires_at <= ?) AS lapsed,
       (SELECT count(*) FROM invitations i WHERE i.organization_id = o.id AND i.status = 'accepted') AS accepted,
       (SELECT count(*) FROM invitations i WHERE i.organization_id = o.id AND i.status = 'revoked') AS revoked
     FROM organizations o ORDER BY o.created_at DESC, o.id LIMIT ${LIST_LIMIT}`,
  ).bind(t, t).all()).results;
  const ans = await answersFor(rdb, null);
  const byOrg = new Map();
  for (const a of ans.rows) (byOrg.get(a.organization_id) || byOrg.set(a.organization_id, []).get(a.organization_id)).push(a);
  return json({
    profile_available: ans.ok,
    capabilities, // booleans only: whether this deployment accepts access changes (so the interface can explain itself)
    clients: orgs.map((o) => ({
      id: o.id, name: o.name, slug: o.slug, status: o.status, created_at: o.created_at, archived_at: o.archived_at, active_members: o.active_members,
      invitations: { pending: o.pending, accepted: o.accepted, revoked: o.revoked, lapsed: o.lapsed },
      profile: ans.ok ? profileFor(byOrg.get(o.id) || []) : null,
    })),
  });
}

/** Branding counts for the client page, or null on a database without migration 0005 (so older databases keep working). */
async function brandingFor(rdb, id) {
  try { return await brandingSummary(rdb, id); } catch { return null; }
}

/** Invoice counts (drafts waiting, past due) for the client page, or null on a database without migration 0007. */
async function invoicesFor(rdb, id, now) {
  try { return await adminInvoiceSummary(rdb, id, { now }); } catch { return null; }
}

/** Support request counts (unseen, open) for the client page, or null on a database without migration 0007. */
async function supportFor(rdb, id) {
  try { return await adminSupportSummary(rdb, id); } catch { return null; }
}

async function one(rdb, id, now, writes) {
  const org = await rdb.prepare("SELECT id, name, slug, status, website_url, created_at, archived_at FROM organizations WHERE id = ?").bind(id).first();
  if (!org) return json({ error: "not_found" }, 404);
  const members = (await rdb.prepare(
    `SELECT u.email, u.name, u.status AS user_status, m.role, m.status, m.created_at, u.last_login_at
       FROM memberships m JOIN portal_users u ON u.id = m.user_id WHERE m.organization_id = ? ORDER BY m.created_at, u.email`,
  ).bind(id).all()).results;
  const t = now.toISOString();
  const invitations = (await rdb.prepare("SELECT email, role, status, created_at, created_by, expires_at, accepted_at, revoked_at FROM invitations WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100").bind(id).all()).results
    .map((i) => ({ ...i, past_expiry: i.status === "pending" && i.expires_at <= t })); // the stored status is reported as it is; "past_expiry" is only a fact about the date
  const ans = await answersFor(rdb, id);
  return json({ organization: org, capabilities: { writes }, members, invitations, profile_available: ans.ok, profile: ans.ok ? profileFor(ans.rows, { withAnswers: true }) : null, branding: await brandingFor(rdb, id), invoices: await invoicesFor(rdb, id, now), support: await supportFor(rdb, id) });
}

/**
 * @param path pathname with "/api/admin" removed. @returns Response or null when the path is not a clients route.
 */
export async function handleClientsApi(request, env, principal, path, deps = {}) {
  const m = path.match(/^\/clients(?:\/([^/]+))?$/);
  if (!m) return null;
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
  if (!env.PORTAL_DB) return json({ error: "portal_unavailable" }, 503);
  const rdb = readOnlyDb(env.PORTAL_DB);
  const now = deps.now || new Date();
  try {
    if (!m[1]) return await list(rdb, now, { writes: env.PORTAL_ADMIN_WRITES === "1" });
    if (!UUID.test(m[1])) return json({ error: "not_found" }, 404);
    return await one(rdb, m[1], now, env.PORTAL_ADMIN_WRITES === "1");
  } catch (err) {
    console.error("admin clients api error:", err && err.name); // never the message: it can carry SQL text or values
    return json({ error: "portal_unavailable" }, 503);
  }
}
