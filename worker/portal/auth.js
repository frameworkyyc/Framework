/**
 * Sign-in, callback and sign-out handlers (Stage 2C). Each takes the request context built by the router and returns a Response.
 *
 * Sign-in is a PKCE authorization-code flow: /portal/login sets a short-lived signed state cookie and sends the browser to WorkOS;
 * /portal/auth/callback accepts the result ONLY if the state matches that cookie, exchanges the code server-side, verifies the
 * token, matches the identity, provisions the user from invitations, and creates a brand-new portal session.
 *
 * Failure policy (all generic to the person, each with a short reference; details go to the structured log by code only):
 *   state missing/expired/mismatched, WorkOS error, bad or reused code, token not valid, no WorkOS session id, email not verified
 *   -> 400/403 page, nothing created.   WorkOS or the database unreachable -> 502/503 page, nothing created, try again.
 */
import { sealPayload, openPayload, randomToken, sha256b64url, timingSafeEqualStrings } from "./crypto.js";
import { redirect, errorPage, serializeCookie, clearCookie, checkSameSiteMutation, STATE_COOKIE, SESSION_COOKIE, WORKOS_ORIGIN, getCookie } from "./http.js";
import { buildAuthorizeUrl, exchangeCode, verifyAccessToken, forwardableParams } from "./workos.js";
import { identityFromWorkosUser } from "./claims.js";
import { rotateSession, endSession, workosLogoutUrl, checkCsrf } from "./sessions.js";
import { upsertUserFromIdentity } from "./repo/users.js";
import { activatePendingInvitations } from "./repo/invitations.js";
import { recordActivity } from "./repo/activity.js";
import { loginPage } from "./pages.js";
import { requireSession, dbCall, Unavailable, unavailablePage } from "./guard.js";
import { logEvent, routeName } from "./log.js";
import { htmlPage } from "./http.js";

const STATE_TTL_SECONDS = 600;
const STATE_PURPOSE = "auth-state";
const ALLOWED_ORIGINS = [WORKOS_ORIGIN];

const note = (ctx, evt, outcome, extra = {}) => logEvent({ evt, outcome, route: routeName(ctx.url.pathname), ref: ctx.ref, ...extra });
const methodNotAllowed = (ctx, allow) => errorPage(405, { ref: ctx.ref, headers: { Allow: allow } });

/** An error page that also removes the one-shot state cookie, with a way to try again. */
function signInFailure(ctx, status, title, message, extraCookies = []) {
  return htmlPage({
    status,
    title,
    ref: ctx.ref,
    cookies: [clearCookie(STATE_COOKIE), ...extraCookies],
    bodyHtml: `<p class="lead">${message}</p><p><a class="btn btn--primary" href="/portal/login">Try again</a></p>`,
  });
}

/* ------------------------------------------------------------------ GET /portal/login */

export async function handleLogin(ctx) {
  if (ctx.request.method !== "GET" && ctx.request.method !== "HEAD") return methodNotAllowed(ctx, "GET, HEAD");
  const already = await requireSession(ctx);
  if (!(already instanceof Response)) return redirect("/portal"); // already signed in
  if (already.status === 503) return already; // an outage is reported as an outage, not as "please sign in"

  const forward = forwardableParams(ctx.url.searchParams);
  if (ctx.url.searchParams.get("start") !== "1") {
    // An interstitial, so that returning here after sign-out never silently signs the person straight back in.
    const qs = new URLSearchParams({ start: "1", ...forward }).toString();
    return loginPage({ continueHref: `/portal/login?${qs}`, ended: ctx.url.searchParams.get("r") === "ended" });
  }

  const state = randomToken(32);
  const verifier = randomToken(32);
  const sealed = await sealPayload(ctx.cfg.pepper, STATE_PURPOSE, { s: state, v: verifier }, ctx.now, STATE_TTL_SECONDS);
  const location = buildAuthorizeUrl(ctx.cfg, { state, challenge: await sha256b64url(verifier), loginHint: forward.login_hint, invitationToken: forward.invitation_token });
  note(ctx, "auth.start", "redirected");
  return redirect(location, { status: 302, allowedOrigins: ALLOWED_ORIGINS, cookies: [serializeCookie(STATE_COOKIE, sealed, { maxAge: STATE_TTL_SECONDS })] });
}

/* ------------------------------------------------------------------ GET /portal/auth/callback */

export async function handleCallback(ctx) {
  if (ctx.request.method !== "GET") return methodNotAllowed(ctx, "GET");
  const q = ctx.url.searchParams;
  const code = q.get("code") || "";
  const state = q.get("state") || "";
  const upstreamError = q.get("error");

  // 1. The attempt must have started in THIS browser (login CSRF / fixation defence) and not be stale.
  const cookie = getCookie(ctx.request, STATE_COOKIE);
  const sealed = cookie ? await openPayload(ctx.cfg.pepper, STATE_PURPOSE, cookie, ctx.now) : null;
  if (!sealed || typeof sealed.s !== "string" || typeof sealed.v !== "string") {
    note(ctx, "auth.callback", "rejected", { reason: "state_missing" });
    return signInFailure(ctx, 400, "Sign-in expired", "This sign-in attempt has expired or didn’t start on this device.");
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(state) || !timingSafeEqualStrings(await sha256b64url(state), await sha256b64url(sealed.s))) {
    note(ctx, "auth.callback", "rejected", { reason: "state_mismatch" });
    return signInFailure(ctx, 400, "Sign-in couldn’t be verified", "This sign-in attempt couldn’t be verified.");
  }
  if (upstreamError !== null) {
    note(ctx, "auth.callback", "rejected", { reason: "upstream_error" });
    return signInFailure(ctx, 400, "Sign-in wasn’t completed", "The sign-in wasn’t completed.");
  }

  // 2. Server-side code exchange.
  const exchanged = await exchangeCode(ctx.cfg, code, sealed.v, ctx.fetch);
  if (!exchanged.ok) {
    note(ctx, "auth.callback", exchanged.kind === "unavailable" ? "upstream_unavailable" : "rejected", { reason: "code_exchange", status: exchanged.kind === "unavailable" ? 502 : 400 });
    return exchanged.kind === "unavailable"
      ? signInFailure(ctx, 502, "Sign-in service unavailable", "We couldn’t reach the sign-in service. Please try again in a moment.")
      : signInFailure(ctx, 400, "Sign-in couldn’t be completed", "This sign-in link has expired or was already used.");
  }

  // 3. Token and identity.
  const token = await verifyAccessToken(ctx.cfg, exchanged.accessToken, ctx.fetch, ctx.now);
  if (!token.ok) {
    note(ctx, "auth.callback", token.kind === "unavailable" ? "upstream_unavailable" : "rejected", { reason: token.reason });
    return token.kind === "unavailable"
      ? signInFailure(ctx, 502, "Sign-in service unavailable", "We couldn’t reach the sign-in service. Please try again in a moment.")
      : signInFailure(ctx, 400, "Sign-in couldn’t be verified", "We couldn’t verify this sign-in.");
  }
  const who = identityFromWorkosUser(exchanged.user, token.claims);
  if (!who.ok) {
    note(ctx, "auth.callback", "rejected", { reason: who.reason });
    return who.reason === "email_not_verified"
      ? signInFailure(ctx, 403, "Email not verified", "We couldn’t confirm your email address.")
      : signInFailure(ctx, 400, "Sign-in couldn’t be verified", "We couldn’t verify this sign-in.");
  }

  // 4. Provision from invitations, then create the session. Any database failure here creates no session.
  try {
    const up = await dbCall(() => upsertUserFromIdentity(ctx.db, who.identity, { now: ctx.now }));
    if (!up.ok) {
      note(ctx, "auth.callback", "rejected", { reason: up.error });
      return signInFailure(ctx, 403, "Account needs attention", "We couldn’t finish setting up your account. Please contact Framework.");
    }
    const user = up.user;
    if (user.status !== "active") {
      note(ctx, "auth.callback", "rejected", { reason: "user_disabled", user: user.id });
      return signInFailure(ctx, 403, "Account unavailable", "This account isn’t able to sign in. Please contact Framework.");
    }
    const act = await dbCall(() => activatePendingInvitations(ctx.db, { user, emailVerified: true }, { now: ctx.now }));
    const started = await rotateSession(ctx.request, ctx.cfg, ctx.db, { userId: user.id, workosSessionId: token.claims.sid, authMethod: exchanged.authMethod, ip: ctx.request.headers.get("CF-Connecting-IP") }, { now: ctx.now });
    if (!started.ok) {
      if (started.error === "store_error") throw new Unavailable();
      note(ctx, "auth.callback", "rejected", { reason: started.error, user: user.id });
      return signInFailure(ctx, 403, "Account unavailable", "This account isn’t able to sign in. Please contact Framework.");
    }
    // user-level audit entry; its failure must not undo a successful sign-in
    try {
      await recordActivity(ctx.db, { organizationId: null, actorType: "client", actorRef: user.id, action: "auth.signed_in" }, { now: ctx.now });
    } catch {
      /* ignore */
    }
    note(ctx, "auth.callback", "signed_in", { user: user.id, count: act.ok ? act.activated.length : 0, status: 303 });
    return redirect("/portal", { cookies: [clearCookie(STATE_COOKIE), started.cookie] });
  } catch (err) {
    if (err instanceof Unavailable) {
      note(ctx, "auth.callback", "store_unavailable", { status: 503 });
      return htmlPage({ status: 503, title: "Temporarily unavailable", ref: ctx.ref, cookies: [clearCookie(STATE_COOKIE)], headers: { "Retry-After": "30" }, bodyHtml: `<p class="lead">The client portal isn’t available right now. Please try again in a moment.</p><p><a class="btn btn--primary" href="/portal/login">Try again</a></p>` });
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ POST /portal/logout */

const MAX_FORM_BYTES = 2048; // the sign-out form is one fixed-length token

/** Cheap pre-check from the headers alone: a declared length over the limit (or not a number) is refused before anything is read. */
function declaredBodyProblem(request) {
  const declared = request.headers.get("Content-Length");
  if (declared === null) return null;
  if (!/^\d{1,12}$/.test(declared.trim())) return 400;
  return Number(declared) > MAX_FORM_BYTES ? 413 : null;
}

/**
 * Read the form body, never more than MAX_FORM_BYTES: the stream is cancelled the moment the limit is crossed, so an oversized or
 * chunked (no Content-Length) body is never buffered whole. Returns { tooLarge: true } or { value }.
 */
async function formValue(request, name) {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/x-www-form-urlencoded")) return { value: "" };
  if (!request.body) return { value: "" };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FORM_BYTES) {
      await reader.cancel().catch(() => {});
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return { value: new URLSearchParams(new TextDecoder().decode(bytes)).get(name) || "" };
}

export async function handleLogout(ctx) {
  if (ctx.request.method !== "POST") return methodNotAllowed(ctx, "POST");
  const declared = declaredBodyProblem(ctx.request); // before the session lookup: an oversized request costs no database work and its body is never read
  if (declared) {
    note(ctx, "auth.logout", "rejected", { reason: "body_too_large", status: declared });
    return errorPage(declared, { ref: ctx.ref });
  }
  const same = checkSameSiteMutation(ctx.request, ctx.cfg.origin);
  if (!same.ok) {
    note(ctx, "auth.logout", "rejected", { reason: same.reason, status: 403 });
    return errorPage(403, { ref: ctx.ref });
  }
  const got = await requireSession(ctx);
  if (got instanceof Response) {
    // No usable session: nothing to end. An outage is still reported as one; anything else just goes to sign-in.
    return got.status === 503 ? got : redirect("/portal/login", { cookies: [clearCookie(SESSION_COOKIE)] });
  }
  const form = await formValue(ctx.request, "csrf");
  if (form.tooLarge) {
    note(ctx, "auth.logout", "rejected", { reason: "body_too_large", status: 413 });
    return errorPage(413, { ref: ctx.ref });
  }
  if (!(await checkCsrf(ctx.cfg, got.session, form.value))) {
    note(ctx, "auth.logout", "rejected", { reason: "csrf", status: 403 });
    return errorPage(403, { ref: ctx.ref });
  }
  const ended = await endSession(ctx.request, ctx.cfg, ctx.db, { now: ctx.now });
  if (ended.error) {
    // The server-side session could not be revoked: do NOT pretend the person is signed out.
    note(ctx, "auth.logout", "store_unavailable", { status: 503 });
    return unavailablePage(ctx);
  }
  note(ctx, "auth.logout", "signed_out", { user: got.session.userId, status: 303 });
  const back = ctx.cfg.origin + "/portal/login";
  const idp = workosLogoutUrl(ctx.cfg, ended.workosSessionId, back);
  return redirect(idp || "/portal/login", { cookies: [ended.cookie], allowedOrigins: ALLOWED_ORIGINS });
}
