/**
 * Discovery routes for the portal: the guest way in (/portal/discover/<token>, no account) and the signed-in way in (under Branding). Both end in the same `serve`
 * function, so the pages, the validation and the saving are identical. Differences, all on purpose:
 *   guest : the credential is the secret link; every request resolves the link by its hash and an inactive link looks the same whatever the reason; no cookie is set; the
 *           write routes need a same-origin request; the audit entry names the link, never a person.
 *   member: the portal's guard has already proved the membership; writes also need the CSRF token; the audit entry names the user.
 * An assessment is reached only through its own link or its own organization, so one link can never open another assessment.
 */
import { newRef, redirect, securityHeaders, errorPage, checkSameSiteMutation } from "../http.js";
import { MARK, head, footer, escapeHtml as e } from "../frame.js";
import { declaredBodyProblem, readForm, readUploads, UPLOAD_FORM_OVERHEAD } from "../form.js";
import { checkRateLimit } from "../ratelimit.js";
import { sha256b64url } from "../crypto.js";
import { logEvent, routeName } from "../log.js";
import { effectiveKind, stageByNumber, stageQuestions, readStageFields, cleanText } from "./model.js";
import * as repo from "../repo/discovery.js";
import { stageBody, welcomeBody, doneBody, closedBody, uploadErrorText } from "./pages.js";
import { addInspiration, removeInspiration, referenceResponse } from "./files.js";
import { STATUS_LABEL } from "../repo/discovery.js";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MAX_FORM = 32 * 1024;
const MAX_FILES_PER_POST = 3;
export const MAX_REVIEW_BODY = MAX_FILES_PER_POST * repo.MAX_UPLOAD_BYTES + UPLOAD_FORM_OVERHEAD;
const NOTICES = { saved: "Saved. You can come back to this at any time.", added: "File added.", removed: "File removed.", reopened: "Welcome back." };
const ERRORS = new Set(["type_not_allowed", "file_too_large", "empty_file", "invalid_name", "content_mismatch", "file_limit", "quota_exceeded", "storage_unavailable", "too_many", "closed", "nothing_to_submit"]);
const SUBMIT_TEXT = "Please answer at least one question before you send this, even if it is only “I’m not sure”.";

const GUEST_PREFIX = "/portal/discover/";
export const isGuestPath = (path) => path.startsWith(GUEST_PREFIX);

/* ------------------------------------------------------------------ guest frame */

function guestPage(status, title, bodyHtml, ref) {
  const html = `<!DOCTYPE html><html lang="en-CA"><head>${head(title, { script: "/assets/js/discovery.js", styles: ["/assets/css/discovery.css"] })}</head>
<body class="dsc-body"><header class="dsc-top"><div class="wrap"><span class="brand">${MARK}<span class="brand__word">Framework</span></span></div></header>
<main id="main" class="dsc-main" tabindex="-1"><div class="wrap">${bodyHtml}</div></main>${footer}</body></html>`;
  return new Response(html, { status, headers: securityHeaders({ "Content-Type": "text/html; charset=utf-8" }, { scripts: true }) });
}

const closedPage = (ref) => guestPage(404, "Link not active", closedBody(), ref);

/* ------------------------------------------------------------------ the shared flow */

/**
 * @param {object} c { ctx, assessment, rest ("" | "<n>" | "media/<id>"), base, mode, by, csrf?, csrfOk?(fields)->bool, page(status,title,body), backHref? }
 */
async function serve(c) {
  const { ctx, assessment, rest, base, mode } = c;
  const db = ctx.db, deps = { db, bucket: ctx.env.PORTAL_FILES, now: ctx.now };
  const content = await repo.listContent(db, assessment.kind);
  const eff = effectiveKind(assessment.kind, content.rows);
  if (!eff) return errorPage(404, { ref: ctx.ref });
  const method = ctx.request.method;
  const open = assessment.status === "not_started" || assessment.status === "in_progress";
  const imageUrl = (id) => `${base}/media/${id}`;

  if (rest.startsWith("media/")) {
    if (method !== "GET" && method !== "HEAD") return errorPage(405, { ref: ctx.ref, headers: { Allow: "GET, HEAD" } });
    const id = rest.slice(6);
    if (!/^[0-9a-f-]{36}$/.test(id) || !content.rows.some((r) => r.id === id && r.image_key)) return errorPage(404, { ref: ctx.ref });
    const r = await referenceResponse(deps, { contentId: id });
    if (!r.ok) return errorPage(404, { ref: ctx.ref });
    r.response.headers.set("Cache-Control", "private, max-age=300");
    return r.response;
  }

  if (rest === "") {
    if (method !== "GET" && method !== "HEAD") return errorPage(405, { ref: ctx.ref, headers: { Allow: "GET, HEAD" } });
    if (c.onVisit) await c.onVisit();
    const q = ctx.url.searchParams.get("n");
    const notice = NOTICES[q] || null;
    if (!open) return c.page(200, "Thank you", doneBody({ eff, assessment, mode, backHref: c.backHref }));
    return c.page(200, eff.label, (notice ? `<p class="dsc__notice" role="status">${e(notice)}</p>` : "") + welcomeBody({ eff, assessment, base, resumeStage: Math.min(Math.max(assessment.stage, 1), eff.stages.length), mode }));
  }

  const m = /^([1-9]\d?)$/.exec(rest);
  if (!m) return errorPage(404, { ref: ctx.ref });
  const n = Number(m[1]);
  const stage = stageByNumber(eff, n);
  if (!stage) return errorPage(404, { ref: ctx.ref });
  if (!open) return method === "GET" || method === "HEAD" ? c.page(200, "Thank you", doneBody({ eff, assessment, mode, backHref: c.backHref })) : redirect(base);

  if (method === "GET" || method === "HEAD") {
    if (n > Math.max(assessment.stage, 1)) return redirect(`${base}/${Math.max(assessment.stage, 1)}`);
    const [answers, uploads] = await Promise.all([repo.getAnswers(db, assessment.id), stage.review ? repo.listUploads(db, assessment.organizationId, assessment.id) : []]);
    const nq = ctx.url.searchParams.get("n"), eq = ctx.url.searchParams.get("e");
    return c.page(200, `${stage.title} · ${eff.label}`, stageBody({ eff, assessment, stage, answers, uploads, base, csrf: c.csrf, imageUrl, mode, notice: NOTICES[nq] || null, error: ERRORS.has(eq) ? (eq === "nothing_to_submit" ? SUBMIT_TEXT : uploadErrorText(eq)) : null }));
  }
  if (method !== "POST") return errorPage(405, { ref: ctx.ref, headers: { Allow: "GET, HEAD, POST" } });

  // ---- a save
  const declared = declaredBodyProblem(ctx.request, stage.review ? MAX_REVIEW_BODY : MAX_FORM);
  if (declared) return errorPage(declared, { ref: ctx.ref });
  const same = checkSameSiteMutation(ctx.request, ctx.cfg.origin);
  if (!same.ok) return errorPage(403, { ref: ctx.ref });
  const multipart = /^multipart\/form-data/i.test(ctx.request.headers.get("Content-Type") || "");
  if (multipart && !stage.review) return errorPage(400, { ref: ctx.ref });
  const read = multipart ? await readUploads(ctx.request, MAX_REVIEW_BODY, repo.MAX_UPLOADS) : await readForm(ctx.request, MAX_FORM);
  if (read.error) return errorPage(read.error, { ref: ctx.ref });
  const fields = read.fields, files = read.files || [];
  if (c.csrfOk && !(await c.csrfOk(fields))) { logEvent({ evt: "discovery.save", outcome: "rejected", reason: "csrf", status: 403, route: routeName(ctx.url.pathname), ref: ctx.ref }); return errorPage(403, { ref: ctx.ref }); }

  const go = fields.get("go") || "";
  const questions = stageQuestions(eff, stage);
  const entries = readStageFields(fields, questions);
  const nextStage = go === "back" ? Math.max(1, n - 1) : go === "next" || go === "submit" ? Math.min(eff.stages.length, n + 1) : n;
  const saved = await repo.saveAnswers(db, assessment, entries, { nextStage, by: c.by, now: ctx.now });
  if (!saved.ok) return redirect(base); // closed in the meantime: show the thank-you
  let flag = "";
  if (stage.review) {
    if (fields.has("overall")) await repo.saveOverallComment(db, assessment, cleanText(fields.get("overall"), 1000), { now: ctx.now });
    const removeId = fields.get("remove");
    if (removeId && /^[0-9a-f-]{36}$/.test(removeId)) { const r = await removeInspiration(deps, { assessment, uploadId: removeId, by: c.by }); flag = r.ok ? "n=removed" : "e=closed"; }
    const picked = files.filter((f) => f.name && f.bytes && f.bytes.length);
    if (picked.length > MAX_FILES_PER_POST) flag = "e=too_many";
    else for (const f of picked) {
      const r = await addInspiration(deps, { assessment, file: f, by: c.by });
      if (!r.ok) { flag = `e=${ERRORS.has(r.error) ? r.error : "invalid_name"}`; break; }
      flag = "n=added";
    }
  }
  if (flag.startsWith("e=") || (flag && go !== "submit" && go !== "next" && go !== "back")) return redirect(`${base}/${n}?${flag}`); // a refused file or a file just added/removed: stay here and say so
  if (go === "submit") {
    const fresh = await repo.getAssessment(db, assessment.organizationId, assessment.id);
    const sub = await repo.submitAssessment(db, fresh, c.by, { now: ctx.now });
    if (!sub.ok) return redirect(`${base}/${n}?e=${sub.error === "nothing_to_submit" ? "nothing_to_submit" : "closed"}`);
    return redirect(base);
  }
  if (go === "save") return redirect(`${base}?n=saved`);
  return redirect(go === "next" || go === "back" ? `${base}/${nextStage}` : `${base}/${n}${flag ? `?${flag}` : ""}`);
}

/* ------------------------------------------------------------------ guest */

/** @returns {Promise<Response>} for any /portal/discover/... path. The caller has already confirmed the feature is on. */
export async function handleGuest(ctx, path) {
  const m = /^\/portal\/discover\/([^/]+)(?:\/(.*))?$/.exec(path);
  const token = m ? m[1] : "";
  const rest = m && m[2] ? m[2] : "";
  const isMedia = rest.startsWith("media/");
  if (!isMedia) {
    const limit = await checkRateLimit(ctx.env, ctx.request, ctx.cfg, "discovery");
    if (limit.limited) { logEvent({ evt: "rate.limited", outcome: "discovery", route: "/portal/discover", status: 429, ref: ctx.ref }); return errorPage(429, { ref: ctx.ref, headers: { "Retry-After": "60" } }); }
  }
  if (!TOKEN.test(token)) return closedPage(ctx.ref);
  let found;
  try { found = await repo.resolveLink(ctx.db, await sha256b64url(token), { now: ctx.now }); } catch { return errorPage(503, { ref: ctx.ref }); }
  if (!found) { logEvent({ evt: "discovery.link", outcome: "inactive", status: 404, route: "/portal/discover", ref: ctx.ref }); return closedPage(ctx.ref); }
  const { assessment, link } = found;
  const base = `/portal/discover/${token}`;
  return serve({
    ctx, assessment, rest, base, mode: "guest",
    by: { type: "client", ref: `discovery-link:${link.id.slice(0, 8)}` },
    page: (status, title, body) => guestPage(status, title, body, ctx.ref),
    onVisit: () => repo.touchLink(ctx.db, link.id, { now: ctx.now }),
  });
}

/* ------------------------------------------------------------------ member (under Branding) */

export function memberListBody(basePath, assessments) {
  if (!assessments.length) return `<div class="dsc dsc--welcome dsc--member"><div class="dsc__intro dsc__intro--hero"><span class="eyebrow">Branding</span><h1 class="dsc__h1">Brand Discovery</h1><p class="dsc__lead">There is nothing to complete right now. Framework will add a Brand Discovery here when it is ready for you.</p></div></div>`;
  return `<div class="dsc dsc--welcome dsc--member"><div class="dsc__intro dsc__intro--hero"><span class="eyebrow">Branding</span><h1 class="dsc__h1">Brand Discovery</h1><p class="dsc__lead">A short, visual way to show Framework what you like.</p>
<ul class="dlist">${assessments.map((a) => `<li class="dlist__item"><div><strong>${e(a.title)}</strong><span class="status status--idle">${e(STATUS_LABEL[a.status])}</span></div><a class="btn btn--primary" href="${e(basePath)}/${e(a.id)}">${a.status === "not_started" ? "Start" : a.status === "in_progress" ? "Continue" : "View"}</a></li>`).join("")}</ul></div></div>`;
}

/** Wiring for router.js: each takes the guard's access object `a`, so the organization always comes from the membership, never from the request. */
export function memberApi(pages, { csrfFor, checkCsrf }) {
  const base = (a) => `/portal/o/${a.membership.slug}/branding/discovery`;
  return {
    list: async (ctx, a) => pages.discoveryPage(ctx, a, { body: memberListBody(base(a), await repo.listClientAssessments(ctx.db, a.membership.organizationId)) }),
    run: async (ctx, a, id, rest = "") => {
      if (!/^[0-9a-f-]{36}$/.test(id || "")) return errorPage(404, { ref: ctx.ref });
      const assessment = await repo.getAssessment(ctx.db, a.membership.organizationId, id);
      if (!assessment || assessment.archivedAt) return errorPage(404, { ref: ctx.ref });
      const csrf = await csrfFor(ctx.cfg, a.session);
      return serve({
        ctx, assessment, rest: rest || "", base: `${base(a)}/${id}`, mode: "member", csrf, backHref: `/portal/o/${a.membership.slug}/branding`,
        csrfOk: async (fields) => checkCsrf(ctx.cfg, a.session, fields.get("csrf") || ""),
        by: { type: "client", ref: a.session.userId },
        page: (status, title, body) => pages.discoveryPage(ctx, a, { title, body, status }),
      });
    },
  };
}
