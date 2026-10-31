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
import { redirect, errorPage, clearCookie, getCookie, SESSION_COOKIE, VIEW_ROLE_COOKIE } from "./http.js";
import { getActiveMembership } from "./repo/memberships.js";
import { getStaffAccess, getOrganizationForStaff, recordStaffActivity } from "./repo/staff.js";
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

/** The client role a staff member is previewing: only "owner" or "member" from the preview cookie, anything else (missing, tampered) is "owner". */
export function viewRoleOf(request) {
  return getCookie(request, VIEW_ROLE_COOKIE) === "member" ? "member" : "owner";
}

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
 * Master Client Access: a person with a verified, BOUND grant in portal_staff (repo/staff.js) who is not a member of the organization gets a synthetic membership for it, so the
 * client portal's own pages, permissions and data run unchanged. The grant is re-read on every request; nothing about it comes from the request except which role to PREVIEW (owner or
 * member), a choice that cannot add any access. No membership row is ever written. Every staff request is audited internally (the first page of a client, and every change).
 *
 * @param action a policy action such as "projects.view"
 * @returns {Promise<{session, membership, staff?}|Response>} membership = {organizationId, slug, name, websiteUrl, role}; staff = {userId, email, previewRole} only for master access
 */
export async function requireOrgAccess(ctx, slug, action) {
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  let membership;
  let staff = null;
  try {
    membership = await dbCall(() => getActiveMembership(ctx.db, got.session.userId, slug));
    if (!membership) {
      const grant = await dbCall(() => getStaffAccess(ctx.db, got.session.userId));
      const org = grant ? await dbCall(() => getOrganizationForStaff(ctx.db, slug)) : null;
      if (grant && org) {
        const previewRole = viewRoleOf(ctx.request);
        membership = { ...org, role: previewRole };
        staff = { userId: got.session.userId, email: grant.email, previewRole };
        const first = ctx.request.method === "GET" && ctx.url.pathname === `/portal/o/${org.slug}`;
        if (first || (ctx.request.method !== "GET" && ctx.request.method !== "HEAD")) {
          await dbCall(() => recordStaffActivity(ctx.db, { organizationId: org.organizationId, userId: got.session.userId, action: first ? "staff.portal.opened" : "staff.portal.write", detail: first ? { role: previewRole } : { route: routeName(ctx.url.pathname), method: ctx.request.method, role: previewRole } }, { now: ctx.now }));
        }
      }
    }
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
  return staff ? { session: got.session, membership, staff } : { session: got.session, membership };
}
