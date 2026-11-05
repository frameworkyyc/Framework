/**
 * Discovery retention and permanent deletion.
 *
 *  eraseAssessment   Permanently deletes ONE assessment: its files (main storage and the backup copy), answers, links and upload records, atomically in the database, and
 *                    leaves one audit entry that holds counts only. Fails closed: if any file cannot be deleted nothing in the database is touched, and the same call can be
 *                    repeated safely (deleting an absent object succeeds). Used by the Admin "Delete permanently" action (a guest's deletion request) and by the retention job.
 *  retentionPlan     Read-only: the assessments whose organization has an explicit relationship end date at least 90 days old.
 *  runRetention      Applies the plan, a few assessments per run. It is a DRY RUN unless the caller passes dryRun:false AND the owner has switched PORTAL_DISCOVERY_RETENTION to "1";
 *                    otherwise it only counts. It never infers an end date from archiving or status, re-checks the date right before each deletion, needs the main bucket,
 *                    and fails closed if the database cannot be read. Only counts and outcome words are logged (never a key, name or answer).
 */
import { newId, isoTime, ok, fail } from "../repo/common.js";
import { deleteObject } from "../files/index.js";
import { retentionEnabled } from "../config.js";
import { logEvent } from "../log.js";

export const RETENTION_DAYS = 90;
export const RETENTION_LIMIT = 3; // assessments per run: each may have up to 10 files, and the platform limits the work done in one run
const DAY = 86400000;
const ymd = (d) => d.toISOString().slice(0, 10);
export const cutoffFor = (now, days = RETENTION_DAYS) => ymd(new Date(now.getTime() - days * DAY));

/** Assessments due for deletion: relationship ended on or before the cutoff date. Throws if the database cannot answer. */
export async function retentionPlan(db, { now = new Date(), days = RETENTION_DAYS, limit = 200 } = {}) {
  const cutoff = cutoffFor(now, days);
  const rows = (await db.prepare(
    `SELECT a.id, a.organization_id, a.title, a.status, r.ended_on
       FROM discovery_assessments a JOIN client_relationships r ON r.organization_id = a.organization_id
      WHERE r.ended_on <= ? ORDER BY r.ended_on, a.created_at LIMIT ?`).bind(cutoff, limit).all()).results;
  return { cutoff, due: rows.map((r) => ({ id: r.id, organizationId: r.organization_id, title: r.title, status: r.status, endedOn: r.ended_on })) };
}

/**
 * @param deps { db, bucket, backup? }   bucket = the main private bucket, backup = its private backup bucket (optional)
 * @param opts { organizationId, assessmentId, actor, now, endedBefore? }  endedBefore: only erase while the organization's recorded end date is on or before this date (the retention job)
 */
export async function eraseAssessment(deps, { organizationId, assessmentId, actor, now = new Date(), endedBefore = null }) {
  const { db, bucket, backup } = deps;
  const found = await db.prepare("SELECT id FROM discovery_assessments WHERE id = ? AND organization_id = ?").bind(assessmentId, organizationId).first();
  if (!found) return fail("not_found");
  if (endedBefore) {
    const still = await db.prepare("SELECT 1 AS x FROM client_relationships WHERE organization_id = ? AND ended_on <= ?").bind(organizationId, endedBefore).first();
    if (!still) return fail("not_due"); // the date was cleared or changed since the plan was made
  }
  const keys = (await db.prepare("SELECT storage_key FROM discovery_uploads WHERE assessment_id = ? AND organization_id = ?").bind(assessmentId, organizationId).all()).results.map((r) => r.storage_key);
  if (keys.length && !(bucket && typeof bucket.delete === "function")) return fail("storage_unavailable");
  let removed = 0;
  for (const key of keys) {
    try {
      await deleteObject(bucket, { key, organizationId });
      if (backup && backup !== bucket && typeof backup.delete === "function") await backup.delete(key);
      removed++;
    } catch { return fail("storage_delete_failed"); } // nothing in the database has changed; the same call can be repeated
  }
  const at = isoTime(now);
  const guard = endedBefore ? " AND EXISTS (SELECT 1 FROM client_relationships WHERE organization_id = ? AND ended_on <= ?)" : "";
  const g = endedBefore ? [organizationId, endedBefore] : [];
  const res = await db.batch([
    db.prepare(`DELETE FROM discovery_uploads WHERE assessment_id = ? AND organization_id = ?${guard}`).bind(assessmentId, organizationId, ...g),
    db.prepare(`DELETE FROM discovery_answers WHERE assessment_id = ? AND EXISTS (SELECT 1 FROM discovery_assessments WHERE id = ? AND organization_id = ?)${guard}`).bind(assessmentId, assessmentId, organizationId, ...g),
    db.prepare(`DELETE FROM discovery_links WHERE assessment_id = ? AND EXISTS (SELECT 1 FROM discovery_assessments WHERE id = ? AND organization_id = ?)${guard}`).bind(assessmentId, assessmentId, organizationId, ...g),
    db.prepare(`INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at)
                SELECT ?, a.organization_id, ?, ?, 'discovery.erased', 'discovery', a.id, ?, 'internal', ? FROM discovery_assessments a WHERE a.id = ? AND a.organization_id = ?${guard}`)
      .bind(newId(), endedBefore ? "system" : "admin", actor, JSON.stringify({ files: removed, via: endedBefore ? "retention" : "admin" }), at, assessmentId, organizationId, ...g),
    db.prepare(`DELETE FROM discovery_assessments WHERE id = ? AND organization_id = ?${guard}`).bind(assessmentId, organizationId, ...g),
  ]);
  const gone = res[4].meta.changes === 1;
  return gone ? ok({ files: removed, uploads: res[0].meta.changes, answers: res[1].meta.changes, links: res[2].meta.changes }) : fail("not_found");
}

/** @returns {Promise<{ok:boolean, dryRun:boolean, enabled:boolean, skipped?:string, cutoff?:string, due:number, erased:number, failed:number, remaining:number}>} */
export async function runRetention(env, { now = new Date(), dryRun = true, limit = RETENTION_LIMIT, log = logEvent } = {}) {
  const enabled = retentionEnabled(env);
  const real = dryRun === false && enabled; // anything else only counts
  const r = { ok: true, dryRun: !real, enabled, due: 0, erased: 0, failed: 0, remaining: 0 };
  if (!env || !env.PORTAL_DB) return { ...r, skipped: "not_configured" };
  if (real && !env.PORTAL_FILES) return { ...r, ok: false, skipped: "storage_unavailable" };
  try {
    const plan = await retentionPlan(env.PORTAL_DB, { now });
    r.cutoff = plan.cutoff; r.due = plan.due.length;
    if (!real) { r.remaining = plan.due.length; log({ evt: "retention.run", outcome: "dry_run", count: plan.due.length }); return r; }
    for (const item of plan.due) {
      if (r.erased + r.failed >= limit) break;
      const out = await eraseAssessment({ db: env.PORTAL_DB, bucket: env.PORTAL_FILES, backup: env.PORTAL_FILES_BACKUP }, { organizationId: item.organizationId, assessmentId: item.id, actor: "retention", now, endedBefore: plan.cutoff });
      if (out.ok) r.erased++; else r.failed++;
    }
    r.remaining = r.due - r.erased - r.failed;
    if (r.failed) r.ok = false;
    log({ evt: "retention.run", outcome: r.ok ? "ok" : "error", count: r.erased });
  } catch {
    log({ evt: "retention.run", outcome: "error" });
    return { ...r, ok: false, skipped: "database_unreadable" }; // fail closed: an unreadable database never leads to a deletion
  }
  return r;
}
