/**
 * Framework Admin: Overview dashboard data. Behind Cloudflare Access and ADMIN_EMAILS like every Admin route; read-only (every query goes through readOnlyDb, which
 * refuses anything but one SELECT). One GET answers what the Overview needs about clients, support requests, invoices and recent activity, each part on its own:
 * a database without a migration (or a failing query) gives `null` for that part and never fails the page. Deleted clients are left out of every count and list.
 * Staff-facing, so it may name clients; it never returns client answers, message text, file names or storage keys.
 *
 *   GET /dashboard   { generatedAt, clients, support, invoices, activity }
 */
import { readOnlyDb } from "./admin-clients.js";
import { profileProgress } from "./profile-schema.js";
import { listRequestsAllAdmin, adminSupportTotals } from "./repo/support.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const part = async (fn) => { try { return await fn(); } catch { return null; } };
const LIVE = "o.status <> 'archived'";

/** What the staff see in "Recent activity": an allow-list of events with plain labels (anything else, such as page views and sign-ins, is never shown). */
export const ACTIVITY_LABELS = Object.freeze({
  "org.created": "Client added",
  "org.deleted": "Client deleted",
  "org.restored": "Client restored",
  "invitation.created": "Invitation created",
  "invitation.accepted": "Joined the portal",
  "membership.revoked": "Access removed",
  "profile.updated": "Business Profile updated",
  "feedback.submitted": "Portal feedback sent",
  "support.request.created": "Support request submitted",
  "support.message.client": "Client replied to a request",
  "invoice.published": "Invoice published",
  "brand.upload.created": "Brand file uploaded by the client",
  "approved_email.added": "Approved email added",
  "approved_email.removed": "Approved email removed",
});

async function clientsPart(rdb, now) {
  const t = now.toISOString();
  const one = async (sql, ...p) => (await (p.length ? rdb.prepare(sql).bind(...p) : rdb.prepare(sql)).first());
  const orgs = await one(`SELECT sum(o.status <> 'archived') AS active, sum(o.status = 'archived') AS deleted FROM organizations o`);
  const members = await one(`SELECT count(DISTINCT m.user_id) AS n FROM memberships m JOIN portal_users u ON u.id = m.user_id JOIN organizations o ON o.id = m.organization_id WHERE m.status = 'active' AND u.status = 'active' AND ${LIVE}`);
  const inv = await one(`SELECT COALESCE(sum(i.expires_at > ?), 0) AS pending, COALESCE(sum(i.expires_at <= ?), 0) AS lapsed FROM invitations i JOIN organizations o ON o.id = i.organization_id WHERE i.status = 'pending' AND ${LIVE}`, t, t);
  const without = (await rdb.prepare(
    `SELECT o.id, o.name FROM organizations o WHERE ${LIVE} AND NOT EXISTS (SELECT 1 FROM memberships m JOIN portal_users u ON u.id = m.user_id WHERE m.organization_id = o.id AND m.status = 'active' AND u.status = 'active') ORDER BY o.created_at DESC, o.id LIMIT 5`,
  ).all()).results;
  const out = { active: orgs.active || 0, deleted: orgs.deleted || 0, people: members.n || 0, pendingInvitations: inv.pending, lapsedInvitations: inv.lapsed, withoutAccess: without, profile: null };
  out.profile = await part(async () => {
    const live = (await rdb.prepare(`SELECT o.id FROM organizations o WHERE ${LIVE}`).all()).results.map((r) => r.id);
    const answers = (await rdb.prepare(`SELECT a.organization_id, a.field_id, a.value FROM business_profile_answers a JOIN organizations o ON o.id = a.organization_id WHERE ${LIVE} LIMIT 20000`).all()).results;
    const byOrg = new Map(live.map((id) => [id, {}]));
    for (const a of answers) if (byOrg.has(a.organization_id)) byOrg.get(a.organization_id)[a.field_id] = a.value;
    const pct = [...byOrg.values()].map((saved) => profileProgress(saved).percent);
    return { avgPercent: pct.length ? Math.round(pct.reduce((x, y) => x + y, 0) / pct.length) : 0, incomplete: pct.filter((p) => p < 100).length, total: pct.length };
  });
  return out;
}

async function supportPart(env) {
  const [totals, list] = [await adminSupportTotals(env.PORTAL_DB), await listRequestsAllAdmin(env.PORTAL_DB, { scope: "attention", limit: 5 })];
  return {
    open: totals.open, attention: totals.attention,
    items: list.map((r) => ({ id: r.id, organizationId: r.organizationId, orgName: r.orgName, title: r.title, status: r.status, reason: r.reason, lastMessageAt: r.lastMessageAt })),
  };
}

async function invoicesPart(rdb, now) {
  const today = now.toISOString().slice(0, 10);
  const base = `FROM invoices i JOIN organizations o ON o.id = i.organization_id WHERE i.archived_at IS NULL AND ${LIVE}`;
  const out = await rdb.prepare(`SELECT COALESCE(sum(i.published_at IS NULL), 0) AS drafts, COALESCE(sum(i.published_at IS NOT NULL AND i.payment_status = 'unpaid'), 0) AS outstanding_count, COALESCE(sum(CASE WHEN i.published_at IS NOT NULL AND i.payment_status = 'unpaid' THEN i.amount_cents END), 0) AS outstanding_cents, COALESCE(sum(i.published_at IS NOT NULL AND i.payment_status = 'unpaid' AND i.due_date IS NOT NULL AND i.due_date < ?), 0) AS overdue ${base}`).bind(today).first();
  const overdueItems = (await rdb.prepare(`SELECT o.id AS organization_id, o.name AS org_name, i.invoice_number, i.amount_cents, i.due_date ${base} AND i.published_at IS NOT NULL AND i.payment_status = 'unpaid' AND i.due_date IS NOT NULL AND i.due_date < ? ORDER BY i.due_date, i.id LIMIT 5`).bind(today).all()).results;
  const draftItems = (await rdb.prepare(`SELECT o.id AS organization_id, o.name AS org_name, i.invoice_number, i.amount_cents ${base} AND i.published_at IS NULL ORDER BY i.created_at DESC, i.id LIMIT 3`).all()).results;
  return {
    drafts: out.drafts, overdue: out.overdue, outstandingCount: out.outstanding_count, outstandingCents: out.outstanding_cents,
    overdueItems: overdueItems.map((r) => ({ organizationId: r.organization_id, orgName: r.org_name, number: r.invoice_number, cents: r.amount_cents, dueDate: r.due_date })),
    draftItems: draftItems.map((r) => ({ organizationId: r.organization_id, orgName: r.org_name, number: r.invoice_number, cents: r.amount_cents })),
  };
}

async function activityPart(rdb) {
  const actions = Object.keys(ACTIVITY_LABELS);
  const rows = (await rdb.prepare(
    `SELECT a.action, a.created_at, o.id AS organization_id, o.name AS org_name FROM activity_log a LEFT JOIN organizations o ON o.id = a.organization_id WHERE a.action IN (${actions.map(() => "?").join(",")}) AND (o.id IS NULL OR o.status <> 'archived') ORDER BY a.created_at DESC, a.id LIMIT 80`,
  ).bind(...actions).all()).results;
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = r.action + "|" + (r.organization_id || ""); // a burst of the same event for one client is one line (the newest)
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ at: r.created_at, label: ACTIVITY_LABELS[r.action], organizationId: r.organization_id, orgName: r.org_name });
    if (out.length === 10) break;
  }
  return out;
}

export async function handleDashboardApi(request, env, principal, path, deps = {}) {
  if (path !== "/dashboard") return null;
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!env.PORTAL_DB) return json({ available: false });
  const now = deps.now || new Date();
  const rdb = readOnlyDb(env.PORTAL_DB);
  return json({
    available: true,
    generatedAt: now.toISOString(),
    clients: await part(() => clientsPart(rdb, now)),
    support: await part(() => supportPart(env)),
    invoices: await part(() => invoicesPart(rdb, now)),
    activity: await part(() => activityPart(rdb)),
  });
}
