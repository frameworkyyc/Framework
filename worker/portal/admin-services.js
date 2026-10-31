/**
 * Framework Admin: the Additional Services catalogue (Admin -> Settings -> Additional Services), the optional services listed on every client's Website page, and what Admin knows about each
 * client's own situation. Behind Cloudflare Access and ADMIN_EMAILS; writes also need PORTAL_ADMIN_WRITES and a same-origin request with the X-Framework-Admin header. Prices are NOT here: they
 * are set in Service Pricing.
 *
 *   GET  /additional-services   { available, contentAvailable, mediaAvailable, services: [{key, name, description, enabled, sortOrder, tagline, problem, why, benefits, ctaLabel, featured, demoUrl, demoLabel, custom, price, media: [...]}], capabilities }
 *   POST /additional-services   { key, name?, description?, enabled?, sort_order? }                                  change one service's basics
 *   POST /additional-services   { key, tagline?, problem?, why?, benefits?: string[], cta_label?, featured?, demo_url?, demo_label? }   its sales content (empty = the standard wording; needs migration 0016)
 *   POST /additional-services   { key, move: "up" | "down" }                                                         move one service one place
 *   POST /additional-services/media                  multipart: file (png, jpg or webp, 5 MB) + meta { service_key, alt, caption? }    add a picture
 *   POST /additional-services/media/:id/update | delete | move                                                       { alt?, caption? } | {} | { direction }
 *   GET  /additional-services/media/:id              the picture, inline
 *   GET  /clients/:org/additional-services           this client's state per service: { services: [{key, name, state: null|"owned"|"hidden", note}] }
 *   POST /clients/:org/additional-services           { key, state: "automatic"|"owned"|"hidden", note? }     owned = they already have it (not promoted); hidden = do not show it to them
 */
import { UUID } from "./repo/common.js";
import { getOrganizationById } from "./repo/orgs.js";
import { listServicesAdmin, updateService, updateServiceContent, moveService, SERVICE_CONTENT_KEYS, SERVICE_KEYS } from "./repo/portal-services.js";
import { listServiceMedia, updateServiceMedia, moveServiceMedia, listClientServiceStates, setClientServiceState, SERVICE_STATES } from "./repo/service-catalogue-state.js";
import { adminAddMedia, adminDeleteMedia, mediaResponse, MEDIA_MAX_BYTES } from "./service-media-files.js";
import { listPrices } from "./repo/prices.js";
import { priceLabel } from "./branding-pricing.js";
import { json, err, sameOriginWrite, readJson, readUpload } from "./admin-branding.js";

const STATUS = {
  invalid_service: 422, invalid_name: 422, invalid_description: 422, invalid_enabled: 422, invalid_sort_order: 422, invalid_direction: 422, invalid_input: 422,
  invalid_tagline: 422, invalid_problem: 422, invalid_why: 422, invalid_cta: 422, invalid_benefits: 422, invalid_featured: 422, invalid_demo_url: 422, invalid_demo_label: 422,
  invalid_alt: 422, invalid_caption: 422, invalid_state: 422, invalid_note: 422, invalid_actor: 422, not_found: 404, too_many: 409, unavailable: 409, content_unavailable: 409,
  type_not_allowed: 415, content_mismatch: 422, active_content: 422, image_dimensions: 422, empty_file: 422, no_file: 400, file_too_large: 413, invalid_name_file: 422,
  storage_unavailable: 503, storage_write_failed: 502, storage_read_failed: 502, storage_delete_failed: 502,
};
const fromFailure = (r) => (STATUS[r.error] ? json({ error: r.error, message: "The change was not made." }, STATUS[r.error]) : err(500, "server_error", "Something went wrong. Nothing was changed."));
const BASIC = ["name", "description", "enabled", "sort_order"];
const MAX_UPLOAD = MEDIA_MAX_BYTES + 256 * 1024;

async function contentColumnsExist(db) { try { await db.prepare("SELECT tagline FROM portal_services LIMIT 1").first(); return true; } catch { return false; } }

async function catalogue(env) {
  const db = env.PORTAL_DB;
  const list = await listServicesAdmin(db);
  const stored = new Map((await listPrices(db)).rows.map((r) => [r.service_key, r]));
  const media = await listServiceMedia(db);
  const priced = (key) => { const r = stored.get(key); if (!r || r.price_type === "included") return null; const label = priceLabel({ type: r.price_type, priceCad: r.price_cad }); return label ? { label, type: r.price_type, priceCad: r.price_cad } : null; };
  let mediaAvailable = true;
  try { await db.prepare("SELECT 1 FROM portal_service_media LIMIT 1").first(); } catch { mediaAvailable = false; }
  return { available: list.available, contentAvailable: list.available && (await contentColumnsExist(db)), mediaAvailable, services: list.services.map((s) => ({ ...s, price: priced(s.key), media: media.get(s.key) || [] })), capabilities: { writes: env.PORTAL_ADMIN_WRITES === "1", storage: Boolean(env.PORTAL_FILES) } };
}

export async function handleServicesApi(request, env, principal, path, deps = {}) {
  const seg = path.split("/").filter(Boolean);
  let route = null;
  if (seg.length === 1 && seg[0] === "additional-services") route = { kind: "catalogue", methods: ["GET", "POST"] };
  else if (seg.length === 2 && seg[0] === "additional-services" && seg[1] === "media") route = { kind: "media_add", methods: ["POST"] };
  else if (seg.length === 3 && seg[0] === "additional-services" && seg[1] === "media") route = { kind: "media_view", methods: ["GET"], target: seg[2] };
  else if (seg.length === 4 && seg[0] === "additional-services" && seg[1] === "media" && ["update", "delete", "move"].includes(seg[3])) route = { kind: "media_" + seg[3], methods: ["POST"], target: seg[2] };
  else if (seg.length === 3 && seg[0] === "clients" && seg[2] === "additional-services") route = { kind: "client_state", methods: ["GET", "POST"], org: seg[1] };
  if (!route) return null;
  if (!route.methods.includes(request.method)) return json({ error: "method_not_allowed", message: "That method is not allowed here." }, 405, { Allow: route.methods.join(", ") });
  if ((route.target !== undefined && !UUID.test(route.target)) || (route.org !== undefined && !UUID.test(route.org))) return err(404, "not_found", "Not found.");
  if (request.method === "POST") {
    if (env.PORTAL_ADMIN_WRITES !== "1") return err(403, "writes_disabled", "Changes are not enabled on this deployment.");
    if (!sameOriginWrite(request)) return err(403, "forbidden", "This request was not accepted.");
  }
  if (!env.PORTAL_DB) return err(503, "portal_unavailable", "The portal database is not available.");
  const db = env.PORTAL_DB, now = deps.now || new Date(), actor = principal && principal.email;
  try {
    if (route.kind === "catalogue") {
      if (request.method === "POST") {
        const read = await readJson(request, ["key", ...BASIC, ...SERVICE_CONTENT_KEYS, "move"]);
        if (read.response) return read.response;
        const { key, move, ...patch } = read.body;
        const basic = Object.fromEntries(Object.entries(patch).filter(([k]) => BASIC.includes(k)));
        const content = Object.fromEntries(Object.entries(patch).filter(([k]) => SERVICE_CONTENT_KEYS.includes(k)));
        if (move !== undefined) { const r = await moveService(db, key, move, actor, { now }); if (!r.ok) return fromFailure(r); }
        else {
          if (Object.keys(content).length) { const r = await updateServiceContent(db, key, content, actor, { now }); if (!r.ok) return fromFailure(r); }
          if (Object.keys(basic).length || !Object.keys(content).length) { const r = await updateService(db, key, basic, actor, { now }); if (!r.ok) return fromFailure(r); }
        }
      }
      return json(await catalogue(env));
    }
    if (route.kind === "client_state") {
      const org = await getOrganizationById(db, route.org);
      if (!org) return err(404, "not_found", "No such organization.");
      if (request.method === "POST") {
        const read = await readJson(request, ["key", "state", "note"]);
        if (read.response) return read.response;
        const { key, state, note } = read.body;
        if (state !== "automatic" && !SERVICE_STATES.includes(state)) return err(422, "invalid_state", "The change was not made.");
        const r = await setClientServiceState(db, org.id, key, state === "automatic" ? null : state, state === "automatic" ? null : note, actor, { now });
        if (!r.ok) return fromFailure(r);
      }
      const st = await listClientServiceStates(db, org.id);
      const list = await listServicesAdmin(db);
      return json({ available: st.available, organization: { id: org.id, name: org.name }, capabilities: { writes: env.PORTAL_ADMIN_WRITES === "1" }, services: list.services.map((s) => ({ key: s.key, name: s.name, state: st.items[s.key] ? st.items[s.key].state : null, note: st.items[s.key] ? st.items[s.key].note || "" : "" })) });
    }
    // pictures
    if (!env.PORTAL_FILES && route.kind !== "media_update" && route.kind !== "media_move") return err(503, "storage_unavailable", "File storage is not available on this deployment.");
    const svc = { db, bucket: env.PORTAL_FILES, env, now };
    if (route.kind === "media_add") {
      const read = await readUpload(request, { withMeta: true, max: MAX_UPLOAD });
      if (read.response) return read.response;
      if (typeof read.meta.service_key !== "string" || !SERVICE_KEYS.includes(read.meta.service_key)) return err(422, "invalid_service", "The change was not made.");
      const r = await adminAddMedia(svc, { serviceKey: read.meta.service_key, actor, file: read.file, meta: { alt: read.meta.alt, caption: read.meta.caption } });
      return r.ok ? json({ ok: true, id: r.id }, 201) : (r.error === "invalid_name" ? err(422, "invalid_name_file", "The change was not made.") : fromFailure(r));
    }
    if (route.kind === "media_view") { const r = await mediaResponse(svc, { id: route.target, clientOnly: false }); return r.ok ? r.response : fromFailure(r); }
    if (route.kind === "media_update") { const read = await readJson(request, ["alt", "caption"]); if (read.response) return read.response; const r = await updateServiceMedia(db, route.target, read.body, actor, { now }); return r.ok ? json({ ok: true }) : fromFailure(r); }
    if (route.kind === "media_move") { const read = await readJson(request, ["direction"]); if (read.response) return read.response; const r = await moveServiceMedia(db, route.target, read.body.direction, actor, { now }); return r.ok ? json({ ok: true, changed: !r.unchanged }) : fromFailure(r); }
    if (route.kind === "media_delete") { const r = await adminDeleteMedia(svc, { id: route.target, actor }); return r.ok ? json({ ok: true }) : fromFailure(r); }
    return null;
  } catch (e) {
    console.error("admin additional services api error:", e && e.name); // never the message
    return err(500, "server_error", "Something went wrong. Nothing was changed.");
  }
}
