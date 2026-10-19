/**
 * portal_sessions: server-side sign-in sessions (Stage 2B). A session row is keyed by the HMAC of the browser's random token, so a
 * database read alone cannot be replayed as a sign-in. Rows belong to a USER, not an organization: tenant access is decided per
 * request from memberships, never from a session.
 *
 * Every function takes explicit times (no hidden clock), uses bound parameters only, and treats "not active" as one thing:
 * revoked, past its idle limit, past its absolute limit, or owned by a disabled user are all simply not found.
 */
import { isoTime, requireUserId, ok, fail, PortalDataError } from "./common.js";

export const SESSION_ID = /^[0-9a-f]{64}$/;
const WORKOS_ID = /^[A-Za-z0-9_.-]{5,128}$/;
const REASON = /^[a-z][a-z_]{0,59}$/;
const METHOD = /^[a-z][a-z0-9_-]{0,39}$/;
const IP_HASH = /^[0-9a-f]{16,64}$/;

export const DEFAULT_IDLE_SECONDS = 12 * 3600;
export const DEFAULT_ABSOLUTE_SECONDS = 14 * 86400;
export const DEFAULT_MAX_ACTIVE = 10;
export const MAX_ACTIVE_CEILING = 50;

const requireSessionId = (id) => {
  if (typeof id !== "string" || !SESSION_ID.test(id)) throw new PortalDataError("invalid_session_id");
  return id;
};
const addSeconds = (date, s) => new Date(date.getTime() + s * 1000);
const ACTIVE = "revoked_at IS NULL AND idle_expires_at > ? AND expires_at > ?";

/**
 * Create a session for a user. Atomic (one batch): when the user already has `maxActive` active sessions the OLDEST-USED ones beyond
 * the limit are revoked with reason "session_limit"; every other session is left alone. Refused for a disabled or missing user.
 */
export async function createSession(db, { id, userId, workosSessionId, authMethod = null, ipHash = null } = {}, { now = new Date(), idleSeconds = DEFAULT_IDLE_SECONDS, absoluteSeconds = DEFAULT_ABSOLUTE_SECONDS, maxActive = DEFAULT_MAX_ACTIVE } = {}) {
  requireSessionId(id);
  requireUserId(userId);
  if (typeof workosSessionId !== "string" || !WORKOS_ID.test(workosSessionId)) return fail("invalid_workos_session_id");
  if (authMethod !== null && !(typeof authMethod === "string" && METHOD.test(authMethod))) return fail("invalid_auth_method");
  if (ipHash !== null && !(typeof ipHash === "string" && IP_HASH.test(ipHash))) return fail("invalid_ip_hash");
  if (!Number.isInteger(maxActive) || maxActive < 1 || maxActive > MAX_ACTIVE_CEILING) return fail("invalid_limit");
  if (!Number.isInteger(idleSeconds) || !Number.isInteger(absoluteSeconds) || idleSeconds < 60 || absoluteSeconds < idleSeconds) return fail("invalid_lifetime");
  const t = isoTime(now);
  const idle = isoTime(addSeconds(now, idleSeconds));
  const abs = isoTime(addSeconds(now, absoluteSeconds));
  const results = await db.batch([
    // Keep the newest (maxActive - 1) active sessions; the new one makes maxActive. Only for an active user.
    db
      .prepare(
        `UPDATE portal_sessions SET revoked_at = ?, revoked_reason = 'session_limit'
         WHERE user_id = ? AND ${ACTIVE}
           AND EXISTS (SELECT 1 FROM portal_users WHERE id = ? AND status = 'active')
           AND id NOT IN (SELECT id FROM portal_sessions WHERE user_id = ? AND ${ACTIVE} ORDER BY last_seen_at DESC, id LIMIT ?)`,
      )
      .bind(t, userId, t, t, userId, userId, t, t, maxActive - 1),
    db
      .prepare(
        `INSERT INTO portal_sessions (id, user_id, workos_session_id, auth_method, created_at, last_seen_at, idle_expires_at, expires_at, ip_hash)
         SELECT ?, id, ?, ?, ?, ?, ?, ?, ? FROM portal_users WHERE id = ? AND status = 'active'`,
      )
      .bind(id, workosSessionId, authMethod, t, t, idle, abs, ipHash, userId),
  ]);
  if (results[1].meta.changes !== 1) return fail("user_not_active");
  return ok({ session: { id, userId, createdAt: t, idleExpiresAt: idle, expiresAt: abs } });
}

/** The active session and its (active) user, or null. One query. */
export async function findActiveSession(db, id, { now = new Date() } = {}) {
  requireSessionId(id);
  const t = isoTime(now);
  return (
    (await db
      .prepare(
        `SELECT s.id AS session_id, s.user_id, s.workos_session_id, s.auth_method, s.created_at, s.last_seen_at, s.idle_expires_at, s.expires_at,
                u.email, u.name
         FROM portal_sessions s JOIN portal_users u ON u.id = s.user_id
         WHERE s.id = ? AND s.revoked_at IS NULL AND s.idle_expires_at > ? AND s.expires_at > ? AND u.status = 'active'`,
      )
      .bind(id, t, t)
      .first()) || null
  );
}

/**
 * Slide the idle deadline (never past the absolute one). Writes at most once per `minIntervalSeconds` so reads do not become writes
 * on every request. Returns whether a row changed.
 */
export async function touchSession(db, id, { now = new Date(), idleSeconds = DEFAULT_IDLE_SECONDS, minIntervalSeconds = 60 } = {}) {
  requireSessionId(id);
  const t = isoTime(now);
  const idle = isoTime(addSeconds(now, idleSeconds));
  const res = await db
    .prepare(
      `UPDATE portal_sessions SET last_seen_at = ?, idle_expires_at = CASE WHEN ? < expires_at THEN ? ELSE expires_at END
       WHERE id = ? AND ${ACTIVE} AND last_seen_at <= ?`,
    )
    .bind(t, idle, idle, id, t, t, isoTime(addSeconds(now, -minIntervalSeconds)))
    .run();
  return res.meta.changes === 1;
}

/** Revoke one session. Idempotent: a session that is already revoked keeps its original reason and time. */
export async function revokeSession(db, id, reason, { now = new Date() } = {}) {
  requireSessionId(id);
  if (typeof reason !== "string" || !REASON.test(reason)) return fail("invalid_reason");
  const res = await db.prepare("UPDATE portal_sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL").bind(isoTime(now), reason, id).run();
  return ok({ revoked: res.meta.changes });
}

/** Revoke every not-yet-revoked session of a user, optionally keeping one. */
export async function revokeAllForUser(db, userId, reason, { exceptId = null, now = new Date() } = {}) {
  requireUserId(userId);
  if (typeof reason !== "string" || !REASON.test(reason)) return fail("invalid_reason");
  if (exceptId !== null) requireSessionId(exceptId);
  const res = await db
    .prepare("UPDATE portal_sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL AND id IS NOT ?")
    .bind(isoTime(now), reason, userId, exceptId)
    .run();
  return ok({ revoked: res.meta.changes });
}

/** Disable a user and end all of their sessions in ONE atomic step. */
export async function disableUserAndRevokeSessions(db, userId, { now = new Date() } = {}) {
  requireUserId(userId);
  const t = isoTime(now);
  const results = await db.batch([
    db.prepare("UPDATE portal_users SET status = 'disabled', disabled_at = COALESCE(disabled_at, ?) WHERE id = ?").bind(t, userId),
    db.prepare("UPDATE portal_sessions SET revoked_at = ?, revoked_reason = 'user_disabled' WHERE user_id = ? AND revoked_at IS NULL").bind(t, userId),
  ]);
  return results[0].meta.changes === 1 ? ok({ revoked: results[1].meta.changes }) : fail("not_found");
}

export async function countActiveSessions(db, userId, { now = new Date() } = {}) {
  requireUserId(userId);
  const t = isoTime(now);
  const row = await db.prepare(`SELECT count(*) AS n FROM portal_sessions WHERE user_id = ? AND ${ACTIVE}`).bind(userId, t, t).first();
  return row ? row.n : 0;
}

/** Housekeeping: delete sessions that ended more than `retainDays` ago. */
export async function purgeEndedSessions(db, { now = new Date(), retainDays = 30 } = {}) {
  if (!Number.isInteger(retainDays) || retainDays < 1) return fail("invalid_retention");
  const cutoff = isoTime(addSeconds(now, -retainDays * 86400));
  const res = await db
    .prepare("DELETE FROM portal_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)") /* cross-user: housekeeping over ended sessions only */
    .bind(cutoff, cutoff)
    .run();
  return ok({ deleted: res.meta.changes });
}
