/**
 * Framework — Cloudflare Worker
 *
 * Static pages are served by Workers static assets. This Worker only runs for /api/* (see
 * "run_worker_first" in wrangler.jsonc) and handles the private client feedback form:
 *
 *   POST /api/feedback          store one submission in D1
 *   GET  /api/feedback/export   CSV / JSON export, requires  Authorization: Bearer <FEEDBACK_EXPORT_TOKEN>
 *
 * Submissions live only in the D1 database bound as DB. Nothing is returned publicly.
 */

const MAX_BODY_BYTES = 24 * 1024;
const MAX_RECENT_SUBMISSIONS = 40; // flood guard: max stored submissions per 10 minutes, site-wide
const FORM_VERSION = "1";

/* ---- Allowed values (must match client-feedback.html) ---- */

const RATING_KEYS = [
  "visual_design",
  "ease_of_use",
  "mobile_experience",
  "accuracy",
  "professionalism",
  "communication",
  "overall_product",
];
const IMPROVEMENT = ["Significant improvement", "Moderate improvement", "Slight improvement", "About the same", "Worse"];
const IMPACT = [
  "Our business looks more professional",
  "Customers can find information more easily",
  "More inquiries or leads",
  "More bookings or sales",
  "Better customer feedback",
  "Greater confidence sharing our website",
  "Improved search visibility",
  "Too early to tell",
  "Other",
];
const FAIR_PRICE = ["Under $500", "$500–$999", "$1,000–$1,999", "$2,000–$2,999", "$3,000–$4,999", "$5,000+", "Unsure"];
const REVENUE = [
  "Under $100,000",
  "$100,000–$249,999",
  "$250,000–$499,999",
  "$500,000–$999,999",
  "$1M–$2.49M",
  "$2.5M–$4.99M",
  "$5M+",
  "Prefer not to answer",
];
const PERMISSION = [
  "Yes, with my name and business",
  "Yes, attributed to my business only",
  "Yes, anonymously",
  "No",
];
const LOGO = ["Yes", "No"];
const SERVICES = [
  "Website updates and maintenance",
  "SEO",
  "Google Business / search presence",
  "Branding",
  "Graphic design and content",
  "Social media/content",
  "Business strategy/consulting",
  "Ongoing website management",
  "Other",
  "None currently",
];

const TEXT_LIMITS = {
  impact_other: 300,
  liked: 1500,
  could_improve: 3000,
  testimonial: 3000,
  attribution_name: 120,
  attribution_title: 120,
  attribution_business: 160,
  services_other: 300,
  comments: 3000,
};

const COLUMNS = [
  "id",
  "created_at",
  "form_version",
  "satisfaction",
  ...RATING_KEYS.map((k) => "rating_" + k),
  "improvement",
  "impact",
  "impact_other",
  "fair_price",
  "recommend",
  "revenue",
  "liked",
  "could_improve",
  "testimonial",
  "testimonial_permission",
  "attribution_name",
  "attribution_title",
  "attribution_business",
  "logo_permission",
  "services",
  "services_other",
  "comments",
];

const SCHEMA = `CREATE TABLE IF NOT EXISTS feedback_responses (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  form_version TEXT NOT NULL,
  satisfaction INTEGER NOT NULL,
  rating_visual_design INTEGER NOT NULL,
  rating_ease_of_use INTEGER NOT NULL,
  rating_mobile_experience INTEGER NOT NULL,
  rating_accuracy INTEGER NOT NULL,
  rating_professionalism INTEGER NOT NULL,
  rating_communication INTEGER NOT NULL,
  rating_overall_product INTEGER NOT NULL,
  improvement TEXT NOT NULL,
  impact TEXT NOT NULL,
  impact_other TEXT,
  fair_price TEXT NOT NULL,
  recommend INTEGER NOT NULL,
  revenue TEXT,
  liked TEXT NOT NULL,
  could_improve TEXT,
  testimonial TEXT,
  testimonial_permission TEXT NOT NULL,
  attribution_name TEXT,
  attribution_title TEXT,
  attribution_business TEXT,
  logo_permission TEXT NOT NULL,
  services TEXT NOT NULL,
  services_other TEXT,
  comments TEXT
)`;

let schemaReady = null;
const ensureSchema = (db) => {
  if (!schemaReady) schemaReady = db.prepare(SCHEMA).run().catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
};

/* ---- Helpers ---- */

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...extra },
  });

const clean = (value, max) => {
  if (typeof value !== "string") return "";
  // strip control characters except newline / tab, normalise line endings, trim
  return value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
};

const intInRange = (value, min, max) => {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

const oneOf = (value, list) => (typeof value === "string" && list.includes(value) ? value : null);

const manyOf = (value, list) => {
  if (!Array.isArray(value)) return null;
  const picked = [...new Set(value)].filter((v) => typeof v === "string" && list.includes(v));
  return picked.length ? list.filter((v) => picked.includes(v)) : null; // keep canonical order
};

/** Validate and normalise a submission. Returns { ok, row } or { ok:false, errors }. */
export function validate(input) {
  const errors = [];
  const need = (cond, field) => { if (!cond) errors.push(field); };
  const body = input && typeof input === "object" ? input : {};

  const id = typeof body.id === "string" && /^[A-Za-z0-9-]{16,64}$/.test(body.id) ? body.id : null;
  need(id, "id");

  const satisfaction = intInRange(body.satisfaction, 1, 10);
  need(satisfaction !== null, "satisfaction");

  const ratings = {};
  for (const key of RATING_KEYS) {
    const v = intInRange(body.ratings && body.ratings[key], 1, 5);
    need(v !== null, "ratings." + key);
    ratings[key] = v;
  }

  const improvement = oneOf(body.improvement, IMPROVEMENT);
  need(improvement, "improvement");

  const impact = manyOf(body.impact, IMPACT);
  need(impact, "impact");
  const impactOther = clean(body.impact_other, TEXT_LIMITS.impact_other);
  need(!impact || !impact.includes("Other") || impactOther, "impact_other");

  const fairPrice = oneOf(body.fair_price, FAIR_PRICE);
  need(fairPrice, "fair_price");

  const recommend = intInRange(body.recommend, 0, 10);
  need(recommend !== null, "recommend");

  const revenue = body.revenue ? oneOf(body.revenue, REVENUE) : null; // optional
  if (body.revenue) need(revenue, "revenue");

  const liked = clean(body.liked, TEXT_LIMITS.liked);
  need(liked, "liked");
  const couldImprove = clean(body.could_improve, TEXT_LIMITS.could_improve);

  const testimonial = clean(body.testimonial, TEXT_LIMITS.testimonial);
  const permission = oneOf(body.testimonial_permission, PERMISSION);
  need(permission, "testimonial_permission");
  let attrName = "";
  let attrTitle = "";
  let attrBusiness = "";
  if (permission === PERMISSION[0]) {
    attrName = clean(body.attribution_name, TEXT_LIMITS.attribution_name);
    attrTitle = clean(body.attribution_title, TEXT_LIMITS.attribution_title);
    attrBusiness = clean(body.attribution_business, TEXT_LIMITS.attribution_business);
    need(attrName, "attribution_name");
    need(attrBusiness, "attribution_business");
  } else if (permission === PERMISSION[1]) {
    attrBusiness = clean(body.attribution_business, TEXT_LIMITS.attribution_business);
    need(attrBusiness, "attribution_business");
  }
  need(permission === PERMISSION[3] || !permission || testimonial, "testimonial");

  const logo = oneOf(body.logo_permission, LOGO);
  need(logo, "logo_permission");

  const services = manyOf(body.services, SERVICES);
  need(services, "services");
  const servicesOther = clean(body.services_other, TEXT_LIMITS.services_other);
  need(!services || !services.includes("Other") || servicesOther, "services_other");

  const comments = clean(body.comments, TEXT_LIMITS.comments);

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    row: {
      id,
      created_at: new Date().toISOString(),
      form_version: FORM_VERSION,
      satisfaction,
      ...Object.fromEntries(RATING_KEYS.map((k) => ["rating_" + k, ratings[k]])),
      improvement,
      impact: impact.join("; "),
      impact_other: impact.includes("Other") ? impactOther : null,
      fair_price: fairPrice,
      recommend,
      revenue,
      liked,
      could_improve: couldImprove || null,
      testimonial: testimonial || null,
      testimonial_permission: permission,
      attribution_name: attrName || null,
      attribution_title: attrTitle || null,
      attribution_business: attrBusiness || null,
      logo_permission: logo,
      services: services.join("; "),
      services_other: services.includes("Other") ? servicesOther : null,
      comments: comments || null,
    },
  };
}

const csvCell = (value) => {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // neutralise spreadsheet formula injection
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const timingSafeEqual = (a, b) => {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
};

/* ---- Handlers ---- */

async function handleSubmit(request, env) {
  if (!env.DB) return json({ error: "storage_not_configured" }, 503);

  // Same-origin only: browsers send Origin on cross-site POSTs.
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "forbidden" }, 403);

  if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) {
    return json({ error: "unsupported_media_type" }, 415);
  }
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_BODY_BYTES) return json({ error: "too_large" }, 413);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "too_large" }, 413);

  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "invalid_json" }, 400); }

  // Honeypot: real visitors never fill this. Pretend success so bots learn nothing.
  if (body && typeof body.website === "string" && body.website.trim() !== "") return json({ ok: true });

  const result = validate(body);
  if (!result.ok) return json({ error: "validation_failed", fields: result.errors }, 422);

  await ensureSchema(env.DB);

  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback_responses WHERE created_at > ?").bind(since).first();
  if (recent && recent.n >= MAX_RECENT_SUBMISSIONS) return json({ error: "try_again_later" }, 429, { "Retry-After": "600" });

  const row = result.row;
  const placeholders = COLUMNS.map(() => "?").join(", ");
  // INSERT OR IGNORE on the primary key makes a repeated submission (double click, retry) harmless.
  await env.DB.prepare(`INSERT OR IGNORE INTO feedback_responses (${COLUMNS.join(", ")}) VALUES (${placeholders})`)
    .bind(...COLUMNS.map((c) => row[c] ?? null))
    .run();

  return json({ ok: true });
}

async function handleExport(request, env) {
  const token = env.FEEDBACK_EXPORT_TOKEN;
  if (!token || !env.DB) return json({ error: "not_found" }, 404); // export disabled until configured
  const header = request.headers.get("Authorization") || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied || !timingSafeEqual(supplied, token)) {
    return json({ error: "unauthorized" }, 401, { "WWW-Authenticate": 'Bearer realm="feedback"' });
  }

  await ensureSchema(env.DB);
  const { results } = await env.DB.prepare(`SELECT ${COLUMNS.join(", ")} FROM feedback_responses ORDER BY created_at DESC`).all();

  const format = new URL(request.url).searchParams.get("format") === "json" ? "json" : "csv";
  if (format === "json") return json({ count: results.length, responses: results });

  const lines = [COLUMNS.join(",")].concat(results.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(",")));
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="framework-client-feedback.csv"',
      ...SECURITY_HEADERS,
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");

    try {
      if (path === "/api/feedback") {
        if (request.method === "POST") return await handleSubmit(request, env);
        return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
      }
      if (path === "/api/feedback/export") {
        if (request.method === "GET") return await handleExport(request, env);
        return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
      }
    } catch (err) {
      console.error("feedback error", err && err.message);
      return json({ error: "server_error" }, 500);
    }

    if (path.startsWith("/api/")) return json({ error: "not_found" }, 404);
    return env.ASSETS.fetch(request);
  },
};
