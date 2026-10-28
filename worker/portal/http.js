/**
 * HTTP security headers, cookies, redirects and error pages for the client portal (Stage 2A). Pure: builds Response objects and
 * strings, touches no network, database or environment. Nothing imports it yet.
 *
 * Rules enforced here for EVERY portal response (so no individual handler can forget them):
 *  - Cache-Control: no-store, Referrer-Policy: no-referrer (the sign-in URLs carry one-time codes, and WorkOS sends its own Referer),
 *    a strict CSP (no scripts at all in Stage 2), clickjacking, sniffing and indexing protection.
 *  - Cookies are __Host- prefixed (HTTPS only, host-only, Path=/), HttpOnly, SameSite=Lax, with a restricted value alphabet.
 *  - Redirect targets are validated: a same-site portal path or an explicitly allowed origin, never a value from the request.
 */
import { randomToken } from "./crypto.js";
import { escapeHtml, authFrame } from "./frame.js";

export { escapeHtml };

export const SESSION_COOKIE = "__Host-fw_portal";
export const STATE_COOKIE = "__Host-fw_auth";
export const WORKOS_ORIGIN = "https://api.workos.com";

// form-action includes WorkOS because the sign-out form POSTs here and is then redirected to WorkOS logout; browsers apply form-action to redirects.
export const PORTAL_CSP = [
  "default-src 'none'",
  "style-src 'self' https://api.fontshare.com",
  "font-src 'self' https://cdn.fontshare.com", // 'self': the Branding page shows a specimen in the client's own licensed font file, served by this site
  "img-src 'self' data:",
  "form-action 'self' https://api.workos.com",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");


/** The same policy plus scripts from this site only (never inline): used only by pages that load /assets/js/portal-profile.js. */
export const PORTAL_CSP_WITH_SCRIPT = PORTAL_CSP.replace("default-src 'none'; ", "default-src 'none'; script-src 'self'; ");

/** Headers every portal response carries. `extra` may add headers (never weaken the fixed ones: they are applied last). */
export function securityHeaders(extra = {}, { scripts = false } = {}) {
  const h = new Headers();
  for (const [k, v] of Object.entries(extra)) {
    if (Array.isArray(v)) v.forEach((x) => h.append(k, x));
    else if (v !== undefined && v !== null) h.set(k, v);
  }
  h.set("Cache-Control", "no-store");
  h.set("Referrer-Policy", "no-referrer");
  h.set("Content-Security-Policy", scripts ? PORTAL_CSP_WITH_SCRIPT : PORTAL_CSP);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("X-Frame-Options", "DENY");
  h.set("X-Robots-Tag", "noindex, nofollow");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Resource-Policy", "same-origin");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  h.set("Strict-Transport-Security", "max-age=31536000");
  return h;
}

/* ------------------------------------------------------------------ cookies */

const COOKIE_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const COOKIE_VALUE = /^[A-Za-z0-9._~+/=-]{0,4096}$/;
const MAX_COOKIE_SECONDS = 400 * 86400;

/** A Set-Cookie header value. Only the attributes the portal needs are possible: there is deliberately no Domain option. */
export function serializeCookie(name, value, { maxAge, sameSite = "Lax" } = {}) {
  if (typeof name !== "string" || !COOKIE_NAME.test(name)) throw new Error("invalid_cookie_name");
  if (!name.startsWith("__Host-")) throw new Error("portal_cookies_must_be_host_prefixed");
  if (typeof value !== "string" || !COOKIE_VALUE.test(value)) throw new Error("invalid_cookie_value");
  if (!Number.isInteger(maxAge) || maxAge < 0 || maxAge > MAX_COOKIE_SECONDS) throw new Error("invalid_cookie_max_age");
  if (!["Lax", "Strict"].includes(sameSite)) throw new Error("invalid_cookie_same_site");
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=${sameSite}`;
}

export const clearCookie = (name) => serializeCookie(name, "", { maxAge: 0 });

/**
 * Cookies from a request. A name that appears MORE THAN ONCE is ambiguous (cookie tossing from a sibling host) and is treated
 * as absent, so the caller fails closed rather than picking one.
 */
export function readCookies(request) {
  const out = new Map();
  const seen = new Set();
  for (const part of String(request.headers.get("Cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (seen.has(name)) out.delete(name);
    else out.set(name, value);
    seen.add(name);
  }
  return out;
}
export const getCookie = (request, name) => readCookies(request).get(name);

/* ------------------------------------------------------------------ request checks and references */

/** A short reference to quote when asking for help; appears on error pages and in logs, and identifies nothing about the person. */
export function newRef() {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

/**
 * Cheap same-site screening for state-changing requests. NOT sufficient alone: a session-bound CSRF token must also match.
 * Browsers send "Origin: null" on same-origin form posts from a no-referrer page, so "null" is tolerated here (and never trusted).
 */
export function checkSameSiteMutation(request, baseOrigin) {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site && site !== "same-origin") return { ok: false, reason: "cross_site" };
  const origin = request.headers.get("Origin");
  if (origin && origin !== baseOrigin && origin !== "null") return { ok: false, reason: "foreign_origin" };
  return { ok: true };
}

/* ------------------------------------------------------------------ redirects */

/** A return path the portal itself will honour: /portal or below, plain characters only, no query string, no dot segments. */
export function safeReturnPath(value, fallback = "/portal") {
  if (typeof value !== "string" || value.length > 200) return fallback;
  if (!/^\/portal(?:\/[A-Za-z0-9._~-]+)*\/?$/.test(value) || value.split("/").some((s) => s === "." || s === "..")) return fallback;
  return value;
}

const isLocalPath = (t) => typeof t === "string" && t.startsWith("/") && !t.startsWith("//") && !t.includes("\\") && !/[\u0000-\u001F\u007F]/.test(t);

/**
 * A redirect response. `location` must be a local path or an absolute URL whose origin is in `allowedOrigins`;
 * anything else throws (a programming error that must never reach a browser).
 */
export function redirect(location, { status = 303, cookies = [], allowedOrigins = [], headers = {} } = {}) {
  if (![301, 302, 303, 307, 308].includes(status)) throw new Error("invalid_redirect_status");
  let target = location;
  if (!isLocalPath(location)) {
    let u;
    try {
      u = new URL(location);
    } catch {
      throw new Error("unsafe_redirect");
    }
    if (u.protocol !== "https:" || !allowedOrigins.includes(u.origin) || u.username || u.password) throw new Error("unsafe_redirect");
    target = u.toString();
  }
  return new Response(null, { status, headers: securityHeaders({ ...headers, Location: target, "Set-Cookie": cookies }) });
}

/* ------------------------------------------------------------------ pages */

const ERROR_COPY = {
  400: ["This request couldn’t be completed", "Something in the request wasn’t right. Please go back and try again."],
  403: ["Request refused", "This request was not accepted. Please go back and try again."],
  404: ["Page not found", "We couldn’t find that page."],
  405: ["Not available", "That action isn’t available here."],
  413: ["Request too large", "That request was too large to accept."],
  429: ["Too many attempts", "Please wait a moment and try again."],
  500: ["Something went wrong", "We hit a problem on our side. Please try again in a moment."],
  502: ["Sign-in service unavailable", "We couldn’t reach the sign-in service. Please try again in a moment."],
  503: ["Temporarily unavailable", "The client portal isn’t available right now. Please try again in a moment."],
};

/** A branded, script-free HTML page (sign-in and system pages). `bodyHtml` must already be escaped by the caller; `title` is escaped here. */
export function htmlPage({ status = 200, title, bodyHtml = "", ref = null, cookies = [], headers = {} } = {}) {
  return new Response(authFrame({ title, bodyHtml, ref }), { status, headers: securityHeaders({ ...headers, "Content-Type": "text/html; charset=utf-8", "Set-Cookie": cookies }) });
}

/** A generic error page with a short reference. Never shows upstream text, stack traces, emails or request data. */
export function errorPage(status, { ref = newRef(), cookies = [], headers = {} } = {}) {
  const [title, message] = ERROR_COPY[status] || ERROR_COPY[500];
  return htmlPage({ status: ERROR_COPY[status] ? status : 500, title, bodyHtml: `<p class="lead">${escapeHtml(message)}</p>`, ref, cookies, headers });
}

export { randomToken };
