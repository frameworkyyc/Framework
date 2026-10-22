// Run with:  node --test worker/test/*.mjs
// Guards the privacy policy and the site's real privacy behaviour: every page links to the policy, the policy makes no
// claim the code does not support (and none of the claims the business decided against), nothing optional loads or
// is stored before consent, and the marketing opt-in stays separate and unticked.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { portalPolicyAssertionsApply } from "./helpers/portal-privacy-guard.mjs";

const root = new URL("../../", import.meta.url);
const read = (f) => readFileSync(new URL(f, root), "utf8");
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&rsquo;|’/g, "'").replace(/\s+/g, " ");

// me.html is the private Framework Personal Dashboard (noindex, links only, no data collected): not a public page, so no policy footer.
const PAGES = readdirSync(root).filter((f) => f.endsWith(".html") && f !== "me.html");
const policy = read("privacy.html");
const policyText = text(policy);
// The portal-specific policy assertions are mandatory on Staging and whenever Production activates the portal (see helpers/portal-privacy-guard.mjs and
// portal-privacy-guard.test.mjs); they also run whenever a portal section exists. Only a Production-bound change with the portal OFF may keep the website-only policy.
const portalExpected = portalPolicyAssertionsApply(policy);

test("every public page has a Privacy Policy link in its footer", () => {
  assert.deepEqual(PAGES.sort(), ["404.html", "about.html", "assessment.html", "card.html", "client-feedback.html", "contact.html", "index.html", "method.html", "portfolio.html", "privacy.html", "services.html"]);
  for (const page of PAGES) {
    // the business card has no site footer: it carries a single compact privacy link instead
    const footer = read(page).split(page === "card.html" ? '<footer class="card__foot">' : '<footer class="site-footer">')[1] || "";
    assert.match(footer, /<a href="\/?privacy\.html">Privacy Policy<\/a>/, page + " footer link");
  }
});

test("the privacy link is a plain footer list item (no layout or navigation changes)", () => {
  for (const page of PAGES.filter((p) => !["assessment.html", "privacy.html", "card.html"].includes(p))) {
    const html = read(page);
    assert.equal((html.match(/privacy\.html/g) || []).length, 1, page + ": exactly one privacy link");
    assert.ok(html.includes('<li><a href="contact.html">Contact</a></li>\n          <li><a href="privacy.html">Privacy Policy</a></li>'), page);
    assert.ok(!/<nav[^>]*>[\s\S]*?privacy[\s\S]*?<\/nav>/.test(html), page + ": not added to the main navigation");
  }
});

test("policy: required sections, effective date, contact and decided facts are present", () => {
  const sections = ["summary", "who", "collect", "purposes", "assessments", "feedback", "marketing", "portal", "cookies", "advertising", "providers", "international", "security", "retention", "rights", "links", "changes", "contact"];
  for (const id of sections.filter((x) => portalExpected || x !== "portal")) {
    assert.ok(policy.includes(`id="${id}"`), "section " + id);
  }
  const pending = /<time id="effective-date" data-status="pending">Effective on the date this policy is published on the live website<\/time>/.test(policy);
  const dated = /<time datetime="\d{4}-\d{2}-\d{2}" id="effective-date">[A-Z][a-z]+ \d{1,2}, \d{4}<\/time>/.test(policy);
  assert.ok(pending || dated, "effective date must be either the explicit pending notice or a real date, never another placeholder");
  if (process.env.PRIVACY_PUBLISH) assert.ok(dated && !pending, "set the real Production publication date before publishing");
  assert.ok(policyText.includes("hello@frameworkco.ca"));
  assert.ok(!policyText.includes("info@frameworkco.ca"));
  assert.match(policyText, /up to 24 months after our last meaningful interaction/);
  assert.match(policyText, /We do not sell personal information/);
  assert.match(policyText, /explicit consent/i);
  assert.match(policyText, /Alberta, Canada/);
  assert.match(policyText, /Office of the Information and Privacy Commissioner of Alberta/);
  assert.ok(!/noindex/.test(policy), "the policy page must be indexable");
});

test("policy: names the real providers and processing it describes", () => {
  for (const name of ["Cloudflare", "Resend", "Fontshare", "Meta", "Turnstile", ...(portalExpected ? ["WorkOS"] : [])]) assert.ok(policyText.includes(name), name);
  assert.match(policyText, /outside Alberta and outside Canada/);
  assert.match(policyText, /We do not promise that your information stays in Canada/);
});

test("policy: contains none of the claims the business ruled out or the code cannot support", () => {
  const forbidden = [
    /deleted automatically/i, /automatic(ally)? (deletion|delete)/i, /we (automatically|will automatically) delete/i,
    /stored only in canada/i, /(only|solely) (stored|processed) in canada/i, /data (stays|remains) in canada(?! \.)/i,
    /100% secure/i, /completely secure(?!,)/i, /absolutely secure/i, /fully compliant/i, /complies with all/i, /guarantee[sd]? compliance/i,
    /google analytics/i, /gtag/i, /cookie banner/i, /we never share/i, /we will never/i,
    /\d{2,5} [A-Z][a-z]+ (Street|St\.|Avenue|Ave\.|Road|Rd\.|Boulevard|Blvd)/, /\bLtd\.?\b|\bInc\.?\b|\bCorp\.?\b/,
  ];
  for (const re of forbidden) assert.ok(!re.test(policyText), "policy must not contain: " + re);
  // what it MUST say instead
  assert.match(policyText, /review and delete records manually, not automatically/);
  assert.match(policyText, /cannot guarantee absolute security/);
  assert.match(policyText, /we do not currently use website analytics/i);
  assert.match(policyText, /we do not set cookies on the public pages of this website ourselves/i);
});

test("the Meta Pixel and every third-party script are absent from all pages except as the gated loader", () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.ok(!/connect\.facebook\.net|facebook\.com\/tr|fbevents|googletagmanager|google-analytics|gtag\(/i.test(html), page + " has no tracker markup");
    assert.ok(!/<script[^>]+src="https?:\/\/(?!api\.fontshare\.com)/.test(html), page + " loads no external script tag");
  }
  const loaders = readdirSync(new URL("assets/js/", root)).filter((f) => f.endsWith(".js") && /connect\.facebook\.net/.test(read("assets/js/" + f)));
  assert.deepEqual(loaders, ["assessment.js"], "the Pixel URL exists in exactly one script");
  const js = read("assets/js/assessment.js");
  const afterLoader = js.slice(js.indexOf("var loadPixel"));
  assert.ok(/consent\.get\(\) !== "granted"\) return/.test(afterLoader), "loadPixel refuses to run without consent");
  assert.ok(/if \(!pixelId/.test(afterLoader), "and without a configured pixel id");
});

test("no cookies are set by site code, and localStorage is touched only by the consent module", () => {
  for (const f of readdirSync(new URL("assets/js/", root)).filter((n) => n.endsWith(".js"))) {
    const js = read("assets/js/" + f);
    assert.ok(!/document\.cookie/.test(js), f + " must not set cookies");
    if (f !== "consent.js") assert.ok(!/localStorage/.test(js), f + " must not use localStorage");
  }
  const w = read("worker/index.js") + read("worker/assessment.js") + read("worker/shared.js");
  assert.ok(!/Set-Cookie/i.test(w), "the Worker sets no cookies");
});

test("assessment form: privacy acknowledgement is required and separate; marketing opt-in is optional, unticked and its own box", () => {
  const html = read("assessment.html");
  const privacy = html.match(/<input[^>]*id="f-privacy"[^>]*>/)[0];
  const marketing = html.match(/<input[^>]*id="f-marketing"[^>]*>/)[0];
  assert.match(privacy, /required/);
  assert.ok(!/\bchecked\b/.test(privacy) && !/\bchecked\b/.test(marketing), "nothing is pre-ticked");
  assert.ok(!/required/.test(marketing));
  const privacyLabel = html.match(/<label for="f-privacy">([\s\S]*?)<\/label>/)[1];
  assert.ok(!/promotional|marketing|offers/i.test(privacyLabel), "the acknowledgement is not marketing consent");
  const marketingLabel = html.match(/<label for="f-marketing">([\s\S]*?)<\/label>/)[1];
  assert.match(marketingLabel, /unsubscribe at any time/);
});

test("transactional emails contain no promotion, and the notification records the opt-in choice", async () => {
  const { buildConfirmation, buildNotification, validateAssessment } = await import("../assessment.js");
  const c = buildConfirmation();
  assert.ok(!/offer|discount|newsletter|promotion|subscribe|special/i.test(c.text));
  const base = { business_name: "A", website: "a.ca", contact_name: "B", email: "b@a.ca", location: "C", industry: "D", privacy_ack: true, submission_id: "x".repeat(20) };
  const yes = buildNotification(validateAssessment({ ...base, marketing_opt_in: true }).data).text;
  const no = buildNotification(validateAssessment({ ...base, marketing_opt_in: false }).data).text;
  assert.match(yes, /Marketing emails opt-in: Yes \(opted in\)/);
  assert.match(no, /Marketing emails opt-in: No/);
  assert.equal(validateAssessment({ ...base }).data.marketing_opt_in, false, "absent means no");
  assert.equal(validateAssessment({ ...base, marketing_opt_in: "yes" }).data.marketing_opt_in, false, "only a real boolean true counts");
});

test("consent module: off until chosen; remembers choices; a browser privacy signal always wins; works with storage blocked", () => {
  const load = ({ stored, gpc = false, dnt = null, blocked = false } = {}) => {
    const store = new Map(stored ? [["fw_meta_consent", stored]] : []);
    const localStorage = blocked
      ? { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } }
      : { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
    const win = { localStorage };
    vm.runInNewContext(read("assets/js/consent.js"), { window: win, navigator: { globalPrivacyControl: gpc, doNotTrack: dnt } });
    return { c: win.FrameworkConsent, store };
  };
  assert.equal(load().c.get(), null, "never asked: treated as not consented");
  assert.equal(load({ stored: "granted" }).c.get(), "granted");
  assert.equal(load({ stored: "denied" }).c.get(), "denied");
  assert.equal(load({ stored: "junk" }).c.get(), null, "an invalid stored value is ignored");
  assert.equal(load({ stored: "granted", gpc: true }).c.get(), "denied", "Global Privacy Control overrides a stored grant");
  assert.equal(load({ stored: "granted", dnt: "1" }).c.get(), "denied", "Do Not Track overrides a stored grant");
  const { c, store } = load(); c.set("granted"); assert.equal(store.get("fw_meta_consent"), "granted"); c.set("denied"); assert.equal(c.get(), "denied");
  c.set("maybe"); assert.equal(c.get(), "denied", "invalid values are ignored");
  const seen = []; c.subscribe((v) => seen.push(v)); c.set("granted"); assert.deepEqual(seen, ["granted"]);
  const b = load({ blocked: true }).c; assert.equal(b.get(), null); b.set("granted"); assert.equal(b.get(), "granted", "choice held in memory when storage is blocked");
});

test("internal privacy operations file exists and is never served publicly", () => {
  const ignore = read(".assetsignore").split("\n").map((l) => l.trim());
  for (const f of ["PRIVACY-OPERATIONS.md", "README.md", "worker/", "migrations/", "wrangler.jsonc"]) assert.ok(ignore.includes(f), f + " is ignored by the static assets");
  const ops = read("PRIVACY-OPERATIONS.md");
  assert.match(ops, /24 months/);
  assert.match(ops, /no automatic deletion/i);
  assert.match(ops, /CASL/);
});

test("policy: client feedback retention, record types and deletion disclosure", () => {
  assert.match(policyText, /Client feedback: up to 24 months after our last meaningful interaction with the client/);
  for (const phrase of ["authorized us to publish", "ongoing client relationship", "contractual or legal requirement", "Published testimonials", "Other business records", "Assessment inquiries and related prospect information"]) {
    assert.ok(policyText.includes(phrase), phrase);
  }
  assert.match(policyText, /remove that record from our main database/);
  for (const place of ["inbox", "Resend", "Cloudflare database backups", "Worker logs", "files we have exported", "any other third party"]) {
    assert.ok(policyText.includes(place), "deletion disclosure names " + place);
  }
  assert.ok(!/(removes?|deletes?) (it|the record|your (data|information)) (from|in) (all|every)/i.test(policyText), "no claim that deletion reaches every system");
});

test("operations guide: retention rules, last interaction, search and off-system review", () => {
  const ops = readFileSync(new URL("../../PRIVACY-OPERATIONS.md", import.meta.url), "utf8");
  for (const phrase of ["24 months after the last meaningful interaction", "COALESCE(last_interaction_at, created_at)", "last_interaction_at", "no automatic deletion", "ongoing client relationship", "Resend", "Time Travel", "Workers Logs", "Downloaded exports", "Other third parties", "search box"]) {
    assert.ok(ops.toLowerCase().includes(phrase.toLowerCase()), phrase);
  }
});

test("policy: describes the client portal accurately: data, WorkOS, access, retention, requests, cookies and MFA without overclaiming", () => {
  if (!portalExpected) return assert.ok(!/client portal/i.test(policyText), "a website-only policy must not make partial portal statements: either all the portal disclosures or none");
  const portal = policyText.slice(policyText.indexOf("The client portal The client portal is available only"));
  assert.match(policyText, /invitation-only area where clients sign in/);
  for (const must of ["Business Profile information", "name, industry, location, products and services, target customers, business goals, competitors, online presence, primary contact and brand preferences", "preferred project timeline, your approximate budget and any existing brand materials or websites", "These additional questions are optional. You may choose not to disclose a budget.", "assess your needs, prepare proposals, plan projects and deliver services", "personal information about individuals you identify", "Portal feedback", "Sign-in and security records", "Activity records", "Invitation records", "WorkOS", "one-time code", "__Host-fw_auth", "__Host-fw_portal", "Resend"]) assert.ok(policyText.includes(must), must);
  assert.match(policyText, /Authorized Framework personnel can view client information in our private administration area only when needed to deliver services, give support, keep the portal secure, or administer accounts/);
  assert.match(policyText, /Each organization can see only its own information/);
  assert.match(policyText, /kept while the client relationship continues, subject to any legal or contractual obligations/);
  assert.match(policyText, /We review inactive beta accounts after 12 months, and delete information we no longer need, subject to the legal and operational retention requirements/);
  assert.match(policyText, /We aim to acknowledge a request within 5 business days and to complete an eligible deletion request within 30 calendar days/);
  assert.match(policyText, /These are targets, not guarantees/);
  assert.match(policyText, /we have not been able to confirm a specific location/);
  assert.ok(policyText.includes("we do not currently require a second sign-in step for clients"), "it says what is true today: email code only for clients");
  // MFA is described as an expectation for staff, never as something enforced for clients or verified
  const mfa = policyText.match(/[^.]*(multi-factor|second sign-in|second factor)[^.]*\./gi) || [];
  assert.equal(mfa.length, 2, "exactly the two reviewed sentences mention it");
  assert.ok(!/(require|enforce)[a-z]* (multi-factor|MFA|two-factor)/i.test(policyText.replace(/we do not currently require a second sign-in step for clients/i, "")), "no claim that MFA is required or enforced");
  assert.ok(!/certif|SOC ?2|ISO ?27001|HIPAA|GDPR|PIPEDA|fully compliant|bank-level|military/i.test(policyText), "no certification or compliance claims");
  assert.ok(!/data (is|are) (stored|kept|processed) (only )?in (canada|the united states|the us)/i.test(policyText), "no data residency promise");
  assert.ok(!/payment card|credit card/i.test(policyText.replace(/We do not ask you for payment card details or government identification in the portal\./, "")));
  assert.ok(portal.length > 0);
});

test("policy: every portal data category it lists exists in the portal's schema, and the cookies and limits match the code", () => {
  if (!portalExpected) return assert.ok(!/client portal/i.test(policyText), "a website-only policy must not make partial portal statements: either all the portal disclosures or none");
  const schema = ["0001_portal_foundation", "0002_business_profile", "0003_portal_feedback", "0004_invitation_delivery"].map((f) => read(`migrations/portal/${f}.sql`)).join("\n");
  for (const table of ["portal_users", "memberships", "invitations", "portal_sessions", "activity_log", "business_profile_answers", "portal_feedback"]) assert.ok(schema.includes(table), table);
  assert.match(schema, /ip_hash/); assert.match(schema, /auth_method/); assert.match(schema, /delivery_status/);
  const http = read("worker/portal/http.js"), sessions = read("worker/portal/repo/sessions.js"), auth = read("worker/portal/auth.js");
  assert.match(http, /SESSION_COOKIE = "__Host-fw_portal"/); assert.match(http, /STATE_COOKIE = "__Host-fw_auth"/);
  assert.match(auth, /STATE_TTL_SECONDS = 600/, "10 minutes");
  assert.match(sessions, /DEFAULT_IDLE_SECONDS = 12 \* 3600/); assert.match(sessions, /DEFAULT_ABSOLUTE_SECONDS = 14 \* 86400/);
  for (const text of ["12 hours without activity", "14 days at most"]) assert.ok(policyText.includes(text), text);
  assert.ok(policyText.includes("expires after 10 minutes"));
  const fields = read("worker/portal/profile-schema.js");
  for (const label of ["Legal business name", "Operating name", "Industry", "What does your business do?", "Who are your target customers?", "Who are your main competitors?", "Existing website", "Social platforms you use"]) assert.ok(fields.includes(label), label);
});
