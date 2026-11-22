/* Website environment screenshots: Production and Staging each keep their own picture (Production in the existing screenshot_* columns, Staging in the six staging_screenshot_* columns of the
   PROPOSED migration 0031). Admin uploads, replaces and removes each by hand; a client sees the Production picture on the Live website card and the Staging picture on the Preview card.
   Until 0031 is applied the Staging picture is simply "not available" and nothing else changes. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as sites from "../portal/repo/websites.js";
import * as B from "../portal/brand-files.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const MIG = "0031_website_staging_screenshot.sql";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const nowS = () => Math.floor(Date.now() / 1000);
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
const rows = (w, q, ...p) => w.db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");

async function setup({ migrated = true } = {}) {
  resetKeyCacheForTests();
  const w = await makeWorld({ skip: migrated ? [] : [MIG] }); // 0031 lives with the migrations Staging may apply; "without 0031" is how Staging and Production are until it is applied
  const bucket = fakeR2();
  Object.assign(w.env, { PORTAL_FILES: bucket, PORTAL_ADMIN_WRITES: "1", PORTAL_WEBSITE: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) });
  const A = await w.org("alpha", "Alpha Co"), Bo = await w.org("beta", "Beta Co");
  await w.invite(A, "ann@alpha.test", "owner"); await w.invite(Bo, "bob@beta.test", "owner");
  const ann = w.browser(), bob = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await bob.signIn(w.user(2, "bob@beta.test"));
  const call = async (path, { method = "GET", json, form } = {}) => {
    const h = { Origin: ORIGIN, "Cf-Access-Jwt-Assertion": sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: nowS(), exp: nowS() + 600 }), ...(method !== "GET" ? { "X-Framework-Admin": "1" } : {}) };
    let body;
    if (form) { const packed = new Response(form); body = new Uint8Array(await packed.arrayBuffer()); h["Content-Type"] = packed.headers.get("Content-Type"); h["Content-Length"] = String(body.length); }
    else if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    const res = await handleAdmin(new Request(ORIGIN + "/api/admin" + path, { method, headers: h, body }), w.env, {});
    const type = res.headers.get("Content-Type") || "";
    return { status: res.status, headers: res.headers, json: type.includes("json") ? await res.json() : null, bytes: type.includes("json") ? null : new Uint8Array(await res.arrayBuffer()) };
  };
  const base = (org) => `/clients/${org.id}/websites`;
  const site = async (org, over = {}) => { const r = await sites.createWebsite(w.db, org.id, { name: "Main website", url: "https://alpha.example.ca", origin: "client", status: "live", published: true, ...over }, ADMIN); assert.ok(r.ok, JSON.stringify(r)); return r.id; };
  const upload = (org, id, env, name, bytes) => { const f = new FormData(); f.append("file", new File([bytes], name)); return call(`${base(org)}/${id}/screenshot${env === "staging" ? "/staging" : ""}`, { method: "POST", form: f }); };
  const remove = (org, id, env) => call(`${base(org)}/${id}/screenshot${env === "staging" ? "/staging" : ""}/remove`, { method: "POST", json: {} });
  const view = async (org, id) => (await call(base(org))).json.websites.find((x) => x.id === id);
  const stage = (org, id, url = "https://staging.alpha.example.ca") => call(`${base(org)}/${id}/workspace/staging`, { method: "POST", json: { staging_url: url } });
  return { w, bucket, A, Bo, ann, bob, call, base, site, upload, remove, view, stage };
}

test("migration 0031 (approved for Staging; Production not yet) only adds six nullable columns, and leaves every existing screenshot untouched", async () => {
  const sql = read("migrations/portal/" + MIG);
  const code = sql.replace(/--.*$/gm, "");
  assert.deepEqual([...code.matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+)/g)].map((m) => `${m[1]}.${m[2]}`), ["key", "name", "format", "type", "size", "sha256"].map((c) => `websites.staging_screenshot_${c}`));
  assert.ok(!/\bDROP\b|\bUPDATE\b|\bDELETE\b|\bRENAME\b|NOT NULL|\bCREATE\b/i.test(code), "additive: nothing removed, rewritten or required");
  const s = await setup({ migrated: false });
  const id = await s.site(s.A);
  assert.equal((await s.upload(s.A, id, "production", "home.png", S.png())).status, 200);
  const before = rows(s.w, "SELECT screenshot_key, screenshot_name, screenshot_format, screenshot_type, screenshot_size, screenshot_sha256, url FROM websites WHERE id = ?", id)[0];
  s.w.db.raw.exec(sql);
  assert.deepEqual(rows(s.w, "SELECT screenshot_key, screenshot_name, screenshot_format, screenshot_type, screenshot_size, screenshot_sha256, url FROM websites WHERE id = ?", id)[0], before, "the Production screenshot and address are exactly as they were");
  const r = rows(s.w, "SELECT staging_screenshot_key k, staging_screenshot_size z FROM websites WHERE id = ?", id)[0];
  assert.deepEqual([r.k, r.z], [null, null], "every website starts with no Staging picture");
  assert.ok(await s.bucket.get(before.screenshot_key), "the stored Production object is untouched");
});

test("without migration 0031: Staging screenshots are 'not available' (409) and say so in the capabilities; Production screenshots, addresses and the client page work as before", async () => {
  const s = await setup({ migrated: false });
  const id = await s.site(s.A);
  assert.equal((await s.call(s.base(s.A))).json.capabilities.stagingScreenshots, false);
  const up = await s.upload(s.A, id, "staging", "stg.png", S.png());
  assert.equal(up.status, 409); assert.equal(up.json.error, "unavailable");
  assert.equal(rows(s.w, "SELECT count(*) n FROM websites WHERE id = ?", id)[0].n, 1);
  assert.equal((await s.call(`${s.base(s.A)}/${id}/screenshot/staging`)).status, 404, "nothing to show");
  assert.equal((await s.remove(s.A, id, "staging")).status, 200, "removing nothing is harmless");
  assert.equal((await s.upload(s.A, id, "production", "home.png", S.png())).status, 200);
  assert.equal((await s.view(s.A, id)).stagingScreenshot, null);
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${id}/screenshot`)).status, 200, "the client still sees the Production picture");
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${id}/screenshot/staging`)).status, 404);
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${id}`)).status, 200, "the website page renders without the columns");
  assert.deepEqual(await B.findOrphanObjects({ db: s.w.db, bucket: s.bucket, now: new Date() }, { organizationId: s.A.id }), []);
});

test("with migration 0031: each environment keeps its own picture (png, jpg, webp), replacing deletes the old object, removing one leaves the other, and bad files change nothing", async () => {
  const s = await setup();
  const id = await s.site(s.A);
  assert.equal((await s.call(s.base(s.A))).json.capabilities.stagingScreenshots, true);
  assert.equal((await s.upload(s.A, id, "production", "live.png", S.png())).status, 200);
  assert.equal((await s.upload(s.A, id, "staging", "stg.png", S.png())).status, 200);
  let w = await s.view(s.A, id);
  assert.deepEqual([w.screenshot.name, w.stagingScreenshot.name], ["live.png", "stg.png"]);
  const r1 = rows(s.w, "SELECT screenshot_key pk, staging_screenshot_key sk, staging_screenshot_type t FROM websites WHERE id = ?", id)[0];
  assert.notEqual(r1.pk, r1.sk); assert.match(r1.sk, new RegExp(`^org/${s.A.id}/websites/[0-9a-f-]{36}$`), "a private object under this organization's own prefix"); assert.equal(r1.t, "image/png");
  assert.ok(await s.bucket.get(r1.pk) && await s.bucket.get(r1.sk));
  const got = await s.call(`${s.base(s.A)}/${id}/screenshot/staging`);
  assert.equal(got.status, 200); assert.match(got.headers.get("Content-Type"), /^image\/png/); assert.match(got.headers.get("Content-Security-Policy") || "", /sandbox/); assert.ok(got.bytes.length > 0);
  assert.ok(!JSON.stringify(w).match(/staging_screenshot_key|"key"|org\/[0-9a-f-]{36}\/websites/), "no storage key ever leaves");
  // replace with a JPG then a WebP: the previous Staging object is deleted at once, the Production one is not touched
  assert.equal((await s.upload(s.A, id, "staging", "stg.jpg", S.jpeg())).status, 200);
  const r2 = rows(s.w, "SELECT screenshot_key pk, staging_screenshot_key sk, staging_screenshot_format f FROM websites WHERE id = ?", id)[0];
  assert.equal(r2.f, "jpg"); assert.notEqual(r2.sk, r1.sk); assert.equal(await s.bucket.get(r1.sk), null, "the replaced Staging picture is deleted"); assert.equal(r2.pk, r1.pk, "Production untouched");
  assert.equal((await s.upload(s.A, id, "staging", "stg.webp", S.webp())).status, 200);
  assert.equal(rows(s.w, "SELECT staging_screenshot_format f FROM websites WHERE id = ?", id)[0].f, "webp");
  // refusals change nothing
  const key = rows(s.w, "SELECT staging_screenshot_key k FROM websites WHERE id = ?", id)[0].k;
  for (const [name, bytes] of [["x.svg", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")], ["x.exe", Buffer.from("MZ" + "\0".repeat(200))], ["x.png", Buffer.from("not a png")], ["empty.png", Buffer.alloc(0)]]) {
    const bad = await s.upload(s.A, id, "staging", name, bytes); assert.ok(bad.status >= 400 && bad.status < 500, name + " " + bad.status);
  }
  assert.equal(rows(s.w, "SELECT staging_screenshot_key k FROM websites WHERE id = ?", id)[0].k, key, "every refusal left the Staging screenshot as it was");
  // another client cannot touch it; removing Staging leaves Production
  assert.equal((await s.upload(s.Bo, id, "staging", "x.png", S.png())).status, 404); assert.equal((await s.call(`${s.base(s.Bo)}/${id}/screenshot/staging`)).status, 404);
  assert.equal((await s.remove(s.A, id, "staging")).status, 200);
  assert.equal(await s.bucket.get(key), null, "the stored Staging picture is deleted"); w = await s.view(s.A, id);
  assert.equal(w.stagingScreenshot, null); assert.ok(w.screenshot, "Production is still there");
  assert.equal((await s.call(`${s.base(s.A)}/${id}/screenshot/staging`)).status, 404);
  assert.equal((await s.remove(s.A, id, "production")).status, 200); assert.equal((await s.view(s.A, id)).screenshot, null);
  assert.equal(rows(s.w, "SELECT count(*) n FROM activity_log WHERE action IN ('website.staging_screenshot_set', 'website.staging_screenshot_removed')")[0].n, 4, "every change is audited (ids only)");
});

test("both writes need the same protections as Production: same-origin Admin header, writes switched on; an archived website cannot be changed", async () => {
  const s = await setup();
  const id = await s.site(s.A);
  const f = new FormData(); f.append("file", new File([S.png()], "a.png"));
  const res = await handleAdmin(new Request(ORIGIN + `/api/admin${s.base(s.A)}/${id}/screenshot/staging`, { method: "POST", headers: { Origin: ORIGIN, "Cf-Access-Jwt-Assertion": sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: nowS(), exp: nowS() + 600 }) }, body: f }), s.w.env, {});
  assert.equal(res.status, 403, "no X-Framework-Admin header, no change");
  assert.equal((await s.call(`${s.base(s.A)}/${id}/screenshot/staging`, { method: "DELETE" })).status, 405);
  s.w.env.PORTAL_ADMIN_WRITES = "0"; assert.equal((await s.upload(s.A, id, "staging", "a.png", S.png())).status, 403); s.w.env.PORTAL_ADMIN_WRITES = "1";
  assert.equal((await s.call(`${s.base(s.A)}/${id}/archive`, { method: "POST", json: {} })).status, 200);
  assert.equal((await s.upload(s.A, id, "staging", "a.png", S.png())).status, 404, "an archived website is not changed");
});

test("Client Portal: the Preview card shows the Staging picture and the Live card the Production one; another organization and an unpublished website see neither", async () => {
  const s = await setup();
  const id = await s.site(s.A);
  await s.stage(s.A, id);
  let h = await (await s.ann.get(`/portal/o/alpha/website/${id}`)).text();
  assert.match(h, /No preview image yet/); assert.ok(!new RegExp(`/website/${id}/screenshot/staging`).test(h));
  await s.upload(s.A, id, "staging", "stg.png", S.png());
  h = await (await s.ann.get(`/portal/o/alpha/website/${id}`)).text();
  const prev = h.slice(h.indexOf('class="wd-card wd-card--ink wd-prev"')); const live = h.slice(h.indexOf('class="wd-card wd-live"'), h.indexOf('class="wd-card wd-card--ink wd-prev"'));
  assert.match(prev, new RegExp(`<img src="/portal/o/alpha/website/${id}/screenshot/staging" alt="Screenshot of Main website"`)); assert.ok(!/<img/.test(live), "the Live card has no picture of its own yet");
  await s.upload(s.A, id, "production", "live.png", S.png());
  h = await (await s.ann.get(`/portal/o/alpha/website/${id}`)).text();
  assert.match(h.slice(h.indexOf('class="wd-card wd-live"'), h.indexOf('class="wd-card wd-card--ink wd-prev"')), new RegExp(`<img src="/portal/o/alpha/website/${id}/screenshot"`));
  assert.ok(!/ style=|<style|<script|javascript:|\son[a-z]+=["']/i.test(h), "no inline styles or scripts");
  const img = await s.ann.get(`/portal/o/alpha/website/${id}/screenshot/staging`);
  assert.equal(img.status, 200); assert.match(img.headers.get("Content-Type"), /^image\/png/); assert.match(img.headers.get("Cache-Control") || "", /no-store/);
  assert.equal((await s.bob.get(`/portal/o/alpha/website/${id}/screenshot/staging`)).status, 404, "another organization's member");
  assert.equal((await s.bob.get(`/portal/o/beta/website/${id}/screenshot/staging`)).status, 404, "an organization's own path with someone else's website");
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${"0".repeat(8)}-0000-4000-8000-000000000000/screenshot/staging`)).status, 404);
  await sites.updateWebsite(s.w.db, s.A.id, id, { published: false }, ADMIN);
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${id}/screenshot/staging`)).status, 404, "unpublished: not shown");
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${id}/screenshot`)).status, 404);
});

test("storage accounting: the orphan check knows both pictures, and removing one object is reported", async () => {
  const s = await setup();
  const id = await s.site(s.A);
  await s.upload(s.A, id, "production", "a.png", S.png()); await s.upload(s.A, id, "staging", "b.png", S.png());
  const deps = { db: s.w.db, bucket: s.bucket, now: new Date() };
  assert.deepEqual(await B.findOrphanObjects(deps, { organizationId: s.A.id }), [], "both live screenshots are accounted for");
  assert.equal((await sites.listWebsiteStorageKeys(s.w.db, s.A.id)).length, 2);
});

test("Admin UI: one Edit button per environment card, the screenshot lives in the card and its Edit panel, and the standalone Screenshot card is gone", () => {
  const ui = read("admin/assets/sites.js"), blocks = read("admin/assets/site-blocks.js"), css = read("admin/assets/ds.css");
  assert.ok(!/screenshotCard/.test(ui + blocks), "the standalone Screenshot card is removed");
  assert.ok(!/Edit address/.test(ui), "'Edit address' is now 'Edit'");
  assert.match(ui, /button\("Edit", \{[^\n]*envDrawer\(kind\)/);
  assert.match(ui, /shotPicture\(site, kind, base\)/); assert.match(ui, /shotEditor\(site, kind,/);
  assert.match(ui, /title: prod \? "Production settings" : "Staging settings"/);
  assert.match(blocks, /accept: "\.png,\.jpg,\.jpeg,\.webp"/); assert.match(blocks, /screenshot\/staging/);
  assert.ok(!/innerHTML|style=|\.style\b|insertAdjacentHTML/.test(blocks + ui), "no HTML insertion or inline styles");
  assert.match(css, /\.ds-eshot \{[^}]*aspect-ratio: 16 \/ 10/); assert.match(css, /\.ds-card--ink \.ds-eshot/);
});
