/** Projects: tenant-owned. Every function takes the organization id and scopes by it; an id from another organization is simply "not found". */
import { newId, isoTime, requireOrgId, requireId, ok, fail, isConstraintViolation } from "./common.js";
import { validateName, validateText, validateHttpsUrl, validateKind, validateEnum, PROJECT_STATUSES } from "./validate.js";

const COLUMNS = "id, organization_id, name, kind, status, live_url, summary, created_at, updated_at";

export async function createProject(db, organizationId, input, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  const name = validateName(input && input.name);
  if (!name) return fail("invalid_name");
  const kind = input.kind === undefined ? "website" : validateKind(input.kind);
  if (!kind) return fail("invalid_kind");
  const status = input.status === undefined ? "discovery" : validateEnum(input.status, PROJECT_STATUSES);
  if (!status) return fail("invalid_status");
  const liveUrl = validateHttpsUrl(input.liveUrl);
  if (liveUrl === undefined) return fail("invalid_live_url");
  const summary = validateText(input.summary, 2000);
  if (summary === undefined) return fail("invalid_summary");
  const id = newId();
  const t = isoTime(now);
  try {
    await db.prepare("INSERT INTO projects (id, organization_id, name, kind, status, live_url, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, organizationId, name, kind, status, liveUrl, summary, t, t).run();
  } catch (err) {
    if (isConstraintViolation(err)) return fail("invalid_organization"); // unknown organization (foreign key) or a rejected value
    throw err;
  }
  return ok({ project: await getProject(db, organizationId, id) });
}

export async function getProject(db, organizationId, id) {
  requireOrgId(organizationId);
  requireId(id, "project_id");
  return (await db.prepare(`SELECT ${COLUMNS} FROM projects WHERE id = ? AND organization_id = ?`).bind(id, organizationId).first()) || null;
}

export async function listProjects(db, organizationId) {
  requireOrgId(organizationId);
  return (await db.prepare(`SELECT ${COLUMNS} FROM projects WHERE organization_id = ? ORDER BY created_at, id`).bind(organizationId).all()).results;
}

/** Partial update of name, kind, status, liveUrl and summary. Returns not_found for an id outside this organization. */
export async function updateProject(db, organizationId, id, patch, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  requireId(id, "project_id");
  const sets = [];
  const values = [];
  const take = (key, column, valid, error) => {
    if (!(patch && key in patch)) return null;
    const v = valid(patch[key]);
    if (v === null && key !== "liveUrl" && key !== "summary") return error;
    if (v === undefined) return error;
    sets.push(`${column} = ?`);
    values.push(v);
    return null;
  };
  const problem =
    take("name", "name", (v) => validateName(v), "invalid_name") ||
    take("kind", "kind", (v) => validateKind(v), "invalid_kind") ||
    take("status", "status", (v) => validateEnum(v, PROJECT_STATUSES), "invalid_status") ||
    take("liveUrl", "live_url", validateHttpsUrl, "invalid_live_url") ||
    take("summary", "summary", (v) => validateText(v, 2000), "invalid_summary");
  if (problem) return fail(problem);
  if (!sets.length) return fail("nothing_to_update");
  sets.push("updated_at = ?");
  values.push(isoTime(now), id, organizationId);
  const res = await db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ? AND organization_id = ?`).bind(...values).run();
  return res.meta.changes === 1 ? ok({ project: await getProject(db, organizationId, id) }) : fail("not_found");
}
