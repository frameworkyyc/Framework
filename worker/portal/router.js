/**
 * Client portal router (Stage 2C/2D). Wired into worker/index.js for every /portal path. It only answers when PORTAL_ENABLED is exactly "1"
 * and the settings are valid and the request is on PORTAL_BASE_URL's host; otherwise the Worker returns portalNotFound().
 *
 * Returns null (= "not mine"; worker/index.js then answers portalNotFound(), never the static site) when the portal is off, or the request is not for the portal or not on the
 * portal host. When it IS enabled but misconfigured it fails closed with a generic 503 for portal paths.
 */
import { portalMode, portalConfigProblems, readPortalConfig, demoEnabled, brandingEnabled, servicesEnabled, websiteEnabled } from "./config.js";
import { errorPage, newRef, redirect, checkSameSiteMutation, securityHeaders, serializeCookie, safeReturnPath, VIEW_ROLE_COOKIE } from "./http.js";
import { handleLogin, handleCallback, handleLogout } from "./auth.js";
import { requireSession, requireOrgAccess, dbCall, Unavailable, unavailablePage, notFoundPage } from "./guard.js";
import { checkRateLimit } from "./ratelimit.js";
import { logEvent, routeName } from "./log.js";
import * as pages from "./pages.js";
import { handleDemo, isDemoPath } from "./demo.js";
import { viewFilters } from "./filters.js";
import { listActiveMembershipsForUser, listMembers } from "./repo/memberships.js";
import { setUserName } from "./repo/users.js";
import { getStaffAccess, listOrganizationsForStaff } from "./repo/staff.js";
import { listRequirementSettings } from "./repo/brand-requirement-settings.js";
import { listClientMilestones } from "./repo/website-milestones.js";
import { stageOf, milestoneProgress } from "./website-stage.js";
import { getSeoForClient } from "./repo/website-seo.js";
import { listProjects, getProject } from "./repo/projects.js";
import { listActivity } from "./repo/activity.js";
import { validateSlug, validateName } from "./repo/validate.js";
import { UUID } from "./repo/common.js";
import { getProfileAnswers, saveProfileStep, getStepRevision } from "./repo/business-profile.js";
import { hasPriorVisit } from "./repo/visits.js";
import { stepById, PROFILE_STEPS, MULTI_SEP } from "./profile-schema.js";
import { comingSoonKeys, LIVE_AREAS } from "./guided-data.js";
import { moduleStatuses, nextActions } from "./module-status.js";
import { readForm, readUpload, readUploads, declaredBodyProblem, MAX_PROFILE_FORM_BYTES, MAX_FEEDBACK_FORM_BYTES, UPLOAD_FORM_OVERHEAD } from "./form.js";
import { submitPortalFeedback, validPageKey } from "./repo/portal-feedback.js";
import { checkCsrf } from "./sessions.js";
import { can } from "./policy.js";
import { getClientBrand, listClientUploads, uploadUsage, getBrandKit, listServiceRequests, createServiceRequest } from "./repo/brand.js";
import { loadPricing, listPrices } from "./repo/prices.js";
import { listClientInvoices, clientInvoiceSummary } from "./repo/invoices.js";
import { clientDownloadInvoice } from "./invoice-files.js";
import { invoiceStatusLine, supportStatusLine } from "./services-live.js";
import { listClientWebsites, getClientWebsite } from "./repo/client-websites.js";
import { clientScreenshotResponse } from "./website-files.js";
import { checkEmbeddable } from "./website-preview.js";
import { kindOf, categoryOfKind } from "./website-live.js";
import { clientPackageResponse } from "./website-files.js";
import { getClientPackage } from "./repo/website-packages.js";
import { listClientServices, requestKeyOfService, SERVICE_KEYS } from "./repo/portal-services.js";
import { pricingFrom, priceSnapshot } from "./branding-pricing.js";
import * as supportRepo from "./repo/support.js";
import { clientCreateRequest, clientReply, clientDownloadAttachment } from "./support-files.js";
import { dispatchNotifications } from "./service-notifications.js";
import { fontCss } from "./brand-type.js";
import { clientUploadFile, clientDeleteUpload, clientDownloadUpload, clientDownloadAsset, clientRequestService, limitsFor } from "./brand-files.js";

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
  // Master Client Access: a bound, unrevoked Framework grant sees every client (the directory); nobody else's page changes.
  let directory = null;
  try {
    const grant = await dbCall(() => getStaffAccess(ctx.db, got.session.userId));
    if (grant) directory = await dbCall(() => listOrganizationsForStaff(ctx.db, { q: (ctx.url.searchParams.get("q") || "").slice(0, 80) }));
  } catch (err) {
    if (err instanceof Unavailable) return unavailablePage(ctx);
    throw err;
  }
  if (directory) return pages.staffDirectoryPage(ctx, got.session, directory, ctx.url.searchParams.get("q") || "");
  if (memberships.length === 0) return redirect("/portal/no-access");
  if (memberships.length === 1) return redirect(`/portal/o/${memberships[0].slug}`);
  return pages.pickerPage(ctx, got.session, memberships);
}

/** Choose which client role the Framework master-access banner previews (owner or member). It grants nothing: the cookie only picks what to show; access is re-derived from the database. */
async function staffViewAs(ctx) {
  if (ctx.request.method !== "POST") return errorPage(405, { ref: ctx.ref, headers: { Allow: "POST" } });
  const same = checkSameSiteMutation(ctx.request, ctx.cfg.origin);
  if (!same.ok) return errorPage(403, { ref: ctx.ref });
  const got = await requireSession(ctx);
  if (got instanceof Response) return got;
  let grant;
  try {
    grant = await dbCall(() => getStaffAccess(ctx.db, got.session.userId));
  } catch (err) {
    if (err instanceof Unavailable) return unavailablePage(ctx);
    throw err;
  }
  if (!grant) return notFoundPage(ctx);
  const read = await readForm(ctx.request, MAX_FEEDBACK_FORM_BYTES);
  if (read.error) return errorPage(read.error, { ref: ctx.ref });
  if (!(await checkCsrf(ctx.cfg, got.session, read.fields.get("csrf") || ""))) return errorPage(403, { ref: ctx.ref });
  const role = read.fields.get("role");
  if (role !== "owner" && role !== "member") return errorPage(400, { ref: ctx.ref });
  const next = safeReturnPath(read.fields.get("next") || "", "/portal");
  return redirect(next, { cookies: [serializeCookie(VIEW_ROLE_COOKIE, role, { maxAge: 8 * 3600 })] });
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
/** The Coming Soon pages (members only, like every organization page) for each section that is not built yet; derived from the same list that drives Home. */
const SOON = comingSoonKeys().join("|");
const brandingOn = (ctx) => brandingEnabled(ctx.env);
const servicesOn = (ctx) => servicesEnabled(ctx.env);
const websiteOn = (ctx) => websiteEnabled(ctx.env);

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
  for (const d of step.fields) {
    // a multiple-choice question arrives as one checkbox per option (<id>__<n>); an unchecked box is simply absent, so no box checked means "unanswered"
    if (d.kind === "multi") input[d.id] = d.options.filter((o, i) => read.fields.get(`${d.id}__${i}`) === o).join(MULTI_SEP);
    else if (read.fields.has(d.id)) input[d.id] = read.fields.get(d.id);
  }
  // The revision the form was loaded with (see repo/business-profile.js). Missing or malformed counts as "unknown": it can never match, so such a save is a conflict.
  const posted = read.fields.has("rev") ? read.fields.get("rev") : null;
  const rev = typeof posted === "string" && /^(?:[0-9a-f-]{36})?$/.test(posted) ? posted : null;
  let saved;
  try {
    saved = await dbCall(() => getProfileAnswers(ctx.db, a.membership.organizationId));
  } catch (err) {
    if (err instanceof Unavailable) return unavailablePage(ctx);
    throw err;
  }
  let result;
  try {
    result = await dbCall(() => saveProfileStep(ctx.db, a.membership.organizationId, a.session.userId, stepId, input, { now: ctx.now, expectedRevision: rev }));
  } catch (err) {
    if (!(err instanceof Unavailable)) throw err;
    logEvent({ evt: "profile.save", outcome: "store_unavailable", status: 503, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId });
    // keep what the person typed on the page and say plainly that it was not stored
    return pages.profileStepPage(ctx, a, step, saved, { values: Object.fromEntries(step.fields.map((d) => [d.id, input[d.id] || ""])), failed: true, status: 503, revision: rev ?? "" });
  }
  if (!result.ok && result.error === "conflict") {
    // The step changed since this form was loaded (another window, device or member). NOTHING was written. Show the person's own input again, say what is
    // saved now, and carry the latest revision so that saving again is a deliberate, informed choice.
    logEvent({ evt: "profile.save", outcome: "conflict", status: 409, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId, user: a.session.userId });
    const latest = await dbCall(() => getProfileAnswers(ctx.db, a.membership.organizationId));
    return pages.profileStepPage(ctx, a, step, latest, { values: Object.fromEntries(step.fields.map((d) => [d.id, input[d.id] || ""])), conflict: result.currentValues, revision: result.revision, status: 409 });
  }
  if (!result.ok) {
    logEvent({ evt: "profile.save", outcome: "invalid", status: 422, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId, count: Object.keys(result.errors || {}).length });
    return pages.profileStepPage(ctx, a, step, saved, { values: result.values || {}, errors: result.errors || {}, status: 422, revision: rev ?? "" });
  }
  const changed = result.changed || [];
  logEvent({ evt: "profile.save", outcome: changed.length ? "saved" : "unchanged", status: 303, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId, user: a.session.userId });
  const base = `/portal/o/${a.membership.slug}/profile`;
  // "Save and continue" goes on to the next step (the overview after the last one); anything else, including a missing or unknown intent, stays here.
  if (read.fields.get("intent") === "continue") {
    const next = PROFILE_STEPS[PROFILE_STEPS.indexOf(step) + 1];
    return redirect(next ? `${base}/${next.id}` : base);
  }
  return redirect(`${base}/${stepId}?saved=${changed.length ? 1 : 0}`);
}

/** Send feedback. Organization and person come from the membership and session; the form supplies only the kind, the message and an optional section. */
/**
 * The Business Profile's "Primary contact" is the business's day-to-day contact, which is not necessarily the person signed in. It is therefore
 * only ever a DISPLAY fallback, and only when its contact email is the signed-in (verified) email, i.e. provably the same person. It is never
 * written to the account and never used for anyone else's account.
 */
/** This organization's saved Business Profile answers, or null when they cannot be read (an outage, or a database without the profile table). Never another organization's. */
async function readAnswers(ctx, a) {
  try {
    return await dbCall(() => getProfileAnswers(ctx.db, a.membership.organizationId));
  } catch (err) {
    if (err instanceof Unavailable) return null;
    throw err;
  }
}
function contactNameFrom(answers, a) {
  if (!answers) return "";
  const same = String(answers.cemail || "").trim().toLowerCase() === String(a.session.email || "").trim().toLowerCase();
  return same && validateName(answers.cname) ? validateName(answers.cname) : "";
}
/** Whether this person has reliable evidence of an earlier visit (repo/visits.js). A read that cannot be made means "unknown", which words the greeting neutrally. */
async function returningVisitor(ctx, a) {
  try {
    return await dbCall(() => hasPriorVisit(ctx.db, { userId: a.session.userId, organizationId: a.membership.organizationId, sessionId: a.session.id }));
  } catch (err) {
    if (err instanceof Unavailable) return false;
    throw err;
  }
}
function withDisplayName(a, answers) {
  if (a.session.name) return a;
  const name = contactNameFrom(answers, a);
  return name ? { ...a, session: { ...a.session, name } } : a;
}

async function saveAccountName(ctx, a) {
  const read = await readForm(ctx.request, MAX_FEEDBACK_FORM_BYTES);
  if (read.error) return errorPage(read.error, { ref: ctx.ref });
  if (!(await checkCsrf(ctx.cfg, a.session, read.fields.get("csrf") || ""))) {
    logEvent({ evt: "account.name", outcome: "rejected", reason: "csrf", status: 403, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId });
    return errorPage(403, { ref: ctx.ref });
  }
  const value = read.fields.get("name") || "";
  if (!validateName(value)) return pages.accountPage(ctx, a, { value, error: "Enter your name (up to 120 characters).", status: 422 });
  let result;
  try {
    result = await dbCall(() => setUserName(ctx.db, a.session.userId, value)); // always the signed-in user's own row, never an id from the request
  } catch (err) {
    if (!(err instanceof Unavailable)) throw err;
    return unavailablePage(ctx);
  }
  if (!result.ok) return pages.accountPage(ctx, a, { value, error: "We couldn’t save that. Please try again.", status: 422 });
  logEvent({ evt: "account.name", outcome: "saved", status: 303, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId, user: a.session.userId });
  return redirect(`/portal/o/${a.membership.slug}/account?saved=1`);
}

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

/* ------------------------------------------------------------------ Branding (Phase 3; only where PORTAL_BRANDING is on) */

/** The Branding card on Home: published or not, and how many files the client has shared. null when Branding is not live; "unavailable" when it cannot be read. */
/**
 * The Website card on Home: where the client's (first, in Framework's order) published website stands, and for one being built its progress from real milestones. null when the Website section is
 * off or there is no website to show. An unreadable result is never shown as a status: the card then just shows no line.
 */
async function websiteCard(ctx, a) {
  if (!websiteOn(ctx)) return null;
  try {
    const org = a.membership.organizationId;
    const sites = await dbCall(() => listClientWebsites(ctx.db, org));
    if (!sites.length) return null;
    const first = sites[0];
    const milestones = first.status === "in_development" ? await dbCall(() => listClientMilestones(ctx.db, org, first.id)) : [];
    return { stage: stageOf(first), progress: milestoneProgress(first, milestones), count: sites.length, name: first.name };
  } catch (err) {
    if (err instanceof Unavailable || /no such (table|column)/i.test(String(err && err.message))) return null;
    throw err;
  }
}

async function brandCard(ctx, a) {
  if (!brandingOn(ctx)) return null;
  try {
    const org = a.membership.organizationId;
    const [kit, uploads] = await Promise.all([dbCall(() => getBrandKit(ctx.db, org)), dbCall(() => listClientUploads(ctx.db, org))]);
    return { state: kit && kit.status === "published" ? "published" : "draft", uploads: uploads.length };
  } catch (err) {
    if (err instanceof Unavailable) return { state: "unavailable", uploads: 0 };
    throw err;
  }
}

const brandDeps = (ctx) => ({ db: ctx.db, bucket: ctx.env.PORTAL_FILES, env: ctx.env, now: ctx.now });
const who = (a) => ({ role: a.membership.role, organizationId: a.membership.organizationId, userId: a.session.userId, asStaff: Boolean(a.staff) }); // asStaff: only the guard sets a.staff, after verifying a bound master-access grant
/** Files leave through brand-files.js/fileResponse; the portal-wide headers it does not set itself are added here. */
function withPortalHeaders(response) {
  response.headers.set("Strict-Transport-Security", "max-age=31536000");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}
/** A refused file request is always the same plain "not found", whatever the reason (another organization's, unpublished, held, deleted). */
const fileProblem = (ctx, error) => (error === "forbidden" ? errorPage(403, { ref: ctx.ref }) : error === "not_found" ? notFoundPage(ctx) : errorPage(503, { ref: ctx.ref }));
const NOTICE_KEYS = ["uploaded", "removed"];

async function brandingUploadsView(ctx, a, o = {}) {
  const org = a.membership.organizationId;
  const [uploads, usage] = await Promise.all([dbCall(() => listClientUploads(ctx.db, org)), dbCall(() => uploadUsage(ctx.db, org))]);
  const f = viewFilters(ctx.url);
  return pages.brandingUploadsPage(ctx, a, { uploads, usage, limits: limitsFor(brandDeps(ctx)), canUpload: can(a.membership.role, "branding.upload"), canDelete: can(a.membership.role, "branding.delete_upload"), notice: NOTICE_KEYS.find((k) => f[k]) || "", ...o });
}

async function uploadBrandFile(ctx, a) {
  const base = `/portal/o/${a.membership.slug}`;
  const max = limitsFor(brandDeps(ctx)).maxFileBytes + UPLOAD_FORM_OVERHEAD;
  const read = await readUpload(ctx.request, max);
  if (read.error) return brandingUploadsView(ctx, a, { error: read.error === 413 ? "file_too_large" : "invalid", status: read.error });
  if (!(await checkCsrf(ctx.cfg, a.session, read.fields.get("csrf") || ""))) {
    logEvent({ evt: "brand.upload", outcome: "rejected", reason: "csrf", status: 403, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId });
    return errorPage(403, { ref: ctx.ref });
  }
  if (!ctx.env.PORTAL_FILES) return brandingUploadsView(ctx, a, { error: "storage_unavailable", status: 503 });
  if (!read.file) return brandingUploadsView(ctx, a, { error: "no_file", status: 422 });
  const res = await clientUploadFile(brandDeps(ctx), { ...who(a), category: read.fields.get("category") || "", fontRightsAck: read.fields.get("font_rights") === "1", file: read.file });
  if (!res.ok) {
    const status = res.error === "forbidden" ? 403 : res.error.startsWith("storage_") ? 503 : 422;
    logEvent({ evt: "brand.upload", outcome: "refused", reason: res.error, status, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId });
    return brandingUploadsView(ctx, a, { error: res.error, status });
  }
  logEvent({ evt: "brand.upload", outcome: "saved", status: 303, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId, user: a.session.userId });
  return redirect(`${base}/branding/uploads?uploaded=1`);
}

async function removeBrandUpload(ctx, a, id) {
  const read = await readForm(ctx.request, MAX_FEEDBACK_FORM_BYTES);
  if (read.error) return errorPage(read.error, { ref: ctx.ref });
  if (!(await checkCsrf(ctx.cfg, a.session, read.fields.get("csrf") || ""))) return errorPage(403, { ref: ctx.ref });
  if (!UUID.test(id)) return notFoundPage(ctx);
  if (!ctx.env.PORTAL_FILES) return errorPage(503, { ref: ctx.ref });
  const res = await clientDeleteUpload(brandDeps(ctx), { ...who(a), uploadId: id });
  if (!res.ok) return res.error === "not_found" ? notFoundPage(ctx) : fileProblem(ctx, res.error);
  logEvent({ evt: "brand.upload.remove", outcome: "removed", status: 303, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId, user: a.session.userId });
  return redirect(`/portal/o/${a.membership.slug}/branding/uploads?removed=1`);
}

/** A client owner asks for additions or changes to one Branding section, or for the full brand kit. One open request per section (the database enforces it): a second press is a friendly "already open". */
async function requestBrandSection(ctx, a) {
  const read = await readForm(ctx.request, MAX_FEEDBACK_FORM_BYTES);
  if (read.error) return errorPage(read.error, { ref: ctx.ref });
  if (!(await checkCsrf(ctx.cfg, a.session, read.fields.get("csrf") || ""))) return errorPage(403, { ref: ctx.ref });
  const note = (read.fields.get("note") || "").trim();
  const res = await clientRequestService(brandDeps(ctx), { ...who(a), serviceKey: read.fields.get("section") || "", note: note || null });
  const base = `/portal/o/${a.membership.slug}/branding`;
  if (!res.ok) {
    if (res.error === "already_requested") return redirect(`${base}?requested=0`);
    if (res.error === "forbidden" || res.error === "not_allowed") return errorPage(403, { ref: ctx.ref });
    return errorPage(400, { ref: ctx.ref });
  }
  logEvent({ evt: "brand.request", outcome: "saved", status: 303, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId, user: a.session.userId });
  return redirect(`${base}?requested=1`);
}

async function downloadBrandFile(ctx, a, id, kind) {
  if (!UUID.test(id)) return notFoundPage(ctx);
  if (!ctx.env.PORTAL_FILES) return errorPage(503, { ref: ctx.ref });
  const deps = brandDeps(ctx);
  const res = kind === "upload"
    ? await clientDownloadUpload(deps, { ...who(a), uploadId: id })
    : await clientDownloadAsset(deps, { ...who(a), assetId: id, inline: viewFilters(ctx.url).preview, font: viewFilters(ctx.url).font });
  return res.ok ? withPortalHeaders(res.response) : fileProblem(ctx, res.error);
}

const BRANDING_ROUTES = [
  {
    when: brandingOn, re: /^\/portal\/o\/([^/]+)\/branding$/, action: "branding.view",
    run: async (ctx, a) => {
      const org = a.membership.organizationId;
      const brand = await getClientBrand(ctx.db, org);
      const kit = brand.published ? await getBrandKit(ctx.db, org) : null;
      const uploadCount = (await listClientUploads(ctx.db, org)).length;
      const newest = {}; // the newest request per section (listServiceRequests is newest first)
      for (const r of await listServiceRequests(ctx.db, org)) if (!newest[r.serviceKey]) newest[r.serviceKey] = r;
      const f = viewFilters(ctx.url);
      return pages.brandingPage(ctx, a, brand, { canUpload: can(a.membership.role, "branding.upload"), uploadCount, brandName: kit && kit.brandName ? kit.brandName : "", canRequest: can(a.membership.role, "branding.request"), requests: newest, requirementSettings: (await listRequirementSettings(ctx.db, org)).items, pricing: await loadPricing(ctx.db), notice: f.requested ? "sent" : f.requestDup ? "dup" : "" });
    },
  },
  { when: brandingOn, re: /^\/portal\/o\/([^/]+)\/branding\/request$/, action: "branding.view", postAction: "branding.request", bucket: "branding", run: async (ctx, a) => redirect(`/portal/o/${a.membership.slug}/branding`), post: (ctx, a) => requestBrandSection(ctx, a) },
  { when: brandingOn, re: /^\/portal\/o\/([^/]+)\/branding\/uploads$/, action: "branding.view", postAction: "branding.upload", bucket: "branding", maxBody: (ctx) => limitsFor(brandDeps(ctx)).maxFileBytes + UPLOAD_FORM_OVERHEAD, run: (ctx, a) => brandingUploadsView(ctx, a), post: (ctx, a) => uploadBrandFile(ctx, a) },
  { when: brandingOn, re: /^\/portal\/o\/([^/]+)\/branding\/uploads\/([^/]+)\/download$/, action: "branding.view", run: (ctx, a, id) => downloadBrandFile(ctx, a, id, "upload") },
  { when: brandingOn, re: /^\/portal\/o\/([^/]+)\/branding\/uploads\/([^/]+)\/delete$/, action: "branding.view", postAction: "branding.delete_upload", bucket: "branding", run: async (ctx, a) => redirect(`/portal/o/${a.membership.slug}/branding/uploads`), post: (ctx, a, id) => removeBrandUpload(ctx, a, id) },
  { when: brandingOn, re: /^\/portal\/o\/([^/]+)\/branding\/fonts\.css$/, action: "branding.view", run: async (ctx, a) => {
      // The stylesheet that lets the Typography section show a specimen in the client's own licensed font files (only those they may also download). Empty when there is none.
      const brand = await getClientBrand(ctx.db, a.membership.organizationId);
      const css = brand.published ? fontCss(`/portal/o/${encodeURIComponent(a.membership.slug)}`, brand.typography, (brand.assets || []).filter((x) => x.kind === "font")) : "";
      return withPortalHeaders(new Response(css, { status: 200, headers: securityHeaders({ "Content-Type": "text/css; charset=utf-8" }) }));
    },
  },
  { when: brandingOn, re: /^\/portal\/o\/([^/]+)\/branding\/files\/([^/]+)$/, action: "branding.view", run: (ctx, a, id) => downloadBrandFile(ctx, a, id, "asset") },
];

/* ------------------------------------------------------------------ Website (Phase 2; only where PORTAL_WEBSITE is on) */

/** Can this website be shown live in a frame? Only a live or existing website with an https address is ever checked; any trouble reads as "no" and the page falls back. The outcome is logged (words and a status code only, never the address). */
async function previewOf(ctx, site, a) {
  if (!site || !site.url || site.status === "in_development") return null;
  const r = await checkEmbeddable(site.url, { fetch: ctx.previewFetch, portalOrigin: ctx.cfg.origin, cache: ctx.previewCache });
  if (!r.cached) logEvent({ evt: "website.preview", outcome: r.embeddable ? "embeddable" : "fallback", reason: r.reason, ...(Number.isInteger(r.status) ? { status: r.status } : {}), ref: ctx.ref, org: a.membership.organizationId });
  return r;
}

/** Website management for one website: its downloadable files (if Framework published them), whether the member may send requests, and how their website requests stand. */
async function websiteManagement(ctx, a, site) {
  const org = a.membership.organizationId;
  const [pkg, reqs] = await Promise.all([getClientPackage(ctx.db, org, site.id), supportRepo.listWebsiteRequests(ctx.db, org)]);
  return { package: pkg, canRequest: can(a.membership.role, "support.submit"), requests: { total: reqs.length, open: reqs.filter((r) => !r.closed).length, unread: reqs.filter((r) => r.unreadForClient).length } };
}

/** The Additional Services grid: the shown services (Admin's catalogue), a price only where Admin set one (never "Included"), and whether the client already has an open request for each. */
async function websiteServices(ctx, a) {
  const org = a.membership.organizationId;
  const items = await listClientServices(ctx.db);
  if (!items.length) return null;
  const prices = pricingFrom((await listPrices(ctx.db)).rows);
  const open = new Set((await listServiceRequests(ctx.db, org, { openOnly: true })).map((r) => r.serviceKey));
  const f = viewFilters(ctx.url);
  return {
    canRequest: can(a.membership.role, "website.request"), flash: f.requested ? "requested" : f.requestDup ? "dup" : "",
    items: items.map((it) => { const p = prices[it.key]; const shown = p && p.type !== "included" ? p : null; return { ...it, price: shown ? shown.label : "", priceType: shown ? shown.type : "", requested: open.has(requestKeyOfService(it.key)) }; }),
  };
}

async function postServiceRequest(ctx, a) {
  const read = await readForm(ctx.request, MAX_FEEDBACK_FORM_BYTES);
  if (read.error) return errorPage(read.error, { ref: ctx.ref });
  if (!(await checkCsrf(ctx.cfg, a.session, read.fields.get("csrf") || ""))) return errorPage(403, { ref: ctx.ref });
  const key = read.fields.get("service") || "";
  const shown = (await listClientServices(ctx.db)).map((x) => x.key);
  if (!SERVICE_KEYS.includes(key) || !shown.includes(key)) return notFoundPage(ctx);
  const priced = (pricingFrom((await listPrices(ctx.db)).rows))[key];
  const snapshot = priced && priced.type !== "included" ? priceSnapshot(priced) : null;
  const requestKey = requestKeyOfService(key);
  const res = await createServiceRequest(ctx.db, a.membership.organizationId, a.session.userId, { serviceKey: requestKey, note: null, priceSnapshot: snapshot }, (k) => k === requestKey, { now: ctx.now, asStaff: Boolean(a.staff) });
  const base = `/portal/o/${a.membership.slug}/website`;
  if (!res.ok && res.error !== "already_requested") { logEvent({ evt: "website.service", outcome: "refused", reason: res.error, status: 400, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId }); return errorPage(400, { ref: ctx.ref }); }
  logEvent({ evt: "website.service", outcome: res.ok ? "saved" : "duplicate", status: 303, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId, user: a.session.userId });
  return redirect(`${base}?requested=${res.ok ? 1 : 0}#additional-services`);
}

async function postWebsiteRequest(ctx, a, siteId) {
  if (!UUID.test(siteId)) return notFoundPage(ctx);
  const site = await getClientWebsite(ctx.db, a.membership.organizationId, siteId);
  if (!site) return notFoundPage(ctx);
  const read = await readUploads(ctx.request, SUPPORT_BODY, supportRepo.MAX_ATTACHMENTS);
  if (read.error) return pages.websiteRequestFormPage(ctx, a, site, "change", { error: read.error === 413 ? "file_too_large" : "invalid", status: read.error });
  const kind = kindOf(read.fields.get("kind") || "");
  if (!kind) return notFoundPage(ctx);
  if (!(await checkCsrf(ctx.cfg, a.session, read.fields.get("csrf") || ""))) return errorPage(403, { ref: ctx.ref });
  const values = { title: read.fields.get("title") || "", description: read.fields.get("description") || "" };
  const res = await clientCreateRequest(brandDeps(ctx), { ...who(a), category: categoryOfKind(kind), ...values, websiteId: site.id, files: read.files });
  if (!res.ok) {
    if (res.error === "website_not_found") return notFoundPage(ctx);
    const status = supportStatus(res.error);
    logEvent({ evt: "website.request", outcome: "refused", reason: res.error, status, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId });
    return pages.websiteRequestFormPage(ctx, a, site, kind, { values, error: res.error, status });
  }
  logEvent({ evt: "website.request", outcome: "saved", status: 303, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId, user: a.session.userId });
  await dispatchNotifications(ctx.env, ctx); // after the request is saved; it can never undo or delay it
  return redirect(`/portal/o/${a.membership.slug}/website/requests/${res.id}?${res.attachmentsFailed ? "flash=partial" : "flash=sent"}`);
}

/** A website request's conversation: only a request that names a website, and only the client-visible messages (the shared support code does the rest). */
async function showWebsiteThread(ctx, a, id, o = {}) {
  if (!UUID.test(id)) return notFoundPage(ctx);
  const org = a.membership.organizationId;
  const site = await supportRepo.getRequestWebsite(ctx.db, org, id);
  if (!site) return notFoundPage(ctx);
  const thread = await supportRepo.getClientThread(ctx.db, org, id);
  if (!thread) return notFoundPage(ctx);
  if (thread.request.unreadForClient) await supportRepo.markClientRead(ctx.db, org, id, { now: ctx.now });
  return pages.websiteRequestThreadPage(ctx, a, thread, site, { flash: viewFilters(ctx.url).flash, ...o });
}

async function postWebsiteReply(ctx, a, id) {
  if (!UUID.test(id)) return notFoundPage(ctx);
  if (!(await supportRepo.getRequestWebsite(ctx.db, a.membership.organizationId, id))) return notFoundPage(ctx);
  const read = await readUploads(ctx.request, SUPPORT_BODY, supportRepo.MAX_ATTACHMENTS);
  if (read.error) return showWebsiteThread(ctx, a, id, { error: read.error === 413 ? "file_too_large" : "invalid", status: read.error });
  if (!(await checkCsrf(ctx.cfg, a.session, read.fields.get("csrf") || ""))) return errorPage(403, { ref: ctx.ref });
  const res = await clientReply(brandDeps(ctx), { ...who(a), requestId: id, body: read.fields.get("body") || "", files: read.files });
  if (!res.ok) {
    if (res.error === "not_found") return notFoundPage(ctx);
    return showWebsiteThread(ctx, a, id, { error: res.error, status: supportStatus(res.error) });
  }
  logEvent({ evt: "website.reply", outcome: "saved", status: 303, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId, user: a.session.userId });
  await dispatchNotifications(ctx.env, ctx);
  return redirect(`/portal/o/${a.membership.slug}/website/requests/${id}?${res.attachmentsFailed ? "flash=partial" : "flash=replied"}`);
}

const WEBSITE_ROUTES = [
  { when: websiteOn, re: /^\/portal\/o\/([^/]+)\/website$/, action: "website.view", run: async (ctx, a) => {
      const sites = await listClientWebsites(ctx.db, a.membership.organizationId);
      const single = sites.length === 1 ? sites[0] : null;
      return pages.websitePage(ctx, a, { sites, preview: single ? await previewOf(ctx, single, a) : null, management: single ? await websiteManagement(ctx, a, single) : (sites.length ? await websiteListManagement(ctx, a) : null), services: await websiteServices(ctx, a), ...(single ? await siteExtras(ctx, a, single) : {}) });
    } },
  // Requests about a website (Request a change, Get support): the existing support workflow and permissions (support.view / support.submit), independent of PORTAL_SERVICES.
  { when: websiteOn, re: /^\/portal\/o\/([^/]+)\/website\/requests$/, action: "support.view", run: async (ctx, a) => pages.websiteRequestsPage(ctx, a, await supportRepo.listWebsiteRequests(ctx.db, a.membership.organizationId)) },
  { when: websiteOn, re: /^\/portal\/o\/([^/]+)\/website\/requests\/([^/]+)\/files\/([^/]+)$/, action: "support.view", run: async (ctx, a, rid, aid) => {
      if (!UUID.test(rid || "") || !UUID.test(aid || "")) return notFoundPage(ctx);
      if (!(await supportRepo.getRequestWebsite(ctx.db, a.membership.organizationId, rid))) return notFoundPage(ctx);
      if (!ctx.env.PORTAL_FILES) return errorPage(503, { ref: ctx.ref });
      const res = await clientDownloadAttachment(brandDeps(ctx), { ...who(a), requestId: rid, attachmentId: aid });
      return res.ok ? withPortalHeaders(res.response) : fileProblem(ctx, res.error);
    } },
  { when: websiteOn, re: /^\/portal\/o\/([^/]+)\/website\/requests\/([^/]+)\/reply$/, action: "support.view", postAction: "support.submit", bucket: "support", maxBody: () => SUPPORT_BODY,
    run: async (ctx, a, id) => redirect(`/portal/o/${a.membership.slug}/website/requests/${id}`), post: (ctx, a, id) => postWebsiteReply(ctx, a, id) },
  { when: websiteOn, re: /^\/portal\/o\/([^/]+)\/website\/requests\/([^/]+)$/, action: "support.view", run: (ctx, a, id) => showWebsiteThread(ctx, a, id) },
  { when: websiteOn, re: /^\/portal\/o\/([^/]+)\/website\/services\/request$/, action: "website.view", postAction: "website.request", bucket: "support", run: async (ctx, a) => redirect(`/portal/o/${a.membership.slug}/website`), post: (ctx, a) => postServiceRequest(ctx, a) },
  { when: websiteOn, re: /^\/portal\/o\/([^/]+)\/website\/([^/]+)\/requests\/new$/, action: "support.submit", run: async (ctx, a, id) => {
      if (!UUID.test(id)) return notFoundPage(ctx);
      const kind = kindOf(viewFilters(ctx.url).kind || "");
      const site = await getClientWebsite(ctx.db, a.membership.organizationId, id);
      return site && kind ? pages.websiteRequestFormPage(ctx, a, site, kind, {}) : notFoundPage(ctx);
    } },
  { when: websiteOn, re: /^\/portal\/o\/([^/]+)\/website\/([^/]+)\/requests$/, action: "support.view", postAction: "support.submit", bucket: "support", maxBody: () => SUPPORT_BODY,
    run: async (ctx, a, id) => redirect(`/portal/o/${a.membership.slug}/website/${id}`), post: (ctx, a, id) => postWebsiteRequest(ctx, a, id) },
  { when: websiteOn, re: /^\/portal\/o\/([^/]+)\/website\/([^/]+)\/files\/download$/, action: "website.view", run: async (ctx, a, id) => {
      if (!UUID.test(id)) return notFoundPage(ctx);
      if (!ctx.env.PORTAL_FILES) return errorPage(503, { ref: ctx.ref });
      const res = await clientPackageResponse(brandDeps(ctx), { ...who(a), websiteId: id });
      return res.ok ? withPortalHeaders(res.response) : fileProblem(ctx, res.error);
    } },
  { when: websiteOn, re: /^\/portal\/o\/([^/]+)\/website\/([^/]+)\/screenshot$/, action: "website.view", run: async (ctx, a, id) => {
      if (!UUID.test(id)) return notFoundPage(ctx);
      if (!ctx.env.PORTAL_FILES) return errorPage(503, { ref: ctx.ref });
      const res = await clientScreenshotResponse(brandDeps(ctx), { role: a.membership.role, organizationId: a.membership.organizationId, websiteId: id });
      return res.ok ? withPortalHeaders(res.response) : fileProblem(ctx, res.error);
    },
  },
  { when: websiteOn, re: /^\/portal\/o\/([^/]+)\/website\/([^/]+)\/seo$/, action: "website.view", run: async (ctx, a, id) => {
      if (!UUID.test(id)) return notFoundPage(ctx);
      const site = await getClientWebsite(ctx.db, a.membership.organizationId, id);
      const seo = site ? await getSeoForClient(ctx.db, a.membership.organizationId, id) : null; // nothing published (or another organization's website) is simply "not found"
      return site && seo ? pages.websiteSeoPage(ctx, a, site, seo) : notFoundPage(ctx);
    } },
  { when: websiteOn, re: /^\/portal\/o\/([^/]+)\/website\/([^/]+)$/, action: "website.view", run: async (ctx, a, id) => {
      if (!UUID.test(id)) return notFoundPage(ctx);
      const one = await getClientWebsite(ctx.db, a.membership.organizationId, id); // another organization's, unpublished and archived websites are all "not found"
      return one ? pages.websitePage(ctx, a, { one, preview: await previewOf(ctx, one, a), management: await websiteManagement(ctx, a, one), services: await websiteServices(ctx, a), ...(await siteExtras(ctx, a, one)) }) : notFoundPage(ctx);
    },
  },
];

/** What one website's page adds to its basics: its real milestones (for the progress bar) and its published SEO information. Both are scoped to the member's own organization. */
async function siteExtras(ctx, a, site) {
  const org = a.membership.organizationId;
  return { milestones: await listClientMilestones(ctx.db, org, site.id), seo: await getSeoForClient(ctx.db, org, site.id) };
}

/** On the list of several websites: only the link to the website requests (each website's own page has its management actions). */
async function websiteListManagement(ctx, a) {
  const reqs = await supportRepo.listWebsiteRequests(ctx.db, a.membership.organizationId);
  return { requests: { total: reqs.length, open: reqs.filter((r) => !r.closed).length, unread: reqs.filter((r) => r.unreadForClient).length } };
}

/** The Invoices card status on the hub, or "" when invoices cannot be read (a database without migration 0007): the card then stays "Coming soon". */
async function invoiceSummary(ctx, a) {
  try { return await dbCall(() => clientInvoiceSummary(ctx.db, a.membership.organizationId, { now: ctx.now })); }
  catch (err) { if (err instanceof Unavailable || /no such table/i.test(String(err && err.message))) return null; throw err; }
}
const invoiceCard = async (ctx, a) => { const s = await invoiceSummary(ctx, a); return s ? { line: invoiceStatusLine(s), attention: s.overdue > 0 } : null; };

/** The Support card status on the hub, or "" when requests cannot be read (a database without migration 0007): the card then stays "Coming soon". */
async function supportSummary(ctx, a) {
  try { return await dbCall(() => supportRepo.clientSupportSummary(ctx.db, a.membership.organizationId)); }
  catch (err) { if (err instanceof Unavailable || /no such table/i.test(String(err && err.message))) return null; throw err; }
}
const supportCard = async (ctx, a) => { const s = await supportSummary(ctx, a); return s ? { line: supportStatusLine(s), attention: s.unread > 0 || s.quoted > 0 } : null; };

/** What the Home card for Client Services should call out: only things the person can act on. [] when nothing, or when Services is off. */
async function servicesAttention(ctx, a) {
  if (!servicesOn(ctx)) return [];
  const out = [];
  const s = await supportSummary(ctx, a);
  if (s && s.unread) out.push(`${s.unread} new ${s.unread === 1 ? "reply" : "replies"}`);
  if (s && s.quoted) out.push(`${s.quoted} ${s.quoted === 1 ? "quote" : "quotes"} to review`);
  if (can(a.membership.role, "invoices.view")) { const i = await invoiceSummary(ctx, a); if (i && i.overdue) out.push(`${i.overdue} overdue ${i.overdue === 1 ? "invoice" : "invoices"}`); }
  return out;
}

const SUPPORT_BODY = supportRepo.MAX_ATTACHMENTS * supportRepo.MAX_ATTACHMENT_BYTES + UPLOAD_FORM_OVERHEAD;
/** The HTTP status for a refused request or reply. */
const supportStatus = (error) => (error === "forbidden" ? 403 : error === "not_found" ? 404 : error === "closed" ? 409 : error === "file_too_large" ? 413 : String(error).startsWith("storage_") ? 503 : 422);

async function postNewRequest(ctx, a) {
  const read = await readUploads(ctx.request, SUPPORT_BODY, supportRepo.MAX_ATTACHMENTS);
  if (read.error) return pages.requestFormPage(ctx, a, { error: read.error === 413 ? "file_too_large" : "invalid", status: read.error });
  if (!(await checkCsrf(ctx.cfg, a.session, read.fields.get("csrf") || ""))) {
    logEvent({ evt: "support.request", outcome: "rejected", reason: "csrf", status: 403, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId });
    return errorPage(403, { ref: ctx.ref });
  }
  const values = { category: read.fields.get("category") || "", title: read.fields.get("title") || "", description: read.fields.get("description") || "" };
  const res = await clientCreateRequest(brandDeps(ctx), { ...who(a), ...values, files: read.files });
  if (!res.ok) {
    const status = supportStatus(res.error);
    logEvent({ evt: "support.request", outcome: "refused", reason: res.error, status, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId });
    return pages.requestFormPage(ctx, a, { values, error: res.error, status });
  }
  logEvent({ evt: "support.request", outcome: "saved", status: 303, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId, user: a.session.userId });
  await dispatchNotifications(ctx.env, ctx); // after the request is saved; it can never undo or delay it
  return redirect(`/portal/o/${a.membership.slug}/services/requests/${res.id}?${res.attachmentsFailed ? "flash=partial" : "flash=sent"}`);
}

async function showThread(ctx, a, id, o = {}) {
  if (!UUID.test(id)) return notFoundPage(ctx);
  const org = a.membership.organizationId;
  const thread = await supportRepo.getClientThread(ctx.db, org, id);
  if (!thread) return notFoundPage(ctx);
  if (thread.request.unreadForClient) await supportRepo.markClientRead(ctx.db, org, id, { now: ctx.now });
  return pages.requestThreadPage(ctx, a, thread, { flash: viewFilters(ctx.url).flash, ...o });
}

async function postReply(ctx, a, id) {
  if (!UUID.test(id)) return notFoundPage(ctx);
  const read = await readUploads(ctx.request, SUPPORT_BODY, supportRepo.MAX_ATTACHMENTS);
  if (read.error) return showThread(ctx, a, id, { error: read.error === 413 ? "file_too_large" : "invalid", status: read.error });
  if (!(await checkCsrf(ctx.cfg, a.session, read.fields.get("csrf") || ""))) return errorPage(403, { ref: ctx.ref });
  const res = await clientReply(brandDeps(ctx), { ...who(a), requestId: id, body: read.fields.get("body") || "", files: read.files });
  if (!res.ok) {
    if (res.error === "not_found") return notFoundPage(ctx);
    return showThread(ctx, a, id, { error: res.error, status: supportStatus(res.error) });
  }
  logEvent({ evt: "support.reply", outcome: "saved", status: 303, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId, user: a.session.userId });
  await dispatchNotifications(ctx.env, ctx);
  return redirect(`/portal/o/${a.membership.slug}/services/requests/${id}?${res.attachmentsFailed ? "flash=partial" : "flash=replied"}`);
}

/* Client Services (only where PORTAL_SERVICES is on). Phase 1: the hub and the Contact page; invoices and support requests follow. */
const SERVICES_ROUTES = [
  { when: servicesOn, re: /^\/portal\/o\/([^/]+)\/services\/requests$/, action: "support.view", postAction: "support.submit", bucket: "support", maxBody: () => SUPPORT_BODY,
    run: async (ctx, a) => pages.requestsPage(ctx, a, await supportRepo.listClientRequests(ctx.db, a.membership.organizationId)), post: (ctx, a) => postNewRequest(ctx, a) },
  { when: servicesOn, re: /^\/portal\/o\/([^/]+)\/services\/requests\/new$/, action: "support.submit", run: (ctx, a) => pages.requestFormPage(ctx, a, {}) },
  { when: servicesOn, re: /^\/portal\/o\/([^/]+)\/services\/requests\/([^/]+)\/files\/([^/]+)$/, action: "support.view", run: async (ctx, a, rid, aid) => {
      if (!UUID.test(rid || "") || !UUID.test(aid || "")) return notFoundPage(ctx);
      if (!ctx.env.PORTAL_FILES) return errorPage(503, { ref: ctx.ref });
      const res = await clientDownloadAttachment(brandDeps(ctx), { ...who(a), requestId: rid, attachmentId: aid });
      return res.ok ? withPortalHeaders(res.response) : fileProblem(ctx, res.error);
    } },
  { when: servicesOn, re: /^\/portal\/o\/([^/]+)\/services\/requests\/([^/]+)\/reply$/, action: "support.view", postAction: "support.submit", bucket: "support", maxBody: () => SUPPORT_BODY,
    run: async (ctx, a, id) => redirect(`/portal/o/${a.membership.slug}/services/requests/${id}`), post: (ctx, a, id) => postReply(ctx, a, id) },
  { when: servicesOn, re: /^\/portal\/o\/([^/]+)\/services\/requests\/([^/]+)$/, action: "support.view", run: (ctx, a, id) => showThread(ctx, a, id) },
  { when: servicesOn, re: /^\/portal\/o\/([^/]+)\/services$/, action: "services.view", run: async (ctx, a) => pages.servicesPage(ctx, a, { invoices: can(a.membership.role, "invoices.view") ? await invoiceCard(ctx, a) : null, support: await supportCard(ctx, a) }) },
  // owners only (policy invoices.view): a member who opens the address gets the portal's plain "not allowed" page
  { when: servicesOn, re: /^\/portal\/o\/([^/]+)\/services\/invoices$/, action: "invoices.view", run: async (ctx, a) => pages.invoicesPage(ctx, a, await listClientInvoices(ctx.db, a.membership.organizationId, { now: ctx.now })) },
  { when: servicesOn, re: /^\/portal\/o\/([^/]+)\/services\/invoices\/([^/]+)\/download$/, action: "invoices.view", run: async (ctx, a, id) => {
      if (!UUID.test(id)) return notFoundPage(ctx);
      if (!ctx.env.PORTAL_FILES) return errorPage(503, { ref: ctx.ref });
      const res = await clientDownloadInvoice(brandDeps(ctx), { ...who(a), invoiceId: id });
      return res.ok ? withPortalHeaders(res.response) : fileProblem(ctx, res.error);
    },
  },
  { when: servicesOn, re: /^\/portal\/o\/([^/]+)\/services\/contact$/, action: "services.view", run: (ctx, a) => pages.contactPage(ctx, a) },
];

const ORG_ROUTES = [
  ...BRANDING_ROUTES,
  ...WEBSITE_ROUTES,
  ...SERVICES_ROUTES,
  { re: /^\/portal\/o\/([^/]+)$/, action: "org.view", run: async (ctx, a) => {
      // One read serves both the greeting's name fallback and the module progress. null (unreadable) shows "Progress unavailable", never 0%.
      if (servicesOn(ctx)) await dispatchNotifications(ctx.env, ctx); // a client visit is also a chance to retry any email that did not go out (see service-notifications.js)
      const answers = await readAnswers(ctx, a);
      const shown = { ...withDisplayName(a, answers), returning: await returningVisitor(ctx, a) };
      return pages.homePage(ctx, shown, moduleStatuses(pages.liveAreasFor(ctx), { profile: answers }), nextActions(pages.liveAreasFor(ctx), { profile: answers }), await brandCard(ctx, a), await servicesAttention(ctx, a), await websiteCard(ctx, a));
    },
  },
  { re: /^\/portal\/o\/([^/]+)\/progress$/, action: "org.view", run: async (ctx, a) => pages.overviewPage(ctx, { ...a, returning: await returningVisitor(ctx, a) }, { projects: await listProjects(ctx.db, a.membership.organizationId), activity: await listActivity(ctx.db, a.membership.organizationId, { limit: 5 }) }) },
  { re: /^\/portal\/o\/([^/]+)\/profile$/, action: "profile.view", run: async (ctx, a) => pages.profileOverviewPage(ctx, a, await getProfileAnswers(ctx.db, a.membership.organizationId)) },
  {
    re: /^\/portal\/o\/([^/]+)\/profile\/([^/]+)$/,
    action: "profile.view",
    postAction: "profile.edit",
    bucket: "profile",
    run: async (ctx, a, id) => {
      const step = stepById(id);
      if (!step) return notFoundPage(ctx);
      const revision = await getStepRevision(ctx.db, a.membership.organizationId, step.id); // BEFORE the answers: a save in between can only make this form look older, never newer
      return pages.profileStepPage(ctx, a, step, await getProfileAnswers(ctx.db, a.membership.organizationId), { savedNote: viewFilters(ctx.url).saved, unchanged: viewFilters(ctx.url).nochange, revision });
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
    {
    re: /^\/portal\/o\/([^/]+)\/account$/,
    action: "account.view",
    postAction: "account.view", // everyone may edit only their own name; the target row comes from the session, never the request
    bucket: "profile",
    run: async (ctx, a) => {
      const shown = withDisplayName(a, await readAnswers(ctx, a));
      return pages.accountPage(ctx, shown, { saved: viewFilters(ctx.url).saved, derived: !a.session.name && Boolean(shown.session.name) });
    },
    post: (ctx, a) => saveAccountName(ctx, a),
  },
  {
    re: /^\/portal\/o\/([^/]+)\/members$/,
    action: "members.view",
    run: async (ctx, a) => pages.membersPage(ctx, a, (await listMembers(ctx.db, a.membership.organizationId)).filter((m) => m.status === "active" && m.user_status === "active")),
  },
];

async function orgRoute(ctx, path) {
  for (const r of ORG_ROUTES) {
    if (r.when && !r.when(ctx)) continue;
    const m = r.re.exec(path);
    if (!m) continue;
    const method = ctx.request.method;
    const isPost = method === "POST" && !!r.post;
    if (method !== "GET" && method !== "HEAD" && !isPost) return errorPage(405, { ref: ctx.ref, headers: { Allow: r.post ? "GET, HEAD, POST" : "GET, HEAD" } });
    const slug = validateSlug(m[1]);
    if (!slug) return notFoundPage(ctx);
    if (isPost) {
      // cheap checks first: an oversized or cross-site request costs no database work and its body is never read
      const declared = declaredBodyProblem(ctx.request, r.maxBody ? r.maxBody(ctx) : r.bucket === "feedback" || r.bucket === "branding" ? MAX_FEEDBACK_FORM_BYTES : MAX_PROFILE_FORM_BYTES);
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
      return await (isPost ? r.post : r.run)(ctx, access, m[2], m[3]);
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
  "/portal/staff/view-as": staffViewAs,
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

  const ctx = { request, env, cfg, db: env.PORTAL_DB, url, now: deps.now || new Date(), fetch: deps.fetch || fetch, previewFetch: deps.previewFetch || (deps.fetch ? null : fetch), previewCache: deps.previewCache !== undefined ? deps.previewCache : (typeof caches !== "undefined" && caches.default) || null, waitUntil: deps.waitUntil, ref, demo: demoEnabled(env, cfg) };
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
