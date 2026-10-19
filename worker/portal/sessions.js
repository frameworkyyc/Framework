/**
 * Session lifecycle for the client portal (Stage 2B): the one place that joins the cookie, the token hash and the session
 * repository. Fails closed: any problem reading the store means "not signed in", never "signed in". Nothing imports it yet.
 *
 * A session proves WHO someone is. It never grants access to an organization; callers must still check membership, organization
 * status and permissions on every organization request.
 */
import { SESSION_COOKIE, getCookie, serializeCookie, clearCookie } from "./http.js";
import { randomToken, isSessionToken, hashSessionToken, hashIp, csrfToken, verifyCsrfToken } from "./crypto.js";
import * as store from "./repo/sessions.js";
import { WORKOS_ID } from "./claims.js";

export const IDLE_SECONDS = store.DEFAULT_IDLE_SECONDS;
export const ABSOLUTE_SECONDS = store.DEFAULT_ABSOLUTE_SECONDS;
export const MAX_ACTIVE_SESSIONS = store.DEFAULT_MAX_ACTIVE;

/** Create a session after a verified sign-in. Always a brand-new token (never reuse one a browser already holds). */
export async function startSession(cfg, db, { userId, workosSessionId, authMethod = null, ip = null } = {}, { now = new Date() } = {}) {
  if (typeof workosSessionId !== "string" || !WORKOS_ID.test(workosSessionId)) return { ok: false, error: "workos_session_missing" };
  const token = randomToken(32);
  const id = await hashSessionToken(cfg.pepper, token);
  const ipHash = await hashIp(cfg.pepper, ip);
  let res;
  try {
    res = await store.createSession(db, { id, userId, workosSessionId, authMethod, ipHash }, { now });
  } catch {
    return { ok: false, error: "store_error" };
  }
  if (!res.ok) return { ok: false, error: res.error };
  const maxAge = Math.max(1, Math.floor((new Date(res.session.expiresAt) - now) / 1000));
  return { ok: true, cookie: serializeCookie(SESSION_COOKIE, token, { maxAge }), session: res.session };
}

/**
 * Sign-in rotation: ALWAYS a brand-new token. If this browser already presented a session cookie, that one session (and only that
 * one) is revoked with reason "rotated" once the new one exists; the person's other browsers are untouched.
 */
export async function rotateSession(request, cfg, db, params, opts = {}) {
  const started = await startSession(cfg, db, params, opts);
  if (!started.ok) return started;
  const old = getCookie(request, SESSION_COOKIE);
  if (isSessionToken(old)) {
    try {
      await store.revokeSession(db, await hashSessionToken(cfg.pepper, old), "rotated", { now: opts.now || new Date() });
    } catch {
      /* the new session is valid; a stale old one still expires on its own */
    }
  }
  return started;
}

/**
 * Who is signed in on this request?
 * @returns {{ok:true, session}|{ok:false, reason:"no_session"|"invalid"|"store_error"}}
 */
export async function authenticate(request, cfg, db, { now = new Date() } = {}) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token === undefined || token === "") return { ok: false, reason: "no_session" };
  if (!isSessionToken(token)) return { ok: false, reason: "invalid" };
  try {
    const id = await hashSessionToken(cfg.pepper, token);
    const row = await store.findActiveSession(db, id, { now });
    if (!row) return { ok: false, reason: "invalid" };
    try {
      await store.touchSession(db, id, { now });
    } catch {
      /* the session was valid when read; a failed idle-extension must not sign anyone out or let anyone in */
    }
    return {
      ok: true,
      session: { id, userId: row.user_id, email: row.email, name: row.name, workosSessionId: row.workos_session_id, authMethod: row.auth_method, expiresAt: row.expires_at },
    };
  } catch {
    return { ok: false, reason: "store_error" };
  }
}

export const csrfFor = (cfg, session) => csrfToken(cfg.pepper, session.id);
export const checkCsrf = (cfg, session, supplied) => verifyCsrfToken(cfg.pepper, session.id, supplied);

/**
 * Sign out of this browser: revoke the server-side session and clear the cookie. Returns the WorkOS session id so the caller can
 * also end the identity-provider session. Idempotent; a store error still clears the cookie but reports it.
 */
export async function endSession(request, cfg, db, { now = new Date(), reason = "logout" } = {}) {
  const result = { cookie: clearCookie(SESSION_COOKIE), workosSessionId: null, revoked: false, error: null };
  const token = getCookie(request, SESSION_COOKIE);
  if (!isSessionToken(token)) return result;
  try {
    const id = await hashSessionToken(cfg.pepper, token);
    const row = await store.findActiveSession(db, id, { now });
    if (row) result.workosSessionId = row.workos_session_id;
    const res = await store.revokeSession(db, id, reason, { now });
    result.revoked = Boolean(res.ok && res.revoked === 1);
  } catch {
    result.error = "store_error";
  }
  return result;
}

/** The WorkOS URL that ends the identity-provider session; `returnTo` must be the registered sign-out URI. */
export function workosLogoutUrl(cfg, workosSessionId, returnTo) {
  if (typeof workosSessionId !== "string" || !WORKOS_ID.test(workosSessionId)) return null;
  const u = new URL("https://api.workos.com/user_management/sessions/logout");
  u.searchParams.set("session_id", workosSessionId);
  u.searchParams.set("return_to", returnTo);
  return u.toString();
}

export const revokeAllSessions = (db, userId, reason, opts) => store.revokeAllForUser(db, userId, reason, opts);
export const disableUser = (db, userId, opts) => store.disableUserAndRevokeSessions(db, userId, opts);
