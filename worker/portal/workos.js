/**
 * WorkOS AuthKit client for the client portal (Stage 2C): authorize URL (PKCE S256), server-side code exchange, token verification.
 * Every network call goes through an injected `fetchImpl` so tests never touch the network. Outcomes are typed so callers can tell
 * "the sign-in service could not be reached" (retry later) from "the sign-in was refused or invalid" (start again) and never need
 * to look at upstream text, which is deliberately not returned.
 */
import { verifyRs256 } from "./jwt.js";
import { validateAccessTokenClaims } from "./claims.js";
import { WORKOS_ORIGIN } from "./http.js";

const FETCH_TIMEOUT_MS = 8000;
const EMAIL_HINT = /^[^\s@<>"'&?#%]{1,64}@[^\s@<>"'&?#%]{1,190}$/;
const INVITATION_TOKEN = /^[A-Za-z0-9._~-]{8,256}$/;
const AUTH_CODE = /^[A-Za-z0-9._~-]{1,512}$/;

export const CALLBACK_PATH = "/portal/auth/callback";

/** Only these parameters are ever forwarded from our login URL to WorkOS, and only when they look right. */
export function forwardableParams(searchParams) {
  const out = {};
  const hint = searchParams.get("login_hint");
  if (hint && EMAIL_HINT.test(hint)) out.login_hint = hint;
  const invitation = searchParams.get("invitation_token");
  if (invitation && INVITATION_TOKEN.test(invitation)) out.invitation_token = invitation;
  return out;
}

export function buildAuthorizeUrl(cfg, { state, challenge, loginHint, invitationToken }) {
  const u = new URL(`${WORKOS_ORIGIN}/user_management/authorize`);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.origin + CALLBACK_PATH);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("provider", "authkit");
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (loginHint) u.searchParams.set("login_hint", loginHint);
  if (invitationToken) u.searchParams.set("invitation_token", invitationToken);
  return u.toString();
}

async function fetchJson(fetchImpl, url, init = {}) {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

/**
 * Exchange the authorization code. The API key travels only in this server-to-server request body.
 * @returns {Promise<{ok:true, accessToken:string, user:object, authMethod:string|null}|{ok:false, kind:"unavailable"|"refused"}>}
 */
export async function exchangeCode(cfg, code, verifier, fetchImpl) {
  if (typeof code !== "string" || !AUTH_CODE.test(code)) return { ok: false, kind: "refused" };
  let res;
  try {
    res = await fetchJson(fetchImpl, `${WORKOS_ORIGIN}/user_management/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.apiKey, grant_type: "authorization_code", code, code_verifier: verifier }),
    });
  } catch {
    return { ok: false, kind: "unavailable" };
  }
  if (res.status >= 500 || res.status === 429) return { ok: false, kind: "unavailable" };
  const b = res.body;
  if (!res.ok || !b || typeof b.access_token !== "string" || !b.user || typeof b.user !== "object") return { ok: false, kind: "refused" };
  const method = typeof b.authentication_method === "string" ? b.authentication_method.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase() : null;
  return { ok: true, accessToken: b.access_token, user: b.user, authMethod: method && /^[a-z][a-z0-9_-]{0,39}$/.test(method) ? method : null };
}

const trustedJwksHost = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && (u.hostname === "api.workos.com" || u.hostname.endsWith(".authkit.app"));
  } catch {
    return false;
  }
};

/** The environment's signing keys (discovery document first, documented URL as the fallback). null when unreachable. */
export async function loadJwks(cfg, fetchImpl) {
  let url = `${WORKOS_ORIGIN}/sso/jwks/${encodeURIComponent(cfg.clientId)}`;
  try {
    const d = await fetchJson(fetchImpl, `${WORKOS_ORIGIN}/user_management/${encodeURIComponent(cfg.clientId)}/.well-known/openid-configuration`);
    if (d.ok && d.body && typeof d.body.jwks_uri === "string" && trustedJwksHost(d.body.jwks_uri)) url = d.body.jwks_uri;
  } catch {
    /* use the documented URL */
  }
  try {
    const k = await fetchJson(fetchImpl, url);
    return k.ok && k.body && Array.isArray(k.body.keys) ? k.body : null;
  } catch {
    return null;
  }
}

/**
 * Verify the access token (signature, algorithm, expiry) and its claims (pinned issuer, our client, subject, REQUIRED session id).
 * @returns {Promise<{ok:true, claims}|{ok:false, kind:"unavailable"|"invalid", reason:string}>}
 */
export async function verifyAccessToken(cfg, token, fetchImpl, now = new Date()) {
  const jwks = await loadJwks(cfg, fetchImpl);
  if (!jwks) return { ok: false, kind: "unavailable", reason: "keys_unavailable" };
  const verified = await verifyRs256(token, jwks, now);
  if (!verified.ok) return { ok: false, kind: "invalid", reason: "token_" + verified.reason };
  const checked = validateAccessTokenClaims(verified.payload, cfg, now);
  return checked.ok ? { ok: true, claims: checked.claims } : { ok: false, kind: "invalid", reason: checked.reason };
}
