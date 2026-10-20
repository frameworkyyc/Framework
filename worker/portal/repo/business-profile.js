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
 * Save one step of the questionnaire.
 * @returns {Promise<{ok:true, missingRequired:string[], changed:string[]} | {ok:false, error:string, errors?:Record<string,string>, values?:Record<string,string>}>}
 *   Invalid answers save NOTHING. Unanswered required questions do not block a save (progress is kept); they only keep the step incomplete.
 *   `changed` lists the questions whose stored answer actually differs from what was submitted. Only those are written (with ONE audit entry);
 *   when nothing differs, NOTHING is written (no rows, no audit entry), so callers can truthfully say "no changes".
 */
export async function saveProfileStep(db, organizationId, userId, stepId, input, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  requireUserId(userId);
  const step = stepById(stepId);
  if (!step) return fail("unknown_step");
  const { values, errors } = validateStep(step, input);
  if (Object.keys(errors).length) return fail("invalid_answers", { errors, values });
  const t = isoTime(now);
  const stored = (await db.prepare("SELECT field_id, value FROM business_profile_answers WHERE organization_id = ?").bind(organizationId).all()).results;
  const current = Object.fromEntries(stored.map((r) => [r.field_id, r.value]));
  const changed = step.fields.filter((def) => (typeof current[def.id] === "string" ? current[def.id] : "") !== values[def.id]).map((def) => def.id);
  if (!changed.length) return ok({ missingRequired: stepStatus(step, values).missingRequired, changed });
  const statements = step.fields.filter((def) => changed.includes(def.id)).map((def) =>
    values[def.id] === ""
      ? db.prepare("DELETE FROM business_profile_answers WHERE organization_id = ? AND field_id = ?").bind(organizationId, def.id)
      : db
          .prepare(
            "INSERT INTO business_profile_answers (organization_id, field_id, value, schema_version, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
              "ON CONFLICT (organization_id, field_id) DO UPDATE SET value = excluded.value, schema_version = excluded.schema_version, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
          )
          .bind(organizationId, def.id, values[def.id], PROFILE_SCHEMA_VERSION, userId, t),
  );
  // the audit entry carries the step id only, never an answer
  statements.push(
    db
      .prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) VALUES (?, ?, 'client', ?, 'profile.updated', 'profile', ?, ?, 'internal', ?)")
      .bind(newId(), organizationId, userId, step.id, JSON.stringify({ step: step.id, v: PROFILE_SCHEMA_VERSION }), t),
  );
  await db.batch(statements);
  return ok({ missingRequired: stepStatus(step, values).missingRequired, changed });
}
