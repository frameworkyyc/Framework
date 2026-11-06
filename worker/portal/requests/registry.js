/**
 * The request type registry: the ONE place that says what can be requested, what the guided form asks, and how a type behaves. Adding a deliverable (or SEO or
 * development) type later is one entry here: no migration, no new route, no new page. Pure data and validation; no database, request or environment access.
 *
 *   kind     which section it belongs to: deliverable | seo | development (website and support arrive in Phase 2 on the same engine)
 *   proofs   true when the work is reviewed as design proofs (the client approves a proof or asks for a revision round)
 *   fields   the guided questions, in order. { key, label, type, required, max, options, help }
 *            type: text | textarea | select | checks | date. Values are validated and stored in requests.details_json; nothing else is ever stored from the form.
 *   brand    true when the form offers the organization's published brand (logos, colours, fonts) and snapshots it with the request
 *   website  true when the request may name one of the organization's websites
 *   files    the hint shown beside the reference upload
 *
 * Nothing here is a price or a contractual term. Prices come from Admin (request_type_settings) or from a quote; where neither exists the page says "custom quote".
 */

export const KINDS = Object.freeze({
  deliverable: Object.freeze({ key: "deliverable", label: "Deliverables", path: "/deliverables", blurb: "Business cards, flyers, social graphics and other branded materials.", noun: "deliverable" }),
  seo: Object.freeze({ key: "seo", label: "SEO", path: "/seo", blurb: "Search visibility for your website and your local presence.", noun: "SEO service" }),
  development: Object.freeze({ key: "development", label: "Custom Development", path: "/development", blurb: "Custom software, dashboards, automations and integrations.", noun: "development project" }),
});
export const KIND_KEYS = Object.freeze(Object.keys(KINDS));
/** Kinds the database already allows but that no section offers yet (Phase 2 copies support requests and website changes into the engine). */
export const ALL_KINDS = Object.freeze(["deliverable", "seo", "development", "website", "support"]);

export const DEFAULT_REVISIONS = 2;

const text = (key, label, o = {}) => ({ key, label, type: "text", max: 200, ...o });
const area = (key, label, o = {}) => ({ key, label, type: "textarea", max: 2000, ...o });
const select = (key, label, options, o = {}) => ({ key, label, type: "select", options, ...o });
const checks = (key, label, options, o = {}) => ({ key, label, type: "checks", options, ...o });

const PRINT_NOTE = "Files are delivered digitally in the portal. Framework does not print or ship materials.";

const DELIVERABLE_COMMON = [
  area("purpose", "What is it for, and who is it for?", { required: true, max: 1000, help: "A sentence or two: the audience, where it will be used and what it should achieve." }),
  area("copy", "Wording to include", { max: 3000, help: "Paste the text exactly as it should appear. Leave empty if you want Framework to propose it." }),
  area("style", "Style and direction", { max: 1000, help: "Anything that helps: examples you like, colours to use or avoid. Your published brand is offered below." }),
];

const DEVELOPMENT_FIELDS = (prompt) => [
  area("problem", prompt, { required: true, max: 2000, help: "Describe the problem in plain words: what happens today and why it is a problem." }),
  area("outcomes", "What should it do, and what does success look like?", { required: true, max: 2000, help: "The functions you need and the result you want. A short list is fine." }),
  area("systems", "Software and systems you already use", { max: 1500, help: "For example accounting, a CRM, spreadsheets, a website or industry software. Say what connects to what, if you know." }),
  select("budget", "Budget range, if known", [["", "Not sure yet"], ["under_2500", "Under $2,500"], ["2500_10000", "$2,500 to $10,000"], ["10000_25000", "$10,000 to $25,000"], ["over_25000", "Over $25,000"]], { help: "In Canadian dollars. This is only a guide for Framework; it is not an offer or a price." }),
  select("timeline", "When do you need it?", [["", "Flexible"], ["asap", "As soon as possible"], ["month", "Within a month"], ["quarter", "In one to three months"], ["later", "In more than three months"]]),
  area("examples", "Examples or links", { max: 1500, help: "Websites, apps or documents that show what you have in mind. You can also upload files below." }),
];

const SEO_FIELDS = (extra = []) => [
  area("goals", "What would you like to achieve?", { required: true, max: 1500, help: "For example more calls from Calgary, ranking for a service, or fixing something that looks wrong." }),
  ...extra,
  area("notes", "Anything else we should know", { max: 1500 }),
];

const DEFS = [
  // ---- Deliverables
  { key: "business_card", kind: "deliverable", label: "Business card", icon: "card", summary: "A front and back business card design.", proofs: true, brand: true, files: "Logos, photos or an existing card to match.",
    fields: [text("person", "Name and title on the card", { required: true }), area("contact", "Contact details to show", { required: true, max: 600 }), select("sides", "Sides", [["two", "Front and back"], ["one", "Front only"]]), ...DELIVERABLE_COMMON], note: PRINT_NOTE,
    includes: ["A design for your approval", "Final files delivered in the portal"] },
  { key: "digital_business_card", kind: "deliverable", label: "Digital business card", icon: "phone", summary: "A shareable digital card with your details and links.", proofs: true, brand: true, files: "A headshot or logo, if you want one on the card.",
    fields: [text("person", "Name and title", { required: true }), area("contact", "Contact details to show", { required: true, max: 600 }), area("links", "Links to include", { max: 800, help: "Website, booking page and social profiles." }), ...DELIVERABLE_COMMON],
    includes: ["A design for your approval", "Final files delivered in the portal"] },
  { key: "poster", kind: "deliverable", label: "Poster", icon: "poster", summary: "A poster for an event, offer or announcement.", proofs: true, brand: true, files: "Photos, logos or an earlier poster.", note: PRINT_NOTE,
    fields: [text("headline", "Headline", { required: true }), select("size", "Size", [["letter", "Letter (8.5 x 11 in)"], ["tabloid", "Tabloid (11 x 17 in)"], ["18x24", "18 x 24 in"], ["24x36", "24 x 36 in"], ["other", "Another size (say which below)"]]), select("orientation", "Orientation", [["portrait", "Portrait"], ["landscape", "Landscape"]]), area("details", "Event or offer details", { required: true, max: 1500, help: "Date, place, price, how to take part." }), ...DELIVERABLE_COMMON],
    includes: ["A design for your approval", "Final files delivered in the portal"] },
  { key: "flyer", kind: "deliverable", label: "Flyer", icon: "flyer", summary: "A one or two sided flyer.", proofs: true, brand: true, files: "Photos, logos or an earlier flyer.", note: PRINT_NOTE,
    fields: [text("headline", "Headline", { required: true }), select("size", "Size", [["letter", "Letter (8.5 x 11 in)"], ["half", "Half letter (5.5 x 8.5 in)"], ["dl", "DL (4 x 9 in)"], ["other", "Another size (say which below)"]]), select("sides", "Sides", [["one", "Front only"], ["two", "Front and back"]]), area("details", "What it needs to say", { required: true, max: 1500 }), text("action", "What should people do?", { help: "For example call, visit or book online." }), ...DELIVERABLE_COMMON],
    includes: ["A design for your approval", "Final files delivered in the portal"] },
  { key: "brochure", kind: "deliverable", label: "Brochure", icon: "brochure", summary: "A folded brochure or a short multi-page document.", proofs: true, brand: true, files: "Photos, logos and any existing text or brochure.", note: PRINT_NOTE,
    fields: [select("format", "Format", [["bifold", "Bi-fold (4 panels)"], ["trifold", "Tri-fold (6 panels)"], ["pages", "Multi-page document"], ["other", "Not sure"]]), area("sections", "Sections or panels", { required: true, max: 2000, help: "What each panel or page should cover." }), ...DELIVERABLE_COMMON],
    includes: ["A design for your approval", "Final files delivered in the portal"] },
  { key: "social_graphics", kind: "deliverable", label: "Social media graphics", icon: "social", summary: "Graphics sized for your social channels.", proofs: true, brand: true, files: "Photos, logos or posts you like.",
    fields: [checks("platforms", "Where will they be used?", [["instagram", "Instagram"], ["facebook", "Facebook"], ["linkedin", "LinkedIn"], ["x", "X"], ["tiktok", "TikTok"], ["youtube", "YouTube"], ["other", "Other"]], { required: true }), select("count", "How many graphics?", [["1", "One"], ["3", "Three"], ["5", "Five"], ["10", "Ten"], ["other", "Another number (say how many below)"]]), area("message", "Message or campaign", { required: true, max: 1500 }), ...DELIVERABLE_COMMON.slice(1)],
    includes: ["Designs for your approval", "Final files delivered in the portal"] },
  { key: "letterhead", kind: "deliverable", label: "Letterhead", icon: "letter", summary: "A branded letterhead for letters and documents.", proofs: true, brand: true, files: "Logos or a current letterhead.",
    fields: [area("contact", "Details for the header and footer", { required: true, max: 800, help: "Address, phone, website, registration numbers." }), select("template", "Also needed as", [["pdf", "A PDF only"], ["word", "A Word template as well"]]), ...DELIVERABLE_COMMON],
    includes: ["A design for your approval", "Final files delivered in the portal"] },
  { key: "email_signature", kind: "deliverable", label: "Email signature", icon: "mail", summary: "A consistent signature for your team's email.", proofs: true, brand: true, files: "Logos or headshots to include.",
    fields: [text("person", "Name and title", { required: true }), area("contact", "Contact details to show", { required: true, max: 600 }), select("client", "Email program", [["gmail", "Gmail"], ["outlook", "Outlook"], ["apple", "Apple Mail"], ["other", "Other or not sure"]]), ...DELIVERABLE_COMMON.slice(1)],
    includes: ["A design for your approval", "Final files delivered in the portal"] },
  { key: "custom_branded", kind: "deliverable", label: "Custom branded material", icon: "custom", summary: "Anything else that should carry your brand.", proofs: true, brand: true, files: "Anything that shows what you need.",
    fields: [text("what", "What do you need?", { required: true, help: "For example a banner, a menu, a sign, a slide template." }), text("size", "Size or format, if known"), ...DELIVERABLE_COMMON],
    includes: ["A design for your approval", "Final files delivered in the portal"] },

  // ---- SEO
  { key: "seo_audit", kind: "seo", label: "SEO audit", icon: "audit", summary: "A review of what is helping and hurting your search visibility.", proofs: false, website: true, files: "Reports or screenshots you already have.", fields: SEO_FIELDS(), includes: ["A written review with recommendations"] },
  { key: "local_seo", kind: "seo", label: "Local SEO and Google Business Profile", icon: "pin", summary: "Be found in your area and keep your Google Business Profile in order.", proofs: false, website: true, files: "Photos of your business or an existing profile.", fields: SEO_FIELDS([text("areas", "Where do you want to be found?", { help: "Cities, neighbourhoods or a service area." }), select("profile", "Google Business Profile today", [["none", "I don't have one"], ["unverified", "I have one, not verified"], ["verified", "I have a verified one"], ["unsure", "Not sure"]])]), includes: ["A plan for your local presence"] },
  { key: "monthly_seo", kind: "seo", label: "Ongoing monthly SEO", icon: "repeat", summary: "Regular work and reporting to improve your search visibility over time.", proofs: false, website: true, files: "", fields: SEO_FIELDS([text("services", "Services or pages that matter most")]), includes: ["Monthly work and a report"] },
  { key: "seo_content", kind: "seo", label: "SEO content", icon: "doc", summary: "New or improved pages written to be found and to persuade.", proofs: false, website: true, files: "Existing copy or notes.", fields: SEO_FIELDS([area("topics", "Pages or topics", { max: 1500 })]), includes: ["Written content for your review"] },
  { key: "technical_seo", kind: "seo", label: "Technical SEO fixes", icon: "wrench", summary: "Fix technical problems that hold your website back in search.", proofs: false, website: true, files: "Screenshots or error messages.", fields: SEO_FIELDS([area("issues", "Problems you know about", { max: 1500 })]), includes: ["Fixes to the technical issues found"] },

  // ---- Custom development
  { key: "custom_web_app", kind: "development", label: "Custom web application", icon: "app", summary: "A web application built around how your business works.", proofs: false, files: "Screenshots, documents or sketches.", fields: DEVELOPMENT_FIELDS("What problem should the application solve?"), includes: ["A scoped quote before work starts"] },
  { key: "business_portal", kind: "development", label: "Business dashboard or portal", icon: "dashboard", summary: "A dashboard or portal for your team or your customers.", proofs: false, files: "Screenshots, documents or sketches.", fields: DEVELOPMENT_FIELDS("What should the dashboard or portal help you see or do?"), includes: ["A scoped quote before work starts"] },
  { key: "ai_automation", kind: "development", label: "AI automation", icon: "spark", summary: "Use AI to take a repetitive task off your team.", proofs: false, files: "Examples of the work, with anything private removed.", fields: DEVELOPMENT_FIELDS("Which task or process would you like to automate with AI?"), includes: ["A scoped quote before work starts"] },
  { key: "workflow_automation", kind: "development", label: "Workflow automation", icon: "flow", summary: "Connect the steps of a process so they run themselves.", proofs: false, files: "Process notes or diagrams.", fields: DEVELOPMENT_FIELDS("Which process or workflow should run automatically?"), includes: ["A scoped quote before work starts"] },
  { key: "api_integration", kind: "development", label: "API or software integration", icon: "link", summary: "Make two tools share information.", proofs: false, files: "Documentation or examples.", fields: DEVELOPMENT_FIELDS("Which tools should be connected, and what should pass between them?"), includes: ["A scoped quote before work starts"] },
  { key: "custom_tool", kind: "development", label: "Custom calculator or tool", icon: "calc", summary: "A calculator, estimator or small tool for your site or team.", proofs: false, files: "Spreadsheets or formulas you use today.", fields: DEVELOPMENT_FIELDS("What should the tool calculate or help people decide?"), includes: ["A scoped quote before work starts"] },
  { key: "other_development", kind: "development", label: "Something else", icon: "plus", summary: "Another software or digital idea.", proofs: false, files: "Anything that explains it.", fields: DEVELOPMENT_FIELDS("What would you like to build, and why?"), includes: ["A scoped quote before work starts"] },
];

export const TYPES = Object.freeze(DEFS.map((d) => Object.freeze({ website: false, brand: false, files: "", note: "", includes: [], ...d })));
const BY_KEY = new Map(TYPES.map((t) => [t.key, t]));
export const getType = (key) => (typeof key === "string" && BY_KEY.has(key) ? BY_KEY.get(key) : null);
export const typesOfKind = (kind) => TYPES.filter((t) => t.kind === kind);
export const kindOf = (key) => (getType(key) ? getType(key).kind : null);
export const typeLabel = (key) => (getType(key) ? getType(key).label : String(key || "Request").replace(/_/g, " "));

/* ---------------------------------------------------------------- settings (Admin-editable, with the defaults above)  */

/**
 * The effective settings of a type: the saved row (request_type_settings) laid over the defaults. Pricing is only ever what Admin entered: no row means a custom quote.
 * @param row the saved row or null. @returns { enabled, revisionsIncluded, pricing: { mode, fixedPriceCents }, turnaroundNote }
 */
export function effectiveSettings(type, row = null) {
  const fixed = row && row.pricing_mode === "fixed" && Number.isInteger(row.fixed_price_cents);
  return {
    enabled: row ? row.enabled === 1 : true,
    revisionsIncluded: row && Number.isInteger(row.revisions_included) ? row.revisions_included : DEFAULT_REVISIONS,
    pricing: fixed ? { mode: "fixed", fixedPriceCents: row.fixed_price_cents } : { mode: "quote", fixedPriceCents: null },
    turnaroundNote: row && row.turnaround_note ? row.turnaround_note : "",
  };
}

/* ---------------------------------------------------------------- validation */

const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (v) => String(v == null ? "" : v).replace(/\r\n?/g, "\n").replace(CTRL, "").trim();

/**
 * Validates the answers to a type's questions. `get(name)` returns the posted value or null. Unknown fields are ignored (never stored). @returns { ok: true, details } | { ok: false, errors: { [fieldKey]: message } }
 */
export function validateDetails(type, get) {
  const details = {}, errors = {};
  for (const f of type.fields) {
    if (f.type === "checks") {
      // multipart forms cannot repeat a field name (the portal's upload reader refuses it), so each option is its own checkbox: d_<field>__<value> = "1"
      const picked = f.options.map((o) => o[0]).filter((v) => get(`d_${f.key}__${v}`) === "1");
      if (picked.length) details[f.key] = picked;
      else if (f.required) errors[f.key] = "Choose at least one.";
      continue;
    }
    const raw = clean(get(`d_${f.key}`));
    if (f.type === "select") {
      const allowed = new Set(f.options.map((o) => o[0]));
      if (raw && !allowed.has(raw)) { errors[f.key] = "Choose one of the options."; continue; }
      if (raw) details[f.key] = raw;
      else if (f.required) errors[f.key] = "Choose one.";
      continue;
    }
    if (!raw) { if (f.required) errors[f.key] = "This is needed."; continue; }
    if (raw.length > (f.max || 2000)) { errors[f.key] = `Please keep this under ${f.max || 2000} characters.`; continue; }
    details[f.key] = raw;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, details };
}

/** The label of a stored value, for showing a request back (select and checks store the option value). */
export function optionLabel(field, value) {
  if (!field || !field.options) return String(value);
  const hit = field.options.find((o) => o[0] === value);
  return hit ? hit[1] : String(value);
}

/** A request's answers as labelled lines for staff: [{ label, value }]. Unknown or empty answers are skipped. */
export function describeDetails(type, details) {
  if (!type || !details) return [];
  const out = [];
  for (const f of type.fields) {
    const v = details[f.key];
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    out.push({ label: f.label, value: Array.isArray(v) ? v.map((x) => optionLabel(f, x)).join(", ") : f.type === "select" ? optionLabel(f, v) : String(v) });
  }
  return out;
}
