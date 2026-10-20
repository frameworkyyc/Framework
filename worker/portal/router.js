/**
 * Client portal router (Stage 2C/2D). Wired into worker/index.js for every /portal path. It only answers when PORTAL_ENABLED is exactly "1"
 * and the settings are valid and the request is on PORTAL_BASE_URL's host; otherwise the Worker returns portalNotFound().
 *
 * Returns null (= "not mine"; worker/index.js then answers portalNotFound(), never the static site) when the portal is off, or the request is not for the portal or not on the
 * portal host. When it IS enabled but misconfigured it fails closed with a generic 503 for portal paths.
 */
import { portalMode, portalConfigProblems, readPortalConfig, demoEnabled } from "./config.js";
import { errorPage, newRef, redirect, checkSameSiteMutation } from "./http.js";
import { handleLogin, handleCallback, handleLogout } from "./auth.js";
import { requireSession, requireOrgAccess, dbCall, Unavailable, unavailablePage, notFoundPage } from "./guard.js";
import { checkRateLimit } from "./ratelimit.js";
import { logEvent, routeName } from "./log.js";
import * as pages from "./pages.js";
import { handleDemo, isDemoPath } from "./demo.js";
import { viewFilters } from "./filters.js";
import { listActiveMembershipsForUser, listMembers } from "./repo/memberships.js";
import { listProjects, getProject } from "./repo/projects.js";
import { listActivity } from "./repo/activity.js";
import { validateSlug } from "./repo/validate.js";
import { UUID } from "./repo/common.js";
import { getProfileAnswers, saveProfileStep } from "./repo/business-profile.js";
import { stepById } from "./profile-schema.js";
import { readForm, declaredBodyProblem, MAX_PROFILE_FORM_BYTES, MAX_FEEDBACK_FORM_BYTES } from "./form.js";
import { submitPortalFeedback, validPageKey } from "./repo/portal-feedback.js";
import { checkCsrf } from "./sessions.js";

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
const SOON = "branding|website|marketing|content|files";

/** Save one questionnaire step. Every check below runs on the server for every save; the organization comes from the membership, never the form. */
async function saveProfile(ctx, a, stepId) {
  const step = stepById(stepId);
  if (!step) return notFoundPage(ctx);
  const read = await readForm(ctx.request, MAX_PROFILE_FORM_BYTES);
  if (read.error) return errorPage(read.error, { ref: ctx.ref });
  const csrfOk = await checkCsrf(ctx.cfg, a.session, read.fields.get("csrf") || "");
  if (!csrfOk) {
    logEvent({ evt: "profile.save", outcome: "rejected", reason: "csrf", status: 403, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId });
    return errorPage(403, { ref: ctx.ref });
  }
  const input = {};
  for (const d of step.fields) if (read.fields.has(d.id)) input[d.id] = read.fields.get(d.id);
  let saved;
  try {
    saved = await dbCall(() => getProfileAnswers(ctx.db, a.membership.organizationId));
  } catch (err) {
    if (err instanceof Unavailable) return unavailablePage(ctx);
    throw err;
  }
  let result;
  try {
    result = await dbCall(() => saveProfileStep(ctx.db, a.membership.organizationId, a.session.userId, stepId, input, { now: ctx.now }));
  } catch (err) {
    if (!(err instanceof Unavailable)) throw err;
    logEvent({ evt: "profile.save", outcome: "store_unavailable", status: 503, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId });
    // keep what the person typed on the page and say plainly that it was not stored
    return pages.profileStepPage(ctx, a, step, saved, { values: Object.fromEntries(step.fields.map((d) => [d.id, input[d.id] || ""])), failed: true, status: 503 });
  }
  if (!result.ok) {
    logEvent({ evt: "profile.save", outcome: "invalid", status: 422, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId, count: Object.keys(result.errors || {}).length });
    return pages.profileStepPage(ctx, a, step, saved, { values: result.values || {}, errors: result.errors || {}, status: 422 });
  }
  logEvent({ evt: "profile.save", outcome: "saved", status: 303, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId, user: a.session.userId });
  return redirect(`/portal/o/${a.membership.slug}/profile/${stepId}?saved=1`);
}

/** Send feedback. Organization and person come from the membership and session; the form supplies only the kind, the message and an optional section. */
async function saveFeedback(ctx, a) {
  const read = await readForm(ctx.request, MAX_FEEDBACK_FORM_BYTES);
  if (read.error) return errorPage(read.error, { ref: ctx.ref });
  if (!(await checkCsrf(ctx.cfg, a.session, read.fields.get("csrf") || ""))) {
    logEvent({ evt: "feedback.submit", outcome: "rejected", reason: "csrf", status: 403, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId });
    return errorPage(403, { ref: ctx.ref });
  }
  const input = { kind: read.fields.get("kind") || "", message: read.fields.get("message") || "", page: read.fields.get("page") || "" };
  let result;
  try {
    result = await dbCall(() => submitPortalFeedback(ctx.db, a.membership.organizationId, a.session.userId, input, { now: ctx.now }));
  } catch (err) {
    if (!(err instanceof Unavailable)) throw err;
    logEvent({ evt: "feedback.submit", outcome: "store_unavailable", status: 503, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId });
    return pages.feedbackPage(ctx, a, { values: input, failed: true, status: 503 });
  }
  if (result.ok) {
    logEvent({ evt: "feedback.submit", outcome: "saved", status: 303, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId, user: a.session.userId });
    return redirect(`/portal/o/${a.membership.slug}/feedback?sent=1`);
  }
  if (result.error === "too_many") {
    logEvent({ evt: "feedback.submit", outcome: "too_many", status: 429, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId });
    return pages.feedbackPage(ctx, a, { values: input, tooMany: true, status: 429 });
  }
  logEvent({ evt: "feedback.submit", outcome: "invalid", status: 422, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId, count: Object.keys(result.errors || {}).length });
  return pages.feedbackPage(ctx, a, { values: result.values || input, errors: result.errors || {}, status: 422 });
}

const ORG_ROUTES = [
  { re: /^\/portal\/o\/([^/]+)$/, action: "org.view", run: async (ctx, a) => pages.homePage(ctx, a) },
  { re: /^\/portal\/o\/([^/]+)\/progress$/, action: "org.view", run: async (ctx, a) => pages.overviewPage(ctx, a, { projects: await listProjects(ctx.db, a.membership.organizationId), activity: await listActivity(ctx.db, a.membership.organizationId, { limit: 5 }) }) },
  { re: /^\/portal\/o\/([^/]+)\/profile$/, action: "profile.view", run: async (ctx, a) => pages.profileOverviewPage(ctx, a, await getProfileAnswers(ctx.db, a.membership.organizationId)) },
  {
    re: /^\/portal\/o\/([^/]+)\/profile\/([^/]+)$/,
    action: "profile.view",
    postAction: "profile.edit",
    bucket: "profile",
    run: async (ctx, a, id) => {
      const step = stepById(id);
      return step ? pages.profileStepPage(ctx, a, step, await getProfileAnswers(ctx.db, a.membership.organizationId), { savedNote: viewFilters(ctx.url).saved }) : notFoundPage(ctx);
    },
    post: (ctx, a, id) => saveProfile(ctx, a, id),
  },
  {
    re: /^\/portal\/o\/([^/]+)\/feedback$/,
    action: "feedback.submit",
    postAction: "feedback.submit",
    bucket: "feedback",
    run: async (ctx, a) => {
      const f = viewFilters(ctx.url);
      return pages.feedbackPage(ctx, a, f.sent ? { sent: true } : { from: validPageKey(f.from) || "" });
    },
    post: (ctx, a) => saveFeedback(ctx, a),
  },
  { re: new RegExp(`^\\/portal\\/o\\/([^/]+)\\/(${SOON})$`), action: "workspace.view", run: async (ctx, a, key) => pages.comingSoonPage(ctx, a, key) },
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
  { re: /^\/portal\/o\/([^/]+)\/activity$/, action: "activity.view", run: async (ctx, a) => pages.activityPage(ctx, a, await listActivity(ctx.db, a.membership.organizationId, { limit: 50 }), viewFilters(ctx.url)) },
  { re: /^\/portal\/o\/([^/]+)\/documents$/, action: "documents.view", run: async (ctx, a) => pages.documentsPage(ctx, a, viewFilters(ctx.url)) },
  { re: /^\/portal\/o\/([^/]+)\/account$/, action: "account.view", run: async (ctx, a) => pages.accountPage(ctx, a) },
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
    const method = ctx.request.method;
    const isPost = method === "POST" && !!r.post;
    if (method !== "GET" && method !== "HEAD" && !isPost) return errorPage(405, { ref: ctx.ref, headers: { Allow: r.post ? "GET, HEAD, POST" : "GET, HEAD" } });
    const slug = validateSlug(m[1]);
    if (!slug) return notFoundPage(ctx);
    if (isPost) {
      // cheap checks first: an oversized or cross-site request costs no database work and its body is never read
      const declared = declaredBodyProblem(ctx.request, r.bucket === "feedback" ? MAX_FEEDBACK_FORM_BYTES : MAX_PROFILE_FORM_BYTES);
      if (declared) return errorPage(declared, { ref: ctx.ref });
      const same = checkSameSiteMutation(ctx.request, ctx.cfg.origin);
      if (!same.ok) {
        logEvent({ evt: "profile.save", outcome: "rejected", reason: same.reason, status: 403, route: routeName(path), ref: ctx.ref });
        return errorPage(403, { ref: ctx.ref });
      }
      const limit = await checkRateLimit(ctx.env, ctx.request, ctx.cfg, r.bucket);
      if (limit.limited) {
        logEvent({ evt: "rate.limited", outcome: r.bucket, route: routeName(path), status: 429, ref: ctx.ref });
        return errorPage(429, { ref: ctx.ref, headers: { "Retry-After": "60" } });
      }
    }
    const access = await requireOrgAccess(ctx, slug, isPost ? r.postAction : r.action);
    if (access instanceof Response) return access;
    try {
      return await (isPost ? r.post : r.run)(ctx, access, m[2]);
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

  const ctx = { request, env, cfg, db: env.PORTAL_DB, url, now: deps.now || new Date(), fetch: deps.fetch || fetch, ref, demo: demoEnabled(env, cfg) };
  const started = Date.now();
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  let response;
  let rl; // the limiter outcome (a fixed word), set only for the limited endpoints; logged on the final `request` event
  try {
    if (isDemoPath(path)) {
      // The static demonstration: no session, no database, no cookies, sample data only. Off everywhere except where demoEnabled says so (never a production host).
      response = ctx.demo ? handleDemo(ctx, path) : errorPage(404, { ref });
      logEvent({ evt: "request", method: request.method === "GET" || request.method === "HEAD" ? request.method : undefined, route: routeName(path), status: response.status, ms: Date.now() - started, ref });
      return response;
    }
    const bucket = LIMITED[path];
    const limited = bucket && !(path === "/portal/login" && request.method === "GET" && url.searchParams.get("start") !== "1"); // the plain login page is free; starting a sign-in is not
    if (limited) {
      const check = await checkRateLimit(env, request, cfg, bucket);
      rl = check.outcome;
      if (check.limited) {
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
  logEvent({ evt: "request", method: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(request.method) ? request.method : undefined, route: routeName(path), status: response.status, ms: Date.now() - started, ref, rl });
  return response;
}
