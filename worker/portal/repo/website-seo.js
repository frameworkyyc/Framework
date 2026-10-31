/**
 * SEO & Search Visibility for a website (migration 0015): a status and summary, a checklist, recommendations, written reports and search visibility figures. Admin keeps all of it; a client reads
 * only what is published, for a published, unarchived website of their OWN organization. Nothing is fetched from anywhere: the figures are typed by Admin (`source` 'manual'). The column
 * `source` also allows 'search_console', reserved so a future Google Search Console import can fill the same table; no such import exists and none is started here.
 * Every statement names organization_id AND the website id, so another organization's website, its rows and an unpublished or archived one are simply "not found".
 * A database without migration 0015 answers "not available".
 */
import { newId, isoTime, requireOrgId, requireId, ok, fail, validActor } from "./common.js";
import { validateText, validateEnum } from "./validate.js";
import { validateDate } from "./websites.js";

export const SEO_STATUSES = ["not_started", "in_progress", "optimised", "monitoring"];
export const SEO_STATUS_LABEL = Object.freeze({ not_started: "Not started", in_progress: "In progress", optimised: "Optimised", monitoring: "Monitoring" });
export const ITEM_KINDS = ["checklist", "recommendation"];
export const ITEM_STATUSES = ["todo", "in_progress", "done"];
export const PRIORITIES = ["high", "medium", "low"];
export const MAX_ITEMS = 40, MAX_REPORTS = 60, MAX_METRICS = 60;

const missing = (err) => /no such table/i.test(String(err && err.message));
const audit = (db, org, actor, action, entity, id, at, detail) => db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) VALUES (?, ?, 'admin', ?, ?, ?, ?, ?, 'internal', ?)").bind(newId(), org, actor.trim(), action, entity, id, JSON.stringify(detail), at);
const siteOk = (db, org, website) => db.prepare("SELECT 1 AS x FROM websites WHERE id = ? AND organization_id = ? AND archived_at IS NULL").bind(website, org).first();

/** A https link for a report: https only, no credentials, no spaces or markup; null for none, undefined when invalid. */
export function validateReportLink(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || raw.length > 300 || /[\s<>"'\\]/.test(raw)) return undefined;
  try { const u = new URL(raw); return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".") ? u.toString() : undefined; } catch { return undefined; }
}
const int = (raw, max) => { if (raw === undefined || raw === null || raw === "") return null; const n = typeof raw === "number" ? raw : /^\d{1,10}$/.test(String(raw)) ? Number(raw) : NaN; return Number.isInteger(n) && n >= 0 && n <= max ? n : undefined; };
const position = (raw) => { if (raw === undefined || raw === null || raw === "") return null; const n = typeof raw === "number" ? raw : Number(raw); return Number.isFinite(n) && n >= 1 && n <= 1000 ? Math.round(n * 10) / 10 : undefined; };

const toItem = (r) => ({ id: r.id, kind: r.kind, title: r.title, detail: r.detail, status: r.status, priority: r.priority, sortOrder: r.sort_order, completedAt: r.completed_at, updatedAt: r.updated_at });
const toReport = (r) => ({ id: r.id, title: r.title, period: r.period_label, summary: r.summary, link: r.link_url, published: r.published === 1, createdAt: r.created_at });
const toMetric = (r) => ({ id: r.id, periodStart: r.period_start, periodEnd: r.period_end, source: r.source, impressions: r.impressions, clicks: r.clicks, position: r.avg_position, indexedPages: r.indexed_pages, note: r.note, published: r.published === 1 });

/** Everything about one website's SEO, for Admin (drafts included) or for the client (published only). */
async function load(db, org, website, { client }) {
  const pub = client ? " AND published = 1" : "";
  const head = await db.prepare("SELECT status, summary, published, updated_at FROM website_seo WHERE website_id = ? AND organization_id = ?").bind(website, org).first();
  const items = (await db.prepare("SELECT id, kind, title, detail, status, priority, sort_order, completed_at, updated_at FROM website_seo_items WHERE website_id = ? AND organization_id = ? ORDER BY kind, sort_order, created_at, id").bind(website, org).all()).results.map(toItem);
  const reports = (await db.prepare(`SELECT id, title, period_label, summary, link_url, published, created_at FROM website_seo_reports WHERE website_id = ? AND organization_id = ?${pub} ORDER BY created_at DESC, id`).bind(website, org).all()).results.map(toReport);
  const metrics = (await db.prepare(`SELECT id, period_start, period_end, source, impressions, clicks, avg_position, indexed_pages, note, published FROM website_seo_metrics WHERE website_id = ? AND organization_id = ?${pub} ORDER BY period_end DESC, id`).bind(website, org).all()).results.map(toMetric);
  return { status: head ? head.status : "not_started", summary: head ? head.summary : null, published: head ? head.published === 1 : false, updatedAt: head ? head.updated_at : null, hasRow: Boolean(head), checklist: items.filter((i) => i.kind === "checklist"), recommendations: items.filter((i) => i.kind === "recommendation"), reports, metrics };
}

export async function getSeoAdmin(db, organizationId, websiteId) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  try { return { available: true, ...(await load(db, organizationId, websiteId, { client: false })) }; } catch (err) { if (missing(err)) return { available: false }; throw err; }
}

/** The client's view: null when nothing is published (no row, or Admin has not published it), so the Website page shows nothing rather than an empty shell. */
export async function getSeoForClient(db, organizationId, websiteId) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  try {
    const site = await db.prepare("SELECT 1 AS x FROM websites WHERE id = ? AND organization_id = ? AND published = 1 AND archived_at IS NULL").bind(websiteId, organizationId).first();
    if (!site) return null;
    const d = await load(db, organizationId, websiteId, { client: true });
    return d.published ? d : null;
  } catch (err) { if (missing(err)) return null; throw err; }
}

/** The SEO status of several websites (for the list and the page lead): { websiteId -> status } for published ones only. */
export async function seoStatusesForClient(db, organizationId, websiteIds) {
  requireOrgId(organizationId);
  const out = new Map();
  try {
    const rows = (await db.prepare("SELECT s.website_id, s.status FROM website_seo s JOIN websites w ON w.id = s.website_id AND w.organization_id = s.organization_id WHERE s.organization_id = ? AND s.published = 1 AND w.published = 1 AND w.archived_at IS NULL").bind(organizationId).all()).results;
    for (const r of rows) if (websiteIds.includes(r.website_id)) out.set(r.website_id, r.status);
  } catch (err) { if (!missing(err)) throw err; }
  return out;
}

/** Status, summary and visibility of the whole subsection. Only the given fields change. */
export async function saveSeoHead(db, organizationId, websiteId, input, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => !["status", "summary", "published"].includes(k))) return fail("invalid_input");
  const has = (k) => Object.hasOwn(input, k), v = {};
  if (has("status")) { const s = validateEnum(input.status, SEO_STATUSES); if (!s) return fail("invalid_status"); v.status = s; }
  if (has("summary")) { const t = validateText(input.summary, 1000); if (t === undefined) return fail("invalid_summary"); v.summary = t; }
  if (has("published")) { if (typeof input.published !== "boolean") return fail("invalid_published"); v.published = input.published ? 1 : 0; }
  if (!Object.keys(v).length) return fail("invalid_input");
  const at = isoTime(now);
  try {
    if (!(await siteOk(db, organizationId, websiteId))) return fail("not_found");
    const cur = await db.prepare("SELECT status, summary, published FROM website_seo WHERE website_id = ? AND organization_id = ?").bind(websiteId, organizationId).first();
    const next = { status: v.status ?? (cur ? cur.status : "not_started"), summary: has("summary") ? v.summary : cur ? cur.summary : null, published: v.published ?? (cur ? cur.published : 0) };
    await db.batch([
      db.prepare("INSERT INTO website_seo (website_id, organization_id, status, summary, published, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (website_id) DO UPDATE SET status = excluded.status, summary = excluded.summary, published = excluded.published, updated_at = excluded.updated_at, updated_by = excluded.updated_by")
        .bind(websiteId, organizationId, next.status, next.summary, next.published, at, actor.trim()),
      audit(db, organizationId, actor, "website.seo.updated", "website_seo", websiteId, at, { fields: Object.keys(v) }),
    ]);
    return ok();
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

/* ------------------------------------------------------------------ checklist items and recommendations */

function checkItem(input, { partial }) {
  const has = (k) => Object.hasOwn(input, k), v = {};
  if (!partial || has("title")) { const t = validateText(input.title, 120); if (!t || /\n/.test(t)) return { error: "invalid_title" }; v.title = t; }
  if (has("detail")) { const t = validateText(input.detail, 500); if (t === undefined) return { error: "invalid_detail" }; v.detail = t; }
  if (has("status")) { const s = validateEnum(input.status, ITEM_STATUSES); if (!s) return { error: "invalid_status" }; v.status = s; }
  if (has("priority")) { if (input.priority === null || input.priority === "") v.priority = null; else { const p = validateEnum(input.priority, PRIORITIES); if (!p) return { error: "invalid_priority" }; v.priority = p; } }
  return { values: v };
}

export async function createItem(db, organizationId, websiteId, input, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => !["kind", "title", "detail", "status", "priority"].includes(k))) return fail("invalid_input");
  const kind = validateEnum(input.kind, ITEM_KINDS);
  if (!kind) return fail("invalid_kind");
  const c = checkItem(input, { partial: false });
  if (c.error) return fail(c.error);
  const v = c.values, status = v.status || "todo";
  const priority = kind === "recommendation" ? (v.priority ?? null) : null;
  if (kind === "checklist" && v.priority) return fail("invalid_priority");
  const id = newId(), at = isoTime(now);
  try {
    if (!(await siteOk(db, organizationId, websiteId))) return fail("not_found");
    const n = await db.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(sort_order), 0) AS top FROM website_seo_items WHERE organization_id = ? AND website_id = ? AND kind = ?").bind(organizationId, websiteId, kind).first();
    if (n.n >= MAX_ITEMS) return fail("too_many");
    await db.batch([
      db.prepare("INSERT INTO website_seo_items (id, organization_id, website_id, kind, title, detail, status, priority, sort_order, completed_at, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, organizationId, websiteId, kind, v.title, v.detail ?? null, status, priority, Math.min(9999, n.top + 10), status === "done" ? at : null, at, at, actor.trim()),
      audit(db, organizationId, actor, "website.seo.item.created", "website_seo_item", id, at, { website: websiteId, kind }),
    ]);
    return ok({ id });
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

export async function updateItem(db, organizationId, websiteId, id, patch, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id"); requireId(id, "item_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some((k) => !["title", "detail", "status", "priority"].includes(k))) return fail("invalid_input");
  const c = checkItem(patch, { partial: true });
  if (c.error) return fail(c.error);
  const keys = Object.keys(c.values);
  if (!keys.length) return fail("invalid_input");
  const at = isoTime(now), v = c.values;
  try {
    const cur = await db.prepare("SELECT kind, status, completed_at FROM website_seo_items WHERE id = ? AND organization_id = ? AND website_id = ?").bind(id, organizationId, websiteId).first();
    if (!cur) return fail("not_found");
    if (cur.kind === "checklist" && v.priority) return fail("invalid_priority");
    const status = v.status || cur.status;
    const completedAt = status === "done" ? (cur.status === "done" && cur.completed_at ? cur.completed_at : at) : null;
    const sets = [...keys.map((k) => `${k} = ?`), "completed_at = ?", "updated_at = ?", "updated_by = ?"]; // keys: a validated, fixed list; values are bound
    await db.batch([
      db.prepare(`UPDATE website_seo_items SET ${sets.join(", ")} WHERE id = ? AND organization_id = ? AND website_id = ?`).bind(...keys.map((k) => v[k]), completedAt, at, actor.trim(), id, organizationId, websiteId),
      audit(db, organizationId, actor, "website.seo.item.updated", "website_seo_item", id, at, { website: websiteId, fields: keys }),
    ]);
    return ok();
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

export async function deleteItem(db, organizationId, websiteId, id, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id"); requireId(id, "item_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const res = await db.batch([
    db.prepare("DELETE FROM website_seo_items WHERE id = ? AND organization_id = ? AND website_id = ?").bind(id, organizationId, websiteId),
    db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, ?, 'admin', ?, 'website.seo.item.deleted', 'website_seo_item', ?, ?, 'internal', ? WHERE changes() > 0").bind(newId(), organizationId, actor.trim(), id, JSON.stringify({ website: websiteId }), isoTime(now)),
  ]);
  return res[0].meta.changes === 1 ? ok() : fail("not_found");
}

/* ------------------------------------------------------------------ reports */

function checkReport(input, { partial }) {
  const has = (k) => Object.hasOwn(input, k), v = {};
  if (!partial || has("title")) { const t = validateText(input.title, 120); if (!t || /\n/.test(t)) return { error: "invalid_title" }; v.title = t; }
  if (has("period")) { const t = validateText(input.period, 40); if (t === undefined || (t && /\n/.test(t))) return { error: "invalid_period" }; v.period_label = t; }
  if (has("summary")) { const t = validateText(input.summary, 1000); if (t === undefined) return { error: "invalid_summary" }; v.summary = t; }
  if (has("link")) { const l = validateReportLink(input.link); if (l === undefined) return { error: "invalid_link" }; v.link_url = l; }
  if (has("published")) { if (typeof input.published !== "boolean") return { error: "invalid_published" }; v.published = input.published ? 1 : 0; }
  return { values: v };
}
const REPORT_KEYS = ["title", "period", "summary", "link", "published"];

export async function createReport(db, organizationId, websiteId, input, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => !REPORT_KEYS.includes(k))) return fail("invalid_input");
  const c = checkReport(input, { partial: false });
  if (c.error) return fail(c.error);
  const v = c.values, id = newId(), at = isoTime(now);
  try {
    if (!(await siteOk(db, organizationId, websiteId))) return fail("not_found");
    if ((await db.prepare("SELECT COUNT(*) AS n FROM website_seo_reports WHERE organization_id = ? AND website_id = ?").bind(organizationId, websiteId).first()).n >= MAX_REPORTS) return fail("too_many");
    await db.batch([
      db.prepare("INSERT INTO website_seo_reports (id, organization_id, website_id, title, period_label, summary, link_url, published, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, organizationId, websiteId, v.title, v.period_label ?? null, v.summary ?? null, v.link_url ?? null, v.published ?? 0, at, at, actor.trim()),
      audit(db, organizationId, actor, "website.seo.report.created", "website_seo_report", id, at, { website: websiteId }),
    ]);
    return ok({ id });
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

export async function updateReport(db, organizationId, websiteId, id, patch, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id"); requireId(id, "report_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some((k) => !REPORT_KEYS.includes(k))) return fail("invalid_input");
  const c = checkReport(patch, { partial: true });
  if (c.error) return fail(c.error);
  const keys = Object.keys(c.values);
  if (!keys.length) return fail("invalid_input");
  const at = isoTime(now), v = c.values;
  try {
    const sets = [...keys.map((k) => `${k} = ?`), "updated_at = ?", "updated_by = ?"]; // keys: columns chosen by checkReport; values are bound
    const res = await db.batch([
      db.prepare(`UPDATE website_seo_reports SET ${sets.join(", ")} WHERE id = ? AND organization_id = ? AND website_id = ?`).bind(...keys.map((k) => v[k]), at, actor.trim(), id, organizationId, websiteId),
      db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, ?, 'admin', ?, 'website.seo.report.updated', 'website_seo_report', ?, ?, 'internal', ? WHERE changes() > 0").bind(newId(), organizationId, actor.trim(), id, JSON.stringify({ website: websiteId, fields: keys }), at),
    ]);
    return res[0].meta.changes === 1 ? ok() : fail("not_found");
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

export async function deleteReport(db, organizationId, websiteId, id, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id"); requireId(id, "report_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const res = await db.batch([
    db.prepare("DELETE FROM website_seo_reports WHERE id = ? AND organization_id = ? AND website_id = ?").bind(id, organizationId, websiteId),
    db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, ?, 'admin', ?, 'website.seo.report.deleted', 'website_seo_report', ?, ?, 'internal', ? WHERE changes() > 0").bind(newId(), organizationId, actor.trim(), id, JSON.stringify({ website: websiteId }), isoTime(now)),
  ]);
  return res[0].meta.changes === 1 ? ok() : fail("not_found");
}

/* ------------------------------------------------------------------ search visibility figures */

const METRIC_KEYS = ["period_start", "period_end", "impressions", "clicks", "position", "indexed_pages", "note", "published"];

function checkMetric(input, { partial }) {
  const has = (k) => Object.hasOwn(input, k), v = {};
  if (!partial || has("period_start")) { const d = validateDate(input.period_start); if (!d) return { error: "invalid_date" }; v.period_start = d; }
  if (!partial || has("period_end")) { const d = validateDate(input.period_end); if (!d) return { error: "invalid_date" }; v.period_end = d; }
  if (has("impressions")) { const n = int(input.impressions, 2000000000); if (n === undefined) return { error: "invalid_number" }; v.impressions = n; }
  if (has("clicks")) { const n = int(input.clicks, 2000000000); if (n === undefined) return { error: "invalid_number" }; v.clicks = n; }
  if (has("indexed_pages")) { const n = int(input.indexed_pages, 10000000); if (n === undefined) return { error: "invalid_number" }; v.indexed_pages = n; }
  if (has("position")) { const n = position(input.position); if (n === undefined) return { error: "invalid_number" }; v.avg_position = n; }
  if (has("note")) { const t = validateText(input.note, 300); if (t === undefined || (t && /\n/.test(t))) return { error: "invalid_note" }; v.note = t; }
  if (has("published")) { if (typeof input.published !== "boolean") return { error: "invalid_published" }; v.published = input.published ? 1 : 0; }
  return { values: v };
}

export async function createMetric(db, organizationId, websiteId, input, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => !METRIC_KEYS.includes(k))) return fail("invalid_input");
  const c = checkMetric(input, { partial: false });
  if (c.error) return fail(c.error);
  const v = c.values;
  if (v.period_end < v.period_start) return fail("invalid_date");
  if (v.impressions == null && v.clicks == null && v.avg_position == null && v.indexed_pages == null) return fail("invalid_input");
  const id = newId(), at = isoTime(now);
  try {
    if (!(await siteOk(db, organizationId, websiteId))) return fail("not_found");
    if ((await db.prepare("SELECT COUNT(*) AS n FROM website_seo_metrics WHERE organization_id = ? AND website_id = ?").bind(organizationId, websiteId).first()).n >= MAX_METRICS) return fail("too_many");
    if (await db.prepare("SELECT 1 AS x FROM website_seo_metrics WHERE website_id = ? AND organization_id = ? AND period_start = ? AND period_end = ? AND source = 'manual'").bind(websiteId, organizationId, v.period_start, v.period_end).first()) return fail("duplicate_period");
    await db.batch([
      db.prepare("INSERT INTO website_seo_metrics (id, organization_id, website_id, period_start, period_end, source, impressions, clicks, avg_position, indexed_pages, note, published, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, organizationId, websiteId, v.period_start, v.period_end, v.impressions ?? null, v.clicks ?? null, v.avg_position ?? null, v.indexed_pages ?? null, v.note ?? null, v.published ?? 0, at, actor.trim()),
      audit(db, organizationId, actor, "website.seo.metric.created", "website_seo_metric", id, at, { website: websiteId }),
    ]);
    return ok({ id });
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

export async function updateMetric(db, organizationId, websiteId, id, patch, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id"); requireId(id, "metric_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some((k) => !METRIC_KEYS.includes(k))) return fail("invalid_input");
  const c = checkMetric(patch, { partial: true });
  if (c.error) return fail(c.error);
  const keys = Object.keys(c.values);
  if (!keys.length) return fail("invalid_input");
  const at = isoTime(now), v = c.values;
  try {
    const cur = await db.prepare("SELECT period_start, period_end, source FROM website_seo_metrics WHERE id = ? AND organization_id = ? AND website_id = ?").bind(id, organizationId, websiteId).first();
    if (!cur) return fail("not_found");
    if ((v.period_end || cur.period_end) < (v.period_start || cur.period_start)) return fail("invalid_date");
    const sets = [...keys.map((k) => `${k} = ?`), "updated_at = ?", "updated_by = ?"]; // keys: columns chosen by checkMetric; values are bound
    await db.batch([
      db.prepare(`UPDATE website_seo_metrics SET ${sets.join(", ")} WHERE id = ? AND organization_id = ? AND website_id = ?`).bind(...keys.map((k) => v[k]), at, actor.trim(), id, organizationId, websiteId),
      audit(db, organizationId, actor, "website.seo.metric.updated", "website_seo_metric", id, at, { website: websiteId, fields: keys }),
    ]);
    return ok();
  } catch (err) {
    if (missing(err)) return fail("unavailable");
    if (/UNIQUE/i.test(String(err && err.message))) return fail("duplicate_period");
    throw err;
  }
}

export async function deleteMetric(db, organizationId, websiteId, id, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id"); requireId(id, "metric_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const res = await db.batch([
    db.prepare("DELETE FROM website_seo_metrics WHERE id = ? AND organization_id = ? AND website_id = ?").bind(id, organizationId, websiteId),
    db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, ?, 'admin', ?, 'website.seo.metric.deleted', 'website_seo_metric', ?, ?, 'internal', ? WHERE changes() > 0").bind(newId(), organizationId, actor.trim(), id, JSON.stringify({ website: websiteId }), isoTime(now)),
  ]);
  return res[0].meta.changes === 1 ? ok() : fail("not_found");
}
