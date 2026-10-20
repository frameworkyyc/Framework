/**
 * Business Profile answers: tenant-owned. Every function takes the organization id (from the membership lookup, never from the browser),
 * validates it with requireOrgId and puts `organization_id = ?` in the SQL. Answers are validated against profile-schema.js before they are
 * written; a step is saved in ONE atomic batch (all its answers plus the audit entry, or nothing).
 */
import { newId, isoTime, requireOrgId, requireUserId, ok, fail } from "./common.js";
import { PROFILE_SCHEMA_VERSION, FIELD_IDS, stepById, validateStep, stepStatus } from "../profile-schema.js";

/** Saved answers for one organization as { fieldId: value }, limited to questions that exist in the current schema. */
export async function getProfileAnswers(db, organizationId) {
  requireOrgId(organizationId);
  const rows = (await db.prepare("SELECT field_id, value FROM business_profile_answers WHERE organization_id = ?").bind(organizationId).all()).results;
  const out = {};
  for (const r of rows) if (FIELD_IDS.has(r.field_id) && typeof r.value === "string") out[r.field_id] = r.value;
  return out;
}

/**
 * The REVISION of one step: the id of the newest `profile.updated` audit entry for that step in this organization ('' when the step was never saved).
 * Every write that changes a step inserts exactly one such entry (last, in the same atomic batch), so the revision changes whenever, and only when, the
 * saved answers of the step change. It needs no extra column or migration. It is read by the page BEFORE the answers, so a save that lands between the
 * two reads makes the form look older than it is (a conflict later) and never newer (a silent overwrite).
 * Ordered by rowid (insertion order), not by timestamp, so clock differences between Workers cannot hide a newer entry; matching the id (not the rowid)
 * means a deleted newest entry can never be mistaken for an unchanged step.
 */
const REVISION = "COALESCE((SELECT id FROM activity_log WHERE organization_id = ? AND action = 'profile.updated' AND entity_type = 'profile' AND entity_id = ? ORDER BY rowid DESC LIMIT 1), '')";

export async function getStepRevision(db, organizationId, stepId) {
  requireOrgId(organizationId);
  if (!stepById(stepId)) return "";
  const row = await db.prepare(`SELECT ${REVISION} AS revision`).bind(organizationId, stepId).first();
  return row ? row.revision : "";
}

/**
 * Save one step of the questionnaire.
 * @param opts.expectedRevision the revision the form was loaded with. A string (or null for "missing or malformed") is REQUIRED to match the step's
 *   current revision for anything to be written; undefined means an internal caller with no form (the write is still guarded against concurrent writers).
 * @returns {Promise<{ok:true, missingRequired:string[], changed:string[]} | {ok:false, error:"invalid_answers", errors, values} | {ok:false, error:"conflict", currentValues, revision}>}
 *   Invalid answers save NOTHING. A stale form (the step changed since it was loaded) saves NOTHING and returns the latest saved values and revision.
 *   Unanswered required questions do not block a save (progress is kept); they only keep the step incomplete.
 *   `changed` lists the questions whose stored answer actually differs from what was submitted. Only those are written (with ONE audit entry);
 *   when nothing differs, NOTHING is written (no rows, no audit entry), so callers can truthfully say "no changes".
 *
 * Atomicity: every write statement, and the audit entry that moves the revision (always LAST), carries the same condition "the step's revision is still
 * the one this save was based on". D1 runs a batch as one transaction and serializes writers, so of two simultaneous saves against the same revision the
 * first changes the revision and the second finds its condition false: none of its statements writes anything.
 */
export async function saveProfileStep(db, organizationId, userId, stepId, input, { now = new Date(), expectedRevision } = {}) {
  requireOrgId(organizationId);
  requireUserId(userId);
  const step = stepById(stepId);
  if (!step) return fail("unknown_step");
  const { values, errors } = validateStep(step, input);
  if (Object.keys(errors).length) return fail("invalid_answers", { errors, values });
  const t = isoTime(now);
  const revision = await getStepRevision(db, organizationId, stepId); // read BEFORE the answers (see REVISION)
  const stored = (await db.prepare("SELECT field_id, value FROM business_profile_answers WHERE organization_id = ?").bind(organizationId).all()).results;
  const current = Object.fromEntries(stored.map((r) => [r.field_id, r.value]));
  const currentValues = Object.fromEntries(step.fields.map((def) => [def.id, typeof current[def.id] === "string" ? current[def.id] : ""]));
  const changed = step.fields.filter((def) => currentValues[def.id] !== values[def.id]).map((def) => def.id);
  if (!changed.length) return ok({ missingRequired: stepStatus(step, values).missingRequired, changed });
  const basis = expectedRevision === undefined ? revision : expectedRevision;
  if (basis !== revision) return fail("conflict", { currentValues, revision });
  const guard = `(${REVISION}) = ?`;
  const guardArgs = [organizationId, stepId, basis];
  const statements = step.fields.filter((def) => changed.includes(def.id)).map((def) =>
    values[def.id] === ""
      ? db.prepare(`DELETE FROM business_profile_answers WHERE organization_id = ? AND field_id = ? AND ${guard}`).bind(organizationId, def.id, ...guardArgs)
      : db
          .prepare(
            "INSERT INTO business_profile_answers (organization_id, field_id, value, schema_version, updated_by, updated_at) " +
              `SELECT ?, ?, ?, ?, ?, ? WHERE ${guard} ` +
              "ON CONFLICT (organization_id, field_id) DO UPDATE SET value = excluded.value, schema_version = excluded.schema_version, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
          )
          .bind(organizationId, def.id, values[def.id], PROFILE_SCHEMA_VERSION, userId, t, ...guardArgs),
  );
  // the audit entry carries the step id only, never an answer. It is LAST: inserting it moves the revision, so it must come after every guarded statement.
  statements.push(
    db
      .prepare(`INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, ?, 'client', ?, 'profile.updated', 'profile', ?, ?, 'internal', ? WHERE ${guard}`)
      .bind(newId(), organizationId, userId, step.id, JSON.stringify({ step: step.id, v: PROFILE_SCHEMA_VERSION }), t, ...guardArgs),
  );
  const results = await db.batch(statements);
  if (results[results.length - 1].meta.changes !== 1) {
    // another save won the revision between our read and our write: nothing above wrote anything. Report the latest state.
    const latest = await getStepRevision(db, organizationId, stepId);
    const rows = (await db.prepare("SELECT field_id, value FROM business_profile_answers WHERE organization_id = ?").bind(organizationId).all()).results;
    const now2 = Object.fromEntries(rows.map((r) => [r.field_id, r.value]));
    return fail("conflict", { currentValues: Object.fromEntries(step.fields.map((def) => [def.id, typeof now2[def.id] === "string" ? now2[def.id] : ""])), revision: latest });
  }
  return ok({ missingRequired: stepStatus(step, values).missingRequired, changed });
}
