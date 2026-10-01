/**
 * Framework — pieces shared by the public feedback form (index.js) and the private admin API (admin/).
 * Everything here is plain JavaScript with no Cloudflare-only imports, so it can be unit-tested in Node.
 */

export const RATING_KEYS = [
  "visual_design",
  "ease_of_use",
  "mobile_experience",
  "accuracy",
  "professionalism",
  "communication",
  "overall_product",
];

export const COLUMNS = [
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

export const SCHEMA = `CREATE TABLE IF NOT EXISTS feedback_responses (
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
export const ensureSchema = (db) => {
  if (!schemaReady) schemaReady = db.prepare(SCHEMA).run().catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
};

export const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};

export const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...extra },
  });

export const csvCell = (value) => {
  if (value === null || value === undefined) return "";
  let s = String(value);
  // neutralise spreadsheet formula injection
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export const timingSafeEqual = (a, b) => {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
};
