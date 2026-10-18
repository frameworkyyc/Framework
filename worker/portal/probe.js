/**
 * Client portal, Phase 0: WorkOS sign-in PROBE (temporary; remove before any portal feature work is merged).
 *
 * Its only job is to prove, on Staging, how the WorkOS AuthKit flow really behaves before the portal is built on it:
 *   /portal/login          initiate-login endpoint. Shows one "Continue" button (so a logout that returns here does not
 *                          silently sign the person straight back in), then redirects to WorkOS with state + PKCE (S256).
 *   /portal/auth/callback  checks state, exchanges the code server-side, verifies the access token's signature against the
 *                          environment's published keys, and renders a MASKED diagnostic report.
 *   /portal/logout         POST only (same-origin); sends the browser to WorkOS logout for the session that signed in.
 *
 * What it deliberately does NOT do: no portal session, no database or R2 access, no stored tokens. Tokens, codes, the API key
 * and the pepper are never rendered or logged. It is inert unless every one of these is true (otherwise the request falls
 * through to the static site exactly as before, which is what Production does):
 *   PORTAL_PROBE = "1", PORTAL_BASE_URL (https origin), PORTAL_AUTH_CLIENT_ID, PORTAL_AUTH_CLIENT_SECRET (the WorkOS API key),
 *   PORTAL_SESSION_PEPPER, and the request arrives on the PORTAL_BASE_URL host.
 * Framework Admin (Cloudflare Access) is a separate code path and is not touched here.
 */

import { verifyRs256 } from "./jwt.js";

const API = "https://api.workos.com";
export const LOGIN_PATH = "/portal/login";
export const CALLBACK_PATH = "/portal/auth/callback";
export const LOGOUT_PATH = "/portal/logout";
export const PROBE_PATHS = [LOGIN_PATH, CALLBACK_PATH, LOGOUT_PATH];

const STATE_COOKIE = "__Host-fw_probe";
const SID_COOKIE = "__Host-fw_probe_sid";
const STATE_TTL_SECONDS = 600;
const SID_TTL_SECONDS = 1800;
const FETCH_TIMEOUT_MS = 8000;

const encoder = new TextEncoder();

/* ------------------------------------------------------------------ small helpers */

const bytesToB64url = (bytes) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlToBytes = (str) => {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const randomToken = (bytes = 32) => bytesToB64url(crypto.getRandomValues(new Uint8Array(bytes)));
const sha256b64url = async (text) => bytesToB64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))));
const escapeHtml = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Read the configuration; null (= probe is off) unless everything needed is present and sane. */
export function probeConfig(env) {
  if (!env || String(env.PORTAL_PROBE || "") !== "1") return null;
  const clientId = String(env.PORTAL_AUTH_CLIENT_ID || "").trim();
  const apiKey = String(env.PORTAL_AUTH_CLIENT_SECRET || "").trim();
  const pepper = String(env.PORTAL_SESSION_PEPPER || "").trim();
  let origin = "";
  try {
    const u = new URL(String(env.PORTAL_BASE_URL || "").trim());
    if (u.protocol === "https:" && !u.username && !u.password) origin = u.origin;
  } catch {
    origin = "";
  }
  if (!clientId || !apiKey || !pepper || !origin) return null;
  return { clientId, apiKey, pepper, origin, expectedIssuer: String(env.PORTAL_AUTH_ISSUER || "").trim() };
}

const maskId = (id) => (typeof id === "string" && id.length > 8 ? id.slice(0, 8) + "…" : id ? "(short)" : null);
const maskEmail = (email) => {
  const m = /^([^@]{1,64})@([^@]+)$/.exec(String(email || ""));
  return m ? m[1][0] + "***@" + m[2] : null;
};

/* ------------------------------------------------------------------ signed cookies (HMAC-SHA256 keyed by the pepper) */

const hmacKey = (pepper) => crypto.subtle.importKey("raw", encoder.encode("fw-portal-probe:" + pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

async function sealCookie(cfg, payload) {
  const body = bytesToB64url(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(cfg.pepper), encoder.encode(body));
  return body + "." + bytesToB64url(new Uint8Array(sig));
}

async function openCookie(cfg, value, now) {
  const parts = String(value || "").split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await hmacKey(cfg.pepper), b64urlToBytes(parts[1]), encoder.encode(parts[0]));
  } catch {
    ok = false;
  }
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    if (!payload || typeof payload.exp !== "number" || Math.floor(now.getTime() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Logout CSRF token: HMAC(pepper, "logout-csrf:" + sid), shown only on the report page of the person who is signed in.
 * It is bound to that WorkOS session, so a forged request cannot know it. This is the primary check; Origin and Sec-Fetch-Site
 * are extra. (An Origin check alone is not enough: a page sent with Referrer-Policy: no-referrer makes browsers send
 * "Origin: null" on its own same-origin form posts, which is why a legitimate logout was refused.)
 */
const logoutToken = async (cfg, sid) => bytesToB64url(new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(cfg.pepper), encoder.encode("logout-csrf:" + sid))));
async function logoutTokenValid(cfg, sid, supplied) {
  if (typeof supplied !== "string" || !/^[A-Za-z0-9_-]{20,100}$/.test(supplied)) return false;
  try {
    return await crypto.subtle.verify("HMAC", await hmacKey(cfg.pepper), b64urlToBytes(supplied), encoder.encode("logout-csrf:" + sid));
  } catch {
    return false;
  }
}

const readCookie = (request, name) => {
  for (const part of String(request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
};
const setCookie = (name, value, maxAge) => `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

/* ------------------------------------------------------------------ responses */

const CSP = "default-src 'none'; style-src 'self' https://api.fontshare.com; font-src https://cdn.fontshare.com; img-src 'self' data:; form-action 'self' https://api.workos.com; base-uri 'none'; frame-ancestors 'none'";

function headersFor(extra = {}) {
  const h = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": CSP,
  });
  for (const [k, v] of Object.entries(extra)) {
    if (Array.isArray(v)) v.forEach((x) => h.append(k, x));
    else h.set(k, v);
  }
  return h;
}

function page(status, title, bodyHtml, extra) {
  const html = `<!DOCTYPE html>
<html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)} | Framework</title>
<link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=switzer@600,700&f[]=general-sans@400,500,600&display=swap">
<link rel="stylesheet" href="/assets/css/styles.css"></head>
<body><main class="page-head"><div class="container"><span class="eyebrow">Client portal · sign-in test (Staging)</span>
<h1 class="h2">${escapeHtml(title)}</h1>${bodyHtml}</div></main></body></html>`;
  return new Response(html, { status, headers: headersFor(extra) });
}

const failure = (status, message, extra) => page(status, "Sign-in could not be completed", `<p class="lead">${escapeHtml(message)}</p><p><a class="btn btn--primary" href="${LOGIN_PATH}">Try again</a></p>`, extra);

/* ------------------------------------------------------------------ WorkOS calls */

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

const trustedJwksHost = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && (u.hostname === "api.workos.com" || u.hostname.endsWith(".authkit.app"));
  } catch {
    return false;
  }
};

/** Discovery document + signing keys. Reports which source worked; never throws. */
async function loadKeys(cfg, fetchImpl) {
  const out = { discovery: { ok: false, issuer: null, jwksUri: null }, jwks: null, source: null };
  let jwksUrl = `${API}/sso/jwks/${encodeURIComponent(cfg.clientId)}`;
  try {
    const d = await fetchJson(fetchImpl, `${API}/user_management/${encodeURIComponent(cfg.clientId)}/.well-known/openid-configuration`);
    if (d.ok && d.body && typeof d.body.issuer === "string") {
      out.discovery = { ok: true, issuer: d.body.issuer, jwksUri: typeof d.body.jwks_uri === "string" ? d.body.jwks_uri : null };
      if (out.discovery.jwksUri && trustedJwksHost(out.discovery.jwksUri)) jwksUrl = out.discovery.jwksUri;
    }
  } catch {
    /* fall back to the documented JWKS URL */
  }
  try {
    const k = await fetchJson(fetchImpl, jwksUrl);
    if (k.ok && k.body && Array.isArray(k.body.keys)) {
      out.jwks = k.body;
      out.source = jwksUrl === `${API}/sso/jwks/${encodeURIComponent(cfg.clientId)}` ? "api.workos.com/sso/jwks" : "discovery jwks_uri";
    }
  } catch {
    out.jwks = null;
  }
  return out;
}

/* ------------------------------------------------------------------ routes */

const ALLOWED_QUERY_NAME = /^[a-z_]{1,40}$/;
const EMAIL_HINT = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}$/;
const INVITATION_TOKEN = /^[A-Za-z0-9._~-]{8,256}$/;

/** Only these parameters are ever forwarded to WorkOS from the initiate-login URL, and only when they look right. */
function forwardableParams(searchParams) {
  const out = {};
  const hint = searchParams.get("login_hint");
  if (hint && EMAIL_HINT.test(hint)) out.login_hint = hint;
  const invitation = searchParams.get("invitation_token");
  if (invitation && INVITATION_TOKEN.test(invitation)) out.invitation_token = invitation;
  return out;
}

async function handleLogin(request, cfg, url, now) {
  if (request.method !== "GET" && request.method !== "HEAD") return page(405, "Method not allowed", "", { Allow: "GET, HEAD" });
  const forward = forwardableParams(url.searchParams);
  const names = [...new Set([...url.searchParams.keys()].map((n) => (ALLOWED_QUERY_NAME.test(n) ? n : "other")))].filter((n) => n !== "start").slice(0, 10);

  if (url.searchParams.get("start") !== "1") {
    const qs = new URLSearchParams({ start: "1", ...forward }).toString();
    return page(200, "Sign in", `<p class="lead">This is a temporary test of the Framework client sign-in. Continue to sign in with the email address that was invited.</p><p><a class="btn btn--primary" href="${LOGIN_PATH}?${escapeHtml(qs)}">Continue</a></p>`);
  }

  const state = randomToken(32);
  const verifier = randomToken(32);
  const challenge = await sha256b64url(verifier);
  const cookie = await sealCookie(cfg, { s: state, v: verifier, q: names, exp: Math.floor(now.getTime() / 1000) + STATE_TTL_SECONDS });
  const authorize = new URL(`${API}/user_management/authorize`);
  authorize.searchParams.set("client_id", cfg.clientId);
  authorize.searchParams.set("redirect_uri", cfg.origin + CALLBACK_PATH);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("provider", "authkit");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  for (const [k, v] of Object.entries(forward)) authorize.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: headersFor({ Location: authorize.toString(), "Set-Cookie": setCookie(STATE_COOKIE, cookie, STATE_TTL_SECONDS) }) });
}

const claimsReport = (payload) => ({
  claim_names: Object.keys(payload).sort(),
  iss: payload.iss ?? null,
  aud: payload.aud ?? null,
  client_id_claim: payload.client_id ?? null,
  sid_present: typeof payload.sid === "string" && payload.sid.length > 0,
  org_id_present: typeof payload.org_id === "string",
  role: typeof payload.role === "string" ? payload.role : null,
  lifetime_seconds: typeof payload.exp === "number" && typeof payload.iat === "number" ? payload.exp - payload.iat : null,
});

async function handleCallback(request, cfg, url, deps, now) {
  if (request.method !== "GET") return page(405, "Method not allowed", "", { Allow: "GET" });
  const clear = { "Set-Cookie": [setCookie(STATE_COOKIE, "", 0)] }; // single use: whatever happens next, the state cookie is gone
  const fetchImpl = deps.fetch || fetch;

  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const upstreamError = url.searchParams.get("error") || "";
  const sealed = await openCookie(cfg, readCookie(request, STATE_COOKIE), now);
  if (!sealed || typeof sealed.s !== "string" || typeof sealed.v !== "string") {
    // Learn how WorkOS reaches us when the attempt did not start here (for example straight after accepting an invitation):
    // parameter NAMES only, never values.
    const names = [...new Set([...url.searchParams.keys()].map((n) => (ALLOWED_QUERY_NAME.test(n) ? n : "other")))].slice(0, 10);
    return failure(400, `This sign-in attempt has expired or did not start here. Please try again. (Parameters received: ${names.length ? names.join(", ") : "none"}.)`, clear);
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(state) || (await sha256b64url(state)) !== (await sha256b64url(sealed.s))) return failure(400, "This sign-in attempt could not be verified. Please try again.", clear);
  if (upstreamError) return failure(400, `WorkOS returned an error (${/^[a-z_]{1,40}$/.test(upstreamError) ? upstreamError : "unrecognised"}).`, clear);
  if (!/^[A-Za-z0-9._~-]{1,512}$/.test(code)) return failure(400, "The sign-in response was incomplete. Please try again.", clear);

  let exchange;
  try {
    exchange = await fetchJson(fetchImpl, `${API}/user_management/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.apiKey, grant_type: "authorization_code", code, code_verifier: sealed.v }),
    });
  } catch {
    console.error("portal probe: authenticate request failed");
    return failure(502, "The sign-in service could not be reached. Please try again.", clear);
  }
  if (!exchange.ok || !exchange.body || typeof exchange.body.access_token !== "string" || !exchange.body.user || typeof exchange.body.user.id !== "string") {
    const code2 = exchange.body && typeof exchange.body.code === "string" && /^[a-z_]{1,60}$/.test(exchange.body.code) ? ` (${exchange.body.code})` : "";
    console.error("portal probe: code exchange refused", exchange.status);
    return failure(400, `The sign-in could not be completed${code2}. The code may have been used already.`, clear);
  }

  const { user, access_token: accessToken } = exchange.body;
  const keys = await loadKeys(cfg, fetchImpl);
  const verified = keys.jwks ? await verifyRs256(accessToken, keys.jwks, now) : { ok: false, reason: "no_keys" };
  const payload = verified.payload || {};
  const issuerOk = Boolean(cfg.expectedIssuer) && payload.iss === cfg.expectedIssuer;
  const report = {
    result: !verified.ok ? `token NOT verified (${verified.reason})` : issuerOk ? "token signature and issuer verified" : "token signature verified, but the issuer does NOT match PORTAL_AUTH_ISSUER",
    code_exchange: { status: exchange.status, authentication_method: exchange.body.authentication_method ?? null },
    user: { id: maskId(user.id), email: maskEmail(user.email), email_verified: user.email_verified === true, organization_id_present: typeof exchange.body.organization_id === "string" },
    token: {
      alg: (verified.header && verified.header.alg) || null,
      kid_present: Boolean(verified.header && verified.header.kid),
      signature_valid: verified.ok,
      ...claimsReport(payload),
      iss_equals_PORTAL_AUTH_ISSUER: issuerOk,
      iss_equals_discovery_issuer: keys.discovery.ok && payload.iss === keys.discovery.issuer,
      client_id_claim_matches: payload.client_id === cfg.clientId,
    },
    keys: { discovery_ok: keys.discovery.ok, discovery_issuer: keys.discovery.issuer, jwks_source: keys.source, jwks_key_count: keys.jwks ? keys.jwks.keys.length : 0 },
    initiate_login_query_param_names_seen: Array.isArray(sealed.q) ? sealed.q.filter((n) => typeof n === "string").slice(0, 10) : [],
    not_done_by_this_test: ["no portal session created", "no database or R2 access", "no tokens stored"],
  };

  const extra = { "Set-Cookie": [setCookie(STATE_COOKIE, "", 0)] };
  const sid = verified.ok && typeof payload.sid === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(payload.sid) ? payload.sid : "";
  if (sid) extra["Set-Cookie"].push(setCookie(SID_COOKIE, await sealCookie(cfg, { sid, exp: Math.floor(now.getTime() / 1000) + SID_TTL_SECONDS }), SID_TTL_SECONDS));
  const csrf = sid ? await logoutToken(cfg, sid) : "";
  const body = `<p class="lead">${escapeHtml(report.result)}.</p>
<pre>${escapeHtml(JSON.stringify(report, null, 2))}</pre>
<form method="post" action="${LOGOUT_PATH}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="btn btn--primary" type="submit">Sign out (tests WorkOS logout)</button></form>
<p><a class="text-link" href="${LOGIN_PATH}">Start over</a></p>`;
  return page(200, "Sign-in test result", body, extra);
}

const refused = () => page(403, "Request refused", "<p class=\"lead\">This request did not come from the sign-in test page. Go back and use the Sign out button.</p>");

async function handleLogout(request, cfg, now) {
  if (request.method !== "POST") return page(405, "Method not allowed", "", { Allow: "POST" });
  // Layered same-site checks (defence in depth; the CSRF token below is what must pass):
  //  - a browser that says the request is not same-origin is refused outright;
  //  - an Origin that is present must be ours or the literal "null" browsers send for same-origin form posts from a
  //    no-referrer page. "null" is also what a hostile sandboxed page sends, so it is never enough on its own.
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return refused();
  const origin = request.headers.get("Origin");
  if (origin && origin !== cfg.origin && origin !== "null") return refused();

  const sealed = await openCookie(cfg, readCookie(request, SID_COOKIE), now);
  const clear = setCookie(SID_COOKIE, "", 0);
  const back = cfg.origin + LOGIN_PATH;
  if (!sealed || typeof sealed.sid !== "string") return new Response(null, { status: 303, headers: headersFor({ Location: back, "Set-Cookie": clear }) });

  // The token must be present in the form body and match this session.
  let supplied = "";
  if ((request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    const text = await request.text();
    if (text.length <= 1024) supplied = new URLSearchParams(text).get("csrf") || "";
  }
  if (!(await logoutTokenValid(cfg, sealed.sid, supplied))) return refused();

  const logout = new URL(`${API}/user_management/sessions/logout`);
  logout.searchParams.set("session_id", sealed.sid);
  logout.searchParams.set("return_to", back);
  return new Response(null, { status: 303, headers: headersFor({ Location: logout.toString(), "Set-Cookie": clear }) });
}

/**
 * @returns {Promise<Response|null>} null = not handled here (probe off, or another host): the caller serves the static site.
 */
export async function handlePortalProbe(request, env, deps = {}) {
  const cfg = probeConfig(env);
  if (!cfg) return null;
  const url = new URL(request.url);
  if (url.origin !== cfg.origin) return null;
  const now = deps.now || new Date();
  const path = url.pathname.replace(/\/+$/, "");
  if (path === LOGIN_PATH) return handleLogin(request, cfg, url, now);
  if (path === CALLBACK_PATH) return handleCallback(request, cfg, url, deps, now);
  if (path === LOGOUT_PATH) return handleLogout(request, cfg, now);
  return null;
}
