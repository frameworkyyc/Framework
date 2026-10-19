/**
 * Client portal router (Stage 2C/2D). Wired into worker/index.js for every /portal path. It only answers when PORTAL_ENABLED is exactly "1"
 * and the settings are valid and the request is on PORTAL_BASE_URL's host; otherwise the Worker returns portalNotFound().
 *
 * Returns null (= "not mine"; worker/index.js then answers portalNotFound(), never the static site) when the portal is off, or the request is not for the portal or not on the
 * portal host. When it IS enabled but misconfigured it fails closed with a generic 503 for portal paths.
 */
import { portalMode, portalConfigProblems, readPortalConfig } from "./config.js";
import { errorPage, newRef, redirect } from "./http.js";
import { handleLogin, handleCallback, handleLogout } from "./auth.js";
import { requireSession, requireOrgAccess, dbCall, Unavailable, unavailablePage, notFoundPage } from "./guard.js";
import { isRateLimited } from "./ratelimit.js";
import { logEvent, routeName } from "./log.js";
import * as pages from "./pages.js";
import { listActiveMembershipsForUser, listMembers } from "./repo/memberships.js";
import { listProjects, getProject } from "./repo/projects.js";
import { listActivity } from "./repo/activity.js";
import { validateSlug } from "./repo/validate.js";
import { UUID } from "./repo/common.js";

/**
 * The answer for every /portal path when the portal is not serving this request (disabled, wrong host). Deliberately bare: no portal
 * styling, no reference id, and NO Strict-Transport-Security (a disabled portal must not change HSTS state for the live site).
 */
export function portalNotFound() {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

const isPortalPath = (p) => p === "/portal" || p.startsWith("/portal/");

async function home(ctx) {
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  let memberships;
  try {
    memberships = await dbCall(() => listActiveMembershipsForUser(ctx.db, got.session.userId));
  } catch (err) {
    if (err instanceof Unavailable) return unavailablePage(ctx);
    throw err;
  }
  if (memberships.length === 0) return redirect("/portal/no-access");
  if (memberships.length === 1) return redirect(`/portal/o/${memberships[0].slug}`);
  return pages.pickerPage(ctx, got.session, memberships);
}

async function noAccess(ctx) {
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  let memberships;
  try {
    memberships = await dbCall(() => listActiveMembershipsForUser(ctx.db, got.session.userId));
  } catch (err) {
    if (err instanceof Unavailable) return unavailablePage(ctx);
    throw err;
  }
  return memberships.length ? redirect("/portal") : pages.noAccessPage(ctx, got.session);
}

/** Organization pages: every one goes through requireOrgAccess; queries use ONLY the membership's organization id. */
const ORG_ROUTES = [
  { re: /^\/portal\/o\/([^/]+)$/, action: "org.view", run: async (ctx, a) => pages.overviewPage(ctx, a, { projects: await listProjects(ctx.db, a.membership.organizationId), activity: await listActivity(ctx.db, a.membership.organizationId, { limit: 5 }) }) },
  { re: /^\/portal\/o\/([^/]+)\/projects$/, action: "projects.view", run: async (ctx, a) => pages.projectsPage(ctx, a, await listProjects(ctx.db, a.membership.organizationId)) },
  {
    re: /^\/portal\/o\/([^/]+)\/projects\/([^/]+)$/,
    action: "projects.view",
    run: async (ctx, a, id) => {
      if (!UUID.test(id)) return notFoundPage(ctx);
      const p = await getProject(ctx.db, a.membership.organizationId, id);
      return p ? pages.projectPage(ctx, a, p) : notFoundPage(ctx);
    },
  },
  { re: /^\/portal\/o\/([^/]+)\/activity$/, action: "activity.view", run: async (ctx, a) => pages.activityPage(ctx, a, await listActivity(ctx.db, a.membership.organizationId, { limit: 50 })) },
  {
    re: /^\/portal\/o\/([^/]+)\/members$/,
    action: "members.view",
    run: async (ctx, a) => pages.membersPage(ctx, a, (await listMembers(ctx.db, a.membership.organizationId)).filter((m) => m.status === "active" && m.user_status === "active")),
  },
];

async function orgRoute(ctx, path) {
  for (const r of ORG_ROUTES) {
    const m = r.re.exec(path);
    if (!m) continue;
    if (ctx.request.method !== "GET" && ctx.request.method !== "HEAD") return errorPage(405, { ref: ctx.ref, headers: { Allow: "GET, HEAD" } });
    const slug = validateSlug(m[1]);
    if (!slug) return notFoundPage(ctx);
    const access = await requireOrgAccess(ctx, slug, r.action);
    if (access instanceof Response) return access;
    try {
      return await r.run(ctx, access, m[2]);
    } catch (err) {
      // a failed database read after the guard is an outage; a bug (TypeError and friends) or bad input is a 500 and is not disguised
      if (err instanceof Unavailable || !(err instanceof Error) || !["PortalDataError", "TypeError", "ReferenceError", "RangeError", "SyntaxError"].includes(err.name)) return unavailablePage(ctx);
      throw err;
    }
  }
  return null;
}

const SIMPLE = {
  "/portal": home,
  "/portal/login": handleLogin,
  "/portal/auth/callback": handleCallback,
  "/portal/logout": handleLogout,
  "/portal/no-access": noAccess,
};
const LIMITED = { "/portal/login": "login", "/portal/auth/callback": "callback", "/portal/logout": "logout" };

/** @returns {Promise<Response|null>} */
export async function handlePortal(request, env, deps = {}) {
  if (portalMode(env) === "off") return null;
  const url = new URL(request.url);
  if (!isPortalPath(url.pathname)) return null;
  const ref = newRef();
  if (portalMode(env) === "misconfigured") {
    const problems = portalConfigProblems(env); // setting NAMES / codes only, never values
    logEvent({ evt: "config.invalid", outcome: "failed_closed", reason: problems[0].toLowerCase(), route: routeName(url.pathname), ref, count: problems.length });
    return errorPage(503, { ref });
  }
  const cfg = readPortalConfig(env);
  if (url.origin !== cfg.origin) return null;

  const ctx = { request, env, cfg, db: env.PORTAL_DB, url, now: deps.now || new Date(), fetch: deps.fetch || fetch, ref };
  const started = Date.now();
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  let response;
  try {
    const bucket = LIMITED[path];
    const limited = bucket && !(path === "/portal/login" && request.method === "GET" && url.searchParams.get("start") !== "1"); // the plain login page is free; starting a sign-in is not
    if (limited) {
      if (await isRateLimited(env, request, cfg, bucket)) {
        logEvent({ evt: "rate.limited", outcome: bucket, route: routeName(path), status: 429, ref });
        return errorPage(429, { ref, headers: { "Retry-After": "60" } });
      }
    }
    if (SIMPLE[path]) {
      if (path === "/portal" || path === "/portal/no-access") {
        if (request.method !== "GET" && request.method !== "HEAD") return errorPage(405, { ref, headers: { Allow: "GET, HEAD" } });
      }
      response = await SIMPLE[path](ctx);
    } else {
      response = (await orgRoute(ctx, path)) || errorPage(404, { ref });
    }
  } catch (err) {
    if (err instanceof Unavailable) return unavailablePage(ctx);
    logEvent({ evt: "request.failed", outcome: "error", route: routeName(path), status: 500, ref });
    return errorPage(500, { ref });
  }
  logEvent({ evt: "request", method: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(request.method) ? request.method : undefined, route: routeName(path), status: response.status, ms: Date.now() - started, ref });
  return response;
}
