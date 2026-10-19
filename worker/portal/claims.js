/**
 * Validation of what WorkOS tells us at sign-in (Stage 2A). Pure functions; no network. The next stage calls them from the callback.
 *
 * Two things are checked and then CROSS-CHECKED against each other:
 *  - the access token's claims (issuer pinned exactly, our client id, a session id, sane timing), after its signature was verified;
 *  - the user object returned by the server-side code exchange (verified email, id).
 * Anything missing, malformed or inconsistent is a refusal with a short machine reason; there is no "best effort" path.
 */
import { normalizeEmail } from "./repo/validate.js";

export const WORKOS_ID = /^[A-Za-z0-9_.-]{5,128}$/;
const LEEWAY_SECONDS = 30;
const MAX_TOKEN_LIFETIME_SECONDS = 3600; // WorkOS access tokens last minutes; anything longer is not what we configured

/**
 * @param payload verified JWT payload
 * @param cfg {issuer, clientId} from readPortalConfig
 * @returns {{ok:true, claims:{sub,sid,exp,iat}}|{ok:false, reason:string}}
 */
export function validateAccessTokenClaims(payload, cfg, now = new Date()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, reason: "claims_missing" };
  if (typeof payload.iss !== "string" || payload.iss !== cfg.issuer) return { ok: false, reason: "issuer_mismatch" };
  if (typeof payload.client_id !== "string" || payload.client_id !== cfg.clientId) return { ok: false, reason: "client_mismatch" };
  if (typeof payload.sub !== "string" || !WORKOS_ID.test(payload.sub)) return { ok: false, reason: "subject_invalid" };
  // Session tokens carry no audience today. If one is present it must be ours; a token for another audience is never accepted.
  if (payload.aud !== undefined && payload.aud !== null) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(cfg.clientId)) return { ok: false, reason: "audience_mismatch" };
  }
  // The WorkOS session id is REQUIRED: without it we could not end the WorkOS session at logout, so sign-in would not be revocable.
  if (payload.sid === undefined || payload.sid === null || payload.sid === "") return { ok: false, reason: "session_id_missing" };
  if (typeof payload.sid !== "string" || !WORKOS_ID.test(payload.sid)) return { ok: false, reason: "session_id_invalid" };
  if (!Number.isInteger(payload.exp) || !Number.isInteger(payload.iat)) return { ok: false, reason: "expiry_invalid" };
  const nowSec = Math.floor(now.getTime() / 1000);
  if (nowSec > payload.exp + LEEWAY_SECONDS) return { ok: false, reason: "expired" };
  if (payload.iat > nowSec + LEEWAY_SECONDS) return { ok: false, reason: "issued_in_future" };
  const lifetime = payload.exp - payload.iat;
  if (lifetime < 1 || lifetime > MAX_TOKEN_LIFETIME_SECONDS) return { ok: false, reason: "lifetime_invalid" };
  return { ok: true, claims: { sub: payload.sub, sid: payload.sid, exp: payload.exp, iat: payload.iat } };
}

/**
 * The identity to provision from the code-exchange `user` object, bound to the verified token.
 * @returns {{ok:true, identity:{workosUserId,email,name}}|{ok:false, reason:string}}
 */
export function identityFromWorkosUser(user, claims) {
  if (!user || typeof user !== "object" || Array.isArray(user)) return { ok: false, reason: "user_invalid" };
  if (typeof user.id !== "string" || !WORKOS_ID.test(user.id)) return { ok: false, reason: "user_invalid" };
  if (!claims || typeof claims.sub !== "string" || claims.sub !== user.id) return { ok: false, reason: "subject_mismatch" };
  if (user.email_verified !== true) return { ok: false, reason: "email_not_verified" }; // exactly true: "true", 1, "yes" are refused
  const email = normalizeEmail(user.email);
  if (!email) return { ok: false, reason: "email_invalid" };
  const parts = [user.first_name, user.last_name].filter((p) => typeof p === "string" && p.trim());
  const joined = parts.join(" ").trim();
  const name = joined && joined.length <= 120 && !/[\u0000-\u001F\u007F\u2028\u2029]/.test(joined) ? joined : null; // a bad name is dropped, not fatal
  return { ok: true, identity: { workosUserId: user.id, email, name } };
}
