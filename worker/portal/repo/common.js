/**
 * Client portal data layer: shared helpers.
 *
 * Rules every repository module follows:
 *  - Every query is parameterised (values are bound, never concatenated into SQL).
 *  - Every function that touches a tenant-owned table (memberships, invitations, projects, activity_log) takes the
 *    organization id as an explicit argument, validates it with requireOrgId (which THROWS for anything that is not a UUID,
 *    so a missing id can never silently become an unscoped query) and puts `organization_id = ?` in the SQL.
 *  - The few queries that are intentionally cross-tenant carry a `cross-tenant:` comment inside the SQL naming the reason.
 *    A test pins the exact list.
 *  - Organization ids come from the server (a membership lookup), never from client input.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class PortalDataError extends Error {
  constructor(code) {
    super(code);
    this.name = "PortalDataError";
    this.code = code;
  }
}

export const newId = () => crypto.randomUUID();

/** ISO-8601 UTC with milliseconds: the single time format used in the portal database. */
export const isoTime = (date = new Date()) => date.toISOString();

export function requireId(value, what = "id") {
  if (typeof value !== "string" || !UUID.test(value)) throw new PortalDataError("invalid_" + what);
  return value;
}
export const requireOrgId = (value) => requireId(value, "organization_id");
export const requireUserId = (value) => requireId(value, "user_id");

export const ok = (extra = {}) => ({ ok: true, ...extra });
export const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

export const isUniqueViolation = (err) => /UNIQUE constraint failed/i.test(String((err && err.message) || ""));
export const isConstraintViolation = (err) => /constraint failed/i.test(String((err && err.message) || ""));

/** Which column a UNIQUE violation named, for example "organizations.slug". */
export const uniqueColumns = (err) => (/UNIQUE constraint failed:\s*([^:]+)/i.exec(String((err && err.message) || "")) || [, ""])[1].trim();

/** Who made an administrative change: a short, single-line label (normally the admin's email). Recorded in the audit trail. */
export const validActor = (actor) => typeof actor === "string" && actor.trim().length >= 1 && actor.trim().length <= 254 && !/[\u0000-\u001F\u007F]/.test(actor);
