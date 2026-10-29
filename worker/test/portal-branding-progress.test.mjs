/* Branding progress: a quiet completion mark beside each section in the navigation (Logo 1/4 to 3/4, a checkmark at 4/4; a checkmark for the other eight only with real published
   content) and a Required / Recommended label beside each section name. Examples never count, a request never completes anything, and a Recommended section becomes Required for
   one client only through an explicit dependency (brand-requirements.js SERVICE_REQUIRES) while a request for that service is open. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld, csrfOf } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as brand from "../portal/repo/brand.js";
import { brandingOverview } from "../portal/branding-live.js";
import { requirementsFor, completionOf, DEFAULT_REQUIREMENT, SERVICE_REQUIRES, REQUIREMENT_LABEL } from "../portal/brand-requirements.js";
import { BRAND_REQUESTS, BRANDING_SERVICES } from "../portal/brand-services.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const nowS = () => Math.floor(Date.now() / 1000);
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const base = "/portal/o/alpha/branding";
const KEYS = ["logo", "typography", "colours", "tagline", "imagery", "layout", "textures", "iconography", "style"];

async function setup() {
  resetKeyCacheForTests();
  const w = await makeWorld();
  Object.assign(w.env, { PORTAL_BRANDING: "1", PORTAL_FILES: fakeR2(), PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) });
  const A = await w.org("alpha", "Alpha Co");
  await w.invite(A, "ann@alpha.test", "owner");
  const ann = w.browser(); await ann.signIn(w.user(1, "ann@alpha.test"));
  const call = async (path, { method = "GET", json, form } = {}) => {
    const h = { Origin: ORIGIN, "Cf-Access-Jwt-Assertion": sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: nowS(), exp: nowS() + 600 }), ...(method !== "GET" ? { "X-Framework-Admin": "1" } : {}) };
    let body;
    if (form) { const packed = new Response(form); const buf = new Uint8Array(await packed.arrayBuffer()); h["Content-Type"] = packed.headers.get("Content-Type"); h["Content-Length"] = String(buf.length); body = buf; }
    else if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    const res = await handleAdmin(new Request(ORIGIN + "/api/admin" + path, { method, headers: h, body }), w.env, {});
    return { status: res.status, json: (res.headers.get("Content-Type") || "").includes("json") ? await res.json() : null };
  };
  const upload = (meta, name, bytes) => { const f = new FormData(); f.append("file", new File([bytes], name)); f.append("meta", JSON.stringify(meta)); return call(`/clients/${A.id}/branding/assets`, { method: "POST", form: f }); };
  const logo = async (role, extra = {}) => assert.equal((await upload({ kind: "logo", logo_role: role, orientation: "square", tone: "light", published: true, ...extra }, `${role}.png`, S.png(12, 12))).status, 201);
  let seq = 0;
  const section = async (key, published = true) => assert.equal((await upload({ kind: "other", title: key + seq, section: key, published }, `${key}${seq}.png`, S.png(10 + ++seq, 10))).status, 201);
  const publish = async (kit = {}) => { assert.ok((await brand.saveBrandKit(w.db, A.id, kit, ADMIN)).ok); assert.ok((await brand.setBrandKitStatus(w.db, A.id, "published", ADMIN)).ok); };
  const page = async () => (await ann.get(base)).text();
  return { w, A, ann, call, upload, logo, section, publish, page };
}
/** The navigation entries: { key: { mark: "1/4" | "check" | "", sr: visually-hidden text } }. */
const nav = (html) => {
  const ol = html.slice(html.indexOf('class="bk-nav"'), html.indexOf("</nav>", html.indexOf('class="bk-nav"')));
  return Object.fromEntries([...ol.matchAll(/<li><a href="#(\w+)">([\s\S]*?)<\/a><\/li>/g)].map((m) => [m[1], { mark: /bk-nav__mark--done/.test(m[2]) ? "check" : (/aria-hidden="true">(\d\/4)</.exec(m[2]) || [, ""])[1], sr: [...m[2].matchAll(/visually-hidden">([^<]*)</g)].map((x) => x[1]).join("|"), html: m[2] }]));
};
const tags = (html) => Object.fromEntries(KEYS.map((k) => { const i = html.indexOf(`<section class="bk-sec" id="${k}"`); return [k, (/class="bk-req bk-req--(\w+)"/.exec(html.slice(i)) || [])[1]]; }));

test("defaults: Logo, Typography and Brand Colours are Required; the other six are Recommended", () => {
  assert.deepEqual(DEFAULT_REQUIREMENT, { logo: "required", typography: "required", colours: "required", tagline: "recommended", imagery: "recommended", layout: "recommended", textures: "recommended", iconography: "recommended", style: "recommended" });
  assert.deepEqual(REQUIREMENT_LABEL, { required: "Required", recommended: "Recommended" });
  assert.deepEqual(Object.values(requirementsFor([])).map((x) => x.level), KEYS.map((k) => DEFAULT_REQUIREMENT[k]));
});

test("dependency logic: only an explicit, open request makes a Recommended section Required for that client; closed, declined, unlisted and unknown requests change nothing", () => {
  const fixture = { "brand-svc-iconography": ["style", "colours"], "business-card-design": ["tagline"] };
  const lv = (reqs, table) => Object.fromEntries(Object.entries(requirementsFor(reqs, table)).map(([k, v]) => [k, v.level]));
  assert.equal(lv([{ serviceKey: "business-card-design", status: "new" }], fixture).tagline, "required", "requested");
  assert.equal(lv([{ serviceKey: "business-card-design", status: "contacted" }], fixture).tagline, "required", "in progress");
  for (const status of ["closed", "declined"]) assert.equal(lv([{ serviceKey: "business-card-design", status }], fixture).tagline, "recommended", status + " requires nothing");
  assert.equal(lv([{ serviceKey: "brand-svc-layout", status: "new" }], fixture).layout, "recommended", "a service that is not in the table adds nothing");
  assert.equal(lv([{ serviceKey: "constructor", status: "new" }, { serviceKey: "__proto__", status: "new" }], fixture).tagline, "recommended", "unknown and prototype keys are ignored");
  const both = requirementsFor([{ serviceKey: "brand-svc-iconography", status: "new" }, { serviceKey: "business-card-design", status: "new" }], fixture);
  assert.deepEqual([both.style.level, both.tagline.level, both.imagery.level], ["required", "required", "recommended"]);
  assert.deepEqual(both.style.becauseOf, ["brand-svc-iconography"]); assert.deepEqual(both.colours.becauseOf, [], "a section that was already Required is not 'because of' anything");
  assert.deepEqual(requirementsFor([{ serviceKey: "business-card-design", status: "new" }]).tagline, { level: "recommended", becauseOf: [] }, "the shipped table does not touch the Recommended sections");
  assert.deepEqual(Object.keys(SERVICE_REQUIRES).sort(), ["business-card-design", "email-signature-design"]);
  for (const [svc, secs] of Object.entries(SERVICE_REQUIRES)) { assert.ok(BRANDING_SERVICES.some((x) => x.key === svc) || BRAND_REQUESTS.some((x) => x.key === svc), svc + " is a real service"); assert.ok(secs.every((s) => KEYS.includes(s))); }
});

test("completion rules: Logo counts its four slots; the others need real content; nothing else counts", () => {
  const none = completionOf({ logoFilled: 0, typefaces: 0, fontFiles: 0, colours: 0, tagline: null, files: {} });
  assert.ok(KEYS.every((k) => !none[k].done)); assert.deepEqual([none.logo.count, none.logo.total], [0, 4]);
  assert.deepEqual([1, 2, 3, 4].map((n) => [completionOf({ logoFilled: n }).logo.count, completionOf({ logoFilled: n }).logo.done]), [[1, false], [2, false], [3, false], [4, true]]);
  assert.equal(completionOf({ typefaces: 1 }).typography.done, true); assert.equal(completionOf({ fontFiles: 2 }).typography.done, true); assert.equal(completionOf({ typefaces: 0, fontFiles: 0 }).typography.done, false);
  assert.equal(completionOf({ colours: 1 }).colours.done, true); assert.equal(completionOf({ colours: 0 }).colours.done, false);
  assert.equal(completionOf({ tagline: "Clear thinking." }).tagline.done, true); for (const t of [null, undefined, "", "   ", 5]) assert.equal(completionOf({ tagline: t }).tagline.done, false);
  assert.equal(completionOf({ files: { imagery: 1, style: 3 } }).imagery.done, true); assert.equal(completionOf({ files: { imagery: 1 } }).layout.done, false);
  assert.equal(completionOf({ files: { imagery: -1, layout: 1.5, textures: "2" } }).imagery.done, false, "only whole positive counts");
});

test("an empty client page: no marks anywhere, every section labelled by its default, examples never count", async () => {
  const s = await setup();
  for (const published of [false, true]) {
    if (published) await s.publish();
    const html = await s.page(), n = nav(html);
    assert.deepEqual(Object.keys(n), KEYS); assert.ok(KEYS.every((k) => n[k].mark === ""), "no mark while empty (published: " + published + ")");
    assert.ok(!/bk-nav__mark/.test(html), "no mark element at all");
    assert.deepEqual(tags(html), DEFAULT_REQUIREMENT);
    assert.match(n.logo.sr, /, required$/); assert.match(n.tagline.sr, /, recommended$/);
  }
});

test("Logo: 1/4, 2/4 and 3/4 follow the populated slots; a checkmark replaces the fraction at 4/4; unpublished files and the kit's draft state never count", async () => {
  const s = await setup();
  await s.publish();
  const seen = [];
  for (const role of ["primary", "secondary", "simplified", "icon"]) { await s.logo(role); const n = nav(await s.page()); seen.push(n.logo.mark); }
  assert.deepEqual(seen, ["1/4", "2/4", "3/4", "check"]);
  const html = await s.page();
  assert.match(nav(html).logo.sr, /, complete\|, required$/); assert.ok(!/\d\/4/.test(nav(html).logo.html), "the fraction is replaced, not shown beside the checkmark");
  const t = await setup(); await t.publish();
  await t.logo("primary", { published: false }); await t.logo("secondary");
  assert.equal(nav(await t.page()).logo.mark, "1/4", "an unpublished file is not counted");
  assert.match(nav(await t.page()).logo.sr, /1 of 4 logo variations added/);
  await brand.setBrandKitStatus(t.w.db, t.A.id, "draft", ADMIN);
  assert.equal(nav(await t.page()).logo.mark, "", "a kit that is not published shows the client nothing, so nothing counts");
  const u = await setup(); await u.publish(); await u.logo("primary"); await u.logo("primary", { tone: "dark" });
  assert.equal(nav(await u.page()).logo.mark, "1/4", "two files in one slot are still one slot");
});

test("the other eight sections: a checkmark only with real published content", async () => {
  const s = await setup();
  await s.publish({ colours: [{ name: "Ink", role: "primary", hex: "#0A0A0A", note: "" }], typography: [{ role: "heading", slot: "primary", family: "Inter", weights: [400], styles: ["normal"], usage: "", source_url: "https://example.com", file_ids: [] }], sections: { tagline: { primary: null, alternates: ["Only an alternate"], guidelines: null } } });
  let n = nav(await s.page());
  assert.equal(n.colours.mark, "check"); assert.equal(n.typography.mark, "check");
  assert.equal(n.tagline.mark, "", "alternates alone are not a tagline: the page itself says the primary hasn't been added");
  await s.section("imagery", false); n = nav(await s.page());
  assert.equal(n.imagery.mark, "", "an unpublished file is not shown to the client, so it does not count");
  await s.section("imagery"); await s.section("layout"); await s.section("textures"); await s.section("iconography"); await s.section("style");
  n = nav(await s.page());
  assert.deepEqual(KEYS.slice(4).map((k) => n[k].mark), ["check", "check", "check", "check", "check"]);
  assert.equal(n.logo.mark, "");
  await brand.saveBrandKit(s.w.db, s.A.id, { sections: { tagline: { primary: "Clear thinking.", alternates: [], guidelines: null } } }, ADMIN);
  assert.equal(nav(await s.page()).tagline.mark, "check", "a primary tagline completes it");
  assert.ok(!/bk-nav__mark/.test(nav(await s.page()).logo.html));
});

test("a request never completes a section, and the shipped dependencies change nothing visible; a section still shows its own Required / Recommended label", async () => {
  const s = await setup();
  await s.publish();
  const csrf = csrfOf(await s.page());
  for (const section of ["brand-svc-logo-primary", "brand-svc-tagline", "brand-full-kit", "business-card-design", "email-signature-design"]) assert.equal((await s.ann.post(`${base}/request`, { csrf, section })).status, 303, section);
  const html = await s.page(), n = nav(html);
  assert.ok(KEYS.every((k) => n[k].mark === ""), "five requests, no section complete");
  assert.deepEqual(tags(html), DEFAULT_REQUIREMENT, "business card and email signature need only what is already Required");
  assert.ok(!/bk-req__why/.test(html));
});

test("rendering an explicit dependency: the label turns to Required and says which request it is for; closing the request puts it back", () => {
  const vm = { base: "/portal/o/alpha" }, table = { "business-card-design": ["tagline", "imagery"] };
  const html = (requests) => brandingOverview(vm, { published: true, assets: [], colours: [], typography: [] }, { canRequest: true, csrf: "t", requests, requirementTable: table });
  const open = html({ "business-card-design": { serviceKey: "business-card-design", status: "new", createdAt: "2026-10-29T00:00:00Z" } });
  assert.deepEqual(tags(open), { ...DEFAULT_REQUIREMENT, tagline: "required", imagery: "required" });
  assert.match(open, /bk-req--required"><span class="visually-hidden">\(<\/span>Required<span class="bk-req__why"> · for your Business Card Design request<\/span>/);
  assert.match(nav(open).tagline.sr, /, required$/);
  assert.deepEqual(tags(html({ "business-card-design": { serviceKey: "business-card-design", status: "closed", createdAt: "2026-10-29T00:00:00Z" } })), DEFAULT_REQUIREMENT);
  assert.ok(!/bk-nav__mark/.test(open), "and requiring a section never marks it complete");
});

test("design and safety: text only (no colours, bars or inline styles), the navigation keeps its single column on phones, and everything is escaped", () => {
  const css = read("assets/css/portal.css"), live = read("worker/portal/branding-live.js");
  assert.match(css, /\.bk-nav__mark \{[^}]*margin-left: auto/); assert.match(css, /@media \(min-width: 600px\) \{ \.bk-nav__mark \{ margin-left: 10px; \} \}/, "beside its own section name in the three-column layout"); assert.match(css, /\.bk-req \{[^}]*font-size: 12px/); assert.ok(!/\.bk-(req|nav__mark)[^{]*\{[^}]*(background|border|box-shadow|width: \d+%)/.test(css), "no pills, bars or boxes");
  assert.match(css, /\.bk-nav ol \{[^}]*grid-template-columns: minmax\(0, 1fr\)/); assert.match(css, /@media \(min-width: 600px\) \{ \.bk-nav ol \{ grid-template-columns: repeat\(3/, "one column under 600px, three above");
  assert.ok(!/style="/.test(live.slice(live.indexOf("const markOf"), live.indexOf("const more ="))), "no inline styles");
  const vm = { base: "/portal/o/alpha" };
  const html = brandingOverview(vm, { published: true, assets: [], colours: [], typography: [] }, { canRequest: true, csrf: "t", requests: { x: { serviceKey: "x", status: "new" } }, requirementTable: { x: ["tagline"] } });
  assert.ok(!/<script|<img[^>]*onerror/i.test(html.slice(html.indexOf("bk-req")))); assert.match(html, /for your x request/, "an unknown service key is shown as plain escaped text");
});

/* ------------------------------------------------------------------ the status line and the design offer */
const NAMES = { logo: "Logo", typography: "Typography", colours: "Brand Colours", tagline: "Tagline", imagery: "Brand Imagery", layout: "Layout System", textures: "Textures", iconography: "Iconography", style: "Design Style" };
const secOf = (html, k) => { const i = html.indexOf(`<section class="bk-sec" id="${k}"`); return html.slice(i, html.indexOf("</section>", i)); };
const bodyOf = (html, k) => { const x = secOf(html, k); return x.slice(x.indexOf('<div class="bk-sec__body">') + 26); };

test("an incomplete section opens with its status and Required / Recommended label, then the offer, then the examples: in that order, in all nine sections", async () => {
  const s = await setup();
  await s.publish();
  const html = await s.page();
  for (const k of KEYS) {
    const body = bodyOf(html, k);
    const label = DEFAULT_REQUIREMENT[k] === "required" ? "Required" : "Recommended";
    assert.ok(body.startsWith(`<p class="bk-status"><span class="bk-status__text">${NAMES[k]} not yet provided</span> <span class="bk-req bk-req--${DEFAULT_REQUIREMENT[k]}">`), k + ": the status is the first thing under the heading, with its label beside it");
    assert.match(body.slice(0, 400), new RegExp(`${label}`), k);
    const offer = body.indexOf('<div class="bk-offer'), eg = Math.min(...["bk-eg", "lv-grid", "tf-grid"].map((c) => (body.indexOf(`class="${c}`) < 0 ? 1e9 : body.indexOf(`class="${c}`))));
    assert.ok(offer > 0 && offer < eg, k + ": the offer comes before the examples");
    assert.equal([...body.matchAll(/branding\/uploads"/g)].length, 1, k + ": exactly one upload link");
    assert.match(body.slice(body.indexOf('<div class="bk-offer')), /bk-offer__free"><p>Already have [^<]+\? <a class="text-link"[^>]*>Upload your existing branding for free<\/a>\./, k + ": the free upload sits in its own separated block");
    assert.match(body, /<summary class="btn btn--primary">Request Design<span/, k + ": a black Request Design button");
  }
});

test("messaging: firmer for Required sections, softer for Recommended; the logo offer lists only the missing variations, each with its own price and button", async () => {
  const s = await setup();
  await s.publish();
  let html = await s.page();
  for (const k of ["typography", "colours"]) { const b = bodyOf(html, k); assert.match(b, /Needed to use your brand consistently\./); assert.match(b, new RegExp(`<h3 class="bk-offer__lead">Framework can create your ${NAMES[k].toLowerCase()} for you\\.</h3>`)); assert.ok(!/Want help/.test(b)); }
  for (const k of ["tagline", "imagery", "layout", "textures", "iconography", "style"]) { const b = bodyOf(html, k); assert.match(b, /Optional, but it makes your brand stronger\./); assert.match(b, new RegExp(`<h3 class="bk-offer__lead">Want help with your ${NAMES[k].toLowerCase()}\\?</h3>`)); assert.ok(!/Needed to use/.test(b)); }
  assert.match(bodyOf(html, "logo"), /<h3 class="bk-offer__lead">Framework can create your logo for you\.<\/h3>/);
  assert.equal([...bodyOf(html, "logo").matchAll(/bk-offer__item"/g)].length, 4);
  await s.logo("primary"); await s.logo("icon");
  html = await s.page();
  const logo = bodyOf(html, "logo");
  assert.match(logo, /^<p class="bk-status"><span class="bk-status__text">2 of 4 logo variations provided<\/span>/);
  assert.deepEqual([...logo.matchAll(/bk-offer__name">([^<]+)</g)].map((m) => m[1]), ["Secondary Logo", "Simplified Logo"], "only the variations still missing");
  assert.match(logo, /<h3 class="bk-offer__lead">Framework can design the logo variations you’re missing\.<\/h3>/);
  assert.equal([...logo.matchAll(/<summary class="btn btn--primary">Request Design</g)].length, 2);
  assert.equal([...logo.matchAll(/branding\/uploads"/g)].length, 1);
});

test("a complete section shows one quiet line and no offer, and keeps its change request; the page never offers what is already done", async () => {
  const s = await setup();
  await s.publish({ colours: [{ name: "Ink", role: "primary", hex: "#0A0A0A", note: "" }], typography: [{ role: "heading", slot: "primary", family: "Inter", weights: [400], styles: ["normal"], usage: "", source_url: "https://example.com", file_ids: [] }], sections: { tagline: { primary: "Clear thinking.", alternates: [], guidelines: null } } });
  for (const r of ["primary", "secondary", "simplified", "icon"]) await s.logo(r);
  const html = await s.page();
  for (const k of ["logo", "typography", "colours", "tagline"]) {
    const b = bodyOf(html, k);
    assert.ok(b.startsWith(`<p class="bk-status bk-status--done"><svg`), k + ": a quiet complete line");
    assert.match(b.slice(0, 600), new RegExp(`${NAMES[k]} complete</span>`)); assert.ok(!/bk-offer|Request Design|not yet provided|Needed to use|Optional, but/.test(b), k + ": no offer or prompt");
  }
  for (const k of ["logo", "typography", "colours"]) assert.match(bodyOf(html, k), /Request additions or changes/, k + " keeps its existing change request");
  assert.match(bodyOf(html, "imagery"), /^<p class="bk-status">/, "an incomplete section still opens with its status");
});

test("existing requests, prices and snapshots are preserved: an open whole-section request shows its status instead of a second button, and a new Request Design records the price shown", async () => {
  const s = await setup();
  await s.publish();
  s.w.db.raw.exec(read("migrations/portal-proposed/0010_service_pricing.sql"));
  const csrf = csrfOf(await s.page());
  await s.ann.post(`${base}/request`, { csrf, section: "brand-typography", note: "earlier request" });
  await s.ann.post(`${base}/request`, { csrf, section: "brand-logos" });
  let html = await s.page();
  assert.match(bodyOf(html, "typography"), /class="tag">Requested</); assert.ok(!/<summary class="btn btn--primary">Request Design/.test(bodyOf(html, "typography")), "no second button beside an open request");
  assert.match(bodyOf(html, "typography"), /Starting at \$250 CAD/, "the price is still shown with the offer");
  const logo = bodyOf(html, "logo");
  assert.match(logo, /class="tag">Requested</); assert.ok(!/<summary class="btn btn--primary">Request Design/.test(logo), "an open logos request covers the section");
  assert.equal(await (async () => { const r = await s.ann.post(`${base}/request`, { csrf: csrfOf(html), section: "brand-svc-tagline", note: "Please" }); return r.headers.get("Location"); })(), `${base}?requested=1`);
  const row = s.w.db.raw.prepare("SELECT service_key, price_snapshot FROM service_requests WHERE service_key = 'brand-svc-tagline'").get();
  assert.equal(JSON.parse(row.price_snapshot).label, "Starting at $250 CAD");
  html = await s.page();
  assert.match(bodyOf(html, "tagline"), /class="tag">Requested</);
  assert.equal(s.w.db.raw.prepare("SELECT count(*) n FROM service_requests").get().n, 3);
});

test("design: monochrome and minimal: no colours, boxes or inline styles in the new component; one hairline around the free upload", () => {
  const css = read("assets/css/portal.css");
  const block = css.slice(css.indexOf("/* Branding sections that are not complete"), css.indexOf(".bk-kitprice__price"));
  assert.ok(block.length > 800, "the component's rules are together");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|box-shadow|background/.test(block), "no colours, shadows or fills");
  assert.equal([...block.matchAll(/border(?:-top)?: 1px solid var\(--hairline\)/g)].length, 2, "only the free-upload divider and the separators between logo rows");
  assert.match(block, /\.bk-offer__action \.brq > summary \{ min-height: 48px/); assert.ok(!/style="/.test(read("worker/portal/branding-pricing.js")));
});
