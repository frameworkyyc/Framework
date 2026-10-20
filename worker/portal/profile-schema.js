/**
 * The Business Profile questionnaire: the ONE definition of its steps, questions, types, limits and completion rule (schema version 1).
 * The server validates every submitted answer against it, the form pages are rendered from it, and completion is calculated from it.
 * Pure: no database, request or environment access, and no sample answers (the fictional demo keeps its own copy in guided-data.js;
 * a test keeps the two in step).
 *
 * Storage: one row per answered question in business_profile_answers (migrations/portal/0002_business_profile.sql).
 */
export const PROFILE_SCHEMA_VERSION = 1;

export const INDUSTRIES = Object.freeze(["Hospitality and food", "Retail", "Professional services", "Health and wellness", "Trades and construction", "Technology", "Non-profit", "Other"]);
export const SIZES = Object.freeze(["Just me", "2 to 10 people", "11 to 50 people", "51 to 200 people", "More than 200 people"]);
const TONES = Object.freeze(["Friendly and relaxed", "Polished and professional", "Bold and playful", "Calm and understated"]);

const f = (id, label, kind, extra = {}) => Object.freeze({ id, label, kind, required: false, ...extra });
const step = (id, title, intro, fields) => Object.freeze({ id, title, intro, fields: Object.freeze(fields) });

export const MAX_TEXT = 200;
export const MAX_LONG = 2000;

export const PROFILE_STEPS = Object.freeze([
  step("business", "Your business", "The basics, as they should appear in contracts and in public.", [
    f("legal", "Legal business name", "text", { required: true, autocomplete: "organization" }),
    f("operating", "Operating name", "text", { hint: "The name customers know you by, if different." }),
    f("industry", "Industry", "select", { required: true, options: INDUSTRIES }),
    f("about", "What does your business do?", "textarea", { required: true }),
  ]),
  step("location", "Location and size", "Where you work and how big the team is.", [
    f("city", "Where are you based?", "text", { required: true }),
    f("area", "Where do you serve customers?", "text"),
    f("size", "Business size", "select", { required: true, options: SIZES }),
  ]),
  step("offering", "Products, services and customers", "What you sell and who you sell it to.", [
    f("offer", "Main products and services", "textarea", { required: true }),
    f("customers", "Who are your target customers?", "textarea", { required: true }),
  ]),
  step("goals", "Goals and competitors", "What success looks like, and who you are measured against.", [
    f("goals", "What are your main business goals this year?", "textarea", { required: true }),
    f("competitors", "Who are your main competitors?", "textarea", { placeholder: "Names or websites, one per line. Include businesses you admire, too." }),
  ]),
  step("online", "Online presence", "Where customers can find you today.", [
    f("site", "Existing website", "website", { placeholder: "yourbusiness.ca", autocomplete: "url" }),
    f("social", "Social platforms you use", "textarea", { placeholder: "Links or handles, one per line." }),
  ]),
  step("contact", "Primary contact", "Who Framework should work with day to day.", [
    f("cname", "Name", "text", { required: true, autocomplete: "name" }),
    f("crole", "Role", "text", { autocomplete: "organization-title" }),
    f("cemail", "Email", "email", { required: true, autocomplete: "email" }),
    f("cphone", "Phone", "tel", { autocomplete: "tel" }),
  ]),
  step("personality", "Brand personality and positioning", "How the business should feel, and where it sits in its market.", [
    f("words", "Three words that describe your brand", "text", { required: true, placeholder: "For example: warm, honest, crafted" }),
    f("tone", "How should you sound?", "choice", { required: true, options: TONES }),
    f("position", "What makes you different from your competitors?", "textarea"),
  ]),
]);

export const stepById = (id) => (typeof id === "string" ? PROFILE_STEPS.find((s) => s.id === id) || null : null);
export const FIELD_IDS = Object.freeze(new Set(PROFILE_STEPS.flatMap((s) => s.fields.map((x) => x.id))));
const fieldById = new Map(PROFILE_STEPS.flatMap((s) => s.fields.map((x) => [x.id, x])));
export const fieldDef = (id) => fieldById.get(id) || null;

/* ------------------------------------------------------------------ website addresses */

export const MAX_WEBSITE = 300;
const HAS_HTTP = /^https?:\/\//i;
const HOST_LABEL = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/i;

/**
 * The one rule for turning what a person typed into a website address, shared in spirit by assets/js/portal-profile.js (which only previews the same
 * step): trim, then add "https://" when there is no http:// or https:// in front. An explicit http:// or https:// is kept as typed. Nothing else is rewritten.
 */
export function withProtocol(raw) {
  const v = String(raw == null ? "" : raw).trim();
  if (!v) return "";
  return HAS_HTTP.test(v) ? v.replace(/^https?:\/\//i, (m) => m.toLowerCase()) : "https://" + v;
}

/**
 * Validate a website address and return the value to store. Accepts domains, subdomains, ports, paths, query strings and fragments, with or without a
 * protocol. Refuses other schemes (ftp:, javascript:, mailto:), spaces and control characters, credentials, IP addresses and hosts with no dot or an
 * invalid name. @returns {{ value: string } | { error: string }} value is "" for an empty answer.
 */
export function normalizeWebsite(raw) {
  const trimmed = String(raw == null ? "" : raw).trim();
  if (!trimmed) return { value: "" };
  const bad = { error: "Enter a website address such as yourbusiness.ca" };
  if (/[\s\u0000-\u001F\u007F<>"'\\^`{|}]/.test(trimmed) || /^\/\//.test(trimmed)) return bad;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !HAS_HTTP.test(trimmed)) return bad; // another scheme, for example ftp://
  const candidate = withProtocol(trimmed);
  if (candidate.length > MAX_WEBSITE) return { error: `Please keep the address under ${MAX_WEBSITE} characters.` };
  let u;
  try { u = new URL(candidate); } catch { return bad; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return bad;
  const host = u.hostname; // already lower-case, with international names converted to xn-- form
  const labels = host.split(".");
  const tld = labels[labels.length - 1];
  if (host.length > 253 || labels.length < 2 || !labels.every((l) => HOST_LABEL.test(l))) return bad;
  if (!/^(?:[a-z]{2,}|xn--[a-z0-9-]{2,})$/i.test(tld)) return bad; // a real top-level name, never a number (so not an IP address)
  return { value: candidate };
}

/* ------------------------------------------------------------------ validation */

const CONTROL_SINGLE = /[\u0000-\u001F\u007F]/;
const CONTROL_MULTI = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate ONE answer. Empty (after trimming) means "unanswered" and is always valid. Returns { value } (normalised, "" for unanswered)
 * or { error } (a short message safe to show to the person).
 */
export function validateAnswer(def, raw) {
  if (raw === undefined || raw === null) return { value: "" };
  if (typeof raw !== "string") return { error: "This answer isn’t valid." };
  let v = raw.replace(/\r\n?/g, "\n").trim();
  if (v === "") return { value: "" };
  switch (def.kind) {
    case "text":
      if (CONTROL_SINGLE.test(v)) return { error: "Please use plain text on one line." };
      return v.length <= MAX_TEXT ? { value: v } : { error: `Please keep this under ${MAX_TEXT} characters.` };
    case "textarea":
      if (CONTROL_MULTI.test(v)) return { error: "Please use plain text." };
      return v.length <= MAX_LONG ? { value: v } : { error: `Please keep this under ${MAX_LONG} characters.` };
    case "email":
      v = v.toLowerCase();
      return v.length <= 254 && EMAIL.test(v) && !CONTROL_SINGLE.test(v) ? { value: v } : { error: "Enter a valid email address." };
    case "tel":
      return /^[0-9+()\-.\s]{5,40}$/.test(v) && (v.match(/\d/g) || []).length >= 5 ? { value: v } : { error: "Enter a valid phone number." };
    case "website":
      return normalizeWebsite(v);
    case "select":
    case "choice":
      return def.options.includes(v) ? { value: v } : { error: "Choose one of the options." };
    default:
      return { error: "This answer isn’t valid." };
  }
}

/**
 * Validate a submitted step. `input` maps question ids to strings; only this step's questions are read (anything else is ignored).
 * @returns {{ values: Record<string,string>, errors: Record<string,string> }} values holds normalised answers ("" = unanswered)
 */
export function validateStep(stepDef, input) {
  const values = {};
  const errors = {};
  for (const def of stepDef.fields) {
    const raw = input && Object.prototype.hasOwnProperty.call(input, def.id) ? input[def.id] : undefined;
    const r = validateAnswer(def, raw);
    if (r.error) {
      errors[def.id] = r.error;
      values[def.id] = typeof raw === "string" ? raw.slice(0, MAX_LONG + 1) : "";
    } else values[def.id] = r.value;
  }
  return { values, errors };
}

/* ------------------------------------------------------------------ completion (calculated from saved answers only) */

/**
 * A step is DONE when every required question has a saved answer. A step with no required questions is done once any of its
 * questions has a saved answer. A step with some saved answers that is not done is IN PROGRESS; one with none is NOT STARTED.
 * @param saved Record<fieldId, string> of saved answers
 */
export function stepStatus(stepDef, saved) {
  const has = (def) => typeof saved[def.id] === "string" && saved[def.id] !== "";
  const required = stepDef.fields.filter((x) => x.required);
  const answered = stepDef.fields.filter(has);
  const missing = required.filter((x) => !has(x));
  const done = required.length ? missing.length === 0 : answered.length > 0;
  return { id: stepDef.id, state: done ? "done" : answered.length ? "current" : "todo", answered: answered.length, missingRequired: missing.map((x) => x.id) };
}

/** Overall profile progress: complete steps out of all steps. Nothing else (projects, files, requests) can change it. */
export function profileProgress(saved) {
  const steps = PROFILE_STEPS.map((s) => stepStatus(s, saved || {}));
  const done = steps.filter((s) => s.state === "done").length;
  return { steps, done, total: steps.length, percent: Math.round((done / steps.length) * 100) };
}
