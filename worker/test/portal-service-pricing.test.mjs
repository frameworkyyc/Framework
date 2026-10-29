/* Branding service pricing: one global, Admin-editable price per Branding service (migration 0010), shown quietly in the client's Branding sections beside the request button and
   recorded with the request. Starting at / Custom Quote / Included, whole Canadian dollars. A database without the migration shows no prices and behaves exactly as before. No checkout,
   payment or invoicing. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld, csrfOf } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as brand from "../portal/repo/brand.js";
import * as P from "../portal/branding-pricing.js";
import { BRAND_REQUESTS } from "../portal/brand-services.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const nowS = () => Math.floor(Date.now() / 1000);
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const rowsOf = (w, q, ...p) => w.db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const base = (s) => `/portal/o/${s}/branding`;
const MIGRATION = read("migrations/portal/0010_service_pricing.sql");
const sectionHtml = (html, key) => { const i = html.indexOf(`<section class="bk-sec" id="${key}"`); return html.slice(i, html.indexOf("</section>", i)); };

const PRICES = { "logo-primary": 500, "logo-secondary": 150, "logo-simplified": 150, "logo-submark": 150, typography: 250, colours: 200, tagline: 250, imagery: 300, layout: 350, textures: 150, iconography: 250, style: 350, "brand-kit": 2500 };

async function setup({ migrated = true } = {}) {
  resetKeyCacheForTests();
  const w = await makeWorld();
  Object.assign(w.env, { PORTAL_BRANDING: "1", PORTAL_FILES: fakeR2(), PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) });
  const alpha = await w.org("alpha", "Alpha Co"), beta = await w.org("beta", "Beta Co");
  await w.invite(alpha, "ann@alpha.test", "owner"); await w.invite(alpha, "mia@alpha.test", "member"); await w.invite(beta, "bob@beta.test", "owner");
  const ann = w.browser(), mia = w.browser(), bob = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(2, "mia@alpha.test")); await bob.signIn(w.user(3, "bob@beta.test"));
  if (!migrated) w.db.raw.exec("DROP TABLE service_prices; ALTER TABLE service_requests DROP COLUMN price_snapshot"); // a database as it is before migration 0010 (every test world starts fully migrated)
  const csrf = async (b, slug) => csrfOf(await (await b.get(base(slug))).text());
  const send = async (b, slug, fields = {}) => b.post(`${base(slug)}/request`, { csrf: await csrf(b, slug), ...fields });
  const admin = async (path, { method = "GET", json, headers = {} } = {}) => {
    const h = { Origin: ORIGIN, "Cf-Access-Jwt-Assertion": sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, exp: nowS() + 600, iat: nowS() }), ...(method !== "GET" ? { "X-Framework-Admin": "1", "Content-Type": "application/json" } : {}), ...headers };
    const res = await handleAdmin(new Request(ORIGIN + "/api/admin" + path, { method, headers: h, body: json === undefined ? undefined : JSON.stringify(json) }), w.env, {});
    return { status: res.status, json: await res.json() };
  };
  const setPrices = (prices) => admin("/service-pricing", { method: "POST", json: { prices } });
  const publish = async (org, kit = {}) => { assert.ok((await brand.saveBrandKit(w.db, org.id, kit, ADMIN)).ok); assert.ok((await brand.setBrandKitStatus(w.db, org.id, "published", ADMIN)).ok); };
  return { w, alpha, beta, ann, mia, bob, send, admin, setPrices, publish };
}

test("the catalogue: thirteen services in section order with Framework's starting prices; each has its own request key (the complete kit keeps its existing one)", () => {
  assert.deepEqual(P.PRICING_SERVICES.filter((s) => s.section !== "website" && s.section !== "addon").map((s) => [s.key, s.name, s.defaultCad]), [
    ["logo-primary", "Primary Logo", 500], ["logo-secondary", "Secondary Logo", 150], ["logo-simplified", "Simplified Logo", 150], ["logo-submark", "Sub-mark", 150], ["typography", "Typography", 250], ["colours", "Brand Colours", 200], ["tagline", "Tagline", 250],
    ["imagery", "Brand Imagery", 300], ["layout", "Layout System", 350], ["textures", "Textures", 150], ["iconography", "Iconography", 250], ["style", "Design Style", 350], ["brand-kit", "Complete Brand Kit", 2500]]);
  assert.deepEqual(Object.fromEntries(P.PRICING_SERVICES.filter((s) => s.section !== "website" && s.section !== "addon").map((s) => [s.key, s.defaultCad])), PRICES);
  assert.deepEqual(P.PRICING_TYPES, ["starting_at", "custom_quote", "included"]);
  assert.equal(P.requestKeyOf("brand-kit"), "brand-full-kit"); assert.equal(P.requestKeyOf("logo-secondary"), "brand-svc-logo-secondary");
  for (const s of P.PRICING_SERVICES.filter((x) => x.section !== "website" && x.section !== "addon")) { assert.ok(BRAND_REQUESTS.some((r) => r.key === P.requestKeyOf(s.key)), s.key + " can be requested"); assert.equal(P.pricingKeyOfRequest(P.requestKeyOf(s.key)), s.key); }
  assert.equal(P.pricingKeyOfRequest("brand-colours"), null);
  assert.equal(P.priceLabel({ type: "starting_at", priceCad: 250 }), "Starting at $250 CAD"); assert.equal(P.priceLabel({ type: "starting_at", priceCad: 2500 }), "Starting at $2,500 CAD");
  assert.equal(P.priceLabel({ type: "custom_quote" }), "Custom quote"); assert.equal(P.priceLabel({ type: "included" }), "Included");
  for (const bad of [{ type: "starting_at", priceCad: 0 }, { type: "starting_at", priceCad: 12.5 }, { type: "starting_at", priceCad: null }, { type: "starting_at", priceCad: 1000001 }, { type: "bogus" }, null]) assert.equal(P.priceLabel(bad), "");
  assert.deepEqual(P.pricingFrom([{ service_key: "typography", price_type: "starting_at", price_cad: 250 }, { service_key: "nope", price_type: "included", price_cad: null }, { service_key: "colours", price_type: "starting_at", price_cad: 0 }]).typography.label, "Starting at $250 CAD");
  assert.deepEqual(Object.keys(P.pricingFrom([{ service_key: "typography", price_type: "starting_at", price_cad: 250 }, { service_key: "nope", price_type: "included", price_cad: null }, { service_key: "colours", price_type: "starting_at", price_cad: 0 }])), ["typography"], "unknown services and invalid rows are never shown");
  assert.deepEqual(P.pricingFrom([]), {});
  const svc = P.pricingService("typography");
  assert.equal(svc.offerTitle, "Professional Typography Design"); assert.deepEqual(svc.upload, ["Already have your fonts?", "Upload them for free"]);
  const box = P.offerBox({ service: { ...svc, offerTitle: "<b>Professional Typography Design</b>" }, entry: { type: "starting_at", priceCad: 250 }, action: "<i>ACT</i>", uploadHref: "/up" });
  assert.match(box, /<h3 class="bk-offer__title">&lt;b&gt;Professional Typography Design&lt;\/b&gt;<\/h3>/, "titles are escaped"); assert.match(box, /<i>ACT<\/i>/);
  assert.match(box, /<p class="bk-offer__price">Starting at \$250 CAD<\/p>/); assert.ok(!/estimate/.test(box), "no disclaimer inside an offer: one general note sits on the page"); assert.match(box, /bk-offer__free"><p>Already have your fonts\? <a class="text-link" href="\/up">Upload them for free<\/a>\.<\/p>/);
  assert.ok(!/<p class="bk-offer__desc|Framework can|Needed to use|Optional, but/.test(box), "no description, lead or messaging paragraphs");
  const bare = P.offerBox({ service: P.pricingService("tagline"), entry: null, action: "", uploadHref: "" });
  assert.ok(!/bk-offer__price|bk-offer__estimate|bk-offer__free/.test(bare), "no price, estimate line or upload block when there is nothing to show"); assert.match(bare, /Professional Tagline Development/);
  assert.deepEqual(P.PRICING_SERVICES.filter((x) => x.section !== "website" && x.section !== "addon").map((x) => x.offerTitle), ["Primary Logo Design", "Secondary Logo Design", "Simplified Logo Design", "Sub-mark Design", "Professional Typography Design", "Professional Colour Palette Design", "Professional Tagline Development", "Professional Imagery Direction", "Professional Layout System Design", "Professional Texture & Pattern Design", "Professional Icon Design", "Professional Design Style Guide", "Complete Brand Kit"]);
});

test("migration 0010 is additive: it seeds the thirteen starting prices, enforces its rules, adds a nullable snapshot column, and leaves existing requests untouched", async () => {
  assert.ok(!/\b(DROP|DELETE|UPDATE)\b/i.test(MIGRATION.replace(/--.*$/gm, "")), "nothing that exists is removed or changed");
  const s = await setup({ migrated: false });
  await s.send(s.ann, "alpha", { section: "brand-colours", note: "Before the migration" });
  const before = rowsOf(s.w, "SELECT * FROM service_requests");
  assert.equal(before.length, 1);
  s.w.db.raw.exec(MIGRATION);
  assert.deepEqual(Object.fromEntries(rowsOf(s.w, "SELECT service_key, price_cad FROM service_prices").map((r) => [r.service_key, r.price_cad])), PRICES);
  assert.ok(rowsOf(s.w, "SELECT price_type FROM service_prices").every((r) => r.price_type === "starting_at"));
  const after = rowsOf(s.w, "SELECT * FROM service_requests");
  assert.deepEqual({ ...after[0], price_snapshot: undefined }, { ...before[0], price_snapshot: undefined }, "the existing request is unchanged");
  assert.equal(after[0].price_snapshot, null, "and has no price recorded");
  const ins = (key, type, cad) => s.w.db.raw.prepare("INSERT INTO service_prices (service_key, price_type, price_cad, updated_by, updated_at) VALUES (?, ?, ?, 'x', 't')").run(key, type, cad);
  s.w.db.raw.exec("DELETE FROM service_prices");
  assert.throws(() => ins("typography", "custom_quote", 100), /constraint/i, "an amount only with Starting at");
  assert.throws(() => ins("typography", "starting_at", null), /constraint/i, "Starting at needs an amount");
  assert.throws(() => ins("typography", "starting_at", 0), /constraint/i); assert.throws(() => ins("typography", "starting_at", 1000001), /constraint/i);
  assert.throws(() => ins("typography", "free", null), /constraint/i); assert.throws(() => ins("Bad Key!", "included", null), /constraint/i);
  assert.doesNotThrow(() => ins("typography", "custom_quote", null)); assert.doesNotThrow(() => ins("colours", "included", null)); assert.doesNotThrow(() => ins("tagline", "starting_at", 99));
  assert.throws(() => s.w.db.raw.prepare("UPDATE service_requests SET price_snapshot = ? WHERE id = ?").run("[1]", before[0].id), /constraint/i, "the snapshot is a small JSON object");
  assert.throws(() => s.w.db.raw.prepare("UPDATE service_requests SET price_snapshot = ? WHERE id = ?").run("{" + '"a":"' + "x".repeat(700) + '"}', before[0].id), /constraint/i);
});

test("Admin API: lists all thirteen services with their prices and types; a database without the migration lists the defaults as unavailable and refuses to save", async () => {
  const s = await setup();
  const r = await s.admin("/service-pricing");
  assert.equal(r.status, 200); assert.equal(r.json.available, true); assert.equal(r.json.capabilities.writes, true);
  assert.deepEqual(r.json.types, [{ key: "starting_at", label: "Starting at" }, { key: "custom_quote", label: "Custom quote" }, { key: "included", label: "Included" }]);
  assert.deepEqual(r.json.services.slice(0, 13).map((x) => [x.key, x.type, x.priceCad]), P.PRICING_SERVICES.slice(0, 13).map((x) => [x.key, "starting_at", x.defaultCad]));
  assert.ok(r.json.services.slice(0, 13).every((x) => x.stored && x.name && x.description && x.section));
  assert.deepEqual(r.json.services.slice(13, 17).map((x) => [x.key, x.type, x.priceCad, x.stored]), [["website-design", "custom_quote", null, true], ["website-redesign", "custom_quote", null, true], ["website-seo", "custom_quote", null, true], ["website-maintenance", "custom_quote", null, true]], "the website services are custom quotes, stored by migration 0011")
  const bare = await setup({ migrated: false });
  const b = await bare.admin("/service-pricing");
  assert.equal(b.json.available, false); assert.deepEqual(b.json.services.map((x) => x.priceCad), P.PRICING_SERVICES.map((x) => x.defaultCad)); assert.ok(b.json.services.every((x) => !x.stored));
  const refused = await bare.setPrices([{ key: "typography", type: "included" }]);
  assert.equal(refused.status, 409); assert.equal(refused.json.error, "unavailable");
});

test("Admin API: edits save, are audited once per changed service, an unchanged save writes nothing, and a Custom Quote or Included entry carries no amount", async () => {
  const s = await setup();
  const r = await s.setPrices([{ key: "typography", type: "starting_at", priceCad: 275 }, { key: "colours", type: "custom_quote" }, { key: "tagline", type: "included", priceCad: 999 }, { key: "style", type: "starting_at", priceCad: 350 }]);
  assert.equal(r.status, 200);
  const got = Object.fromEntries(r.json.services.map((x) => [x.key, [x.type, x.priceCad]]));
  assert.deepEqual(got.typography, ["starting_at", 275]); assert.deepEqual(got.colours, ["custom_quote", null]); assert.deepEqual(got.tagline, ["included", null], "an amount sent with Included is dropped"); assert.deepEqual(got.style, ["starting_at", 350]);
  assert.deepEqual(got["logo-primary"], ["starting_at", 500], "untouched services keep their price");
  const log = rowsOf(s.w, "SELECT actor_type, actor_ref, organization_id, visibility, detail FROM activity_log WHERE action = 'service_price.updated' ORDER BY created_at, detail");
  assert.equal(log.length, 3, "style was unchanged: nothing written for it");
  assert.ok(log.every((l) => l.actor_type === "admin" && l.actor_ref === ADMIN && l.organization_id === null && l.visibility === "internal"));
  assert.deepEqual(JSON.parse(log.find((l) => /typography/.test(l.detail)).detail), { service: "typography", name: "Typography", from: { type: "starting_at", priceCad: 250 }, to: { type: "starting_at", priceCad: 275 } });
  await s.setPrices([{ key: "typography", type: "starting_at", priceCad: 275 }]);
  assert.equal(rowsOf(s.w, "SELECT count(*) n FROM activity_log WHERE action = 'service_price.updated'")[0].n, 3, "a repeated save adds no entries");
  assert.equal(rowsOf(s.w, "SELECT updated_by FROM service_prices WHERE service_key = 'typography'")[0].updated_by, ADMIN);
});

test("Admin API validation: only the thirteen services, the three types and whole dollars from 1 to 1,000,000; one bad entry saves nothing", async () => {
  const s = await setup();
  const ok1 = { key: "typography", type: "starting_at", priceCad: 300 };
  const cases = [
    [{ key: "nope", type: "included" }, "invalid_service"], [{ key: "__proto__", type: "included" }, "invalid_service"], [{ type: "included" }, "invalid_service"], [null, "invalid_service"],
    [{ key: "colours", type: "free" }, "invalid_type"], [{ key: "colours", type: "starting_at", priceCad: 0 }, "invalid_price"], [{ key: "colours", type: "starting_at", priceCad: -5 }, "invalid_price"],
    [{ key: "colours", type: "starting_at", priceCad: 12.5 }, "invalid_price"], [{ key: "colours", type: "starting_at", priceCad: "250" }, "invalid_price"], [{ key: "colours", type: "starting_at", priceCad: 1000001 }, "invalid_price"], [{ key: "colours", type: "starting_at" }, "invalid_price"],
  ];
  for (const [bad, code] of cases) {
    const r = await s.setPrices([ok1, bad]);
    assert.equal(r.status, 422, JSON.stringify(bad)); assert.equal(r.json.error, code, JSON.stringify(bad));
  }
  assert.equal((await s.setPrices([ok1, ok1])).status, 422, "a service twice in one request");
  assert.equal((await s.setPrices([])).status, 422); assert.equal((await s.admin("/service-pricing", { method: "POST", json: { prices: "x" } })).status, 422);
  assert.equal((await s.admin("/service-pricing", { method: "POST", json: { prices: [ok1], extra: 1 } })).status >= 400, true, "unknown fields are refused");
  assert.equal(rowsOf(s.w, "SELECT price_cad FROM service_prices WHERE service_key = 'typography'")[0].price_cad, 250, "nothing was written by any refused request");
  assert.equal(rowsOf(s.w, "SELECT count(*) n FROM activity_log WHERE action = 'service_price.updated'")[0].n, 0);
  assert.equal((await s.setPrices([{ key: "colours", type: "starting_at", priceCad: 1 }, { key: "layout", type: "starting_at", priceCad: 1000000 }])).status, 200, "the limits themselves are allowed");
});

test("Admin API guards: writes need PORTAL_ADMIN_WRITES and the admin header; reads and writes need an admin; other methods are refused", async () => {
  const s = await setup();
  s.w.env.PORTAL_ADMIN_WRITES = "0";
  const off = await s.setPrices([{ key: "typography", type: "included" }]);
  assert.equal(off.status, 403); assert.equal(off.json.error, "writes_disabled");
  assert.equal((await s.admin("/service-pricing")).json.capabilities.writes, false);
  s.w.env.PORTAL_ADMIN_WRITES = "1";
  const noHeader = await handleAdmin(new Request(ORIGIN + "/api/admin/service-pricing", { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, exp: nowS() + 600, iat: nowS() }) }, body: JSON.stringify({ prices: [{ key: "typography", type: "included" }] }) }), s.w.env, {});
  assert.equal(noHeader.status, 403);
  const anon = await handleAdmin(new Request(ORIGIN + "/api/admin/service-pricing"), s.w.env, {});
  assert.ok(anon.status === 401 || anon.status === 403, "no admin, no prices");
  const stranger = await handleAdmin(new Request(ORIGIN + "/api/admin/service-pricing", { headers: { "Cf-Access-Jwt-Assertion": sign({ iss: `https://${TEAM}`, aud: [AUD], email: "someone@else.test", exp: nowS() + 600, iat: nowS() }) } }), s.w.env, {});
  assert.equal(stranger.status, 403);
  assert.equal((await s.admin("/service-pricing", { method: "DELETE" })).status, 405);
  assert.equal(rowsOf(s.w, "SELECT count(*) n FROM service_prices")[0].n, 17);
});

test("client Branding with nothing added: every section offers its design service with a quiet price beside the request button, never in a heading, and always the free upload", async () => {
  const s = await setup();
  await s.publish(s.alpha);
  const html = await (await s.ann.get(base("alpha"))).text();
  const esc = (t) => t.replace(/[$.]/g, "\\$&");
  const price = (key) => `Starting at ${new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(PRICES[key])} CAD`;
  const logo = sectionHtml(html, "logo");
  for (const [name, key, title] of [["Primary Logo", "logo-primary", "Primary Logo Design"], ["Secondary Logo", "logo-secondary", "Secondary Logo Design"], ["Simplified Logo", "logo-simplified", "Simplified Logo Design"], ["Sub-mark", "logo-submark", "Sub-mark Design"]]) assert.match(logo, new RegExp(`bk-offer__title">${title}<\\/h3><p class="bk-offer__price">${esc(price(key))}`), name);
  assert.match(logo, /Logo <span class="bk-req bk-req--required">/); assert.ok(!/not yet provided/.test(html));
  for (const [sec, key] of [["typography", "typography"], ["colours", "colours"], ["tagline", "tagline"], ["imagery", "imagery"], ["layout", "layout"], ["textures", "textures"], ["iconography", "iconography"], ["style", "style"]]) {
    const h = sectionHtml(html, sec);
    assert.match(h, new RegExp(`bk-offer__price">${esc(price(key))}<`), sec + " shows its price");
    assert.ok(!/estimates, not final quotes/.test(h), sec + " carries no disclaimer of its own");
    assert.match(h, /<summary class="btn btn--primary">Request Design<span class="visually-hidden">: [^<]+ design<\/span>/, sec + " has the black request button with an accessible name");
    assert.match(h, /Already have [^<]+\? <a class="text-link" href="\/portal\/o\/alpha\/branding\/uploads">Upload (them|it) for free<\/a>\./, sec + " offers the free upload"); assert.match(h, /href="\/portal\/o\/alpha\/branding\/uploads"/);
  }
  assert.match(logo, /Already have your logos\? <a class="text-link"[^>]*>Upload them for free<\/a>/); assert.equal([...html.matchAll(/branding\/uploads">Upload (them|it) for free/g)].length, 9, "one free-upload link per section, none repeated");
  assert.ok(!/\$\d/.test([...html.matchAll(/<h[12][^>]*>[\s\S]*?<\/h[12]>/g)].map((m) => m[0]).join(" ")), "no price in any heading");
  assert.ok(!/\$\d/.test(html.slice(html.indexOf('class="bk-nav"'), html.indexOf("</nav>", html.indexOf('class="bk-nav"')))), "none in the section navigation");
  assert.match(html.slice(html.indexOf('class="brand-kit"')), /bk-kitprice__price">Starting at \$2,500 CAD</, "the complete kit shows its price");
  assert.ok(!/checkout|payment|pay now|buy now|add to cart|invoice/i.test(html.replace(/<nav[\s\S]*?<\/nav>/g, "").replace(/<a [^>]*>[^<]*<\/a>/g, "")), "nothing like a checkout");
});

test("completed branding gets no pricing prompt: a section with the client's content, or a logo variation they have, shows no offer", async () => {
  const s = await setup();
  await s.publish(s.alpha, { colours: [{ name: "Ink", role: "primary", hex: "#0A0A0A", note: "" }], typography: [{ role: "heading", slot: "primary", family: "Inter", weights: [400], styles: ["normal"], usage: "", source_url: "https://example.com", file_ids: [] }], sections: { tagline: { primary: "Clear thinking.", alternates: [], guidelines: "" } } });
  const html = await (await s.ann.get(base("alpha"))).text();
  for (const sec of ["colours", "typography", "tagline"]) assert.ok(!/bk-offer/.test(sectionHtml(html, sec)) && /<span class="bk-done">/.test(sectionHtml(html, sec)), sec + " is done: a checkmark and Complete, and no offer");
  assert.match(sectionHtml(html, "imagery"), /bk-offer/, "an empty section still offers it");
  assert.match(html.slice(html.indexOf('class="brand-kit"')), /bk-kitprice__price/, "the complete kit is still offered while sections are missing");
});

test("prices follow Admin: a changed price, Custom Quote and Included show at once on every client's page; an unpriced database shows no offers at all", async () => {
  const s = await setup();
  await s.publish(s.alpha); await s.publish(s.beta);
  assert.equal((await s.setPrices([{ key: "layout", type: "starting_at", priceCad: 425 }, { key: "textures", type: "custom_quote" }, { key: "iconography", type: "included" }])).status, 200);
  for (const [b, slug] of [[s.ann, "alpha"], [s.bob, "beta"]]) {
    const html = await (await b.get(base(slug))).text();
    assert.match(sectionHtml(html, "layout"), /bk-offer__price">Starting at \$425 CAD</); assert.match(sectionHtml(html, "textures"), /bk-offer__price">Custom quote</); assert.match(sectionHtml(html, "iconography"), /bk-offer__price">Included</);
    assert.match(sectionHtml(html, "imagery"), /Starting at \$300 CAD/, "global: both clients see the same");
  }
  const bare = await setup({ migrated: false });
  await bare.publish(bare.alpha);
  const html = await (await bare.ann.get(base("alpha"))).text();
  assert.ok(!/Starting at|bk-offer__price|bk-offer__estimate|bk-kitprice/.test(html), "without the table: no price and no estimate wording anywhere");
  assert.match(sectionHtml(html, "colours"), /<summary class="btn btn--primary">Request Design<span/, "the offer and its request button remain, without a price");
  assert.match(sectionHtml(html, "colours"), /Already have your brand colours\? <a [^>]*>Upload them for free<\/a>/);
});

test("requesting a priced service records the service and the price shown, takes it only from the server, and is reviewed in Admin", async () => {
  const s = await setup();
  await s.publish(s.alpha);
  const res = await s.send(s.ann, "alpha", { section: "brand-svc-logo-secondary", note: "Horizontal please.", price: "1", price_snapshot: '{"label":"Free"}' });
  assert.equal(res.status, 303); assert.equal(res.headers.get("Location"), `${base("alpha")}?requested=1`);
  const r = rowsOf(s.w, "SELECT organization_id, service_key, status, note, price_snapshot FROM service_requests");
  assert.equal(r.length, 1); assert.deepEqual([r[0].organization_id, r[0].service_key, r[0].status, r[0].note], [s.alpha.id, "brand-svc-logo-secondary", "new", "Horizontal please."]);
  assert.deepEqual(JSON.parse(r[0].price_snapshot), { service: "logo-secondary", name: "Secondary Logo", type: "starting_at", priceCad: 150, label: "Starting at $150 CAD" }, "the server's price, not anything from the form");
  assert.equal(rowsOf(s.w, "SELECT count(*) n FROM activity_log WHERE action = 'service.requested' AND organization_id = ?", s.alpha.id)[0].n, 1);
  const html = await (await s.ann.get(res.headers.get("Location"))).text();
  assert.match(sectionHtml(html, "logo"), /class="tag">Requested</, "the page shows the request's status");
  const view = await s.admin(`/clients/${s.alpha.id}/branding`);
  const req = view.json.requests.find((x) => x.serviceKey === "brand-svc-logo-secondary");
  assert.equal(req.service, "Design request: Secondary Logo"); assert.deepEqual(req.priceShown, { service: "logo-secondary", name: "Secondary Logo", type: "starting_at", priceCad: 150, label: "Starting at $150 CAD" });
  await s.setPrices([{ key: "logo-secondary", type: "starting_at", priceCad: 999 }]);
  assert.match(rowsOf(s.w, "SELECT price_snapshot FROM service_requests")[0].price_snapshot, /Starting at \$150 CAD/, "a later price change never rewrites what was shown");
  const dup = await s.send(s.ann, "alpha", { section: "brand-svc-logo-secondary" });
  assert.equal(dup.headers.get("Location"), `${base("alpha")}?requested=0`); assert.equal(rowsOf(s.w, "SELECT count(*) n FROM service_requests")[0].n, 1, "no duplicate while one is open");
  const kit = await s.send(s.ann, "alpha", { section: "brand-full-kit" });
  assert.equal(kit.headers.get("Location"), `${base("alpha")}?requested=1`);
  assert.equal(JSON.parse(rowsOf(s.w, "SELECT price_snapshot FROM service_requests WHERE service_key = 'brand-full-kit'")[0].price_snapshot).label, "Starting at $2,500 CAD");
  await s.send(s.ann, "alpha", { section: "brand-colours" });
  assert.equal(rowsOf(s.w, "SELECT price_snapshot FROM service_requests WHERE service_key = 'brand-colours'")[0].price_snapshot, null, "a request that was shown no price records none");
  await s.setPrices([{ key: "tagline", type: "custom_quote" }, { key: "style", type: "included" }]);
  await s.send(s.ann, "alpha", { section: "brand-svc-tagline" }); await s.send(s.ann, "alpha", { section: "brand-svc-style" });
  assert.deepEqual(rowsOf(s.w, "SELECT service_key, price_snapshot FROM service_requests WHERE service_key IN ('brand-svc-tagline','brand-svc-style') ORDER BY service_key").map((x) => [x.service_key, JSON.parse(x.price_snapshot).label]), [["brand-svc-style", "Included"], ["brand-svc-tagline", "Custom quote"]]);
});

test("request safety: members cannot request, unknown services are refused, another organization never sees or changes the request, and uploading stays free", async () => {
  const s = await setup();
  await s.publish(s.alpha); await s.publish(s.beta);
  assert.equal((await s.send(s.mia, "alpha", { section: "brand-svc-logo-primary" })).status, 403, "a member cannot send a request");
  assert.equal(rowsOf(s.w, "SELECT count(*) n FROM service_requests")[0].n, 0);
  assert.equal((await s.send(s.ann, "alpha", { section: "brand-svc-nothing" })).status, 400);
  assert.equal((await s.send(s.ann, "alpha", { section: "brand-svc-brand-kit" })).status, 400, "the kit is requested under its own key only");
  await s.send(s.ann, "alpha", { section: "brand-svc-typography" });
  const bobHtml = await (await s.bob.get(base("beta"))).text();
  assert.ok(!/class="tag">Requested</.test(sectionHtml(bobHtml, "typography")), "another organization sees no trace of it");
  assert.equal((await s.bob.get(base("alpha"))).status >= 400 || !/Alpha Co/.test(await (await s.bob.get(base("alpha"))).text()), true);
  const mia = await (await s.mia.get(base("alpha"))).text();
  assert.match(sectionHtml(mia, "typography"), /Requested/, "members see the status");
  assert.match(sectionHtml(mia, "imagery"), /Ask an owner of your organization to send a request/, "and are told an owner sends requests");
  assert.equal((await s.ann.get(`${base("alpha")}/uploads`)).status, 200, "the upload area is untouched and free");
});

test("Admin Settings wiring: Settings is a real module with the hub and the Service Pricing page; no inline styles; the editor posts to the pricing API and names every control", () => {
  const modules = read("admin/assets/modules.js"), ui = read("admin/assets/settings.js"), css = read("admin/assets/admin.css");
  assert.match(modules, /id: "settings"[^\n]*enabled: true[^\n]*import\("\.\/settings\.js"\)/);
  assert.match(ui, /\/admin\/settings\/service-pricing/); assert.match(ui, /api\("\/service-pricing"/); assert.match(ui, /method: "POST", body: \{ prices \}/);
  assert.match(ui, /Pricing<\/?|"Pricing"/); assert.match(ui, /"Price \(CAD\)"/); assert.match(ui, /visually-hidden/, "each field is named for its service");
  assert.ok(!/style:|\.style\b|innerHTML|insertAdjacentHTML/.test(ui), "no inline styles and no HTML injection");
  assert.match(css, /\.adm-pricing__row/); assert.match(css, /@media \(max-width: 720px\)[^}]*adm-pricing__row/);
  const portalCss = read("assets/css/portal.css");
  assert.match(portalCss, /\.bk-offer \{/); assert.ok(!/bk-design/.test(portalCss)); assert.ok(!/bk-price/.test(portalCss), "the earlier prominent price block is gone");
  assert.ok(!/stripe|paypal|payment_intent/i.test(ui + read("worker/portal/branding-pricing.js") + read("worker/portal/admin-pricing.js")), "no payment processing");
});
