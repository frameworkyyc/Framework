/**
 * Framework Admin: Discovery assessments (Brand Discovery now; Website and Marketing Discovery later). Behind Cloudflare Access and ADMIN_EMAILS; writes also need
 * PORTAL_ADMIN_WRITES and a same-origin request with the X-Framework-Admin header. Every assessment belongs to one organization; every path that names an assessment also
 * names its organization, so an id from another organization is simply "not found". Nothing here reads or writes brand kits, brand assets or Branding requirements.
 *
 *   GET  /discovery                                   { available, enabled, kinds, assessments: [{ id, organizationId, organizationName, title, status, answered, uploads, activeLinks, ... }] }   ?org=<id> narrows it
 *   GET  /clients/:org/discovery                      the same, for one client
 *   POST /clients/:org/discovery                      { kind, title, recipient_name? }                       create and assign
 *   GET  /clients/:org/discovery/:id                  one assessment: links, files, progress, the creative brief (+ Markdown); once Submitted or Reviewed also `exportMarkdown`, the AI-ready full submission
 *   POST /clients/:org/discovery/:id/update           { title?, recipient_name? }
 *   POST /clients/:org/discovery/:id/review           { note? }        Submitted -> Reviewed
 *   POST /clients/:org/discovery/:id/reopen           {}               Submitted/Reviewed -> In progress
 *   POST /clients/:org/discovery/:id/archive          {}               hides it and ends its links
 *   POST /clients/:org/discovery/:id/links            { label?, days? }  -> { url, expiresAt }   the URL is shown ONCE; only its hash is stored
 *   POST /clients/:org/discovery/:id/links/:link/revoke
 *   GET  /clients/:org/discovery/:id/files/:file      an inspiration file, as a download
 *   GET  /clients/:org/discovery/:id/export.pdf       the whole submission as a PDF download (Submitted or Reviewed only; nothing stored, no migration)
 *   GET  /clients/:org/profile-export                 the client's Business Profile as AI-ready Markdown (`profileMarkdown`) and the COMPLETE CLIENT BRIEF (`briefMarkdown`: Business Profile + Brand Discovery, or a plain statement that Discovery is missing or unfinished)
 *   GET  /clients/:org/profile-export.pdf             the Business Profile as a PDF download
 *   GET  /discovery/content?kind=brand                the questions and options as the recipient sees them, with what Admin has changed
 *   POST /discovery/content                           { kind, item, option?, label?, description?, enabled? } | { ..., add: { label, description? } } | { ..., move: "up"|"down" } | { ..., reset: true }
 *   POST /discovery/content/image                     multipart: file (png, jpg or webp, 5 MB) + meta { kind, item, option, alt? }   a reference picture for one option
 *   POST /discovery/content/:id/image/delete          {}
 *   GET  /discovery/media/:id                         a reference picture, inline
 *   GET  /discovery/retention                         the 90-day rule: clients with a relationship end date, and what would be deleted now (read-only)
 *   POST /clients/:org/relationship                   { ended_on: "YYYY-MM-DD" | null }   record, change or clear the day the client relationship ended (needs migration 0019)
 *   POST /discovery/retention/run                     { confirm: "RETENTION", dry_run?: true }   a dry run unless dry_run is false AND PORTAL_DISCOVERY_RETENTION is "1"
 *   POST /clients/:org/discovery/:id/delete           { confirm: "DELETE" }   permanently deletes the assessment, its answers, links and files (and their backup copies)
 */
import { UUID } from "./repo/common.js";
import { getOrganizationById } from "./repo/orgs.js";
import * as repo from "./repo/discovery.js";
import { KINDS, KIND_KEYS, SECTIONS } from "./discovery/catalogue.js";
import { effectiveKind } from "./discovery/model.js";
import { buildBrief, briefToMarkdown } from "./discovery/brief.js";
import { buildExport, exportMarkdown, exportFilename, exportDate, buildProfileExport, profileMarkdown, briefMarkdown, discoveryStatus } from "./discovery/export.js";
import { renderExportPdf, renderProfilePdf } from "./discovery/pdf.js";
import { getProfileAnswers } from "./repo/business-profile.js";
import { adminDownloadInspiration, adminSetReference, adminClearReference, referenceResponse, REFERENCE_MAX_BYTES } from "./discovery/files.js";
import { randomToken, sha256b64url } from "./crypto.js";
import { discoveryEnabled, retentionEnabled } from "./config.js";
import { eraseAssessment, retentionPlan, runRetention, RETENTION_DAYS } from "./discovery/retention.js";
import { json, err, sameOriginWrite, readJson, readUpload } from "./admin-branding.js";

const STATUS = {
  invalid_kind: 422, invalid_title: 422, invalid_actor: 422, invalid_days: 422, invalid_token: 422, invalid_item: 422, invalid_option: 422, invalid_label: 422, invalid_enabled: 422, invalid_sort_order: 422,
  nothing_to_change: 422, not_found: 404, not_submitted: 409, closed: 409, too_many: 409, type_not_allowed: 415, content_mismatch: 422, active_content: 422, image_dimensions: 422, empty_file: 422, no_file: 400,
  file_too_large: 413, invalid_name: 422, invalid_date: 422, not_due: 409, confirm_required: 422, storage_unavailable: 503, storage_write_failed: 502, storage_read_failed: 502, storage_delete_failed: 502, unavailable: 409,
};
const fromFailure = (r) => (STATUS[r.error] ? json({ error: r.error, message: "The change was not made." }, STATUS[r.error]) : err(500, "server_error", "Something went wrong. Nothing was changed."));
const MAX_UPLOAD = REFERENCE_MAX_BYTES + 256 * 1024;
const MAX_OPTIONS = 20, MAX_CUSTOM = 6;

function route(seg) {
  if (seg[0] === "discovery") {
    if (seg.length === 1) return { kind: "all", methods: ["GET"] };
    if (seg.length === 2 && seg[1] === "content") return { kind: "content", methods: ["GET", "POST"] };
    if (seg.length === 3 && seg[1] === "content" && seg[2] === "image") return { kind: "image_set", methods: ["POST"] };
    if (seg.length === 5 && seg[1] === "content" && seg[3] === "image" && seg[4] === "delete") return { kind: "image_clear", methods: ["POST"], target: seg[2] };
    if (seg.length === 3 && seg[1] === "media") return { kind: "media", methods: ["GET"], target: seg[2] };
    if (seg.length === 2 && seg[1] === "retention") return { kind: "retention", methods: ["GET"] };
    if (seg.length === 3 && seg[1] === "retention" && seg[2] === "run") return { kind: "retention_run", methods: ["POST"] };
    return null;
  }
  if (seg[0] === "clients" && seg.length === 3 && seg[2] === "relationship") return { kind: "relationship", methods: ["POST"], org: seg[1] };
  if (seg[0] === "clients" && seg.length === 3 && seg[2] === "profile-export") return { kind: "profile_export", methods: ["GET"], org: seg[1] };
  if (seg[0] === "clients" && seg.length === 3 && seg[2] === "profile-export.pdf") return { kind: "profile_export_pdf", methods: ["GET"], org: seg[1] };
  if (seg[0] === "clients" && seg[2] === "discovery") {
    const org = seg[1];
    if (seg.length === 3) return { kind: "org", methods: ["GET", "POST"], org };
    const id = seg[3];
    if (seg.length === 4) return { kind: "one", methods: ["GET"], org, id };
    if (seg.length === 5 && ["update", "review", "reopen", "archive", "links", "delete"].includes(seg[4])) return { kind: seg[4], methods: ["POST"], org, id };
    if (seg.length === 6 && seg[4] === "links" && seg[5] !== "" ) return null;
    if (seg.length === 7 && seg[4] === "links" && seg[6] === "revoke") return { kind: "revoke", methods: ["POST"], org, id, link: seg[5] };
    if (seg.length === 6 && seg[4] === "files") return { kind: "file", methods: ["GET"], org, id, file: seg[5] };
    if (seg.length === 5 && seg[4] === "export.pdf") return { kind: "export_pdf", methods: ["GET"], org, id };
  }
  return null;
}

/** The content editor's view: every question and option as the recipient would see it, plus what Admin has changed and the ids needed to change it. */
function editorView(kind, rows) {
  const def = KINDS[kind];
  const eff = effectiveKind(kind, rows);
  const byKey = new Map(rows.map((r) => [`${r.item_key}\u0000${r.option_key}`, r]));
  return def.questions.map((base) => {
    const q = eff.questions.find((x) => x.key === base.key);
    const qr = byKey.get(`${base.key}\u0000`);
    return {
      key: base.key, section: base.section, sectionLabel: `${SECTIONS[base.section].number} ${SECTIONS[base.section].label}`, visual: base.visual, multi: base.multi,
      prompt: q.prompt, builtinPrompt: base.prompt, help: q.help || "", builtinHelp: base.help || "", enabled: q.enabled, edited: Boolean(qr), contentId: qr ? qr.id : null,
      options: q.options.map((o) => {
        const r = byKey.get(`${base.key}\u0000${o.key}`);
        const builtin = base.options.find((b) => b.key === o.key);
        return { key: o.key, label: o.label, builtinLabel: builtin ? builtin.label : null, detail: (base.visual === "tagline" ? o.sample : o.note) || "", enabled: o.enabled, custom: o.custom, edited: Boolean(r), contentId: r ? r.id : null, hasImage: Boolean(o.imageId), imageId: o.imageId || null, imageAlt: r && r.image_alt ? r.image_alt : "" };
      }),
    };
  });
}

/** One organization's Business Profile as the export model, or null when the portal database has no Business Profile table (migration 0002 not applied). Only this organization's rows are read. */
async function profileExportFor(db, org) {
  let rows;
  try { rows = (await db.prepare("SELECT field_id, value, updated_at FROM business_profile_answers WHERE organization_id = ?").bind(org.id).all()).results; } catch { return null; }
  const profile = {};
  let lastSaved = null;
  for (const r of rows) { profile[r.field_id] = r.value; if (!lastSaved || r.updated_at > lastSaved) lastSaved = r.updated_at; }
  return buildProfileExport({ organization: org, profile, lastSaved });
}

/** The Brand Discovery assessment the client brief speaks for: the newest Submitted or Reviewed one, else the newest still open. Archived ones are ignored. Null when none was ever assigned. */
async function briefAssessmentFor(db, org) {
  const list = (await repo.listAssessments(db, { organizationId: org.id, includeArchived: false })).assessments.filter((a) => a.kind === "brand");
  const done = list.filter((a) => a.status === "submitted" || a.status === "reviewed").sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))[0];
  const open = list.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  const pick = done || open;
  return pick ? repo.getAssessment(db, org.id, pick.id) : null;
}

async function discoveryExportFor(db, org, a) {
  if (!a) return null;
  const [uploads, answers, content] = await Promise.all([repo.listUploads(db, org.id, a.id), repo.getAnswers(db, a.id), repo.listContent(db, a.kind)]);
  return buildExport({ organization: org, assessment: a, eff: effectiveKind(a.kind, content.rows), answers, uploads, profile: {} });
}

export async function handleDiscoveryApi(request, env, principal, path, deps = {}) {
  const seg = path.split("/").filter(Boolean);
  const r = route(seg);
  if (!r) return null;
  if (!r.methods.includes(request.method)) return json({ error: "method_not_allowed", message: "That method is not allowed here." }, 405, { Allow: r.methods.join(", ") });
  for (const k of ["org", "id", "link", "file", "target"]) if (r[k] !== undefined && !UUID.test(r[k])) return err(404, "not_found", "Not found.");
  if (request.method === "POST") {
    if (env.PORTAL_ADMIN_WRITES !== "1") return err(403, "writes_disabled", "Changes are not enabled on this deployment.");
    if (!sameOriginWrite(request)) return err(403, "forbidden", "This request was not accepted.");
  }
  if (!env.PORTAL_DB) return err(503, "portal_unavailable", "The portal database is not available.");
  const db = env.PORTAL_DB, now = deps.now || new Date(), actor = principal && principal.email;
  const store = { db, bucket: env.PORTAL_FILES, now };
  const caps = { writes: env.PORTAL_ADMIN_WRITES === "1", enabled: discoveryEnabled(env) };
  const kinds = KIND_KEYS.map((k) => ({ kind: k, label: KINDS[k].label }));
  try {
    if (r.kind === "all" || r.kind === "org") {
      let orgId = null;
      if (r.kind === "org") { const org = await getOrganizationById(db, r.org); if (!org) return err(404, "not_found", "No such organization."); orgId = org.id; }
      else if (new URL(request.url).searchParams.get("org")) { orgId = new URL(request.url).searchParams.get("org"); if (!UUID.test(orgId)) return err(404, "not_found", "Not found."); }
      if (request.method === "POST") {
        const read = await readJson(request, ["kind", "title", "recipient_name"]);
        if (read.response) return read.response;
        const made = await repo.createAssessment(db, { organizationId: orgId, kind: read.body.kind, title: read.body.title, recipientName: read.body.recipient_name, actor }, { now });
        if (!made.ok) return fromFailure(made);
        return json({ ok: true, id: made.id }, 201);
      }
      const list = await repo.listAssessments(db, { organizationId: orgId, includeArchived: false, now });
      return json({ available: list.available, capabilities: caps, kinds, assessments: list.assessments });
    }
    if (r.kind === "one") {
      const org = await getOrganizationById(db, r.org);
      if (!org) return err(404, "not_found", "No such organization.");
      const a = await repo.getAssessment(db, org.id, r.id);
      if (!a) return err(404, "not_found", "Not found.");
      const [links, uploads, answers, content] = await Promise.all([repo.listLinks(db, org.id, a.id, { now }), repo.listUploads(db, org.id, a.id), repo.getAnswers(db, a.id), repo.listContent(db, a.kind)]);
      const eff = effectiveKind(a.kind, content.rows);
      const brief = buildBrief(eff, answers, { uploads: uploads.length, overallComment: a.overallComment });
      const done = a.status === "submitted" || a.status === "reviewed";
      const exportText = done ? exportMarkdown(buildExport({ organization: org, assessment: a, eff, answers, uploads, profile: await getProfileAnswers(db, org.id) })) : null;
      return json({ available: true, capabilities: caps, organization: { id: org.id, name: org.name, slug: org.slug }, assessment: a, links, uploads, brief, markdown: briefToMarkdown(brief, { client: org.name, title: a.title }), exportMarkdown: exportText, answered: answers.size });
    }
    if (r.kind === "profile_export" || r.kind === "profile_export_pdf") {
      const org = await getOrganizationById(db, r.org);
      if (!org) return err(404, "not_found", "No such organization.");
      const p = await profileExportFor(db, org);
      if (!p) return err(409, "unavailable", "Business Profile data is not available on this deployment.");
      if (r.kind === "profile_export_pdf") {
        return new Response(renderProfilePdf(p, { exportedOn: now }), { status: 200, headers: {
          "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${exportFilename({ client: p.client, assessment: { submitted: exportDate(now) } }, "pdf").replace(/^brand-discovery-/, "business-profile-")}"`,
          "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
      }
      const discovery = await discoveryExportFor(db, org, await briefAssessmentFor(db, org));
      const st = discoveryStatus(discovery);
      return json({ available: true, organization: { id: org.id, name: org.name }, profileMarkdown: profileMarkdown(p), briefMarkdown: briefMarkdown(p, discovery), discovery: { state: st.state, complete: st.complete, headline: st.headline }, profile: { answered: p.answered, questions: p.questions, percent: p.percent } });
    }
    if (r.kind === "export_pdf") {
      const org = await getOrganizationById(db, r.org);
      if (!org) return err(404, "not_found", "No such organization.");
      const a = await repo.getAssessment(db, org.id, r.id);
      if (!a) return err(404, "not_found", "Not found.");
      if (a.status !== "submitted" && a.status !== "reviewed") return err(409, "not_submitted", "Only a submitted assessment can be exported.");
      const [uploads, answers, content, profile] = await Promise.all([repo.listUploads(db, org.id, a.id), repo.getAnswers(db, a.id), repo.listContent(db, a.kind), getProfileAnswers(db, org.id)]);
      const model = buildExport({ organization: org, assessment: a, eff: effectiveKind(a.kind, content.rows), answers, uploads, profile });
      return new Response(renderExportPdf(model, { exportedOn: now }), { status: 200, headers: {
        "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${exportFilename(model, "pdf")}"`,
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    }
    if (["update", "review", "reopen", "archive", "links", "revoke"].includes(r.kind)) {
      const org = await getOrganizationById(db, r.org);
      if (!org) return err(404, "not_found", "No such organization.");
      let res;
      if (r.kind === "update") { const read = await readJson(request, ["title", "recipient_name"]); if (read.response) return read.response; res = await repo.updateAssessment(db, org.id, r.id, { title: read.body.title, recipientName: read.body.recipient_name }, actor, { now }); }
      else if (r.kind === "review") { const read = await readJson(request, ["note"]); if (read.response) return read.response; res = await repo.reviewAssessment(db, org.id, r.id, actor, read.body.note, { now }); }
      else if (r.kind === "reopen") res = await repo.reopenAssessment(db, org.id, r.id, actor, { now });
      else if (r.kind === "archive") res = await repo.archiveAssessment(db, org.id, r.id, actor, { now });
      else if (r.kind === "revoke") res = await repo.revokeLink(db, org.id, r.id, r.link, actor, { now });
      else {
        const read = await readJson(request, ["label", "days"]);
        if (read.response) return read.response;
        const base = env.PORTAL_BASE_URL ? new URL(env.PORTAL_BASE_URL).origin : null;
        if (!base || !/^https:\/\//.test(base)) return err(503, "portal_unavailable", "The portal address is not configured.");
        const token = randomToken(32);
        res = await repo.createLink(db, org.id, r.id, { tokenHash: await sha256b64url(token), label: read.body.label, days: read.body.days }, actor, { now });
        if (res.ok) return json({ ok: true, id: res.id, expiresAt: res.expiresAt, url: `${base}/portal/discover/${token}` }, 201); // shown once: only its hash is stored
      }
      return res.ok ? json({ ok: true }) : fromFailure(res);
    }
    if (r.kind === "retention") {
      const rels = await repo.listRelationshipEnds(db);
      const plan = rels.available ? await retentionPlan(db, { now }) : { cutoff: null, due: [] };
      return json({ available: rels.available, capabilities: { ...caps, retentionEnabled: retentionEnabled(env), backup: Boolean(env.PORTAL_FILES_BACKUP) }, days: RETENTION_DAYS, cutoff: plan.cutoff, relationships: rels.rows, due: plan.due });
    }
    if (r.kind === "retention_run") {
      const read = await readJson(request, ["confirm", "dry_run"]);
      if (read.response) return read.response;
      if (read.body.confirm !== "RETENTION") return err(422, "confirm_required", "Type RETENTION to confirm.");
      const out = await runRetention(env, { now, dryRun: read.body.dry_run !== false });
      return json({ ok: out.ok, ...out });
    }
    if (r.kind === "relationship") {
      const org = await getOrganizationById(db, r.org);
      if (!org) return err(404, "not_found", "No such organization.");
      const read = await readJson(request, ["ended_on"]);
      if (read.response) return read.response;
      if (!("ended_on" in read.body)) return err(422, "invalid_date", "The change was not made.");
      const res = read.body.ended_on === null ? await repo.clearRelationshipEnd(db, org.id, actor, { now }) : await repo.setRelationshipEnd(db, org.id, read.body.ended_on, actor, { now });
      return res.ok ? json({ ok: true, endedOn: res.endedOn || null }) : fromFailure(res);
    }
    if (r.kind === "delete") {
      const org = await getOrganizationById(db, r.org);
      if (!org) return err(404, "not_found", "No such organization.");
      const read = await readJson(request, ["confirm"]);
      if (read.response) return read.response;
      if (read.body.confirm !== "DELETE") return err(422, "confirm_required", "Type DELETE to confirm.");
      const res = await eraseAssessment({ db, bucket: env.PORTAL_FILES, backup: env.PORTAL_FILES_BACKUP }, { organizationId: org.id, assessmentId: r.id, actor, now });
      return res.ok ? json({ ok: true, files: res.files }) : fromFailure(res);
    }
    if (r.kind === "file") {
      const org = await getOrganizationById(db, r.org);
      if (!org) return err(404, "not_found", "No such organization.");
      const out = await adminDownloadInspiration(store, { organizationId: org.id, assessmentId: r.id, uploadId: r.file });
      return out.ok ? out.response : fromFailure(out);
    }
    if (r.kind === "media") { const out = await referenceResponse(store, { contentId: r.target }); return out.ok ? out.response : fromFailure(out); }

    // ---- content
    if (r.kind === "content") {
      const kind = request.method === "GET" ? new URL(request.url).searchParams.get("kind") || "brand" : null;
      if (request.method === "GET") {
        if (!KINDS[kind]) return err(422, "invalid_kind", "Unknown assessment type.");
        const content = await repo.listContent(db, kind);
        return json({ available: content.available, capabilities: caps, kind, kinds, questions: content.available ? editorView(kind, content.rows) : [] });
      }
      const read = await readJson(request, ["kind", "item", "option", "label", "description", "enabled", "add", "move", "reset"]);
      if (read.response) return read.response;
      const b = read.body;
      const def = KINDS[b.kind];
      if (!def) return err(422, "invalid_kind", "The change was not made.");
      const base = def.questions.find((q) => q.key === b.item);
      if (!base) return err(422, "invalid_item", "The change was not made.");
      const content = await repo.listContent(db, b.kind);
      if (!content.available) return err(409, "unavailable", "That isn’t available on this site yet (a database update has not been applied here).");
      const optionKey = b.option === undefined || b.option === null ? "" : b.option;
      const rowOf = (item, opt) => content.rows.find((x) => x.item_key === item && x.option_key === opt);
      if (b.add !== undefined) {
        const customs = content.rows.filter((x) => x.item_key === base.key && x.is_custom).length;
        if (customs >= MAX_CUSTOM || base.options.length + customs >= MAX_OPTIONS) return err(409, "too_many", "The change was not made.");
        if (!b.add || typeof b.add !== "object" || typeof b.add.label !== "string") return err(422, "invalid_label", "The change was not made.");
        const key = "x-" + randomToken(6).replace(/[^0-9a-f]/gi, "0").toLowerCase().padEnd(8, "0").slice(0, 8);
        const res = await repo.upsertContent(db, { kind: b.kind, itemKey: base.key, optionKey: key, custom: true, patch: { label: b.add.label, description: b.add.description, sort_order: 9000 + customs } }, actor, { now });
        return res.ok ? json({ ok: true, key }, 201) : fromFailure(res);
      }
      const isBuiltin = optionKey === "" || base.options.some((o) => o.key === optionKey);
      const existing = rowOf(base.key, optionKey);
      const isCustom = Boolean(existing && existing.is_custom);
      if (!isBuiltin && !isCustom) return err(422, "invalid_option", "The change was not made.");
      if (b.reset === true) {
        if (!existing) return json({ ok: true });
        const res = await repo.deleteContent(db, existing.id, actor, { now });
        if (!res.ok) return fromFailure(res);
        if (res.imageKey) await adminClearImageObject(store, res.imageKey);
        return json({ ok: true });
      }
      if (b.move !== undefined) {
        if (b.move !== "up" && b.move !== "down") return err(422, "invalid_sort_order", "The change was not made.");
        const eff = effectiveKind(b.kind, content.rows), q = eff.questions.find((x) => x.key === base.key);
        const order = q.options.map((o) => o.key), i = order.indexOf(optionKey), j = b.move === "up" ? i - 1 : i + 1;
        if (i < 0) return err(422, "invalid_option", "The change was not made.");
        if (j >= 0 && j < order.length) {
          [order[i], order[j]] = [order[j], order[i]];
          for (const [n, key] of order.entries()) {
            const row = rowOf(base.key, key);
            const res = await repo.upsertContent(db, { kind: b.kind, itemKey: base.key, optionKey: key, custom: Boolean(row && row.is_custom), patch: { sort_order: (n + 1) * 10 } }, actor, { now });
            if (!res.ok) return fromFailure(res);
          }
        }
        return json({ ok: true });
      }
      const patch = {};
      for (const k of ["label", "description", "enabled"]) if (b[k] !== undefined) patch[k] = b[k];
      const res = await repo.upsertContent(db, { kind: b.kind, itemKey: base.key, optionKey, custom: isCustom, patch }, actor, { now });
      return res.ok ? json({ ok: true }) : fromFailure(res);
    }
    if (r.kind === "image_set") {
      const read = await readUpload(request, { withMeta: true, max: MAX_UPLOAD });
      if (read.response) return read.response;
      const m = read.meta || {};
      const def = KINDS[m.kind], base = def && def.questions.find((q) => q.key === m.item);
      const optionKey = typeof m.option === "string" ? m.option : "";
      if (!base || !optionKey) return err(422, "invalid_item", "The change was not made.");
      const content = await repo.listContent(db, m.kind);
      if (!content.available) return err(409, "unavailable", "That isn’t available on this site yet (a database update has not been applied here).");
      const row = content.rows.find((x) => x.item_key === base.key && x.option_key === optionKey);
      if (!(base.options.some((o) => o.key === optionKey) || (row && row.is_custom))) return err(422, "invalid_option", "The change was not made.");
      const ensured = await repo.ensureContentRow(db, { kind: m.kind, itemKey: base.key, optionKey }, actor, { now });
      const res = await adminSetReference(store, { contentId: ensured.id, file: read.file, alt: m.alt, actor });
      return res.ok ? json({ ok: true, id: ensured.id }, 201) : (res.error === "invalid_name" ? err(422, "invalid_name", "The change was not made.") : fromFailure(res));
    }
    if (r.kind === "image_clear") { const res = await adminClearReference(store, { contentId: r.target, actor }); return res.ok ? json({ ok: true }) : fromFailure(res); }
    return null;
  } catch (e) {
    if (repo.isMissing(e)) return err(409, "unavailable", "That isn’t available on this site yet (a database update has not been applied here).");
    console.error("admin discovery api error:", e && e.name); // never the message
    return err(500, "server_error", "Something went wrong. Nothing was changed.");
  }
}

async function adminClearImageObject(store, key) {
  const { deleteObject } = await import("./files/index.js");
  const { CATALOGUE_ORG } = await import("./service-media-files.js");
  try { await deleteObject(store.bucket, { key, organizationId: CATALOGUE_ORG }); } catch { /* an unreferenced object: the storage check lists it */ }
}
