/* Additional Services per client (Recommended label, own order, Show/Hide) and the Nexus Fleet Tracker service, through the real router and Admin API in one world.
   Migrations 0015 to 0017 are proposed: tests ask for them by name, or leave 0017 out to prove everything else still works before it is applied. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld, ORIGIN as PORTAL_ORIGIN } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as sites from "../portal/repo/websites.js";
import * as sup from "../portal/repo/support.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ADMIN_ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const nowS = () => Math.floor(Date.now() / 1000);
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const rowsOf = (w, q, ...p) => w.db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const UUID0 = "00000000-0000-4000-8000-000000000000";

async function setup({ migrated = true, branding = false, m17 = true } = {}) {
  resetKeyCacheForTests();
  const w = await makeWorld(migrated && !m17 ? { proposed: ["0015_website_status_seo.sql", "0016_service_catalogue.sql"] } : migrated ? { proposed: ["0015_website_status_seo.sql", "0016_service_catalogue.sql", "0017_service_client_settings.sql"] } : {});
  const bucket = fakeR2();
  Object.assign(w.env, { PORTAL_FILES: bucket, PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) });
  w.env.PORTAL_WEBSITE = "1"; if (branding) w.env.PORTAL_BRANDING = "1";
  const A = await w.org("alpha", "Alpha Co"), Bo = await w.org("beta", "Beta Co");
  await w.invite(A, "ann@alpha.test", "owner"); await w.invite(A, "mia@alpha.test", "member"); await w.invite(Bo, "bob@beta.test", "owner");
  const ann = w.browser(), mia = w.browser(), bob = w.browser(), anon = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(2, "mia@alpha.test")); await bob.signIn(w.user(3, "bob@beta.test"));
  const call = async (path, { method = "GET", json, form } = {}) => {
    const h = { Origin: ADMIN_ORIGIN, "Cf-Access-Jwt-Assertion": sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: nowS(), exp: nowS() + 600 }), ...(method !== "GET" ? { "X-Framework-Admin": "1" } : {}) };
    let body;
    if (form) { const packed = new Response(form); const buf = new Uint8Array(await packed.arrayBuffer()); h["Content-Type"] = packed.headers.get("Content-Type"); h["Content-Length"] = String(buf.length); body = buf; }
    else if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    const res = await handleAdmin(new Request(ADMIN_ORIGIN + "/api/admin" + path, { method, headers: h, body }), w.env, {});
    const type = res.headers.get("Content-Type") || "";
    return { status: res.status, headers: res.headers, json: type.includes("json") ? await res.json() : null };
  };
  const site = async (org, over = {}) => { const r = await sites.createWebsite(w.db, org.id, { name: "Main website", url: "https://alpha.example.ca", origin: "client", status: "live", published: true, ...over }, ADMIN); assert.ok(r.ok, JSON.stringify(r)); return r.id; };
  const upload = (org, id, name, bytes) => { const f = new FormData(); f.append("file", new File([bytes], name)); return call(`/clients/${org.id}/websites/${id}/package`, { method: "POST", form: f }); };
  const publish = (org, id, published) => call(`/clients/${org.id}/websites/${id}/package/publish`, { method: "POST", json: { published } });
  const csrf = async (b, slug, path) => /name="csrf" value="([^"]+)"/.exec(await (await b.get(`/portal/o/${slug}${path}`)).text())[1];
  const send = async (b, path, fields, files = [], { slug = "alpha", csrfFrom = "/website", token } = {}) => {
    const fd = new FormData();
    fd.set("csrf", token ?? await csrf(b, slug, csrfFrom));
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    for (const [name, bytes] of files) fd.append("file", new Blob([bytes]), name);
    return b.send(`/portal/o/${slug}${path}`, { method: "POST", body: fd, headers: { "Sec-Fetch-Site": "same-origin", Origin: PORTAL_ORIGIN } });
  };
  const svc = async (b, fields, { slug = "alpha", token } = {}) => b.post(`/portal/o/${slug}/website/services/request`, { csrf: token ?? await csrf(b, slug, "/website"), ...fields });
  return { w, bucket, A, Bo, ann, mia, bob, anon, call, site, upload, publish, csrf, send, svc };
}
const html = async (r) => r.text();
const WEB_ZIP = () => S.zip([{ name: "index.html", data: S.text("<h1>hi</h1>") }, { name: "assets/app.js", data: S.text("console.log(1)") }, { name: "styles.css", data: S.text("body{}") }, { name: "contact.php", data: S.text("<?php ?>") }]);



const page = async (b, p = "/website", slug = "alpha") => (await b.get(`/portal/o/${slug}${p}`)).text();
const secOf = (h, id) => { const i = h.indexOf(`id="${id}"`); return i < 0 ? "" : h.slice(i, h.indexOf("</section>", i)); };
const svcSec = async (b, slug = "alpha") => secOf(await page(b, "/website", slug), "additional-services");
const titles = async (b, slug = "alpha") => [...(await svcSec(b, slug)).matchAll(/class="svc-card__title">([^<]+)</g)].map((m) => m[1].replace(/&amp;/g, "&"));
const st = (s, org, json) => s.call(`/clients/${org.id}/additional-services`, { method: "POST", json });
const editSvc = (s, json) => s.call("/additional-services", { method: "POST", json });
const addPic = (s, key, alt, bytes) => { const f = new FormData(); f.append("file", new File([bytes], "shot.png")); f.append("meta", JSON.stringify({ service_key: key, alt, caption: "" })); return s.call("/additional-services/media", { method: "POST", form: f }); };
const NEXUS = "Nexus Fleet Tracker";
const GLOBAL = ["Client Admin Portal", "Invoice Sender", "Digital Business Cards", "SEO & Visibility", NEXUS];

/* ------------------------------------------------------------------ Nexus Fleet Tracker */

test("migration 0017: one nullable column, one table and one seed row; the seed is exactly what was supplied and nothing more", () => {
  const sqlText = read("migrations/portal-proposed/0017_service_client_settings.sql").replace(/--.*$/gm, "");
  assert.deepEqual([...sqlText.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]), ["client_service_settings"]);
  assert.deepEqual([...sqlText.matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+)/g)].map((m) => [m[1], m[2]]), [["portal_services", "category"]]);
  assert.ok(!/\b(DROP|UPDATE)\b|\bDELETE\s+FROM\b/i.test(sqlText), "nothing that exists is changed or removed");
  assert.ok(!/service_prices|price_cad|problem|\bwhy\b/i.test(sqlText), "no price, problem or why text is seeded");
  assert.equal([...sqlText.matchAll(/INSERT OR IGNORE INTO (\w+)/g)].length, 1);
});

test("Nexus Fleet Tracker is in the global catalogue with exactly the supplied name, category, headline, description and six features; no price, no invented claims", async () => {
  const s = await setup();
  await s.site(s.A);
  const row = rowsOf(s.w, "SELECT * FROM portal_services WHERE service_key = 'nexus-fleet-tracker'")[0];
  assert.deepEqual([row.name, row.category, row.tagline, row.description, row.enabled, row.sort_order, row.problem, row.why], [NEXUS, "Fleet Management Software", "Take control of your fleet.", "Manage vehicles, monitor maintenance and organize fleet operations from one dashboard.", 1, 50, null, null]);
  assert.deepEqual(JSON.parse(row.benefits_json), ["Vehicle life expectancy", "Odometer tracking", "Oil change reminders", "Damage reporting", "Maintenance requests", "Service scheduling"]);
  assert.equal(rowsOf(s.w, "SELECT COUNT(*) n FROM service_prices WHERE service_key = 'nexus-fleet-tracker'")[0].n, 0, "no price is seeded");
  const cat = (await s.call("/additional-services")).json;
  assert.deepEqual(cat.services.map((x) => x.key), ["client-admin-portal", "invoice-sender", "digital-business-cards", "seo-visibility", "nexus-fleet-tracker"]);
  assert.deepEqual(await titles(s.ann), ["SEO & Visibility", "Client Admin Portal", "Invoice Sender", "Digital Business Cards", NEXUS]);
  const sec = await svcSec(s.ann);
  const card = sec.slice(sec.indexOf(NEXUS) - 400, sec.indexOf("</details>", sec.indexOf(NEXUS)));
  assert.match(card, /Fleet Management Software/); assert.match(card, /Take control of your fleet\./); assert.match(card, /<p class="svc-card__lead">Manage vehicles, monitor maintenance and organize fleet operations from one dashboard\.<\/p>/);
  for (const f of ["Vehicle life expectancy", "Odometer tracking", "Oil change reminders", "Damage reporting", "Maintenance requests", "Service scheduling"]) assert.match(card, new RegExp(`<li>${f}</li>`));
  assert.doesNotMatch(card, /The problem|Why you might need it|svc-price|svc-fig|See an example|integrat|GPS|telematics|real-time|live tracking|\$/i, "nothing beyond what was provided: no problem or why copy, price, pictures, demo or integrations");
  assert.match(card, /Ask about Nexus Fleet Tracker/);
  const r = await s.svc(s.ann, { service: "nexus-fleet-tracker" });
  assert.equal(r.status, 303); assert.equal(rowsOf(s.w, "SELECT service_key, status, price_snapshot FROM service_requests")[0].service_key, "svc-nexus-fleet-tracker");
  assert.equal(rowsOf(s.w, "SELECT price_snapshot FROM service_requests")[0].price_snapshot, null, "no price was shown, so none is recorded");
  assert.match(await svcSec(s.ann), /status--active">Requested/);
  assert.equal((await s.call(`/clients/${s.A.id}/branding`)).json.requests.find((x) => x.serviceKey === "svc-nexus-fleet-tracker").service, "Additional service: Nexus Fleet Tracker");
});

test("Admin manages Nexus like any service: several real screenshots, description and features, a demo link and pricing; nothing appears until it is set", async () => {
  const s = await setup();
  await s.site(s.A);
  assert.equal((await addPic(s, "nexus-fleet-tracker", "The fleet dashboard", S.png(30, 20))).status, 201);
  assert.equal((await addPic(s, "nexus-fleet-tracker", "A vehicle's maintenance history", S.png(31, 20))).status, 201);
  assert.equal((await addPic(s, "nexus-fleet-tracker", "The service schedule", S.png(32, 20))).status, 201);
  assert.equal((await editSvc(s, { key: "nexus-fleet-tracker", description: "Fleet software from Nexus.", benefits: ["Vehicle life expectancy", "Odometer tracking", "Oil change reminders", "Damage reporting", "Maintenance requests", "Service scheduling", "Seventh item", "Eighth item"], demo_url: "https://nexus.example.com/demo", demo_label: "See Nexus in action", category: "Fleet Management Software" })).status, 200);
  assert.equal((await editSvc(s, { key: "nexus-fleet-tracker", benefits: Array.from({ length: 9 }, (_, i) => "x" + i) })).status, 422, "up to eight");
  const sec = await svcSec(s.ann);
  assert.equal((sec.match(/class="svc-fig__img"/g) || []).length, 3); assert.match(sec, /Fleet software from Nexus\./); assert.match(sec, /<li>Eighth item<\/li>/); assert.match(sec, /href="https:\/\/nexus\.example\.com\/demo"[^>]*>See Nexus in action/);
  assert.doesNotMatch(sec, /Starting at|Custom quote/);
  const price = await s.call("/service-pricing", { method: "POST", json: { prices: [{ key: "nexus-fleet-tracker", type: "starting_at", priceCad: 99 }] } });
  assert.equal(price.status, 200, JSON.stringify(price.json));
  assert.match(await svcSec(s.ann), /Starting at \$99 CAD/);
  assert.equal((await s.call("/service-pricing", { method: "POST", json: { prices: [{ key: "nexus-fleet-tracker", type: "included" }] } })).status, 422, "never described as included");
  const list = (await s.call("/service-pricing")).json.services;
  assert.deepEqual(list.filter((x) => x.section === "addon").map((x) => x.key), ["client-admin-portal", "invoice-sender", "digital-business-cards", "seo-visibility", "nexus-fleet-tracker"]);
  await s.svc(s.ann, { service: "nexus-fleet-tracker" });
  assert.deepEqual(JSON.parse(rowsOf(s.w, "SELECT price_snapshot FROM service_requests")[0].price_snapshot).label, "Starting at $99 CAD", "the price the client was shown is recorded");
});

/* ------------------------------------------------------------------ per-client order, Recommended, Show/Hide */

test("per client: Recommended label, own order and Show/Hide change only that client; the global order is the fallback; other clients are untouched", async () => {
  const s = await setup();
  await s.site(s.A, { url: null, origin: "framework", status: "in_development" });
  const base = (await titles(s.ann)).slice();
  assert.deepEqual(base, GLOBAL, "no override: the global order");
  assert.equal((await st(s, s.A, { key: "invoice-sender", recommended: true })).status, 200);
  let sec = await svcSec(s.ann);
  assert.match(sec, /svc-tag svc-tag--recommended">Recommended<\/span>/); assert.equal((sec.match(/Recommended<\/span>/g) || []).length, 1);
  assert.deepEqual(await titles(s.ann), ["Invoice Sender", "Client Admin Portal", "Digital Business Cards", "SEO & Visibility", NEXUS], "without an own order, Recommended comes first, then the global order");
  assert.equal((sec.match(/<details class="svc-card[^>]*open/g) || []).length, 1); assert.match(sec.slice(sec.indexOf("<details")), /^<details class="svc-card svc-card--lead" open>[\s\S]*?Invoice Sender/);
  assert.deepEqual(await titles(s.bob, "beta"), GLOBAL, "another client is untouched");
  // own order
  const view = (await st(s, s.A, { key: NEXUS === "x" ? "" : "nexus-fleet-tracker", move: "up" })).json;
  assert.equal(view.ownOrder, true);
  assert.deepEqual(view.services.map((x) => x.key), ["client-admin-portal", "invoice-sender", "digital-business-cards", "nexus-fleet-tracker", "seo-visibility"]);
  assert.deepEqual(await titles(s.ann), ["Client Admin Portal", "Invoice Sender", "Digital Business Cards", NEXUS, "SEO & Visibility"], "an own order is followed exactly; Recommended does not reorder it");
  assert.match(await svcSec(s.ann), /Recommended<\/span>[\s\S]*?Invoice Sender/);
  for (let i = 0; i < 3; i++) await st(s, s.A, { key: "nexus-fleet-tracker", move: "up" });
  assert.equal((await titles(s.ann))[0], NEXUS);
  assert.equal((await st(s, s.A, { key: "nexus-fleet-tracker", move: "up" })).status, 200, "moving the first one up changes nothing");
  assert.deepEqual(await titles(s.bob, "beta"), GLOBAL, "still untouched");
  assert.deepEqual((await s.call("/additional-services")).json.services.map((x) => x.name), GLOBAL, "the global order is unchanged");
  // Show / Hide
  assert.equal((await st(s, s.A, { key: "digital-business-cards", state: "hidden" })).status, 200);
  assert.ok(!(await titles(s.ann)).includes("Digital Business Cards")); assert.ok((await titles(s.bob, "beta")).includes("Digital Business Cards"));
  assert.equal((await st(s, s.A, { key: "digital-business-cards", state: "automatic" })).status, 200);
  assert.ok((await titles(s.ann)).includes("Digital Business Cards"));
  // back to global
  assert.equal((await st(s, s.A, { reset_order: true })).json.ownOrder, false);
  assert.deepEqual(await titles(s.ann), ["Invoice Sender", "Client Admin Portal", "Digital Business Cards", "SEO & Visibility", NEXUS], "global order again, Recommended kept");
  assert.equal(rowsOf(s.w, "SELECT COUNT(*) n FROM client_service_settings WHERE organization_id = ? AND sort_order IS NOT NULL", s.A.id)[0].n, 0);
  await st(s, s.A, { key: "invoice-sender", recommended: false });
  assert.equal(rowsOf(s.w, "SELECT COUNT(*) n FROM client_service_settings WHERE organization_id = ?", s.A.id)[0].n, 0, "a row exists only while it carries something");
  assert.deepEqual(await titles(s.ann), GLOBAL);
});

test("ownership rules still hold: a service the client already has (Admin-marked or already being done) or that is hidden is never promoted, even when marked Recommended", async () => {
  const s = await setup();
  const id = await s.site(s.A);
  assert.equal((await st(s, s.A, { key: "invoice-sender", recommended: true })).status, 200);
  assert.equal((await st(s, s.A, { key: "invoice-sender", state: "owned" })).status, 200);
  assert.ok(!(await titles(s.ann)).includes("Invoice Sender"), "owned wins over Recommended");
  await st(s, s.A, { key: "client-admin-portal", recommended: true }); await st(s, s.A, { key: "client-admin-portal", state: "hidden" });
  assert.ok(!(await titles(s.ann)).includes("Client Admin Portal"));
  await st(s, s.A, { key: "seo-visibility", recommended: true });
  assert.ok((await titles(s.ann)).includes("SEO & Visibility"));
  await s.call(`/clients/${s.A.id}/websites/${id}/seo`, { method: "POST", json: { status: "in_progress", published: true } });
  assert.ok(!(await titles(s.ann)).includes("SEO & Visibility"), "Framework is already doing SEO for them");
  const view = (await s.call(`/clients/${s.A.id}/additional-services`)).json.services;
  assert.deepEqual(view.find((x) => x.key === "seo-visibility").autoHas, true); assert.equal(view.find((x) => x.key === "invoice-sender").state, "owned"); assert.equal(view.find((x) => x.key === "invoice-sender").recommended, true);
  await st(s, s.A, { key: "invoice-sender", state: "automatic" });
  assert.ok((await titles(s.ann)).includes("Invoice Sender"), "back to normal: shown again, still Recommended");
  assert.match(await svcSec(s.ann), /Recommended<\/span>/);
});

test("per-client settings are validated, audited internally, scoped to one organization and not writable by clients; before migration 0017 everything else keeps working", async () => {
  const s = await setup();
  await s.site(s.A);
  for (const [body, status, code] of [[{ key: "nope", recommended: true }, 422, "invalid_service"], [{ key: "invoice-sender", recommended: "yes" }, 422, "invalid_recommended"], [{ key: "invoice-sender", move: "sideways" }, 422, "invalid_direction"], [{ key: "nope", move: "up" }, 422, "invalid_service"], [{ key: "invoice-sender" }, 422, "invalid_input"], [{ key: "invoice-sender", extra: 1 }, 400, "unknown_field"]]) {
    const r = await st(s, s.A, body); assert.deepEqual([r.status, r.json.error], [status, code], JSON.stringify(body));
  }
  assert.equal((await st(s, s.Bo, { key: "invoice-sender", recommended: true })).status, 200);
  assert.deepEqual(await titles(s.ann), ["SEO & Visibility", "Client Admin Portal", "Invoice Sender", "Digital Business Cards", NEXUS]);
  assert.match(await svcSec(s.bob, "beta"), /Recommended<\/span>/); assert.doesNotMatch(await svcSec(s.ann), /svc-tag--recommended/);
  assert.equal(rowsOf(s.w, "SELECT COUNT(*) n FROM client_service_settings WHERE organization_id = ?", s.A.id)[0].n, 0);
  const audit = rowsOf(s.w, "SELECT visibility, organization_id FROM activity_log WHERE action IN ('service.recommended','service.order','service.order.reset')");
  assert.ok(audit.length >= 1 && audit.every((r) => r.visibility === "internal" && r.organization_id === s.Bo.id));
  for (const path of ["/portal/o/alpha/website/services/settings", "/portal/o/alpha/additional-services"]) assert.ok([404, 405].includes((await s.ann.post(path, { csrf: "x", key: "invoice-sender", recommended: "1" })).status), path);
  assert.equal(rowsOf(s.w, "SELECT COUNT(*) n FROM client_service_settings WHERE organization_id = ?", s.A.id)[0].n, 0, "a client cannot change it");
  const bare = await setup({ m17: false });
  await bare.site(bare.A);
  const v = (await bare.call(`/clients/${bare.A.id}/additional-services`)).json;
  assert.equal(v.settingsAvailable, false);
  for (const body of [{ key: "invoice-sender", recommended: true }, { key: "invoice-sender", move: "up" }]) assert.equal((await st(bare, bare.A, body)).status, 409, "plainly unavailable, nothing changed");
  assert.equal((await st(bare, bare.A, { key: "invoice-sender", state: "hidden" })).status, 200, "Show/Hide uses migration 0016 and still works");
  assert.deepEqual(await titles(bare.ann), ["SEO & Visibility", "Client Admin Portal", "Digital Business Cards"], "the global order, Invoice Sender hidden; no Nexus until its row is seeded");
});
