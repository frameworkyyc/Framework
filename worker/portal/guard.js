/**
 * Request guards (Stage 2D). The only way a handler gets a signed-in user or an organization.
 *
 *   requireSession   -> who is this? (session only; grants NO organization access)
 *   requireOrgAccess -> session, then THIS request's membership + organization status + role permission, every time.
 *
 * Tenant access is re-derived from the database on every organization request: authentication alone never grants it, a removed
 * member or a suspended organization loses access on the very next request, and the organization id used by the page queries always
 * comes from the membership lookup, never from the URL or a form.
 *
 * Failure handling keeps three situations apart:
 *   not signed in / session ended   -> redirect to sign-in (cookie cleared when it was bad)
 *   the database is unavailable      -> 503 "try again" page, session cookie left alone (an outage must not sign people out)
 *   no access                        -> the same 404 for "no such organization" and "not yours"; 403 only for a role that lacks a permission
 */
import { authenticate } from "./sessions.js";
import { redirect, errorPage, clearCookie, SESSION_COOKIE } from "./http.js";
import { getActiveMembership } from "./repo/memberships.js";
import { can } from "./policy.js";
import { logEvent, routeName } from "./log.js";

export class Unavailable extends Error {
  constructor() {
    super("unavailable");
    this.name = "Unavailable";
  }
}

/** Run a database call; any failure becomes Unavailable (a 503), never a leaked error. */
export async function dbCall(fn) {
  try {
    return await fn();
  } catch {
    throw new Unavailable();
  }
}

export const unavailablePage = (ctx) => {
  logEvent({ evt: "store.unavailable", route: routeName(ctx.url.pathname), status: 503, ref: ctx.ref });
  return errorPage(503, { ref: ctx.ref, headers: { "Retry-After": "30" } });
};

export const notFoundPage = (ctx) => errorPage(404, { ref: ctx.ref });
export const forbiddenPage = (ctx) => errorPage(403, { ref: ctx.ref });

const LOGIN = "/portal/login";

/** @returns {Promise<{session}|Response>} */
export async function requireSession(ctx) {
  const auth = await authenticate(ctx.request, ctx.cfg, ctx.db, { now: ctx.now });
  if (auth.ok) return { session: auth.session };
  if (auth.reason === "store_error") return unavailablePage(ctx);
  if (auth.reason === "no_session") return redirect(LOGIN);
  // a cookie we hold but no longer honour: say so, and drop it
  return redirect(`${LOGIN}?r=ended`, { cookies: [clearCookie(SESSION_COOKIE)] });
}

/**
 * @param action a policy action such as "projects.view"
 * @returns {Promise<{session, membership}|Response>} membership = {organizationId, slug, name, websiteUrl, role}
 */
export async function requireOrgAccess(ctx, slug, action) {
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  let membership;
  try {
    membership = await dbCall(() => getActiveMembership(ctx.db, got.session.userId, slug));
  } catch (err) {
    if (err instanceof Unavailable) return unavailablePage(ctx);
    throw err;
  }
  if (!membership) {
    logEvent({ evt: "org.denied", outcome: "no_membership", route: routeName(ctx.url.pathname), ref: ctx.ref });
    return notFoundPage(ctx);
  }
  if (!can(membership.role, action)) {
    logEvent({ evt: "org.denied", outcome: "forbidden", route: routeName(ctx.url.pathname), ref: ctx.ref, org: membership.organizationId });
    return forbiddenPage(ctx);
  }
  return { session: got.session, membership };
}
