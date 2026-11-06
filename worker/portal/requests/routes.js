/**
 * Client routes of the request area (only where PORTAL_REQUESTS is "1"): the Deliverables, SEO and Custom Development sections, the guided request form, My Requests and one request.
 * router.js registers the table returned by buildRequestRoutes(helpers) in its ORG_ROUTES; the tenant guard, CSRF, same-site, size and rate-limit checks all run there before a
 * handler is called, and `action` / `postAction` name the policy.js grant each route needs. The helpers are passed in so this file never imports the router (no cycle).
 */
import * as repo from "./repo.js";
import * as svc from "./service.js";
import * as views from "./views.js";
import { KINDS, getType, effectiveSettings } from "./registry.js";
import { QUOTE_TERMS, quoteAcceptanceOpen } from "./quote-gate.js";
import { getClientBrand } from "../repo/brand.js";
import { listClientWebsites } from "../repo/client-websites.js";
import { getSeoForClient } from "../repo/website-seo.js";
import * as supportRepo from "../repo/support.js";

const STATUS = {
  forbidden: 403, not_found: 404, closed: 409, conflict: 409, not_permitted_move: 409, revision_limit: 409, quote_not_open: 409, acceptance_closed: 409, quote_required: 409,
  file_too_large: 413, storage_unavailable: 503, storage_write_failed: 503, storage_read_failed: 503, too_many_open: 429,
};
const statusOf = (error) => STATUS[error] || 422;
const NOTE_MAX = 4000;
const FLASH_KEYS = ["sent", "replied", "partial", "approved", "revised", "cancelled", "declined"];

export function buildRequestRoutes(h) {
  const { pages, who, brandDeps, notFoundPage, errorPage, redirect, fileProblem, withPortalHeaders, logEvent, routeName, readUploads, readForm, UPLOAD_FORM_OVERHEAD, checkCsrf, dispatchNotifications, UUID, can, requestsOn, servicesOn } = h;

  const vmOf = (ctx, a) => pages.requestsViewModel(ctx, a);
  const shell = (ctx, a, title, body, status = 200) => pages.requestsShellPage(ctx, a, { title, body, status });
  const settingsMap = async (ctx) => { try { return await repo.listTypeSettings(ctx.db); } catch { return new Map(); } };
  const owner = (a) => can(a.membership.role, "requests.accept_quote");
  const log = (ctx, a, evt, outcome, extra = {}) => logEvent({ evt, outcome, route: routeName(ctx.url.pathname), ref: ctx.ref, org: a.membership.organizationId, user: a.session.userId, ...extra });

  /* ---------------------------------------------------------------- sections */

  const section = (kind) => async (ctx, a) => {
    const org = a.membership.organizationId, vm = vmOf(ctx, a);
    const [all, settings, summary] = await Promise.all([repo.listClientRequests(ctx.db, org), settingsMap(ctx), repo.clientSummary(ctx.db, org, { owner: owner(a) })]);
    let extra = "";
    if (kind === "seo") {
      let sites = []; try { sites = await listClientWebsites(ctx.db, org); } catch { sites = []; }
      const seoOf = new Map();
      for (const s of sites) { const d = await getSeoForClient(ctx.db, org, s.id); if (d) seoOf.set(s.id, d); }
      extra = views.seoOverview(vm, sites, seoOf);
    }
    return shell(ctx, a, KINDS[kind].label, views.sectionPage(vm, kind, { requests: all.filter((r) => r.kind === kind), settings, actions: summary.actions, canRequest: can(a.membership.role, "requests.submit"), extra }));
  };

  async function legacySupport(ctx, a) {
    if (!servicesOn(ctx)) return [];
    try {
      return (await supportRepo.listClientRequests(ctx.db, a.membership.organizationId)).map((r) => ({ id: r.id, title: r.title, lastMessageAt: r.lastMessageAt, closed: r.closed, unreadForClient: r.unreadForClient, status: r.status, statusLabel: supportRepo.STATUS_LABEL[r.status] || r.status }));
    } catch { return []; }
  }

  const hub = async (ctx, a) => {
    const org = a.membership.organizationId;
    const [all, summary, legacy] = await Promise.all([repo.listClientRequests(ctx.db, org), repo.clientSummary(ctx.db, org, { owner: owner(a) }), legacySupport(ctx, a)]);
    return shell(ctx, a, "My Requests", views.hubPage(vmOf(ctx, a), { requests: all, legacy, actions: summary.actions, kind: ctx.url.searchParams.get("kind") || "" }));
  };

  /* ---------------------------------------------------------------- the guided form */

  async function formModel(ctx, a, type) {
    const org = a.membership.organizationId;
    const cfg = { ...effectiveSettings(type, (await settingsMap(ctx)).get(type.key)) };
    let websites = [];
    if (type.website) { try { websites = (await listClientWebsites(ctx.db, org)).map((w) => ({ id: w.id, name: w.name })); } catch { websites = []; } }
    let brand = null;
    if (type.brand) {
      const b = await getClientBrand(ctx.db, org);
      if (b && b.published) brand = { colours: (b.colours || []).filter((c) => c && /^#[0-9a-fA-F]{3,8}$/.test(String(c.hex || c.value || ""))).map((c) => ({ name: c.name, hex: String(c.hex || c.value) })), typography: b.typography || [], logos: (b.assets || []).filter((x) => x.kind === "logo").map((x) => ({ id: x.id, title: x.title, role: x.logoRole, tone: x.tone })) };
    }
    return { cfg, websites, brand };
  }

  const renderForm = async (ctx, a, type, o = {}) => {
    const m = await formModel(ctx, a, type);
    return shell(ctx, a, type.label, views.formPage(vmOf(ctx, a), type, { ...m, ...o, csrf: await pages.csrfOf(ctx, a) }), o.status || 200);
  };

  const newForm = async (ctx, a) => {
    const type = getType(ctx.url.searchParams.get("type"));
    if (!type) return redirect(`${vmOf(ctx, a).base}/deliverables`);
    const cfg = effectiveSettings(type, (await settingsMap(ctx)).get(type.key));
    if (!cfg.enabled) return redirect(`${vmOf(ctx, a).base}${KINDS[type.kind].path}`);
    return renderForm(ctx, a, type);
  };

  /** The posted answers, keyed the way the form shows them (so a refused form comes back filled in). */
  const valuesOf = (type, fields) => {
    const v = { title: fields.get("title") || "", needed_by: fields.get("needed_by") || "", website_id: fields.get("website_id") || "", use_brand: fields.get("use_brand") || "" };
    for (const f of type.fields) {
      if (f.type === "checks") v[f.key] = f.options.map((o) => o[0]).filter((o) => fields.get(`d_${f.key}__${o}`) === "1");
      else v[f.key] = fields.get(`d_${f.key}`) || "";
    }
    for (const [k, val] of fields) if (k.startsWith("logo_")) v[k] = val;
    return v;
  };
  const BODY = (repo.MAX_FILES_PER_MESSAGE * repo.MAX_FILE_BYTES) + UPLOAD_FORM_OVERHEAD;

  const create = async (ctx, a) => {
    const read = await readUploads(ctx.request, BODY, repo.MAX_FILES_PER_MESSAGE);
    const typeFromQuery = getType(ctx.url.searchParams.get("type"));
    if (read.error) { const t = typeFromQuery; return t ? renderForm(ctx, a, t, { error: read.error === 413 ? errorMessage("file_too_large") : errorMessage("invalid"), status: read.error }) : errorPage(read.error, { ref: ctx.ref }); }
    const type = getType(read.fields.get("type"));
    if (!type) return notFoundPage(ctx);
    if (!(await checkCsrf(ctx.cfg, a.session, read.fields.get("csrf") || ""))) { log(ctx, a, "requests.create", "rejected", { reason: "csrf", status: 403 }); return errorPage(403, { ref: ctx.ref }); }
    const form = { get: (n) => (read.fields.has(n) ? read.fields.get(n) : null), keys: () => read.fields.keys() };
    const res = await svc.clientCreate(brandDeps(ctx), { ...who(a), typeKey: type.key, form, files: read.files });
    if (!res.ok) {
      const status = res.error === "invalid_details" ? 422 : statusOf(res.error);
      log(ctx, a, "requests.create", "refused", { reason: res.error, status });
      return renderForm(ctx, a, type, { values: valuesOf(type, read.fields), errors: res.errors || {}, error: res.error === "invalid_details" ? "" : views.errorText(res.error) + (res.name ? ` (${res.name})` : ""), status });
    }
    log(ctx, a, "requests.create", "saved", { status: 303 });
    await dispatchNotifications(ctx.env, ctx); // after the request is saved; it can never undo or delay it
    return redirect(`${vmOf(ctx, a).base}/requests/${res.id}?flash=${res.attachmentsFailed ? "partial" : "sent"}`);
  };
  const errorMessage = (code) => ({ file_too_large: "A file is larger than 10 MB.", invalid: "That request couldn't be read. Please try again." }[code] || views.errorText(code));

  /* ---------------------------------------------------------------- one request */

  const show = async (ctx, a, id, o = {}) => {
    if (!UUID.test(id)) return notFoundPage(ctx);
    const org = a.membership.organizationId;
    const t = await repo.getClientThread(ctx.db, org, id);
    if (!t) return notFoundPage(ctx);
    if (t.request.unreadForClient) await repo.markClientRead(ctx.db, org, id, { now: ctx.now });
    const csrf = await pages.csrfOf(ctx, a);
    const role = a.membership.role;
    return shell(ctx, a, t.request.title, views.detailPage(vmOf(ctx, a), t, {
      csrf, flash: FLASH_KEYS.includes(ctx.url.searchParams.get("flash")) ? ctx.url.searchParams.get("flash") : "", error: o.error || "", owner: owner(a), canApprove: can(role, "requests.approve_proof"),
      canCancel: owner(a) || t.request.submittedBy === a.session.userId, quoteOpen: quoteAcceptanceOpen(ctx.env), terms: QUOTE_TERMS.text,
    }), o.status || 200);
  };

  const redirectTo = (ctx, a, id, flash) => redirect(`${vmOf(ctx, a).base}/requests/${id}?flash=${flash}`);

  const reply = async (ctx, a, id) => {
    if (!UUID.test(id)) return notFoundPage(ctx);
    const read = await readUploads(ctx.request, BODY, repo.MAX_FILES_PER_MESSAGE);
    if (read.error) return show(ctx, a, id, { error: read.error === 413 ? "file_too_large" : "invalid_message", status: read.error });
    if (!(await checkCsrf(ctx.cfg, a.session, read.fields.get("csrf") || ""))) return errorPage(403, { ref: ctx.ref });
    const res = await svc.clientReply(brandDeps(ctx), { ...who(a), requestId: id, body: read.fields.get("body") || "", files: read.files });
    if (!res.ok) { if (res.error === "not_found") return notFoundPage(ctx); return show(ctx, a, id, { error: res.error, status: statusOf(res.error) }); }
    log(ctx, a, "requests.reply", "saved", { status: 303 });
    await dispatchNotifications(ctx.env, ctx);
    return redirectTo(ctx, a, id, res.attachmentsFailed ? "partial" : "replied");
  };

  /** A small form post (approve, revise, cancel, accept, decline): urlencoded, CSRF-checked, one service call, back to the request. */
  const act = (name, call, flash) => async (ctx, a, id, qid) => {
    if (!UUID.test(id) || (qid !== undefined && !UUID.test(qid))) return notFoundPage(ctx);
    const read = await readForm(ctx.request, 24 * 1024);
    if (read.error) return errorPage(read.error, { ref: ctx.ref });
    if (!(await checkCsrf(ctx.cfg, a.session, read.fields.get("csrf") || ""))) { log(ctx, a, name, "rejected", { reason: "csrf", status: 403 }); return errorPage(403, { ref: ctx.ref }); }
    const note = (read.fields.get("note") || "").slice(0, NOTE_MAX + 1);
    const res = await call(brandDeps(ctx), { ...who(a), requestId: id, quoteId: qid, note, typedName: read.fields.get("name") || "" });
    if (!res.ok) {
      if (res.error === "not_found") return notFoundPage(ctx);
      log(ctx, a, name, "refused", { reason: res.error, status: statusOf(res.error) });
      return show(ctx, a, id, { error: res.error, status: statusOf(res.error) });
    }
    log(ctx, a, name, "saved", { status: 303 });
    await dispatchNotifications(ctx.env, ctx);
    return redirectTo(ctx, a, id, flash);
  };

  const file = (view) => async (ctx, a, id, fid) => {
    if (!UUID.test(id) || !UUID.test(fid)) return notFoundPage(ctx);
    if (!ctx.env.PORTAL_FILES) return errorPage(503, { ref: ctx.ref });
    const res = await svc.clientOpenFile(brandDeps(ctx), { ...who(a), requestId: id, fileId: fid, view });
    return res.ok ? withPortalHeaders(res.response) : fileProblem(ctx, res.error);
  };

  const R = "\\/portal\\/o\\/([^/]+)";
  const on = { when: requestsOn };
  return [
    { ...on, re: /^\/portal\/o\/([^/]+)\/deliverables$/, action: "requests.view", run: section("deliverable") },
    { ...on, re: /^\/portal\/o\/([^/]+)\/seo$/, action: "requests.view", run: section("seo") },
    { ...on, re: /^\/portal\/o\/([^/]+)\/development$/, action: "requests.view", run: section("development") },
    { ...on, re: /^\/portal\/o\/([^/]+)\/requests$/, action: "requests.view", postAction: "requests.submit", bucket: "requests", maxBody: () => BODY, run: hub, post: create },
    { ...on, re: /^\/portal\/o\/([^/]+)\/requests\/new$/, action: "requests.submit", run: newForm },
    { ...on, re: /^\/portal\/o\/([^/]+)\/requests\/([^/]+)\/files\/([^/]+)\/view$/, action: "requests.view", run: file(true) },
    { ...on, re: /^\/portal\/o\/([^/]+)\/requests\/([^/]+)\/files\/([^/]+)$/, action: "requests.view", run: file(false) },
    { ...on, re: /^\/portal\/o\/([^/]+)\/requests\/([^/]+)\/reply$/, action: "requests.view", postAction: "requests.submit", bucket: "requests", maxBody: () => BODY, run: async (ctx, a, id) => redirect(`${vmOf(ctx, a).base}/requests/${id}`), post: reply },
    { ...on, re: /^\/portal\/o\/([^/]+)\/requests\/([^/]+)\/approve$/, action: "requests.view", postAction: "requests.approve_proof", bucket: "requests", run: async (ctx, a, id) => redirect(`${vmOf(ctx, a).base}/requests/${id}`), post: act("requests.approve", svc.clientApprove, "approved") },
    { ...on, re: /^\/portal\/o\/([^/]+)\/requests\/([^/]+)\/revise$/, action: "requests.view", postAction: "requests.approve_proof", bucket: "requests", run: async (ctx, a, id) => redirect(`${vmOf(ctx, a).base}/requests/${id}`), post: act("requests.revise", svc.clientRevise, "revised") },
    { ...on, re: /^\/portal\/o\/([^/]+)\/requests\/([^/]+)\/cancel$/, action: "requests.view", postAction: "requests.view", bucket: "requests", run: async (ctx, a, id) => redirect(`${vmOf(ctx, a).base}/requests/${id}`), post: act("requests.cancel", svc.clientCancel, "cancelled") },
    { ...on, re: /^\/portal\/o\/([^/]+)\/requests\/([^/]+)\/quote\/([^/]+)\/accept$/, action: "requests.view", postAction: "requests.accept_quote", bucket: "requests", run: async (ctx, a, id) => redirect(`${vmOf(ctx, a).base}/requests/${id}`), post: act("requests.quote.accept", svc.clientAcceptQuote, "approved") },
    { ...on, re: /^\/portal\/o\/([^/]+)\/requests\/([^/]+)\/quote\/([^/]+)\/decline$/, action: "requests.view", postAction: "requests.accept_quote", bucket: "requests", run: async (ctx, a, id) => redirect(`${vmOf(ctx, a).base}/requests/${id}`), post: act("requests.quote.decline", svc.clientDeclineQuote, "declined") },
    { ...on, re: /^\/portal\/o\/([^/]+)\/requests\/([^/]+)$/, action: "requests.view", run: (ctx, a, id) => show(ctx, a, id) },
  ];
}
