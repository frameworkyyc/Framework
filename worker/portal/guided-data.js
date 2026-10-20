/**
 * STATIC DEMONSTRATION CONTENT for the guided client workspace at /portal/demo. Everything here is fictional (the same fictional client as
 * demo-data.js) and is never read from or written to a database. It describes the six areas, the questionnaires, the service catalogue and
 * each service's specific prerequisites. No imports; nothing runs at import time.
 */

export const AREAS = Object.freeze([
  { key: "profile", n: "01", title: "Business Profile", path: "/profile", desc: "Tell us about your business, customers and goals. Everything else builds on this." },
  { key: "branding", n: "02", title: "Branding", path: "/branding", desc: "Share the brand you have, or tell us what you need created." },
  { key: "website", n: "03", title: "Website", path: "/website", desc: "Plan a new website or improve your current one." },
  { key: "marketing", n: "04", title: "Marketing", path: "/marketing", desc: "Goals, audience and the channels that matter to you." },
  { key: "content", n: "05", title: "Content & Photography", path: "/content", desc: "Photography, video and the creative content you need." },
  { key: "files", n: "06", title: "Files & Deliverables", path: "/files", desc: "Everything Framework has shared with you, in one place." },
]);

const f = (id, label, kind, value = "", extra = {}) => ({ id, label, kind, value, ...extra });
const INDUSTRIES = ["Hospitality and food", "Retail", "Professional services", "Health and wellness", "Trades and construction", "Technology", "Non-profit", "Other"];
const SIZES = ["Just me", "2 to 10 people", "11 to 50 people", "51 to 200 people", "More than 200 people"];

/** state: done | current | todo. A done step has every answer filled in; the current step is partly filled. */
export const PROFILE_STEPS = Object.freeze([
  { id: "business", title: "Your business", state: "done", minutes: 3, intro: "The basics, as they should appear in contracts and in public.", fields: [
    f("legal", "Legal business name", "text", "Harbour & Pine Co. Ltd."),
    f("operating", "Operating name", "text", "Harbour & Pine", { hint: "The name customers know you by, if different." }),
    f("industry", "Industry", "select", "Hospitality and food", { options: INDUSTRIES }),
    f("about", "What does your business do?", "textarea", "We run a small coastal bakery and café, and supply bread and pastries to restaurants across Calgary.") ] },
  { id: "location", title: "Location and size", state: "done", minutes: 2, intro: "Where you work and how big the team is.", fields: [
    f("city", "Where are you based?", "text", "Calgary, Alberta"),
    f("area", "Where do you serve customers?", "text", "Calgary and surrounding communities, plus wholesale delivery within 100 km."),
    f("size", "Business size", "select", "11 to 50 people", { options: SIZES }) ] },
  { id: "offering", title: "Products, services and customers", state: "done", minutes: 4, intro: "What you sell and who you sell it to.", fields: [
    f("offer", "Main products and services", "textarea", "Sourdough and pastries, café menu, wholesale supply, seasonal catering."),
    f("customers", "Who are your target customers?", "textarea", "Local residents who value craft food, and restaurant and café owners who want a dependable wholesale supplier.") ] },
  { id: "goals", title: "Goals and competitors", state: "current", minutes: 4, intro: "What success looks like, and who you are measured against.", fields: [
    f("goals", "What are your main business goals this year?", "textarea", "Grow wholesale accounts and make online ordering easy."),
    f("competitors", "Who are your main competitors?", "textarea", "", { placeholder: "Names or websites, one per line. Include businesses you admire, too." }) ] },
  { id: "online", title: "Online presence", state: "todo", minutes: 2, intro: "Where customers can find you today.", fields: [
    f("site", "Existing website", "url", "", { placeholder: "https://" }),
    f("social", "Social platforms you use", "textarea", "", { placeholder: "Links or handles, one per line." }) ] },
  { id: "contact", title: "Primary contact", state: "todo", minutes: 2, intro: "Who Framework should work with day to day.", fields: [
    f("cname", "Name", "text"), f("crole", "Role", "text"), f("cemail", "Email", "email"), f("cphone", "Phone", "tel") ] },
  { id: "personality", title: "Brand personality and positioning", state: "todo", minutes: 5, intro: "How the business should feel, and where it sits in its market.", fields: [
    f("words", "Three words that describe your brand", "text", "", { placeholder: "For example: warm, honest, crafted" }),
    f("tone", "How should you sound?", "choice", "", { options: ["Friendly and relaxed", "Polished and professional", "Bold and playful", "Calm and understated"] }),
    f("position", "What makes you different from your competitors?", "textarea", "", { placeholder: "In a few sentences." }) ] },
]);

const help = (id, title, summary, state, fields, helpWith = "client") => ({ id, title, summary, state, helpWith, fields });

/** Topic workspaces. helpWith: whether the demo client chose to provide the material ("client") or asked for Framework's help ("framework"). */
export const WORKSPACES = Object.freeze({
  website: { title: "Website", intro: "Plan the website step by step. You can provide what you have, or ask Framework to help with any part.", topics: [
    help("type", "Existing or new website", "A new website to replace the current one.", "done", [f("kind", "What do you need?", "choice", "A new website", { options: ["A new website", "Improve my existing website"] })]),
    help("purpose", "Purpose and goals", "Take online orders and attract wholesale enquiries.", "done", [f("purpose", "What should the website achieve?", "textarea", "Take online orders for the café and make it easy for restaurants to request wholesale pricing.")]),
    help("pages", "Pages and features", "Home, menu, wholesale, about, contact. Online ordering to confirm.", "current", [f("pages", "Which pages do you need?", "textarea", "Home, menu, wholesale, about, contact."), f("features", "Features", "textarea", "", { placeholder: "Online ordering, a booking form, a newsletter sign-up…" })]),
    help("domain", "Domain and hosting", "Not started.", "todo", [f("domain", "Do you own a domain name?", "text", "", { placeholder: "harbourandpine.example, or “not sure”" }), f("host", "Where is it registered or hosted?", "text", "", { placeholder: "If you know" })], "framework"),
    help("content", "Content availability", "Not started.", "todo", [f("copy", "Is your written content ready?", "choice", "", { options: ["Yes, it is written", "Partly", "No, I need help"] })], "framework"),
    help("brand", "Branding readiness", "Uses your Branding answers.", "todo", [f("brandready", "Do you have a logo, colours and fonts to use?", "choice", "", { options: ["Yes, all of them", "Some of them", "No"] })]),
    help("integrations", "Integrations and special requirements", "Not started.", "todo", [f("tools", "Tools the website must work with", "textarea", "", { placeholder: "Payments, booking, email marketing, accounting…" })]),
  ] },
  marketing: { title: "Marketing", intro: "Describe what you want marketing to do. Framework will respond with recommendations, not assumptions.", topics: [
    help("goals", "Marketing goals", "Not started.", "todo", [f("mgoals", "What should marketing achieve?", "textarea", "", { placeholder: "More wholesale accounts, a busier café on weekdays…" })]),
    help("audience", "Target audience", "Uses your Business Profile.", "todo", [f("maud", "Who are you trying to reach?", "textarea", "", { placeholder: "Add anything beyond your Business Profile." })]),
    help("channels", "Current marketing channels", "Not started.", "todo", [f("mchan", "What are you doing today?", "textarea", "", { placeholder: "Instagram, a newsletter, local print…" })]),
    help("campaigns", "Campaign interests", "Not started.", "todo", [f("mcamp", "What interests you?", "choice", "", { options: ["A launch campaign", "Seasonal promotions", "Ongoing social media", "Not sure yet"] })], "framework"),
    help("budget", "Budget preferences", "Not started.", "todo", [f("mbud", "Roughly what range do you have in mind?", "select", "", { options: ["Under $2,000", "$2,000 to $5,000", "$5,000 to $15,000", "More than $15,000", "I would like a recommendation"] })], "framework"),
    help("materials", "Existing marketing materials", "Not started.", "todo", [f("mmat", "What do you already have?", "textarea", "", { placeholder: "Flyers, menus, past campaigns…" })]),
  ] },
  content: { title: "Content & Photography", intro: "Tell us about the images, video and creative content you need and what already exists.", topics: [
    help("photo", "Photography requirements", "Product and café photography for the new website.", "done", [f("ph", "What photography do you need?", "textarea", "Product photography of bread and pastries, interior and team portraits for the new website.")], "framework"),
    help("video", "Video and creative content", "Not started.", "todo", [f("vid", "Do you need video or other creative content?", "choice", "", { options: ["Short social videos", "A brand film", "Animation or graphics", "Not at the moment"] })], "framework"),
    help("media", "Existing media", "Not started.", "todo", [f("med", "What photos and video do you already have?", "textarea", "", { placeholder: "Where are they stored, and who owns them?" })]),
    help("references", "Creative references", "Not started.", "todo", [f("ref", "Examples you like", "textarea", "", { placeholder: "Links to work that has the look you want." })]),
    help("uses", "Intended uses", "Website, print menus and social media.", "done", [f("use", "Where will the content be used?", "textarea", "Website, print menus and social media.")]),
    help("requests", "Potential content requests", "Not started.", "todo", [f("req", "Anything else you may need later?", "textarea", "", { placeholder: "Seasonal shoots, event coverage…" })]),
  ] },
});

/** The four paths of the Branding area. */
export const BRAND_PATHS = Object.freeze([
  { id: "existing", title: "I already have a logo or brand identity", blurb: "Share your logo, fonts, colours and guidelines." },
  { id: "logo", title: "I need a logo", blurb: "A new logo designed for your business.", service: "new-logo" },
  { id: "guidelines", title: "I need brand guidelines", blurb: "Clear rules for using your brand consistently.", service: "brand-guidelines" },
  { id: "identity", title: "I need a complete brand identity", blurb: "Strategy, logo, type, colour and guidelines together.", service: "brand-identity" },
]);

export const UPLOAD_SLOTS = Object.freeze([
  { id: "logo", title: "Logo files", hint: "SVG, PDF, AI or PNG. Vector files are best." },
  { id: "fonts", title: "Fonts", hint: "OTF or TTF files, or the names and where they are licensed." },
  { id: "colours", title: "Colour palette", hint: "A swatch file, or colour codes such as HEX or CMYK." },
  { id: "guidelines", title: "Brand guidelines", hint: "A PDF or a link to your current guidelines." },
]);

export const DISCOVERY = Object.freeze([
  "What your brand stands for: values, voice and personality",
  "Who you want to reach and how you want them to feel",
  "Businesses and brands whose look you admire (and ones you do not)",
  "Where the brand will appear first: signage, packaging, website, social media",
  "Any names, colours or symbols that must stay, or must be avoided",
]);

/** What the demo client has so far (used to evaluate prerequisites). */
export const BRAND_STATE = Object.freeze({ assets: false, direction: false, discovery: false });

const P = (id) => ["profile", id], T = (area, id) => ["topic", area, id], B = (id) => ["brand", id];
// needs: required for the request to be reviewed. wants: optional, improves the brief and never blocks the request.
const SERVICE_LIST = [
  { id: "new-logo", area: "branding", title: "New logo", blurb: "A primary logo and secondary marks designed for your business.", needs: [P("business"), P("offering"), P("personality")], wants: [P("goals"), B("discovery")] },
  { id: "brand-guidelines", area: "branding", title: "Brand guidelines", blurb: "A guide to your logo, colour, typography and tone of voice.", needs: [P("business"), P("personality"), B("discovery")], wants: [B("assets"), P("goals")] },
  { id: "brand-identity", area: "branding", title: "Complete brand identity", blurb: "Strategy, logo, typography, colour and guidelines, developed together.", needs: [P("business"), P("offering"), P("personality"), B("discovery")], wants: [P("goals"), B("assets")] },
  { id: "website-development", area: "website", title: "Website development", blurb: "A new website, built and launched by Framework.", needs: [P("business"), P("offering"), T("website", "type"), T("website", "purpose"), T("website", "pages")], wants: [T("website", "content"), T("website", "domain"), P("online")] },
  { id: "website-design", area: "website", title: "Website design", blurb: "Page and template design for your website.", needs: [T("website", "type"), T("website", "purpose"), T("website", "pages"), ["any", "Existing brand assets or an agreed branding direction", [B("assets"), B("direction")]]], wants: [T("website", "brand"), P("online")] },
  { id: "marketing-campaign", area: "marketing", title: "Marketing campaign", blurb: "A planned campaign across the channels that suit your goals.", needs: [P("business"), P("offering"), P("goals"), T("marketing", "goals")], wants: [T("marketing", "audience"), T("marketing", "channels"), T("marketing", "budget")] },
  { id: "photography-session", area: "content", title: "Photography session", blurb: "A planned shoot, with editing and retouching.", needs: [P("business"), T("content", "photo")], wants: [T("content", "references"), T("content", "media")] },
];
export const SERVICES = Object.freeze(SERVICE_LIST.map((s) => Object.freeze(s)));

/** "Still to answer: A; B and 1 more", from the unanswered questions of a section. */
function stillToAnswer(fields) {
  const open = fields.filter((f) => !f.value);
  if (!open.length) return "Review and complete this section.";
  const names = open.slice(0, 2).map((f) => f.label.replace(/[?:.]$/, ""));
  return `Still to answer: ${names.join("; ")}${open.length > 2 ? ` and ${open.length - 2} more` : ""}`;
}

/**
 * One prerequisite, evaluated against the demo completion states: the section it points to, what is missing in it, and the questionnaire page
 * that fixes it (href relative to the demo base). A requirement is met when its section is complete; nothing here changes when a field is edited.
 * @returns {{label, met, href, detail, anyOf?}}
 */
export function requirement([kind, a, b]) {
  if (kind === "profile") { const s = PROFILE_STEPS.find((x) => x.id === a); return { label: s.title, section: "Business Profile", met: s.state === "done", href: `/profile/${a}`, detail: stillToAnswer(s.fields) }; }
  if (kind === "topic") {
    const topic = WORKSPACES[a].topics.find((t) => t.id === b), row = WORKSPACE_ROWS[a].find((r) => r.topics.includes(b));
    return { label: row.title, section: WORKSPACES[a].title, met: topic.state === "done", href: `/${a}/${row.id}`, detail: stillToAnswer(topic.fields) };
  }
  if (kind === "brand" && a === "discovery") return { label: "Brand discovery", section: "Branding", met: BRAND_STATE.discovery, href: "/branding/discovery", detail: `${DISCOVERY.length} short questions about your brand` };
  if (kind === "brand" && a === "assets") return { label: "Existing brand assets", section: "Branding", met: BRAND_STATE.assets, href: "/branding/existing", detail: "Share a logo, fonts, colours or guidelines" };
  if (kind === "brand" && a === "direction") return { label: "Agreed branding direction", section: "Branding", met: BRAND_STATE.direction, href: "/branding/identity", detail: "Agreed with Framework through a brand identity request" };
  if (kind === "any") { const opts = b.map(requirement); return { label: a, section: "Branding", met: opts.some((o) => o.met), href: opts[0].href, detail: "Provide one of these", anyOf: opts }; }
  throw new Error("unknown requirement");
}

export const serviceById = (id) => SERVICES.find((s) => s.id === id);
/** Required items (blocking) and optional items (never blocking) for one service request. */
export function serviceReadiness(service) {
  const reqs = service.needs.map(requirement), optional = (service.wants || []).map(requirement);
  return { reqs, missing: reqs.filter((r) => !r.met), optional, optionalMissing: optional.filter((r) => !r.met) };
}

/** Counts used for the onboarding progress indicator. */
export function progressSummary() {
  const units = [
    ...PROFILE_STEPS.map((s) => s.state === "done"),
    ...Object.values(WORKSPACES).flatMap((w) => w.topics.map((t) => t.state === "done")),
  ];
  const done = units.filter(Boolean).length;
  return { done, total: units.length, percent: Math.round((done / units.length) * 100) };
}

export const profileDone = () => PROFILE_STEPS.filter((s) => s.state === "done").length;
export const workspaceDone = (area) => WORKSPACES[area].topics.filter((t) => t.state === "done").length;

/** The service categories a project can belong to. A project lists its categories explicitly (project.services); nothing is inferred from names. */
export const SERVICE_AREAS = Object.freeze(["branding", "website", "marketing", "content"]);
export const projectsFor = (projects, key) => projects.filter((p) => Array.isArray(p.services) && p.services.includes(key));
export const categoriesOf = (project) => (Array.isArray(project.services) ? project.services.filter((k) => SERVICE_AREAS.includes(k)) : []);

/**
 * How each service workspace overview is organised: one row per group of topics. A row's state is derived from its topics' states, so the
 * demo completion states are unchanged; progress counts rows, never projects, files or requests.
 */
export const WORKSPACE_ROWS = Object.freeze({
  website: [
    { id: "information", title: "Website information", topics: ["type"] },
    { id: "goals", title: "Goals and audience", topics: ["purpose"] },
    { id: "pages", title: "Pages and features", topics: ["pages"] },
    { id: "content", title: "Content and assets", topics: ["content", "brand"] },
    { id: "domain", title: "Domain and hosting", topics: ["domain"] },
    { id: "integrations", title: "Integrations", topics: ["integrations"] },
  ],
  marketing: [
    { id: "goals", title: "Marketing goals", topics: ["goals"] },
    { id: "audience", title: "Target audience", topics: ["audience"] },
    { id: "channels", title: "Existing channels", topics: ["channels"] },
    { id: "campaigns", title: "Campaign information", topics: ["campaigns", "budget"] },
    { id: "assets", title: "Marketing assets", topics: ["materials"] },
  ],
  content: [
    { id: "needs", title: "Photography and video needs", topics: ["photo", "video"] },
    { id: "direction", title: "Creative direction", topics: ["references"] },
    { id: "media", title: "Existing media", topics: ["media"] },
    { id: "requirements", title: "Content requirements", topics: ["uses", "requests"] },
  ],
});
/** "done" when every topic is done, "current" when some work has been done, otherwise "todo". */
export function rowState(key, row) {
  const ts = row.topics.map((id) => WORKSPACES[key].topics.find((t) => t.id === id).state);
  if (ts.every((x) => x === "done")) return "done";
  return ts.some((x) => x === "done" || x === "current") ? "current" : "todo";
}
export const rowProgress = (key) => { const rows = WORKSPACE_ROWS[key]; return { done: rows.filter((r) => rowState(key, r) === "done").length, total: rows.length }; };
