/**
 * The Additional Services catalogue (migration 0012, table portal_services): the optional services listed on the client's Website page. Global (it belongs to Framework, not to a client),
 * so these queries carry `cross-tenant:` comments. Admin edits the name, short description, whether it is shown, and the order; the four service KEYS are fixed (they are what a request and
 * a price are stored under). A database without the table shows the built-in defaults to clients (read-only for Admin), so the section works before the migration is applied.
 */
import { isoTime, ok, fail, validActor } from "./common.js";
import { validateName, validateText } from "./validate.js";

/**
 * Each service's standard sales content: what it is, the problem it solves, what the client gets and why they might need it. Plain, specific and checkable; no promise about results.
 * Admin can replace any of it (migration 0016); a field left empty falls back to the wording here, so the catalogue reads well before anything is edited.
 */
export const SERVICE_DEFAULTS = Object.freeze([
  { key: "client-admin-portal", name: "Client Admin Portal", description: "A secure, branded workspace where you manage your customers, projects and records in one place.", sortOrder: 10,
    problem: "Customer details, jobs and paperwork tend to end up spread across spreadsheets, inboxes and notebooks, which makes simple questions slow to answer.",
    benefits: ["One secure, branded place for your customer and project records", "Find what you need without digging through email threads", "Built around how your business actually works, not a generic template", "Access for the people on your team who need it"],
    why: "Worth a look if you keep records in several places, or spend time rebuilding the same information.", ctaLabel: "Ask about a Client Admin Portal" },
  { key: "invoice-sender", name: "Invoice Sender", description: "Create and send professional invoices to your customers, and see which have been paid.", sortOrder: 20,
    problem: "Invoicing from a document template takes time, and it is easy to lose track of which invoices are still open.",
    benefits: ["Consistent, professional invoices with your branding", "Send them straight to your customers", "See at a glance which are paid and which are outstanding", "Keep your invoice history in one place"],
    why: "A good fit if you invoice regularly and want less admin and fewer follow-ups.", ctaLabel: "Ask about Invoice Sender" },
  { key: "digital-business-cards", name: "Digital Business Cards", description: "A shareable digital card with your details and links, always up to date.", sortOrder: 30,
    problem: "Printed cards go out of date, get lost, and cannot link to your website or booking page.",
    benefits: ["Share your details and links with a tap or a link", "Update once and everyone sees the latest", "Add your website, social profiles and booking links", "Matches your brand"],
    why: "Useful if you meet customers in person or at events and want them to find you online afterwards.", ctaLabel: "Ask about Digital Business Cards" },
  { key: "seo-visibility", name: "SEO & Visibility", description: "Help the right customers find your business in search, with a plan to improve how you show up online.", sortOrder: 40,
    problem: "A good website still has to be found. If it is not set up for search, people looking for what you do may never see it.",
    benefits: ["A clear picture of how your site shows up in search today", "A practical plan for what to improve, in priority order", "Regular reporting on your search visibility", "Fixes for the technical basics search engines look for"],
    why: "Worth considering if you have a website and want more of your customers to find it by searching.", ctaLabel: "Ask about SEO & Visibility" },
  // Exactly what was supplied for it: no problem or "why" text, no price, no integration. Admin adds the rest (description, benefits, pictures, demo link) in the editor.
  { key: "nexus-fleet-tracker", name: "Nexus Fleet Tracker", description: "Manage vehicles, monitor maintenance and organize fleet operations from one dashboard.", sortOrder: 50,
    tagline: "Take control of your fleet.", category: "Fleet Management Software",
    benefits: ["Vehicle life expectancy", "Odometer tracking", "Oil change reminders", "Damage reporting", "Maintenance requests", "Service scheduling"],
    problem: null, why: null, ctaLabel: "Ask about Nexus Fleet Tracker" },
].map((d) => Object.freeze({ ...d, benefits: Object.freeze(d.benefits) })));
export const SERVICE_KEYS = Object.freeze(SERVICE_DEFAULTS.map((s) => s.key));
/** The service_requests key an Additional Service is requested under. */
export const requestKeyOfService = (key) => `svc-${key}`;
export const serviceKeyOfRequest = (requestKey) => (typeof requestKey === "string" && requestKey.startsWith("svc-") && SERVICE_KEYS.includes(requestKey.slice(4)) ? requestKey.slice(4) : null);

const DEFAULT_OF = new Map(SERVICE_DEFAULTS.map((d) => [d.key, d]));
const parseBenefits = (raw) => { try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).slice(0, MAX_BENEFITS) : null; } catch { return null; } };
/** The sales content of a service: what Admin stored (migration 0016, columns present only once it is applied), else the standard wording. */
const contentOf = (r, d) => ({
  tagline: r.tagline || d.tagline || null, category: r.category || d.category || null, problem: r.problem || d.problem, why: r.why || d.why, ctaLabel: r.cta_label || d.ctaLabel,
  benefits: (r.benefits_json && parseBenefits(r.benefits_json)) || [...d.benefits], featured: r.featured === 1, demoUrl: r.demo_url || null, demoLabel: r.demo_label || null,
  custom: { category: Boolean(r.category), tagline: Boolean(r.tagline), problem: Boolean(r.problem), why: Boolean(r.why), ctaLabel: Boolean(r.cta_label), benefits: Boolean(r.benefits_json) },
});
const row = (r) => ({ key: r.service_key, name: r.name, description: r.description, enabled: r.enabled === 1, sortOrder: r.sort_order, updatedBy: r.updated_by, updatedAt: r.updated_at, stored: true, ...contentOf(r, DEFAULT_OF.get(r.service_key) || { benefits: [] }) });
const defaults = () => SERVICE_DEFAULTS.map((d) => ({ ...d, tagline: d.tagline || null, category: d.category || null, benefits: [...d.benefits], featured: false, demoUrl: null, demoLabel: null, custom: { category: false, tagline: false, problem: false, why: false, ctaLabel: false, benefits: false }, enabled: true, updatedBy: null, updatedAt: null, stored: false }));

/** Every catalogue entry (hidden ones too) for Admin, in order. `available` is false (and the defaults are returned) without the migration. */
export async function listServicesAdmin(db) {
  try {
    const rows = (await db.prepare("SELECT * FROM portal_services ORDER BY sort_order, service_key /* cross-tenant: the service catalogue is global */").all()).results;
    return { available: true, services: rows.filter((r) => SERVICE_KEYS.includes(r.service_key)).map(row) };
  } catch { return { available: false, services: defaults() }; }
}

/** What a client sees: only the shown services, in order. The built-in defaults when the table is missing; an empty list when Admin has hidden every service. */
export async function listClientServices(db) {
  const l = await listServicesAdmin(db);
  return l.services.filter((s) => s.enabled).map(({ key, name, description, sortOrder, category, tagline, problem, why, benefits, ctaLabel, featured, demoUrl, demoLabel }) => ({ key, name, description, sortOrder, category, tagline, problem, why, benefits, ctaLabel, featured, demoUrl, demoLabel }));
}

/**
 * Move one service up or down one place. Every service is renumbered 10, 20, 30... in its new order (so equal or gapped numbers never make a move do nothing), and only the rows whose
 * number actually changed are written, each with an audit entry. Moving the first service up or the last one down changes nothing.
 */
export async function moveService(db, key, direction, actor, { now = new Date() } = {}) {
  if (!validActor(actor)) return fail("invalid_actor");
  if (typeof key !== "string" || !SERVICE_KEYS.includes(key)) return fail("invalid_service");
  if (direction !== "up" && direction !== "down") return fail("invalid_direction");
  const cur = await listServicesAdmin(db);
  if (!cur.available) return fail("unavailable");
  const order = cur.services.map((s) => s.key);
  const i = order.indexOf(key), j = direction === "up" ? i - 1 : i + 1;
  if (i < 0) return fail("invalid_service");
  if (j < 0 || j >= order.length) return ok({ unchanged: true });
  [order[i], order[j]] = [order[j], order[i]];
  const at = isoTime(now), by = actor.trim(), statements = [];
  order.forEach((k, idx) => {
    const old = cur.services.find((s) => s.key === k), next = (idx + 1) * 10;
    if (old.sortOrder === next) return;
    statements.push(
      db.prepare("UPDATE portal_services SET sort_order = ?, updated_by = ?, updated_at = ? WHERE service_key = ? /* cross-tenant: the service catalogue is global */").bind(next, by, at, k),
      db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, NULL, 'admin', ?, 'portal_service.updated', 'portal_service', NULL, ?, 'internal', ? WHERE changes() > 0")
        .bind(crypto.randomUUID(), by, JSON.stringify({ service: k, moved: direction }), at),
    );
  });
  if (statements.length) await db.batch(statements);
  return ok();
}

/** Change one service's text, visibility or order. All fields are validated first; nothing is written when any is invalid or nothing changed. */
export async function updateService(db, key, patch, actor, { now = new Date() } = {}) {
  if (!validActor(actor)) return fail("invalid_actor");
  if (typeof key !== "string" || !SERVICE_KEYS.includes(key)) return fail("invalid_service");
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return fail("invalid_input");
  const cur = (await listServicesAdmin(db));
  if (!cur.available) return fail("unavailable");
  const old = cur.services.find((s) => s.key === key);
  if (!old) return fail("invalid_service");
  const next = { name: old.name, description: old.description, enabled: old.enabled, sortOrder: old.sortOrder };
  if ("name" in patch) { const n = validateName(patch.name, 60); if (!n) return fail("invalid_name"); next.name = n; }
  if ("description" in patch) { const d = validateText(patch.description, 240); if (!d) return fail("invalid_description"); next.description = d; }
  if ("enabled" in patch) { if (typeof patch.enabled !== "boolean") return fail("invalid_enabled"); next.enabled = patch.enabled; }
  if ("sort_order" in patch) { const n = patch.sort_order; if (!Number.isInteger(n) || n < 0 || n > 9999) return fail("invalid_sort_order"); next.sortOrder = n; }
  if (next.name === old.name && next.description === old.description && next.enabled === old.enabled && next.sortOrder === old.sortOrder) return ok({ unchanged: true });
  const at = isoTime(now), by = actor.trim();
  await db.batch([
    db.prepare("UPDATE portal_services SET name = ?, description = ?, enabled = ?, sort_order = ?, updated_by = ?, updated_at = ? WHERE service_key = ? /* cross-tenant: the service catalogue is global */").bind(next.name, next.description, next.enabled ? 1 : 0, next.sortOrder, by, at, key),
    db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, NULL, 'admin', ?, 'portal_service.updated', 'portal_service', NULL, ?, 'internal', ? WHERE changes() > 0")
      .bind(crypto.randomUUID(), by, JSON.stringify({ service: key, enabled: next.enabled }), at),
  ]);
  return ok();
}

export const MAX_BENEFITS = 8;
const CONTENT_KEYS = ["category", "tagline", "problem", "why", "benefits", "cta_label", "featured", "demo_url", "demo_label"];
export const SERVICE_CONTENT_KEYS = Object.freeze(CONTENT_KEYS);

/** A one-line text, trimmed; "" or null mean "use the standard wording" (stored as NULL). null = invalid. */
function line(raw, max) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\s+/g, " ").trim();
  if (t === "") return undefined;
  return [...t].length <= max && !/[\u0000-\u001F\u007F]/.test(t) ? t : null;
}
const httpsLink = (raw) => { if (raw === undefined || raw === null || raw === "") return undefined; if (typeof raw !== "string" || raw.length > 300 || /[\s<>"'\\]/.test(raw)) return null; try { const u = new URL(raw); return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".") ? u.toString() : null; } catch { return null; } };

/**
 * Change one service's sales content (tagline, problem, why, benefits, button text, featured, demo link). Every field is validated first; an empty text returns that field to the standard
 * wording; nothing is written when any is invalid or nothing changed. Needs migration 0016: without it, answers "content_unavailable" and writes nothing.
 */
export async function updateServiceContent(db, key, patch, actor, { now = new Date() } = {}) {
  if (!validActor(actor)) return fail("invalid_actor");
  if (typeof key !== "string" || !SERVICE_KEYS.includes(key)) return fail("invalid_service");
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some((k) => !CONTENT_KEYS.includes(k))) return fail("invalid_input");
  const cur = await listServicesAdmin(db);
  if (!cur.available) return fail("unavailable");
  const old = cur.services.find((s) => s.key === key);
  if (!old) return fail("invalid_service");
  const v = {};
  const text = (k, max, err) => { if (!(k in patch)) return true; const t = line(patch[k], max); if (t === null) return err; v[k] = t === undefined ? null : t; return true; };
  for (const [k, max, err] of [["category", 60, "invalid_category"], ["tagline", 160, "invalid_tagline"], ["problem", 400, "invalid_problem"], ["why", 400, "invalid_why"], ["cta_label", 40, "invalid_cta"], ["demo_label", 60, "invalid_demo_label"]]) { const r = text(k, max, err); if (r !== true) return fail(r); }
  if ("benefits" in patch) {
    const b = patch.benefits;
    if (b === null || (Array.isArray(b) && b.every((x) => typeof x === "string" && x.trim() === ""))) v.benefits_json = null;
    else if (!Array.isArray(b) || b.length > MAX_BENEFITS) return fail("invalid_benefits");
    else { const items = []; for (const x of b) { const t = line(x, 120); if (t === null) return fail("invalid_benefits"); if (t) items.push(t); } v.benefits_json = items.length ? JSON.stringify(items) : null; }
  }
  if ("featured" in patch) { if (typeof patch.featured !== "boolean") return fail("invalid_featured"); v.featured = patch.featured ? 1 : 0; }
  if ("demo_url" in patch) { const u = httpsLink(patch.demo_url); if (u === null) return fail("invalid_demo_url"); v.demo_url = u === undefined ? null : u; }
  const keys = Object.keys(v);
  if (!keys.length) return fail("invalid_input");
  const at = isoTime(now), by = actor.trim();
  const sets = [...keys.map((k) => `${k} = ?`), "updated_by = ?", "updated_at = ?"]; // keys are a validated, fixed list; every value is bound
  try {
    await db.batch([
      db.prepare(`UPDATE portal_services SET ${sets.join(", ")} WHERE service_key = ? /* cross-tenant: the service catalogue is global */`).bind(...keys.map((k) => v[k]), by, at, key),
      db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, NULL, 'admin', ?, 'portal_service.updated', 'portal_service', NULL, ?, 'internal', ? WHERE changes() > 0")
        .bind(crypto.randomUUID(), by, JSON.stringify({ service: key, content: keys }), at),
    ]);
  } catch (err) {
    if (/no such column/i.test(String(err && err.message))) return fail("content_unavailable");
    throw err;
  }
  return ok();
}
