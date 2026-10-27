/**
 * Client portal router (Stage 2C/2D). Wired into worker/index.js for every /portal path. It only answers when PORTAL_ENABLED is exactly "1"
 * and the settings are valid and the request is on PORTAL_BASE_URL's host; otherwise the Worker returns portalNotFound().
 *
 * Returns null (= "not mine"; worker/index.js then answers portalNotFound(), never the static site) when the portal is off, or the request is not for the portal or not on the
 * portal host. When it IS enabled but misconfigured it fails closed with a generic 503 for portal paths.
 */
import { portalMode, portalConfigProblems, readPortalConfig, demoEnabled, brandingEnabled, servicesEnabled } from "./config.js";
import { errorPage, newRef, redirect, checkSameSiteMutation } from "./http.js";
import { handleLogin, handleCallback, handleLogout } from "./auth.js";
import { requireSession, requireOrgAccess, dbCall, Unavailable, unavailablePage, notFoundPage } from "./guard.js";
import { checkRateLimit } from "./ratelimit.js";
import { logEvent, routeName } from "./log.js";
import * as pages from "./pages.js";
import { handleDemo, isDemoPath } from "./demo.js";
import { viewFilters } from "./filters.js";
import { listActiveMembershipsForUser, listMembers } from "./repo/memberships.js";
import { setUserName } from "./repo/users.js";
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
import { getClientBrand, listClientUploads, uploadUsage, getBrandKit } from "./repo/brand.js";
import { listClientInvoices, clientInvoiceSummary } from "./repo/invoices.js";
import { clientDownloadInvoice } from "./invoice-files.js";
import { invoiceStatusLine, supportStatusLine } from "./services-live.js";
import * as supportRepo from "./repo/support.js";
import { clientCreateRequest, clientReply, clientDownloadAttachment } from "./support-files.js";
import { clientUploadFile, clientDeleteUpload, clientDownloadUpload, clientDownloadAsset, limitsFor } from "./brand-files.js";

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
/** The Coming Soon pages (members only, like every organization page) for each section that is not built yet; derived from the same list that drives Home. */
const SOON = comingSoonKeys().join("|");
const brandingOn = (ctx) => brandingEnabled(ctx.env);
const servicesOn = (ctx) => servicesEnabled(ctx.env);

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
const who = (a) => ({ role: a.membership.role, organizationId: a.membership.organizationId, userId: a.session.userId });
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

async function downloadBrandFile(ctx, a, id, kind) {
  if (!UUID.test(id)) return notFoundPage(ctx);
  if (!ctx.env.PORTAL_FILES) return errorPage(503, { ref: ctx.ref });
  const deps = brandDeps(ctx);
  const res = kind === "upload"
    ? await clientDownloadUpload(deps, { ...who(a), uploadId: id })
    : await clientDownloadAsset(deps, { ...who(a), assetId: id, inline: viewFilters(ctx.url).preview });
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
      return pages.brandingPage(ctx, a, brand, { canUpload: can(a.membership.role, "branding.upload"), uploadCount, brandName: kit && kit.brandName ? kit.brandName : "" });
    },
  },
  { when: brandingOn, re: /^\/portal\/o\/([^/]+)\/branding\/uploads$/, action: "branding.view", postAction: "branding.upload", bucket: "branding", maxBody: (ctx) => limitsFor(brandDeps(ctx)).maxFileBytes + UPLOAD_FORM_OVERHEAD, run: (ctx, a) => brandingUploadsView(ctx, a), post: (ctx, a) => uploadBrandFile(ctx, a) },
  { when: brandingOn, re: /^\/portal\/o\/([^/]+)\/branding\/uploads\/([^/]+)\/download$/, action: "branding.view", run: (ctx, a, id) => downloadBrandFile(ctx, a, id, "upload") },
  { when: brandingOn, re: /^\/portal\/o\/([^/]+)\/branding\/uploads\/([^/]+)\/delete$/, action: "branding.view", postAction: "branding.delete_upload", bucket: "branding", run: async (ctx, a) => redirect(`/portal/o/${a.membership.slug}/branding/uploads`), post: (ctx, a, id) => removeBrandUpload(ctx, a, id) },
  { when: brandingOn, re: /^\/portal\/o\/([^/]+)\/branding\/files\/([^/]+)$/, action: "branding.view", run: (ctx, a, id) => downloadBrandFile(ctx, a, id, "asset") },
];

/** The Invoices card status on the hub, or "" when invoices cannot be read (a database without migration 0007): the card then stays "Coming soon". */
async function invoiceCard(ctx, a) {
  try { return invoiceStatusLine(await dbCall(() => clientInvoiceSummary(ctx.db, a.membership.organizationId, { now: ctx.now }))); }
  catch (err) { if (err instanceof Unavailable || /no such table/i.test(String(err && err.message))) return ""; throw err; }
}

/** The Support card status on the hub, or "" when requests cannot be read (a database without migration 0007): the card then stays "Coming soon". */
async function supportCard(ctx, a) {
  try { return supportStatusLine(await dbCall(() => supportRepo.clientSupportSummary(ctx.db, a.membership.organizationId))); }
  catch (err) { if (err instanceof Unavailable || /no such table/i.test(String(err && err.message))) return ""; throw err; }
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
  { when: servicesOn, re: /^\/portal\/o\/([^/]+)\/services$/, action: "services.view", run: async (ctx, a) => pages.servicesPage(ctx, a, { invoices: can(a.membership.role, "invoices.view") ? await invoiceCard(ctx, a) : "", support: await supportCard(ctx, a) }) },
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
  ...SERVICES_ROUTES,
  { re: /^\/portal\/o\/([^/]+)$/, action: "org.view", run: async (ctx, a) => {
      // One read serves both the greeting's name fallback and the module progress. null (unreadable) shows "Progress unavailable", never 0%.
      const answers = await readAnswers(ctx, a);
      const shown = { ...withDisplayName(a, answers), returning: await returningVisitor(ctx, a) };
      return pages.homePage(ctx, shown, moduleStatuses(pages.liveAreasFor(ctx), { profile: answers }), nextActions(pages.liveAreasFor(ctx), { profile: answers }), await brandCard(ctx, a));
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
