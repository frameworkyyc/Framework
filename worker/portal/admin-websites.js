/**
 * Framework Admin: Websites API. Behind Cloudflare Access and ADMIN_EMAILS like every Admin route (the router authenticates first); writes also need PORTAL_ADMIN_WRITES and a
 * same-origin request with the X-Framework-Admin header. Framework staff keep each client's websites here (several per client): the address, where it stands (existing, in
 * development or live), whether Framework manages it (a separate yes/no), launch date, domain and hosting facts (information only, never credentials), notes and an optional
 * screenshot. Clients never reach any of this; the client-facing Website section is a later phase and stays switched off.
 *
 *   GET  /clients/:org/websites                       every website of one organization (archived ones too), capabilities and limits; never storage keys
 *   POST /clients/:org/websites                       { name, url?, origin, status, managed_by_framework?, launch_date?, domain_*?, hosting_*?, management_notes?, published? }
 *   POST /clients/:org/websites/:id/update            { ...any of those fields }
 *   POST /clients/:org/websites/:id/archive | restore hide or bring back a website (nothing is deleted)
 *   (create and update also take `phase`: "awaiting_feedback" | "awaiting_approval" (in development) | "maintenance" (live) | null; needs migration 0015)
 *   POST /clients/:org/websites/:id/milestones                       { title, detail?, status?, due_date? }   add a milestone (the progress bar of a website in development is computed from these)
 *   POST /clients/:org/websites/:id/milestones/:mid/update | delete | move   { ...fields } | {} | { direction: "up"|"down" }
 *   POST /clients/:org/websites/:id/screenshot        multipart: file (png, jpg or webp, up to 5 MB)   set or replace the screenshot
 *   POST /clients/:org/websites/:id/screenshot/remove removes the screenshot (the stored image is deleted at once)
 *   GET  /clients/:org/websites/:id/preview-check     what the portal's live-preview check sees for this website, from the Worker (verdict, redirect chain, framing headers; never cached)
 *   GET  /clients/:org/websites/:id/screenshot        the screenshot as an inline picture
 * "No website" is not stored: a client with no rows simply has none. A database without migration 0011 answers { available: false }: nothing else runs.
 */
import { getOrganizationById } from "./repo/orgs.js";
import { UUID } from "./repo/common.js";
import * as sites from "./repo/websites.js";
import * as wfiles from "./website-files.js";
import * as packages from "./repo/website-packages.js";
import * as miles from "./repo/website-milestones.js";
import { milestoneProgress, stageOf, PHASES } from "./website-stage.js";
import { diagnoseEmbeddable } from "./website-preview.js";
import { json, err, sameOriginWrite, readJson, readUpload } from "./admin-branding.js";

const MAX_UPLOAD = wfiles.SCREENSHOT_MAX_BYTES + 256 * 1024;
const MAX_PACKAGE_UPLOAD = wfiles.PACKAGE_MAX_BYTES + 256 * 1024;
const STATUS = {
  not_found: 404, conflict: 409, too_many: 409,
  invalid_phase: 422, phase_unavailable: 409, unavailable: 409, invalid_title: 422, invalid_detail: 422, invalid_direction: 422, invalid_input: 422, invalid_name: 422, invalid_url: 422, invalid_origin: 422, invalid_status: 422, invalid_managed_by_framework: 422, invalid_published: 422, invalid_date: 422, invalid_party: 422, invalid_text: 422, invalid_sort_order: 422, invalid_combination: 422,
  archive_encrypted: 422, archive_unsupported: 422, archive_unsafe_entry: 422, archive_entries: 422, archive_too_large: 422, invalid_published: 422,
  type_not_allowed: 415, invalid_name_file: 422, content_mismatch: 422, active_content: 422, image_dimensions: 422, empty_file: 422, no_file: 400, file_too_large: 413,
  storage_unavailable: 503, storage_write_failed: 502, storage_read_failed: 502, storage_delete_failed: 502,
};
const fromFailure = (r) => (STATUS[r.error] ? err(STATUS[r.error], r.error === "invalid_name" && r.file ? "invalid_name" : r.error, "The change was not made.") : err(500, "server_error", "Something went wrong. Nothing was changed."));

async function phaseColumnExists(db) {
  try { await db.prepare("SELECT phase FROM websites LIMIT 1").first(); return true; } catch { return false; }
}

async function view(env, org) {
  const db = env.PORTAL_DB;
  const pkgs = await packages.listPackagesAdmin(db, org.id);
  return {
    available: true,
    organization: { id: org.id, name: org.name, slug: org.slug },
    capabilities: { writes: env.PORTAL_ADMIN_WRITES === "1", storage: Boolean(env.PORTAL_FILES) },
    limits: { maxWebsites: sites.MAX_WEBSITES, screenshotMaxBytes: wfiles.SCREENSHOT_MAX_BYTES, packageMaxBytes: wfiles.PACKAGE_MAX_BYTES },
    websites: await Promise.all((await sites.listWebsitesAdmin(db, org.id)).map(async (w) => {
      const milestones = await miles.listMilestonesAdmin(db, org.id, w.id);
      return { ...w, package: pkgs.get(w.id) || null, stage: stageOf(w).key, milestones, progress: milestoneProgress(w, milestones) };
    })),
    phases: PHASES,
    phaseAvailable: await phaseColumnExists(db),
    packagesAvailable: await packages.packagesAvailable(db),
  };
}

export async function handleWebsitesApi(request, env, principal, path, deps = {}) {
  const seg = path.split("/").filter(Boolean);
  if (!(seg[0] === "clients" && seg[2] === "websites")) return null;
  const org = seg[1], rest = seg.slice(3);
  let route = null;
  if (rest.length === 0) route = request.method === "GET" ? { kind: "view", method: "GET" } : { kind: "create", method: "POST" };
  else if (rest.length === 2 && ["update", "archive", "restore"].includes(rest[1])) route = { kind: rest[1], method: "POST", target: rest[0] };
  else if (rest.length === 2 && rest[1] === "screenshot") route = request.method === "GET" ? { kind: "screenshot_view", method: "GET", target: rest[0] } : { kind: "screenshot_set", method: "POST", target: rest[0] };
  else if (rest.length === 2 && rest[1] === "package") route = { kind: "package_set", method: "POST", target: rest[0] };
  else if (rest.length === 3 && rest[1] === "package" && ["publish", "remove"].includes(rest[2])) route = { kind: "package_" + rest[2], method: "POST", target: rest[0] };
  else if (rest.length === 2 && rest[1] === "milestones") route = { kind: "milestone_create", method: "POST", target: rest[0] };
  else if (rest.length === 4 && rest[1] === "milestones" && ["update", "delete", "move"].includes(rest[3])) route = { kind: "milestone_" + rest[3], method: "POST", target: rest[0], sub: rest[2] };
  else if (rest.length === 2 && rest[1] === "preview-check") route = { kind: "preview_check", method: "GET", target: rest[0] };
  else if (rest.length === 3 && rest[1] === "screenshot" && rest[2] === "remove") route = { kind: "screenshot_remove", method: "POST", target: rest[0] };
  if (!route) return null;
  if (request.method !== route.method) return json({ error: "method_not_allowed", message: "That method is not allowed here." }, 405, { Allow: route.method });
  if (!UUID.test(org)) return err(404, "not_found", "No such organization.");
  if (route.target !== undefined && !UUID.test(route.target)) return err(404, "not_found", "Not found.");
  if (route.sub !== undefined && !UUID.test(route.sub)) return err(404, "not_found", "Not found.");
  if (route.method !== "GET") {
    if (env.PORTAL_ADMIN_WRITES !== "1") return err(403, "writes_disabled", "Changes are not enabled on this deployment.");
    if (!sameOriginWrite(request)) return err(403, "forbidden", "This request was not accepted.");
  }
  if (!env.PORTAL_DB) return err(503, "portal_unavailable", "The portal database is not available.");
  const now = deps.now || new Date();
  const actor = principal && principal.email;
  try {
    const db = env.PORTAL_DB;
    if (!(await sites.websitesAvailable(db))) return json({ available: false });
    const orgRow = await getOrganizationById(db, org);
    if (!orgRow) return err(404, "not_found", "No such organization.");
    const svc = { db, bucket: env.PORTAL_FILES, env, now };
    if (route.kind.startsWith("screenshot") && !env.PORTAL_FILES) return err(503, "storage_unavailable", "File storage is not available on this deployment.");

    if (route.kind === "view") return json(await view(env, orgRow));
    if (route.kind === "create") {
      const read = await readJson(request, [...sites.WEBSITE_FIELDS, "phase"]);
      if (read.response) return read.response;
      const { phase, ...fields } = read.body;
      if (phase !== undefined && phase !== null && !PHASES.includes(phase)) return err(422, "invalid_phase", "The change was not made.");
      const r = await sites.createWebsite(db, orgRow.id, fields, actor, { now });
      if (!r.ok) return fromFailure(r);
      if (phase) { const p = await sites.setWebsitePhase(db, orgRow.id, r.id, phase, actor, { now }); if (!p.ok) return json({ ok: true, id: r.id, phaseSaved: false, phaseError: p.error }, 201); }
      return json({ ok: true, id: r.id }, 201);
    }
    if (route.kind === "update") {
      const read = await readJson(request, [...sites.WEBSITE_FIELDS, "phase"]);
      if (read.response) return read.response;
      const { phase, ...fields } = read.body;
      if (phase !== undefined && phase !== null && !PHASES.includes(phase)) return err(422, "invalid_phase", "The change was not made.");
      if (Object.keys(fields).length || phase === undefined) { const r = await sites.updateWebsite(db, orgRow.id, route.target, fields, actor, { now }); if (!r.ok) return fromFailure(r); }
      // A status change keeps a phase that still fits (an explicit `phase` wins) and clears one that no longer does, so a launched website never stays "Awaiting approval".
      if (phase !== undefined) { const p = await sites.setWebsitePhase(db, orgRow.id, route.target, phase, actor, { now }); if (!p.ok) return fromFailure(p); }
      else if ("status" in fields) await sites.setWebsitePhase(db, orgRow.id, route.target, null, actor, { now, onlyIfInvalid: true }).catch(() => {});
      return json({ ok: true });
    }
    if (route.kind === "archive" || route.kind === "restore") {
      const r = await sites.setWebsiteArchived(db, orgRow.id, route.target, route.kind === "archive", actor, { now });
      return r.ok ? json({ ok: true, changed: !r.unchanged }) : fromFailure(r);
    }
    if (route.kind === "milestone_create") {
      const read = await readJson(request, ["title", "detail", "status", "due_date"]);
      if (read.response) return read.response;
      const r = await miles.createMilestone(db, orgRow.id, route.target, read.body, actor, { now });
      return r.ok ? json({ ok: true, id: r.id }, 201) : fromFailure(r);
    }
    if (route.kind === "milestone_update") {
      const read = await readJson(request, ["title", "detail", "status", "due_date"]);
      if (read.response) return read.response;
      const r = await miles.updateMilestone(db, orgRow.id, route.target, route.sub, read.body, actor, { now });
      return r.ok ? json({ ok: true }) : fromFailure(r);
    }
    if (route.kind === "milestone_delete") {
      const r = await miles.deleteMilestone(db, orgRow.id, route.target, route.sub, actor, { now });
      return r.ok ? json({ ok: true }) : fromFailure(r);
    }
    if (route.kind === "milestone_move") {
      const read = await readJson(request, ["direction"]);
      if (read.response) return read.response;
      const r = await miles.moveMilestone(db, orgRow.id, route.target, route.sub, read.body.direction, actor, { now });
      return r.ok ? json({ ok: true, changed: !r.unchanged }) : fromFailure(r);
    }
    if (route.kind === "screenshot_set") {
      const read = await readUpload(request, { withMeta: false, max: MAX_UPLOAD });
      if (read.response) return read.response;
      const r = await wfiles.adminSetScreenshot(svc, { organizationId: orgRow.id, websiteId: route.target, actor, file: read.file });
      return r.ok ? json({ ok: true, name: r.name }) : (r.error === "invalid_name" ? err(422, "invalid_name_file", "The change was not made.") : fromFailure(r));
    }
    if (route.kind === "screenshot_remove") {
      const r = await wfiles.adminRemoveScreenshot(svc, { organizationId: orgRow.id, websiteId: route.target, actor });
      return r.ok ? json({ ok: true }) : fromFailure(r);
    }
    if (route.kind === "preview_check") {
      // What the portal's live-preview check sees FROM THE WORKER for this website (never cached): the verdict, the redirect chain and the framing headers only.
      const site = await sites.getWebsiteAdmin(db, orgRow.id, route.target);
      if (!site || !site.url) return err(404, "not_found", "That website has no web address to check.");
      let portalOrigin = null;
      try { portalOrigin = new URL(env.PORTAL_BASE_URL).origin; } catch { /* not configured */ }
      const r = await diagnoseEmbeddable(site.url, { fetch: deps.previewFetch || (deps.fetch ? null : fetch), portalOrigin });
      return json({ embeddable: r.embeddable, reason: r.reason, status: r.status, hops: r.hops || [], error: r.error || null, xFrameOptions: r.summary ? r.summary.xFrameOptions : null, frameAncestors: r.summary ? r.summary.frameAncestors : [], contentType: r.summary ? r.summary.contentType : null });
    }
    if (route.kind.startsWith("package") && !(await packages.packagesAvailable(db))) return err(409, "unavailable", "Website downloads aren’t available on this deployment yet. Nothing was changed.");
    if (route.kind.startsWith("package") && route.kind !== "package_publish" && !env.PORTAL_FILES) return err(503, "storage_unavailable", "File storage is not available on this deployment.");
    if (route.kind === "package_set") {
      const read = await readUpload(request, { withMeta: false, max: MAX_PACKAGE_UPLOAD });
      if (read.response) return read.response;
      const r = await wfiles.adminSetPackage(svc, { organizationId: orgRow.id, websiteId: route.target, actor, file: read.file });
      return r.ok ? json({ ok: true, name: r.name }) : (r.error === "invalid_name" ? err(422, "invalid_name_file", "The change was not made.") : fromFailure(r));
    }
    if (route.kind === "package_publish") {
      const read = await readJson(request, ["published"]);
      if (read.response) return read.response;
      if (typeof read.body.published !== "boolean") return err(422, "invalid_published", "The change was not made.");
      const r = await packages.setPackagePublished(db, orgRow.id, route.target, read.body.published, actor, { now });
      return r.ok ? json({ ok: true, changed: !r.unchanged }) : fromFailure(r);
    }
    if (route.kind === "package_remove") {
      const r = await wfiles.adminRemovePackage(svc, { organizationId: orgRow.id, websiteId: route.target, actor });
      return r.ok ? json({ ok: true }) : fromFailure(r);
    }
    if (route.kind === "screenshot_view") {
      const r = await wfiles.adminScreenshotResponse(svc, { organizationId: orgRow.id, websiteId: route.target });
      return r.ok ? r.response : fromFailure(r);
    }
    return null;
  } catch (e) {
    console.error("admin websites api error:", e && e.name); // never the message
    return err(500, "server_error", "Something went wrong. Nothing was changed.");
  }
}
