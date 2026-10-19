/**
 * portal_users: exactly one row per WorkOS user, no matter how many organizations they belong to (memberships link the two).
 * Rows are created only by a successful sign-in; being invited does not create a user.
 */
import { newId, isoTime, requireUserId, ok, fail, isUniqueViolation, uniqueColumns } from "./common.js";
import { normalizeEmail, validateName, validateEnum, USER_STATUSES } from "./validate.js";

const COLUMNS = "id, workos_user_id, email, name, status, created_at, last_login_at, disabled_at";
const WORKOS_ID = /^[A-Za-z0-9_.-]{5,128}$/;

/**
 * Create or refresh the portal user for a WorkOS identity. Idempotent: the same WorkOS user always maps to the same row,
 * whatever their email is now. A disabled user stays disabled.
 */
export async function upsertUserFromIdentity(db, { workosUserId, email, name } = {}, { now = new Date() } = {}) {
  if (typeof workosUserId !== "string" || !WORKOS_ID.test(workosUserId)) return fail("invalid_workos_user_id");
  const normalized = normalizeEmail(email);
  if (!normalized) return fail("invalid_email");
  const cleanName = name === undefined || name === null || name === "" ? null : validateName(name);
  if (name && !cleanName) return fail("invalid_name");
  const t = isoTime(now);
  try {
    const user = await db
      .prepare(
        `INSERT INTO portal_users (id, workos_user_id, email, name, status, created_at, last_login_at) VALUES (?, ?, ?, ?, 'active', ?, ?)
         ON CONFLICT (workos_user_id) DO UPDATE SET email = excluded.email, name = COALESCE(excluded.name, portal_users.name), last_login_at = excluded.last_login_at
         RETURNING ${COLUMNS}`,
      )
      .bind(newId(), workosUserId, normalized, cleanName, t, t)
      .first();
    return ok({ user });
  } catch (err) {
    // The email already belongs to a different WorkOS user: never merge or overwrite, surface it for an admin to resolve.
    if (isUniqueViolation(err) && /email/.test(uniqueColumns(err))) return fail("email_conflict");
    throw err;
  }
}

export async function getUserById(db, id) {
  requireUserId(id);
  return (await db.prepare(`SELECT ${COLUMNS} FROM portal_users WHERE id = ?`).bind(id).first()) || null;
}

export async function getUserByWorkosId(db, workosUserId) {
  if (typeof workosUserId !== "string" || !WORKOS_ID.test(workosUserId)) return null;
  return (await db.prepare(`SELECT ${COLUMNS} FROM portal_users WHERE workos_user_id = ?`).bind(workosUserId).first()) || null;
}

export async function getUserByEmail(db, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return (await db.prepare(`SELECT ${COLUMNS} FROM portal_users WHERE email = ?`).bind(normalized).first()) || null;
}

/** active / disabled. (Revoking the user's sessions is the sessions module's job, added in Stage 2.) */
export async function setUserStatus(db, id, status, { now = new Date() } = {}) {
  requireUserId(id);
  if (!validateEnum(status, USER_STATUSES)) return fail("invalid_status");
  const res = await db.prepare("UPDATE portal_users SET status = ?, disabled_at = CASE WHEN ? = 'disabled' THEN ? ELSE NULL END WHERE id = ?").bind(status, status, isoTime(now), id).run();
  return res.meta.changes === 1 ? ok({ user: await getUserById(db, id) }) : fail("not_found");
}
