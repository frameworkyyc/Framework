/**
 * Discovery assessments (migration 0018): assessments, guest links, saved answers, Admin edits to the questions, and the recipient's inspiration files.
 * Rules enforced here, on every call:
 *   - an assessment always belongs to ONE organization; every client-side read names that organization as well as the assessment id (another organization's id is "not found");
 *   - a guest link is found only by the SHA-256 of its token (the token itself is never stored), and only while it is unrevoked, unexpired and its assessment is not archived;
 *   - answers can be written only while the assessment is Not started or In progress (the condition is part of the write statement, so a late save cannot slip in after a submit);
 *   - nothing here reads or writes brand_kits, brand_assets or brand_requirements: discovery preferences stay separate from approved branding.
 * A database without migration 0018 answers { available: false } where a caller can use that, and "not found" otherwise.
 */
import { newId, isoTime, requireOrgId, requireId, ok, fail, validActor, UUID } from "./common.js";
import { kindDef } from "../discovery/catalogue.js";
import { cleanText, parsePicks, CUSTOM_KEY } from "../discovery/model.js";

export const STATUSES = ["not_started", "in_progress", "submitted", "reviewed"];
export const STATUS_LABEL = Object.freeze({ not_started: "Not started", in_progress: "In progress", submitted: "Submitted", reviewed: "Reviewed" });
export const LINK_DEFAULT_DAYS = 14;
export const LINK_MAX_DAYS = 90;
export const MAX_UPLOADS = 10;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_TOTAL = 40 * 1024 * 1024;
const TOKEN_HASH = /^[A-Za-z0-9_-]{43}$/;
const QUESTION_KEY = /^[a-z0-9.-]{1,60}$/;

export const isMissing = (err) => /no such (table|column)/i.test(String(err && err.message));
const audit = (db, org, actorType, actor, action, entity, id, at, detail) =>
  db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'internal', ?)")
    .bind(newId(), org, actorType, actor, action, entity, id, detail ? JSON.stringify(detail).slice(0, 1900) : null, at);

const COLS = "id, organization_id, kind, title, recipient_name, status, stage, overall_comment, review_note, created_at, created_by, updated_at, started_at, submitted_at, reviewed_at, reviewed_by, archived_at";
const toAssessment = (r) => r && ({
  id: r.id, organizationId: r.organization_id, kind: r.kind, title: r.title, recipientName: r.recipient_name, status: r.status, stage: r.stage,
  overallComment: r.overall_comment || "", reviewNote: r.review_note || "", createdAt: r.created_at, createdBy: r.created_by, updatedAt: r.updated_at,
  startedAt: r.started_at, submittedAt: r.submitted_at, reviewedAt: r.reviewed_at, reviewedBy: r.reviewed_by, archivedAt: r.archived_at,
});

/* ------------------------------------------------------------------ assessments */

export async function createAssessment(db, { organizationId, kind, title, recipientName, actor }, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  if (!kindDef(kind)) return fail("invalid_kind");
  if (!validActor(actor)) return fail("invalid_actor");
  const t = cleanText(title, 120).replace(/\n/g, " ");
  if (!t) return fail("invalid_title");
  const rn = recipientName === undefined || recipientName === null || recipientName === "" ? null : cleanText(recipientName, 120).replace(/\n/g, " ") || null;
  const org = await db.prepare("SELECT 1 AS x FROM organizations WHERE id = ? AND status = 'active'").bind(organizationId).first();
  if (!org) return fail("not_found");
  const id = newId(), at = isoTime(now);
  await db.batch([
    db.prepare("INSERT INTO discovery_assessments (id, organization_id, kind, title, recipient_name, created_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, organizationId, kind, t, rn, at, actor.trim(), at),
    audit(db, organizationId, "admin", actor.trim(), "discovery.created", "discovery", id, at, { kind }),
  ]);
  return ok({ id });
}

/** Admin list. Counts are for the dashboard: how many questions are answered, how many files, how many links are usable now. */
export async function listAssessments(db, { organizationId = null, includeArchived = false, now = new Date() } = {}) {
  if (organizationId !== null) requireOrgId(organizationId);
  const at = isoTime(now);
  const where = [organizationId ? "a.organization_id = ?" : "1 = 1", includeArchived ? "1 = 1" : "a.archived_at IS NULL"].join(" AND ");
  try {
    const rows = (await db.prepare(
      `SELECT a.id, a.organization_id, a.kind, a.title, a.recipient_name, a.status, a.stage, a.created_at, a.updated_at, a.submitted_at, a.archived_at, o.name AS organization_name, o.slug AS organization_slug,
              (SELECT count(*) FROM discovery_answers x WHERE x.assessment_id = a.id AND x.picks_json IS NOT NULL) AS answered,
              (SELECT count(*) FROM discovery_uploads u WHERE u.assessment_id = a.id AND u.organization_id = a.organization_id AND u.deleted_at IS NULL) AS uploads,
              (SELECT count(*) FROM discovery_links l WHERE l.assessment_id = a.id AND l.revoked_at IS NULL AND l.expires_at > ?) AS active_links
         FROM discovery_assessments a JOIN organizations o ON o.id = a.organization_id
        WHERE ${where} ORDER BY a.created_at DESC LIMIT 300`).bind(...(organizationId ? [at, organizationId] : [at])).all()).results;
    return { available: true, assessments: rows.map((r) => ({ ...toAssessment({ ...r, overall_comment: null, review_note: null, created_by: "", started_at: null, reviewed_at: null, reviewed_by: null }), organizationName: r.organization_name, organizationSlug: r.organization_slug, answered: r.answered, uploads: r.uploads, activeLinks: r.active_links })) };
  } catch (err) { if (isMissing(err)) return { available: false, assessments: [] }; throw err; }
}

export async function getAssessment(db, organizationId, id) {
  requireOrgId(organizationId); requireId(id, "assessment_id");
  try { return toAssessment(await db.prepare(`SELECT ${COLS} FROM discovery_assessments WHERE id = ? AND organization_id = ?`).bind(id, organizationId).first()); } catch (err) { if (isMissing(err)) return null; throw err; }
}

/** The assessments a signed-in client may see for their organization: not archived, newest first. */
export async function listClientAssessments(db, organizationId) {
  requireOrgId(organizationId);
  try { return (await db.prepare(`SELECT ${COLS} FROM discovery_assessments WHERE organization_id = ? AND archived_at IS NULL ORDER BY created_at DESC LIMIT 20`).bind(organizationId).all()).results.map(toAssessment); } catch (err) { if (isMissing(err)) return []; throw err; }
}

export async function updateAssessment(db, organizationId, id, { title, recipientName }, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(id, "assessment_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const sets = [], params = [];
  if (title !== undefined) { const t = cleanText(title, 120).replace(/\n/g, " "); if (!t) return fail("invalid_title"); sets.push("title = ?"); params.push(t); }
  if (recipientName !== undefined) { sets.push("recipient_name = ?"); params.push(recipientName === null || recipientName === "" ? null : cleanText(recipientName, 120).replace(/\n/g, " ") || null); }
  if (!sets.length) return fail("nothing_to_change");
  const at = isoTime(now);
  const r = await db.prepare(`UPDATE discovery_assessments SET ${sets.join(", ")}, updated_at = ? WHERE id = ? AND organization_id = ? AND archived_at IS NULL`).bind(...params, at, id, organizationId).run();
  return r.meta.changes ? ok() : fail("not_found");
}

export async function archiveAssessment(db, organizationId, id, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(id, "assessment_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const at = isoTime(now);
  const [r] = await db.batch([
    db.prepare("UPDATE discovery_assessments SET archived_at = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND archived_at IS NULL").bind(at, at, id, organizationId),
    db.prepare("UPDATE discovery_links SET revoked_at = ?, revoked_by = ? WHERE assessment_id = ? AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM discovery_assessments WHERE id = ? AND organization_id = ?)").bind(at, actor.trim(), id, id, organizationId),
    audit(db, organizationId, "admin", actor.trim(), "discovery.archived", "discovery", id, at, null),
  ]);
  return r.meta.changes ? ok() : fail("not_found");
}

/** Submitted -> Reviewed, with an optional note. */
export async function reviewAssessment(db, organizationId, id, actor, note, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(id, "assessment_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const n = note === undefined || note === null ? null : cleanText(note, 2000) || null;
  const at = isoTime(now);
  const r = await db.prepare("UPDATE discovery_assessments SET status = 'reviewed', reviewed_at = ?, reviewed_by = ?, review_note = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND status = 'submitted' AND archived_at IS NULL").bind(at, actor.trim(), n, at, id, organizationId).run();
  if (!r.meta.changes) return fail("not_submitted");
  await audit(db, organizationId, "admin", actor.trim(), "discovery.reviewed", "discovery", id, at, null).run();
  return ok();
}

/** Submitted or Reviewed -> In progress, so the recipient can change their answers. */
export async function reopenAssessment(db, organizationId, id, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(id, "assessment_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const at = isoTime(now);
  const r = await db.prepare("UPDATE discovery_assessments SET status = 'in_progress', submitted_at = NULL, reviewed_at = NULL, reviewed_by = NULL, updated_at = ? WHERE id = ? AND organization_id = ? AND status IN ('submitted', 'reviewed') AND archived_at IS NULL").bind(at, id, organizationId).run();
  if (!r.meta.changes) return fail("not_submitted");
  await audit(db, organizationId, "admin", actor.trim(), "discovery.reopened", "discovery", id, at, null).run();
  return ok();
}

/* ------------------------------------------------------------------ links */

export async function createLink(db, organizationId, assessmentId, { tokenHash, label, days }, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(assessmentId, "assessment_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (typeof tokenHash !== "string" || !TOKEN_HASH.test(tokenHash)) return fail("invalid_token");
  const d = days === undefined || days === null || days === "" ? LINK_DEFAULT_DAYS : Number(days);
  if (!Number.isInteger(d) || d < 1 || d > LINK_MAX_DAYS) return fail("invalid_days");
  const lab = label === undefined || label === null || label === "" ? null : cleanText(label, 80).replace(/\n/g, " ") || null;
  const at = isoTime(now), expires = isoTime(new Date(now.getTime() + d * 86400000)), id = newId();
  const [r] = await db.batch([
    db.prepare("INSERT INTO discovery_links (id, assessment_id, token_hash, label, expires_at, created_at, created_by) SELECT ?, a.id, ?, ?, ?, ?, ? FROM discovery_assessments a WHERE a.id = ? AND a.organization_id = ? AND a.archived_at IS NULL AND a.status IN ('not_started', 'in_progress')").bind(id, tokenHash, lab, expires, at, actor.trim(), assessmentId, organizationId),
    audit(db, organizationId, "admin", actor.trim(), "discovery.link.created", "discovery", assessmentId, at, { link: id, days: d }),
  ]);
  return r.meta.changes ? ok({ id, expiresAt: expires }) : fail("not_found");
}

export async function listLinks(db, organizationId, assessmentId, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(assessmentId, "assessment_id");
  const at = isoTime(now);
  const rows = (await db.prepare("SELECT l.id, l.label, l.expires_at, l.revoked_at, l.created_at, l.created_by, l.last_used_at, l.use_count FROM discovery_links l JOIN discovery_assessments a ON a.id = l.assessment_id WHERE l.assessment_id = ? AND a.organization_id = ? ORDER BY l.created_at DESC LIMIT 50").bind(assessmentId, organizationId).all()).results;
  return rows.map((r) => ({ id: r.id, label: r.label, createdAt: r.created_at, createdBy: r.created_by, expiresAt: r.expires_at, revokedAt: r.revoked_at, lastUsedAt: r.last_used_at, useCount: r.use_count, state: r.revoked_at ? "revoked" : r.expires_at <= at ? "expired" : "active" }));
}

export async function revokeLink(db, organizationId, assessmentId, linkId, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(assessmentId, "assessment_id"); requireId(linkId, "link_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const at = isoTime(now);
  const [r] = await db.batch([
    db.prepare("UPDATE discovery_links SET revoked_at = ?, revoked_by = ? WHERE id = ? AND assessment_id = ? AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM discovery_assessments WHERE id = ? AND organization_id = ?)").bind(at, actor.trim(), linkId, assessmentId, assessmentId, organizationId),
    audit(db, organizationId, "admin", actor.trim(), "discovery.link.revoked", "discovery", assessmentId, at, { link: linkId }),
  ]);
  return r.meta.changes ? ok() : fail("not_found");
}

/**
 * The only way a guest link is resolved. Returns { link, assessment } for a link that is unrevoked and unexpired on an unarchived assessment, otherwise null: a wrong,
 * expired, revoked or archived link all look the same to the caller.
 */
export async function resolveLink(db, tokenHash, { now = new Date() } = {}) {
  if (typeof tokenHash !== "string" || !TOKEN_HASH.test(tokenHash)) return null;
  try {
    const r = await db.prepare(`SELECT l.id AS link_id, l.expires_at AS link_expires, l.assessment_id, a.id, a.organization_id, a.kind, a.title, a.recipient_name, a.status, a.stage, a.overall_comment, a.review_note, a.created_at, a.created_by, a.updated_at, a.started_at, a.submitted_at, a.reviewed_at, a.reviewed_by, a.archived_at
        FROM discovery_links l JOIN discovery_assessments a ON a.id = l.assessment_id
       WHERE l.token_hash = ? AND l.revoked_at IS NULL AND l.expires_at > ? AND a.archived_at IS NULL`).bind(tokenHash, isoTime(now)).first();
    return r ? { link: { id: r.link_id, expiresAt: r.link_expires }, assessment: toAssessment(r) } : null;
  } catch (err) { if (isMissing(err)) return null; throw err; }
}

export const touchLink = (db, linkId, { now = new Date() } = {}) =>
  db.prepare("UPDATE discovery_links SET last_used_at = ?, use_count = use_count + 1 WHERE id = ?").bind(isoTime(now), linkId).run();

/* ------------------------------------------------------------------ answers */

export async function getAnswers(db, assessmentId) {
  requireId(assessmentId, "assessment_id");
  const out = new Map();
  try {
    for (const r of (await db.prepare("SELECT question_key, picks_json, comment FROM discovery_answers WHERE assessment_id = ?").bind(assessmentId).all()).results) out.set(r.question_key, { picks: r.picks_json ? parsePicks(r.picks_json) : null, comment: r.comment || "" });
  } catch (err) { if (!isMissing(err)) throw err; }
  return out;
}

/**
 * Saves one stage's answers and moves the "where I left off" marker. `entries` is { questionKey: { picks | null, comment } } and has been validated against the question
 * list by the caller. Allowed only while the assessment is Not started or In progress. `by` is { type: 'client'|'admin', ref } for the audit entry (a guest is recorded
 * as the link, never as a person).
 */
export async function saveAnswers(db, assessment, entries, { nextStage, by, now = new Date() }) {
  const at = isoTime(now);
  const stmts = [];
  const open = "EXISTS (SELECT 1 FROM discovery_assessments WHERE id = ? AND organization_id = ? AND status IN ('not_started', 'in_progress') AND archived_at IS NULL)";
  stmts.push(db.prepare("UPDATE discovery_assessments SET status = 'in_progress', started_at = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND status = 'not_started' AND archived_at IS NULL").bind(at, at, assessment.id, assessment.organizationId));
  stmts.push(db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, ?, ?, ?, 'discovery.started', 'discovery', ?, NULL, 'internal', ? WHERE changes() > 0").bind(newId(), assessment.organizationId, by.type, by.ref, assessment.id, at));
  for (const [key, e] of Object.entries(entries)) {
    if (!QUESTION_KEY.test(key)) return fail("invalid_question");
    const comment = e.comment ? e.comment.slice(0, 500) : null;
    if (!e.picks && !comment) { stmts.push(db.prepare(`DELETE FROM discovery_answers WHERE assessment_id = ? AND question_key = ? AND ${open}`).bind(assessment.id, key, assessment.id, assessment.organizationId)); continue; }
    stmts.push(db.prepare(`INSERT INTO discovery_answers (assessment_id, question_key, picks_json, comment, updated_at) SELECT ?, ?, ?, ?, ? WHERE ${open} ON CONFLICT (assessment_id, question_key) DO UPDATE SET picks_json = excluded.picks_json, comment = excluded.comment, updated_at = excluded.updated_at`)
      .bind(assessment.id, key, e.picks ? JSON.stringify(e.picks) : null, comment, at, assessment.id, assessment.organizationId));
  }
  stmts.push(db.prepare("UPDATE discovery_assessments SET stage = max(stage, ?), updated_at = ? WHERE id = ? AND organization_id = ? AND status IN ('not_started', 'in_progress') AND archived_at IS NULL").bind(nextStage, at, assessment.id, assessment.organizationId));
  const res = await db.batch(stmts.filter(Boolean));
  return res[res.length - 1].meta.changes ? ok() : fail("closed");
}

export async function saveOverallComment(db, assessment, text, { now = new Date() } = {}) {
  const c = cleanText(text, 1000) || null;
  const r = await db.prepare("UPDATE discovery_assessments SET overall_comment = ?, updated_at = ? WHERE id = ? AND organization_id = ? AND status IN ('not_started', 'in_progress') AND archived_at IS NULL").bind(c, isoTime(now), assessment.id, assessment.organizationId).run();
  return r.meta.changes ? ok() : fail("closed");
}

/** In progress -> Submitted. Needs at least one answered question (a "not sure" counts: it is an answer). */
export async function submitAssessment(db, assessment, by, { now = new Date() } = {}) {
  const at = isoTime(now);
  const [r] = await db.batch([
    db.prepare("UPDATE discovery_assessments SET status = 'submitted', submitted_at = ?, stage = 6, updated_at = ? WHERE id = ? AND organization_id = ? AND status IN ('not_started', 'in_progress') AND archived_at IS NULL AND EXISTS (SELECT 1 FROM discovery_answers WHERE assessment_id = ? AND picks_json IS NOT NULL)").bind(at, at, assessment.id, assessment.organizationId, assessment.id),
    db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, ?, ?, ?, 'discovery.submitted', 'discovery', ?, NULL, 'internal', ? WHERE changes() > 0").bind(newId(), assessment.organizationId, by.type, by.ref, assessment.id, at),
  ]);
  return r.meta.changes ? ok() : fail("nothing_to_submit");
}

/* ------------------------------------------------------------------ content (Admin edits over the built-in questions) */

export async function listContent(db, kind) {
  if (!kindDef(kind)) return { available: true, rows: [] };
  try {
    const rows = (await db.prepare("SELECT id, kind, item_key, option_key, label, description, enabled, sort_order, is_custom, image_key, image_type, image_size, image_alt FROM discovery_content WHERE kind = ?").bind(kind).all()).results;
    return { available: true, rows: rows.map((r) => ({ ...r, image_id: r.image_key ? r.id : null })) };
  } catch (err) { if (isMissing(err)) return { available: false, rows: [] }; throw err; }
}

export async function getContentRow(db, id) {
  requireId(id, "content_id");
  try { return await db.prepare("SELECT id, kind, item_key, option_key, label, description, enabled, sort_order, is_custom, image_key, image_type, image_sha256, image_size, image_alt FROM discovery_content WHERE id = ?").bind(id).first(); } catch (err) { if (isMissing(err)) return null; throw err; }
}

/**
 * Creates or changes the stored difference for one question or option. `patch` may hold label, description, enabled, sort_order. Whether the question/option exists is
 * the caller's check (it knows the catalogue); this layer validates the shapes only.
 */
export async function upsertContent(db, { kind, itemKey, optionKey = "", custom = false, patch }, actor, { now = new Date() } = {}) {
  if (!kindDef(kind) || !QUESTION_KEY.test(itemKey || "")) return fail("invalid_item");
  if (optionKey !== "" && !(custom ? CUSTOM_KEY.test(optionKey) : /^[a-z0-9-]{1,40}$/.test(optionKey))) return fail("invalid_option");
  if (!validActor(actor)) return fail("invalid_actor");
  const row = {};
  if (patch.label !== undefined) { const v = cleanText(patch.label, optionKey === "" ? 120 : 60).replace(/\n/g, " "); if (!v) return fail("invalid_label"); row.label = v; }
  if (patch.description !== undefined) { const v = cleanText(patch.description, optionKey === "" ? 240 : 140).replace(/\n/g, " "); row.description = v || null; }
  if (patch.enabled !== undefined) { if (typeof patch.enabled !== "boolean") return fail("invalid_enabled"); row.enabled = patch.enabled ? 1 : 0; }
  if (patch.sort_order !== undefined) { if (!Number.isInteger(patch.sort_order) || patch.sort_order < 0 || patch.sort_order > 9999) return fail("invalid_sort_order"); row.sort_order = patch.sort_order; }
  if (!Object.keys(row).length) return fail("nothing_to_change");
  if (custom && row.label === undefined) {
    const existing = await db.prepare("SELECT 1 AS x FROM discovery_content WHERE kind = ? AND item_key = ? AND option_key = ?").bind(kind, itemKey, optionKey).first();
    if (!existing) return fail("invalid_label");
  }
  const at = isoTime(now), id = newId();
  const cols = Object.keys(row);
  await db.batch([
    db.prepare(`INSERT INTO discovery_content (id, kind, item_key, option_key, is_custom, updated_by, updated_at, ${cols.join(", ")}) VALUES (?, ?, ?, ?, ?, ?, ?, ${cols.map(() => "?").join(", ")})
                ON CONFLICT (kind, item_key, option_key) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(", ")}, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(id, kind, itemKey, optionKey, custom ? 1 : 0, actor.trim(), at, ...cols.map((c) => row[c])),
    audit(db, null, "admin", actor.trim(), "discovery.content.updated", "discovery_content", null, at, { kind, item: itemKey, option: optionKey || null, fields: cols }),
  ]);
  const saved = await db.prepare("SELECT id FROM discovery_content WHERE kind = ? AND item_key = ? AND option_key = ?").bind(kind, itemKey, optionKey).first();
  return ok({ id: saved.id });
}

/** Removes the stored difference entirely (a built-in option goes back to the standard wording; a custom option is deleted). Returns the image key to delete, if any. */
export async function deleteContent(db, id, actor, { now = new Date() } = {}) {
  requireId(id, "content_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const row = await getContentRow(db, id);
  if (!row) return fail("not_found");
  const at = isoTime(now);
  await db.batch([
    db.prepare("DELETE FROM discovery_content WHERE id = ?").bind(id),
    audit(db, null, "admin", actor.trim(), "discovery.content.reset", "discovery_content", null, at, { kind: row.kind, item: row.item_key, option: row.option_key || null }),
  ]);
  return ok({ imageKey: row.image_key || null });
}

export async function setContentImage(db, id, image, actor, { now = new Date() } = {}) {
  requireId(id, "content_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const at = isoTime(now);
  const r = await db.prepare("UPDATE discovery_content SET image_key = ?, image_type = ?, image_sha256 = ?, image_size = ?, image_alt = ?, updated_by = ?, updated_at = ? WHERE id = ?")
    .bind(image ? image.key : null, image ? image.type : null, image ? image.sha256 : null, image ? image.size : null, image ? cleanText(image.alt || "", 160).replace(/\n/g, " ") || null : null, actor.trim(), at, id).run();
  return r.meta.changes ? ok() : fail("not_found");
}

/** Makes sure a stored row exists for (kind, item, option) so a picture can be attached to a built-in option that has no changes yet. */
export async function ensureContentRow(db, { kind, itemKey, optionKey }, actor, { now = new Date() } = {}) {
  const found = await db.prepare("SELECT id FROM discovery_content WHERE kind = ? AND item_key = ? AND option_key = ?").bind(kind, itemKey, optionKey).first();
  if (found) return ok({ id: found.id });
  const id = newId();
  await db.prepare("INSERT INTO discovery_content (id, kind, item_key, option_key, is_custom, updated_by, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)").bind(id, kind, itemKey, optionKey, actor.trim(), isoTime(now)).run();
  return ok({ id });
}

/* ------------------------------------------------------------------ inspiration uploads */

export async function uploadUsage(db, organizationId, assessmentId) {
  const r = await db.prepare("SELECT count(*) AS files, coalesce(sum(size_bytes), 0) AS bytes FROM discovery_uploads WHERE assessment_id = ? AND organization_id = ? AND deleted_at IS NULL").bind(assessmentId, organizationId).first();
  return { files: r.files, bytes: r.bytes };
}

export async function addUpload(db, assessment, meta, by, { now = new Date() } = {}) {
  const at = isoTime(now), id = newId();
  const [r] = await db.batch([
    db.prepare("INSERT INTO discovery_uploads (id, assessment_id, organization_id, original_name, format, content_type, size_bytes, sha256, storage_key, created_at) SELECT ?, a.id, a.organization_id, ?, ?, ?, ?, ?, ?, ? FROM discovery_assessments a WHERE a.id = ? AND a.organization_id = ? AND a.status IN ('not_started', 'in_progress') AND a.archived_at IS NULL")
      .bind(id, meta.name, meta.ext, meta.contentType, meta.size, meta.sha256, meta.key, at, assessment.id, assessment.organizationId),
    db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, ?, ?, ?, 'discovery.upload.added', 'discovery', ?, ?, 'internal', ? WHERE changes() > 0").bind(newId(), assessment.organizationId, by.type, by.ref, assessment.id, JSON.stringify({ upload: id, format: meta.ext, size: meta.size }), at),
  ]);
  return r.meta.changes ? ok({ id }) : fail("closed");
}

export async function listUploads(db, organizationId, assessmentId) {
  requireOrgId(organizationId); requireId(assessmentId, "assessment_id");
  try {
    return (await db.prepare("SELECT id, original_name, format, content_type, size_bytes, created_at FROM discovery_uploads WHERE assessment_id = ? AND organization_id = ? AND deleted_at IS NULL ORDER BY created_at").bind(assessmentId, organizationId).all()).results
      .map((r) => ({ id: r.id, name: r.original_name, format: r.format, contentType: r.content_type, size: r.size_bytes, createdAt: r.created_at }));
  } catch (err) { if (isMissing(err)) return []; throw err; }
}

export async function getUpload(db, organizationId, assessmentId, id) {
  requireOrgId(organizationId); requireId(assessmentId, "assessment_id"); requireId(id, "upload_id");
  const r = await db.prepare("SELECT id, original_name, format, content_type, size_bytes, storage_key FROM discovery_uploads WHERE id = ? AND assessment_id = ? AND organization_id = ? AND deleted_at IS NULL").bind(id, assessmentId, organizationId).first();
  return r ? { id: r.id, name: r.original_name, format: r.format, contentType: r.content_type, size: r.size_bytes, storageKey: r.storage_key } : null;
}

/** Soft delete (the object is removed by the caller). Only while the assessment is still open for the recipient. */
export async function removeUpload(db, assessment, id, by, { now = new Date() } = {}) {
  const at = isoTime(now);
  const [r] = await db.batch([
    db.prepare("UPDATE discovery_uploads SET deleted_at = ?, deleted_by = ? WHERE id = ? AND assessment_id = ? AND organization_id = ? AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM discovery_assessments WHERE id = ? AND organization_id = ? AND status IN ('not_started', 'in_progress'))").bind(at, by.ref, id, assessment.id, assessment.organizationId, assessment.id, assessment.organizationId),
    db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, ?, ?, ?, 'discovery.upload.removed', 'discovery', ?, ?, 'internal', ? WHERE changes() > 0").bind(newId(), assessment.organizationId, by.type, by.ref, assessment.id, JSON.stringify({ upload: id }), at),
  ]);
  return r.meta.changes ? ok() : fail("not_found");
}

/** Live object keys of an organization's discovery uploads (for the storage check that finds orphans). */
export async function listLiveStorageKeys(db, organizationId) {
  requireOrgId(organizationId);
  try { return (await db.prepare("SELECT storage_key FROM discovery_uploads WHERE organization_id = ? AND deleted_at IS NULL").bind(organizationId).all()).results.map((r) => r.storage_key); } catch (err) { if (isMissing(err)) return []; throw err; }
}
export { UUID };
