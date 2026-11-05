/**
 * The development milestones of a website (migration 0011, table website_milestones): Admin keeps them, the client sees them (read-only) for a published website. A website's progress bar is
 * computed from them (../website-stage.js milestoneProgress); nothing here stores a percentage.
 * Every statement names organization_id (and the website id): a milestone of another organization is simply "not found". Admin writes are audited internally in the same batch.
 */
import { newId, isoTime, requireOrgId, requireId, ok, fail, validActor } from "./common.js";
import { validateText, validateEnum } from "./validate.js";
import { validateDate } from "./websites.js";

export const MILESTONE_STATUSES = ["todo", "in_progress", "done"];
export const MAX_MILESTONES = 30;
const COLS = "id, website_id, title, detail, status, due_date, sort_order, completed_at, updated_at";
const toMilestone = (r) => ({ id: r.id, websiteId: r.website_id, title: r.title, detail: r.detail, status: r.status, dueDate: r.due_date, sortOrder: r.sort_order, completedAt: r.completed_at, updatedAt: r.updated_at });
const missing = (err) => /no such table/i.test(String(err && err.message));
const audit = (db, org, actor, action, id, at, detail) => db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) VALUES (?, ?, 'admin', ?, ?, 'website_milestone', ?, ?, 'internal', ?)").bind(newId(), org, actor.trim(), action, id, JSON.stringify(detail), at);

export async function listMilestonesAdmin(db, organizationId, websiteId) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  try { return (await db.prepare(`SELECT ${COLS} FROM website_milestones WHERE organization_id = ? AND website_id = ? ORDER BY sort_order, created_at, id`).bind(organizationId, websiteId).all()).results.map(toMilestone); }
  catch (err) { if (missing(err)) return []; throw err; }
}

/** The client's read: milestones of a PUBLISHED, unarchived website of their own organization only. */
export async function listClientMilestones(db, organizationId, websiteId) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  try {
    return (await db.prepare(`SELECT m.id, m.website_id, m.title, m.detail, m.status, m.due_date, m.sort_order, m.completed_at, m.updated_at FROM website_milestones m JOIN websites w ON w.id = m.website_id AND w.organization_id = m.organization_id WHERE m.organization_id = ? AND m.website_id = ? AND w.published = 1 AND w.archived_at IS NULL ORDER BY m.sort_order, m.created_at, m.id`).bind(organizationId, websiteId).all()).results.map(toMilestone);
  } catch (err) { if (missing(err)) return []; throw err; }
}

/** Milestones of many websites at once (the Home card and the list), already scoped like listClientMilestones. */
export async function listClientMilestonesFor(db, organizationId, websiteIds) {
  requireOrgId(organizationId);
  const out = new Map(websiteIds.map((id) => [id, []]));
  try {
    const rows = (await db.prepare(`SELECT m.id, m.website_id, m.title, m.detail, m.status, m.due_date, m.sort_order, m.completed_at, m.updated_at FROM website_milestones m JOIN websites w ON w.id = m.website_id AND w.organization_id = m.organization_id WHERE m.organization_id = ? AND w.published = 1 AND w.archived_at IS NULL ORDER BY m.sort_order, m.created_at, m.id`).bind(organizationId).all()).results;
    for (const r of rows) if (out.has(r.website_id)) out.get(r.website_id).push(toMilestone(r));
  } catch (err) { if (!missing(err)) throw err; }
  return out;
}

function checked(input, { partial }) {
  const v = {}, has = (k) => Object.prototype.hasOwnProperty.call(input, k);
  if (!partial || has("title")) { const t = validateText(input.title, 120); if (!t || /\n/.test(t)) return { error: "invalid_title" }; v.title = t; }
  if (has("detail")) { const t = validateText(input.detail, 500); if (t === undefined) return { error: "invalid_detail" }; v.detail = t; }
  if (!partial || has("status")) { const s = input.status === undefined && !partial ? "todo" : validateEnum(input.status, MILESTONE_STATUSES); if (!s) return { error: "invalid_status" }; v.status = s; }
  if (has("due_date")) { const d = validateDate(input.due_date); if (d === undefined) return { error: "invalid_date" }; v.due_date = d; }
  return { values: v };
}

export async function createMilestone(db, organizationId, websiteId, input, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => !["title", "detail", "status", "due_date"].includes(k))) return fail("invalid_input");
  const c = checked(input, { partial: false });
  if (c.error) return fail(c.error);
  const id = newId(), at = isoTime(now), v = c.values, done = v.status === "done";
  try {
    const site = await db.prepare("SELECT 1 AS x FROM websites WHERE id = ? AND organization_id = ?").bind(websiteId, organizationId).first();
    if (!site) return fail("not_found");
    const n = await db.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(sort_order), 0) AS top FROM website_milestones WHERE organization_id = ? AND website_id = ?").bind(organizationId, websiteId).first();
    if (n.n >= MAX_MILESTONES) return fail("too_many");
    await db.batch([
      db.prepare("INSERT INTO website_milestones (id, organization_id, website_id, title, detail, status, due_date, sort_order, completed_at, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, organizationId, websiteId, v.title, v.detail ?? null, v.status, v.due_date ?? null, Math.min(9999, n.top + 10), done ? at : null, at, at, actor.trim()),
      audit(db, organizationId, actor, "website.milestone.created", id, at, { website: websiteId }),
    ]);
    return ok({ id });
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

export async function updateMilestone(db, organizationId, websiteId, id, patch, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id"); requireId(id, "milestone_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some((k) => !["title", "detail", "status", "due_date"].includes(k))) return fail("invalid_input");
  const c = checked(patch, { partial: true });
  if (c.error) return fail(c.error);
  const keys = Object.keys(c.values);
  if (!keys.length) return fail("invalid_input");
  const at = isoTime(now), v = c.values;
  try {
    const cur = await db.prepare("SELECT status, completed_at FROM website_milestones WHERE id = ? AND organization_id = ? AND website_id = ?").bind(id, organizationId, websiteId).first();
    if (!cur) return fail("not_found");
    const status = v.status || cur.status;
    const completedAt = status === "done" ? (cur.status === "done" && cur.completed_at ? cur.completed_at : at) : null;
    const sets = [...keys.map((k) => `${k} = ?`), "completed_at = ?", "updated_at = ?", "updated_by = ?"]; // keys are validated members of a fixed list; values are bound
    await db.batch([
      db.prepare(`UPDATE website_milestones SET ${sets.join(", ")} WHERE id = ? AND organization_id = ? AND website_id = ?`).bind(...keys.map((k) => v[k]), completedAt, at, actor.trim(), id, organizationId, websiteId),
      audit(db, organizationId, actor, "website.milestone.updated", id, at, { website: websiteId, fields: keys }),
    ]);
    return ok();
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

export async function deleteMilestone(db, organizationId, websiteId, id, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id"); requireId(id, "milestone_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const at = isoTime(now);
  const res = await db.batch([
    db.prepare("DELETE FROM website_milestones WHERE id = ? AND organization_id = ? AND website_id = ?").bind(id, organizationId, websiteId),
    db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, ?, 'admin', ?, 'website.milestone.deleted', 'website_milestone', ?, ?, 'internal', ? WHERE changes() > 0")
      .bind(newId(), organizationId, actor.trim(), id, JSON.stringify({ website: websiteId }), at),
  ]);
  return res[0].meta.changes === 1 ? ok() : fail("not_found");
}

/** Move one milestone up or down one place; everything is renumbered 10, 20, 30... */
export async function moveMilestone(db, organizationId, websiteId, id, direction, actor, { now = new Date() } = {}) {
  if (direction !== "up" && direction !== "down") return fail("invalid_direction");
  if (!validActor(actor)) return fail("invalid_actor");
  const list = await listMilestonesAdmin(db, organizationId, websiteId);
  const i = list.findIndex((m) => m.id === id), j = direction === "up" ? i - 1 : i + 1;
  if (i < 0) return fail("not_found");
  if (j < 0 || j >= list.length) return ok({ unchanged: true });
  const order = list.map((m) => m.id); [order[i], order[j]] = [order[j], order[i]];
  const at = isoTime(now);
  await db.batch([
    ...order.map((mid, n) => db.prepare("UPDATE website_milestones SET sort_order = ?, updated_at = ?, updated_by = ? WHERE id = ? AND organization_id = ? AND website_id = ? AND sort_order <> ?").bind((n + 1) * 10, at, actor.trim(), mid, organizationId, websiteId, (n + 1) * 10)),
    audit(db, organizationId, actor, "website.milestone.moved", id, at, { website: websiteId, direction }),
  ]);
  return ok();
}
