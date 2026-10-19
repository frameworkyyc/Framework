/**
 * Privacy-safe structured logging for the client portal (Stage 2A).
 *
 * Callers pass only a small set of NAMED fields, and every field has its own strict validator, so request data cannot reach a log
 * by accident: emails, URLs, query strings, tokens, codes, cookies, headers and free text all fail validation and are replaced by
 * "[redacted]" (or dropped if the field name is unknown). Cloudflare's own request logs are configured separately
 * (query strings are redacted in wrangler.jsonc); this module is for what OUR code says.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WORD = /^[a-z][a-z0-9_.]{0,39}$/; // lower-case snake words: a token or an email cannot match (capitals, dashes, '@', length)
const ROUTE = /^\/[a-z0-9_:/-]{0,60}$/;
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

const FIELDS = {
  evt: (v) => typeof v === "string" && WORD.test(v),
  route: (v) => typeof v === "string" && ROUTE.test(v),
  method: (v) => METHODS.has(v),
  status: (v) => Number.isInteger(v) && v >= 100 && v <= 599,
  ms: (v) => Number.isFinite(v) && v >= 0 && v <= 600000,
  ref: (v) => typeof v === "string" && /^[A-HJKMNP-TV-Z2-9]{6,10}$/.test(v),
  outcome: (v) => typeof v === "string" && WORD.test(v),
  reason: (v) => typeof v === "string" && WORD.test(v),
  org: (v) => typeof v === "string" && UUID.test(v),
  user: (v) => typeof v === "string" && UUID.test(v),
  count: (v) => Number.isInteger(v) && v >= 0 && v <= 1000000,
};

export const LOG_FIELDS = Object.freeze(Object.keys(FIELDS));

/** Build the object that would be logged: known fields only, each validated, everything else redacted or dropped. */
export function buildLogEntry(fields) {
  const entry = {};
  if (!fields || typeof fields !== "object") return entry;
  for (const key of Object.keys(FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(fields, key) || fields[key] === undefined || fields[key] === null) continue;
    const v = fields[key];
    entry[key] = FIELDS[key](v) ? (key === "ms" ? Math.round(v) : v) : "[redacted]";
  }
  return entry;
}

/** Write one JSON line. Never throws (a logging problem must not break a request). Returns the entry for tests. */
export function logEvent(fields, sink = (line) => console.log(line)) {
  const entry = buildLogEntry(fields);
  try {
    sink(JSON.stringify({ portal: true, ...entry }));
  } catch {
    /* ignore */
  }
  return entry;
}

const STATIC_SEGMENTS = new Set(["portal", "login", "auth", "callback", "logout", "select", "o", "projects", "activity", "members", "assets", "no-access"]);

/** A safe route NAME for a path: organization slugs and ids become placeholders, so a log never reveals which organization. */
export function routeName(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return "/other";
  const segs = pathname.split("/").filter(Boolean).slice(0, 8);
  const out = segs.map((s, i) => (segs[i - 1] === "o" ? ":slug" : STATIC_SEGMENTS.has(s) ? s : ":p"));
  const name = "/" + out.join("/");
  return ROUTE.test(name) ? name : "/other";
}
