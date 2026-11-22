/**
 * The Website review workspace (migration 0030, proposed): the Staging address of a website, the updates Framework publishes for the client to review (approve or reject with notes, or just read) and
 * the tasks Framework needs the client to do. Admin keeps everything, drafts included; a client reads only what is published, for a published, unarchived website of their OWN organization.
 * Every statement names organization_id AND the website id, so another organization's website, its rows, a draft and an archived row are all simply "not found". A client's decision is one
 * compare-and-set (it only applies to a published, awaiting-review approval update) batched with its audit row, so a double click or a replay can never decide twice.
 * A database without migration 0030 answers "not available": the Website page then shows only the environments it can.
 */
import { newId, isoTime, requireOrgId, requireId, ok, fail, validActor } from "./common.js";
import { validateName, validateText, validateEnum, validateHttpsUrl } from "./validate.js";
import { validateDate } from "./websites.js";

export const ENVIRONMENTS = ["staging", "production"];
export const UPDATE_KINDS = ["approval", "info"];
export const UPDATE_STATUS_LABEL = Object.freeze({ awaiting_review: "Awaiting review", approved: "Approved", rejected: "Rejected", info: "Informational" });
export const TASK_CTAS = ["upload", "respond", "review", "none"];
export const TASK_STATUSES = ["open", "submitted", "done", "cancelled"];
export const TASK_STATUS_LABEL = Object.freeze({ open: "Needed", submitted: "Sent to Framework", done: "Done", cancelled: "Cancelled" });
export const MAX_UPDATES = 80, MAX_TASKS = 60, CLIENT_UPDATES = 24, CLIENT_DONE_TASKS = 6;

const missing = (err) => /no such table|no such column/i.test(String(err && err.message));
const audit = (db, org, type, actor, action, entity, id, at, detail) => db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'internal', ?)").bind(newId(), org, type, String(actor).trim(), action, entity, id, JSON.stringify(detail), at);
const siteOk = (db, org, website) => db.prepare("SELECT 1 AS x FROM websites WHERE id = ? AND organization_id = ? AND archived_at IS NULL").bind(website, org).first();
const clientSiteOk = (db, org, website) => db.prepare("SELECT 1 AS x FROM websites WHERE id = ? AND organization_id = ? AND published = 1 AND archived_at IS NULL").bind(website, org).first();
const plain = (o) => o && typeof o === "object" && !Array.isArray(o);

const toUpdate = (r) => ({ id: r.id, title: r.title, detail: r.detail, environment: r.environment, kind: r.kind, status: r.status, decisionNote: r.decision_note, decidedAt: r.decided_at, decidedBy: r.decided_by, published: r.published === 1, publishedAt: r.published_at, createdAt: r.created_at, updatedAt: r.updated_at });
const toTask = (r) => ({ id: r.id, title: r.title, detail: r.detail, cta: r.cta, dueDate: r.due_date, status: r.status, responseText: r.response_text, respondedAt: r.responded_at, respondedBy: r.responded_by, published: r.published === 1, publishedAt: r.published_at, createdAt: r.created_at, updatedAt: r.updated_at });
const UPDATE_COLS = "id, title, detail, environment, kind, status, decision_note, decided_at, decided_by, published, published_at, created_at, updated_at";
const TASK_COLS = "id, title, detail, cta, due_date, status, response_text, responded_at, responded_by, published, published_at, created_at, updated_at";

/* ------------------------------------------------------------------ the Staging address */

/** The Staging address of a website (https), or null; undefined when the column does not exist yet (migration 0030 not applied). */
async function readStagingUrl(db, org, website, { client }) {
  try {
    const stmt = client
      ? db.prepare("SELECT staging_url FROM websites WHERE id = ? AND organization_id = ? AND published = 1 AND archived_at IS NULL")
      : db.prepare("SELECT staging_url FROM websites WHERE id = ? AND organization_id = ?");
    const r = await stmt.bind(website, org).first();
    return r ? r.staging_url || null : null;
  } catch (err) { if (missing(err)) return undefined; throw err; }
}
export const getStagingUrlForClient = (db, org, website) => { requireOrgId(org); requireId(website, "website_id"); return readStagingUrl(db, org, website, { client: true }); };

export async function setStagingUrl(db, organizationId, websiteId, raw, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const url = validateHttpsUrl(raw);
  if (url === undefined) return fail("invalid_url");
  const at = isoTime(now);
  try {
    if (!(await siteOk(db, organizationId, websiteId))) return fail("not_found");
    await db.batch([
      db.prepare("UPDATE websites SET staging_url = ?, updated_at = ?, updated_by = ? WHERE id = ? AND organization_id = ?").bind(url, at, actor.trim(), websiteId, organizationId),
      audit(db, organizationId, "admin", actor, "website.staging_url.set", "website", websiteId, at, { cleared: url === null }),
    ]);
    return ok();
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

/* ------------------------------------------------------------------ validation */

function checkUpdate(input, { partial }) {
  const v = {}, has = (k) => Object.hasOwn(input, k);
  if (!partial || has("title")) { const t = validateName(input.title, 120); if (t === null) return { error: "invalid_title" }; v.title = t; }
  if (has("detail")) { const d = validateText(input.detail, 600); if (d === undefined) return { error: "invalid_detail" }; v.detail = d; }
  if (has("environment")) { const e = validateEnum(input.environment, ENVIRONMENTS); if (!e) return { error: "invalid_environment" }; v.environment = e; }
  if (has("kind")) { const k = validateEnum(input.kind, UPDATE_KINDS); if (!k) return { error: "invalid_kind" }; v.kind = k; }
  if (has("published")) { if (typeof input.published !== "boolean") return { error: "invalid_published" }; v.published = input.published; }
  return { values: v };
}
function checkTask(input, { partial }) {
  const v = {}, has = (k) => Object.hasOwn(input, k);
  if (!partial || has("title")) { const t = validateName(input.title, 120); if (t === null) return { error: "invalid_title" }; v.title = t; }
  if (has("detail")) { const d = validateText(input.detail, 600); if (d === undefined) return { error: "invalid_detail" }; v.detail = d; }
  if (has("cta")) { const c = validateEnum(input.cta, TASK_CTAS); if (!c) return { error: "invalid_cta" }; v.cta = c; }
  if (has("due_date")) { if (input.due_date === null || input.due_date === "") v.due_date = null; else { const d = validateDate(input.due_date); if (d === undefined) return { error: "invalid_date" }; v.due_date = d; } }
  if (has("status")) { const s = validateEnum(input.status, ["open", "done", "cancelled"]); if (!s) return { error: "invalid_status" }; v.status = s; } // "submitted" is only ever the client's answer
  if (has("published")) { if (typeof input.published !== "boolean") return { error: "invalid_published" }; v.published = input.published; }
  return { values: v };
}

/* ------------------------------------------------------------------ Admin */

export async function getWorkspaceAdmin(db, organizationId, websiteId) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  try {
    const updates = (await db.prepare(`SELECT ${UPDATE_COLS} FROM website_updates WHERE organization_id = ? AND website_id = ? AND archived_at IS NULL ORDER BY created_at DESC, id`).bind(organizationId, websiteId).all()).results.map(toUpdate);
    const tasks = (await db.prepare(`SELECT ${TASK_COLS} FROM website_tasks WHERE organization_id = ? AND website_id = ? AND archived_at IS NULL ORDER BY (status IN ('done', 'cancelled')), due_date IS NULL, due_date, created_at DESC, id`).bind(organizationId, websiteId).all()).results.map(toTask);
    return { available: true, stagingUrl: (await readStagingUrl(db, organizationId, websiteId, { client: false })) ?? null, updates, tasks };
  } catch (err) { if (missing(err)) return { available: false }; throw err; }
}

export async function createUpdate(db, organizationId, websiteId, input, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!plain(input) || Object.keys(input).some((k) => !["title", "detail", "environment", "kind", "published"].includes(k))) return fail("invalid_input");
  const c = checkUpdate(input, { partial: false });
  if (c.error) return fail(c.error);
  const v = c.values, kind = v.kind || "approval", status = kind === "info" ? "info" : "awaiting_review", pub = v.published === true;
  const id = newId(), at = isoTime(now);
  try {
    if (!(await siteOk(db, organizationId, websiteId))) return fail("not_found");
    const n = await db.prepare("SELECT COUNT(*) AS n FROM website_updates WHERE organization_id = ? AND website_id = ? AND archived_at IS NULL").bind(organizationId, websiteId).first();
    if (n.n >= MAX_UPDATES) return fail("too_many");
    await db.batch([
      db.prepare("INSERT INTO website_updates (id, organization_id, website_id, title, detail, environment, kind, status, published, published_at, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, organizationId, websiteId, v.title, v.detail ?? null, v.environment || "staging", kind, status, pub ? 1 : 0, pub ? at : null, at, at, actor.trim()),
      audit(db, organizationId, "admin", actor, "website.update.created", "website_update", id, at, { kind, published: pub }),
    ]);
    return ok({ id });
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

export async function updateUpdate(db, organizationId, websiteId, updateId, patch, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id"); requireId(updateId, "update_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!plain(patch) || Object.keys(patch).length === 0 || Object.keys(patch).some((k) => !["title", "detail", "environment", "kind", "published"].includes(k))) return fail("invalid_input");
  const c = checkUpdate(patch, { partial: true });
  if (c.error) return fail(c.error);
  const v = c.values, at = isoTime(now);
  try {
    const cur = await db.prepare("SELECT kind, status, published, published_at FROM website_updates WHERE id = ? AND organization_id = ? AND website_id = ? AND archived_at IS NULL").bind(updateId, organizationId, websiteId).first();
    if (!cur) return fail("not_found");
    const sets = [], vals = [];
    for (const k of ["title", "detail", "environment"]) if (Object.hasOwn(v, k)) { sets.push(`${k} = ?`); vals.push(v[k]); }
    if (v.kind && v.kind !== cur.kind) { // a change of kind resets the decision: an informational update has none, an approval update starts awaiting review
      sets.push("kind = ?", "status = ?", "decision_note = NULL", "decided_at = NULL", "decided_by = NULL"); vals.push(v.kind, v.kind === "info" ? "info" : "awaiting_review");
    }
    if (Object.hasOwn(v, "published") && v.published !== (cur.published === 1)) { sets.push("published = ?", "published_at = ?"); vals.push(v.published ? 1 : 0, v.published ? at : null); }
    if (!sets.length) return ok();
    await db.batch([
      db.prepare(`UPDATE website_updates SET ${sets.join(", ")}, updated_at = ?, updated_by = ? WHERE id = ? AND organization_id = ? AND website_id = ?`).bind(...vals, at, actor.trim(), updateId, organizationId, websiteId),
      audit(db, organizationId, "admin", actor, "website.update.edited", "website_update", updateId, at, { fields: Object.keys(v) }),
    ]);
    return ok();
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

/** After a rejection (or an approval that needs another look): back to awaiting review. The earlier decision stays on record in the audit log. */
export async function requestReview(db, organizationId, websiteId, updateId, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id"); requireId(updateId, "update_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const at = isoTime(now);
  try {
    const [r] = await db.batch([
      db.prepare("UPDATE website_updates SET status = 'awaiting_review', decision_note = NULL, decided_at = NULL, decided_by = NULL, updated_at = ?, updated_by = ? WHERE id = ? AND organization_id = ? AND website_id = ? AND archived_at IS NULL AND kind = 'approval' AND status IN ('approved', 'rejected')").bind(at, actor.trim(), updateId, organizationId, websiteId),
      audit(db, organizationId, "admin", actor, "website.update.review_requested", "website_update", updateId, at, {}),
    ]);
    return r.meta.changes === 1 ? ok() : fail("not_found");
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

export async function archiveUpdate(db, organizationId, websiteId, updateId, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id"); requireId(updateId, "update_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const at = isoTime(now);
  try {
    const [r] = await db.batch([
      db.prepare("UPDATE website_updates SET archived_at = ?, updated_at = ?, updated_by = ? WHERE id = ? AND organization_id = ? AND website_id = ? AND archived_at IS NULL").bind(at, at, actor.trim(), updateId, organizationId, websiteId),
      audit(db, organizationId, "admin", actor, "website.update.archived", "website_update", updateId, at, {}),
    ]);
    return r.meta.changes === 1 ? ok() : fail("not_found");
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

export async function createTask(db, organizationId, websiteId, input, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!plain(input) || Object.keys(input).some((k) => !["title", "detail", "cta", "due_date", "published"].includes(k))) return fail("invalid_input");
  const c = checkTask(input, { partial: false });
  if (c.error) return fail(c.error);
  const v = c.values, pub = v.published === true, id = newId(), at = isoTime(now);
  try {
    if (!(await siteOk(db, organizationId, websiteId))) return fail("not_found");
    const n = await db.prepare("SELECT COUNT(*) AS n FROM website_tasks WHERE organization_id = ? AND website_id = ? AND archived_at IS NULL").bind(organizationId, websiteId).first();
    if (n.n >= MAX_TASKS) return fail("too_many");
    await db.batch([
      db.prepare("INSERT INTO website_tasks (id, organization_id, website_id, title, detail, cta, due_date, published, published_at, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, organizationId, websiteId, v.title, v.detail ?? null, v.cta || "respond", v.due_date ?? null, pub ? 1 : 0, pub ? at : null, at, at, actor.trim()),
      audit(db, organizationId, "admin", actor, "website.task.created", "website_task", id, at, { cta: v.cta || "respond", published: pub }),
    ]);
    return ok({ id });
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

export async function updateTask(db, organizationId, websiteId, taskId, patch, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id"); requireId(taskId, "task_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!plain(patch) || Object.keys(patch).length === 0 || Object.keys(patch).some((k) => !["title", "detail", "cta", "due_date", "status", "published"].includes(k))) return fail("invalid_input");
  const c = checkTask(patch, { partial: true });
  if (c.error) return fail(c.error);
  const v = c.values, at = isoTime(now);
  try {
    const cur = await db.prepare("SELECT status, published FROM website_tasks WHERE id = ? AND organization_id = ? AND website_id = ? AND archived_at IS NULL").bind(taskId, organizationId, websiteId).first();
    if (!cur) return fail("not_found");
    const sets = [], vals = [];
    for (const k of ["title", "detail", "cta", "due_date"]) if (Object.hasOwn(v, k)) { sets.push(`${k} = ?`); vals.push(v[k]); }
    if (v.status && v.status !== cur.status) {
      sets.push("status = ?"); vals.push(v.status);
      if (v.status === "open") sets.push("response_text = NULL", "responded_at = NULL", "responded_by = NULL"); // reopened: the client is asked again (the earlier answer stays in the audit log)
    }
    if (Object.hasOwn(v, "published") && v.published !== (cur.published === 1)) { sets.push("published = ?", "published_at = ?"); vals.push(v.published ? 1 : 0, v.published ? at : null); }
    if (!sets.length) return ok();
    await db.batch([
      db.prepare(`UPDATE website_tasks SET ${sets.join(", ")}, updated_at = ?, updated_by = ? WHERE id = ? AND organization_id = ? AND website_id = ?`).bind(...vals, at, actor.trim(), taskId, organizationId, websiteId),
      audit(db, organizationId, "admin", actor, "website.task.edited", "website_task", taskId, at, { fields: Object.keys(v) }),
    ]);
    return ok();
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

export async function archiveTask(db, organizationId, websiteId, taskId, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id"); requireId(taskId, "task_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const at = isoTime(now);
  try {
    const [r] = await db.batch([
      db.prepare("UPDATE website_tasks SET archived_at = ?, updated_at = ?, updated_by = ? WHERE id = ? AND organization_id = ? AND website_id = ? AND archived_at IS NULL").bind(at, at, actor.trim(), taskId, organizationId, websiteId),
      audit(db, organizationId, "admin", actor, "website.task.archived", "website_task", taskId, at, {}),
    ]);
    return r.meta.changes === 1 ? ok() : fail("not_found");
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

/* ------------------------------------------------------------------ the client */

/**
 * What the client sees of one website's workspace: the Staging address, the published updates (newest first) and the published tasks (what is needed first, a few recently done after).
 * null when the website is not theirs/visible; { available: false } on a database without migration 0030 (the page then shows only the environments).
 */
export async function getWorkspaceForClient(db, organizationId, websiteId) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  try {
    if (!(await clientSiteOk(db, organizationId, websiteId))) return null;
    const updates = (await db.prepare(`SELECT ${UPDATE_COLS} FROM website_updates WHERE organization_id = ? AND website_id = ? AND published = 1 AND archived_at IS NULL ORDER BY (status = 'awaiting_review') DESC, published_at DESC, id LIMIT ?`).bind(organizationId, websiteId, CLIENT_UPDATES).all()).results.map(toUpdate);
    const open = (await db.prepare(`SELECT ${TASK_COLS} FROM website_tasks WHERE organization_id = ? AND website_id = ? AND published = 1 AND archived_at IS NULL AND status IN ('open', 'submitted') ORDER BY status = 'submitted', due_date IS NULL, due_date, published_at DESC, id`).bind(organizationId, websiteId).all()).results.map(toTask);
    const done = (await db.prepare(`SELECT ${TASK_COLS} FROM website_tasks WHERE organization_id = ? AND website_id = ? AND published = 1 AND archived_at IS NULL AND status = 'done' ORDER BY updated_at DESC, id LIMIT ?`).bind(organizationId, websiteId, CLIENT_DONE_TASKS).all()).results.map(toTask);
    const stagingUrl = (await readStagingUrl(db, organizationId, websiteId, { client: true })) ?? null;
    return { available: true, stagingUrl, updates, tasks: [...open, ...done], needsReview: updates.filter((u) => u.kind === "approval" && u.status === "awaiting_review").length, needed: open.filter((t) => t.status === "open").length };
  } catch (err) { if (missing(err)) return { available: false, stagingUrl: null, updates: [], tasks: [], needsReview: 0, needed: 0 }; throw err; }
}

/** How many things wait for this organization across its websites (for a badge or a Home line): updates awaiting review plus tasks still needed. 0 when unavailable. */
export async function workspaceAttention(db, organizationId) {
  requireOrgId(organizationId);
  try {
    const u = await db.prepare("SELECT COUNT(*) AS n FROM website_updates x JOIN websites w ON w.id = x.website_id AND w.organization_id = x.organization_id WHERE x.organization_id = ? AND x.published = 1 AND x.archived_at IS NULL AND x.kind = 'approval' AND x.status = 'awaiting_review' AND w.published = 1 AND w.archived_at IS NULL").bind(organizationId).first();
    const t = await db.prepare("SELECT COUNT(*) AS n FROM website_tasks x JOIN websites w ON w.id = x.website_id AND w.organization_id = x.organization_id WHERE x.organization_id = ? AND x.published = 1 AND x.archived_at IS NULL AND x.status = 'open' AND w.published = 1 AND w.archived_at IS NULL").bind(organizationId).first();
    return { updates: u.n, tasks: t.n };
  } catch (err) { if (missing(err)) return { updates: 0, tasks: 0 }; throw err; }
}

/** A client's decision on an update: approve, or reject with revision notes. `who` = { userId, email }. */
export async function decideUpdate(db, organizationId, websiteId, updateId, { decision, note }, who, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id"); requireId(updateId, "update_id");
  if (!who || !validActor(who.email)) return fail("invalid_actor");
  if (decision !== "approve" && decision !== "reject") return fail("invalid_decision");
  let text = null;
  if (decision === "reject") { text = validateText(note, 1000); if (text === undefined || text === null || text.length < 3) return fail("invalid_note"); }
  const status = decision === "approve" ? "approved" : "rejected", at = isoTime(now), by = who.email.trim();
  try {
    if (!(await clientSiteOk(db, organizationId, websiteId))) return fail("not_found");
    // One batch (a transaction): the audit row first, written only while the update is still awaiting review, then the compare-and-set itself with the same condition. A second click, a replay or a
    // request that races this one finds the update already decided: it writes neither the decision nor an audit row.
    const awaiting = "id = ? AND organization_id = ? AND website_id = ? AND published = 1 AND archived_at IS NULL AND kind = 'approval' AND status = 'awaiting_review'";
    const results = await db.batch([
      db.prepare(`INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, ?, 'client', ?, ?, 'website_update', ?, ?, 'internal', ? WHERE EXISTS (SELECT 1 FROM website_updates WHERE ${awaiting})`)
        .bind(newId(), organizationId, by, `website.update.${status}`, updateId, JSON.stringify({ note: text }), at, updateId, organizationId, websiteId),
      db.prepare(`UPDATE website_updates SET status = ?, decision_note = ?, decided_at = ?, decided_by = ?, updated_at = ?, updated_by = ? WHERE ${awaiting}`).bind(status, text, at, by, at, by, updateId, organizationId, websiteId),
    ]);
    if (results[1].meta.changes === 1) return ok({ status });
    const cur = await db.prepare("SELECT status FROM website_updates WHERE id = ? AND organization_id = ? AND website_id = ? AND published = 1 AND archived_at IS NULL AND kind = 'approval'").bind(updateId, organizationId, websiteId).first();
    return cur ? fail("already_decided") : fail("not_found");
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

/** A client's written answer to a task (respond or review). Allowed while the task is still needed or already sent (they may correct it); never once Framework has marked it done or cancelled it. */
export async function respondTask(db, organizationId, websiteId, taskId, { text }, who, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id"); requireId(taskId, "task_id");
  if (!who || !validActor(who.email)) return fail("invalid_actor");
  const t = validateText(text, 1000);
  if (t === undefined || t === null) return fail("invalid_text");
  const at = isoTime(now), by = who.email.trim();
  try {
    if (!(await clientSiteOk(db, organizationId, websiteId))) return fail("not_found");
    const answerable = "id = ? AND organization_id = ? AND website_id = ? AND published = 1 AND archived_at IS NULL AND cta IN ('respond', 'review') AND status IN ('open', 'submitted')";
    const results = await db.batch([
      db.prepare(`INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, ?, 'client', ?, 'website.task.responded', 'website_task', ?, ?, 'internal', ? WHERE EXISTS (SELECT 1 FROM website_tasks WHERE ${answerable})`)
        .bind(newId(), organizationId, by, taskId, JSON.stringify({ length: t.length }), at, taskId, organizationId, websiteId),
      db.prepare(`UPDATE website_tasks SET status = 'submitted', response_text = ?, responded_at = ?, responded_by = ?, updated_at = ?, updated_by = ? WHERE ${answerable}`).bind(t, at, by, at, by, taskId, organizationId, websiteId),
    ]);
    return results[1].meta.changes === 1 ? ok() : fail("not_found");
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}
