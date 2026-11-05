/* Per-client Branding requirements (Admin -> Clients -> [Client] -> Branding -> Requirements; migration 0014). Priority is separate from completion; Automatic is no override; clients only read. */
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

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const nowS = () => Math.floor(Date.now() / 1000);
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const base = "/portal/o/alpha/branding";
const KEYS = ["logo", "typography", "colours", "tagline", "imagery", "layout", "textures", "iconography", "style"];
const sql = (w, q, ...p) => w.db.raw.prepare(q).all(...p).map((r) => ({ ...r }));

async function setup({ migrated = true } = {}) {
  resetKeyCacheForTests();
  const w = await makeWorld(migrated ? {} : { skip: ["0014_brand_requirements.sql"] });
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

const sectionHtml = (html, key) => { const i = html.indexOf(`<section class="bk-sec" id="${key}"`); return html.slice(i, html.indexOf("</section>", i)); };
const norm = (html) => html.replace(/name="csrf" value="[^"]+"/g, 'name="csrf" value="X"').replace(/Reference: <strong>[^<]*<\/strong>/g, "");
const setReq = (t, key, level, note) => t.call(`/clients/${t.A.id}/branding/requirements`, { method: "PUT", json: { key, level, ...(note === undefined ? {} : { note }) } });
const card = (html, title) => { const i = html.indexOf(`<h3 class="lv-card__title">${title}</h3>`); const start = html.lastIndexOf("<li class=\"lv-card", i); return html.slice(start, html.indexOf("</li>", i)); };

test("migration 0014: one additive table, no seed rows, nothing existing is changed", () => {
  const sqlText = read("migrations/portal/0014_brand_requirements.sql").replace(/--.*$/gm, "");
  assert.deepEqual([...sqlText.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]), ["brand_requirements"]);
  assert.ok(!/\b(ALTER|DROP|UPDATE|INSERT)\b|\bDELETE\s+FROM\b/i.test(sqlText), "no change to anything that exists, no seed");
  assert.match(sqlText, /PRIMARY KEY \(organization_id, item_key\)/);
});

test("before the migration: Admin says so plainly, nothing can be saved, and the client's page is unchanged", async () => {
  const t = await setup({ migrated: false });
  const view = (await t.call(`/clients/${t.A.id}/branding`)).json;
  assert.equal(view.requirements.available, false);
  assert.equal((await setReq(t, "logo", "required", "x")).status, 409);
  const html = await t.page();
  assert.ok(!/bk-rnote/.test(html));
  assert.equal(sql(t.w, "SELECT name FROM sqlite_master WHERE name = 'brand_requirements'").length, 0);
});

test("a client with no overrides behaves exactly as before, and Automatic returns an item to that state", async () => {
  const t = await setup();
  await t.publish();
  const before = norm(await t.page());
  assert.equal((await setReq(t, "typography", "optional", "Not needed yet")).status, 200);
  assert.notEqual(norm(await t.page()), before);
  assert.equal((await setReq(t, "typography", "automatic")).status, 200);
  assert.equal(norm(await t.page()), before, "back to the automatic page, byte for byte");
  assert.equal(sql(t.w, "SELECT COUNT(*) n FROM brand_requirements")[0].n, 0, "automatic is no row");
});

test("Aurora: individual logo files marked Required with a note; the cards show the label and the note, completion stays separate", async () => {
  const t = await setup();
  await t.publish();
  const note = "Please upload the primary and secondary logo files (SVG or PNG). Your approved guidelines are already here.";
  for (const k of ["logo.primary", "logo.secondary"]) assert.equal((await setReq(t, k, "required", note)).status, 200);
  let html = await t.page();
  for (const title of ["Primary Logo", "Secondary Logo"]) { const c = card(html, title); assert.match(c, /bk-req bk-req--required/); assert.match(c, /Not added yet/); assert.ok(c.includes(note.replace("&", "&amp;"))); }
  assert.ok(!/bk-req/.test(card(html, "Simplified Logo")), "other variations are untouched");
  await t.logo("primary");
  html = await t.page();
  const c = card(html, "Primary Logo");
  assert.match(c, /Available/); assert.match(c, /bk-req--required/, "Required and Complete are shown together: the file is in, the requirement still stands");
  assert.match(card(html, "Secondary Logo"), /Not added yet/);
  assert.match(card(html, "Secondary Logo"), /bk-req--required/, "Required and Incomplete");
});

test("a section can be Required and Complete, Required and Incomplete, Optional, or Not applicable, each shown honestly", async () => {
  const t = await setup();
  await t.publish();
  assert.equal((await setReq(t, "imagery", "required", "Send three approved photos.")).status, 200);
  let html = await t.page();
  let sec = sectionHtml(html, "imagery");
  assert.match(sec, /bk-req--required/); assert.doesNotMatch(sec, /bk-done/); assert.match(sec, /Send three approved photos\./);
  await t.section("imagery");
  sec = sectionHtml(await t.page(), "imagery");
  assert.match(sec, /bk-req--required/); assert.match(sec, /bk-done/, "both labels at once");
  assert.equal((await setReq(t, "layout", "optional")).status, 200);
  assert.match(sectionHtml(await t.page(), "layout"), /bk-req--optional/);
  assert.equal((await setReq(t, "textures", "not_applicable", "Not part of this brand.")).status, 200);
  sec = sectionHtml(await t.page(), "textures");
  assert.match(sec, /bk-req--not-applicable/); assert.doesNotMatch(sec, /bk-done|Upload files|Request Design/); assert.match(sec, /Not part of this brand\./);
});

test("an item Admin has set never shows Framework's paid design offer: the note and the free upload link instead, and nothing is created", async () => {
  const t = await setup();
  await t.publish();
  assert.match(sectionHtml(await t.page(), "typography"), /Request Design/, "automatic: the existing offer");
  const reqsBefore = sql(t.w, "SELECT COUNT(*) n FROM service_requests")[0].n;
  assert.equal((await setReq(t, "typography", "required", "Upload your font files.")).status, 200);
  const sec = sectionHtml(await t.page(), "typography");
  assert.doesNotMatch(sec, /Request Design|From \$|price/i); assert.match(sec, /Upload files/); assert.match(sec, /Upload your font files\./);
  assert.equal(sql(t.w, "SELECT COUNT(*) n FROM service_requests")[0].n, reqsBefore, "no request is ever created by a requirement");
});

test("a logo variation marked Not applicable does not hold the Logo section back: it is complete once the others are in", async () => {
  const t = await setup();
  await t.publish();
  assert.equal((await setReq(t, "logo.secondary", "not_applicable", "No secondary logo for this brand.")).status, 200);
  const c = card(await t.page(), "Secondary Logo");
  assert.match(c, /Not applicable/); assert.doesNotMatch(c, /Not added yet/); assert.match(c, /No secondary logo/);
  await t.logo("primary"); await t.logo("simplified");
  let html = await t.page();
  assert.doesNotMatch(sectionHtml(html, "logo"), /bk-done/);
  await t.logo("icon");
  html = await t.page();
  assert.match(sectionHtml(html, "logo"), /bk-done/, "three of the three that apply");
});

test("settings belong to one client: another organization, its members and its page are untouched, and notes are escaped", async () => {
  const t = await setup();
  const B = await t.w.org("beta", "Beta Co"); await t.w.invite(B, "bob@beta.test", "owner");
  const bob = t.w.browser(); await bob.signIn(t.w.user(2, "bob@beta.test"));
  assert.ok((await brand.saveBrandKit(t.w.db, B.id, {}, ADMIN)).ok); assert.ok((await brand.setBrandKitStatus(t.w.db, B.id, "published", ADMIN)).ok);
  const betaBefore = norm(await (await bob.get("/portal/o/beta/branding")).text());
  await t.publish();
  assert.equal((await setReq(t, "logo", "required", "<script>alert(1)</script> & more")).status, 200);
  const html = await t.page();
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; more/); assert.ok(!html.includes("<script>alert"));
  assert.equal(norm(await (await bob.get("/portal/o/beta/branding")).text()), betaBefore, "Beta's page is byte-identical");
  assert.equal(sql(t.w, "SELECT COUNT(*) n FROM brand_requirements WHERE organization_id = ?", B.id)[0].n, 0);
});

test("clients cannot change requirements: no portal route accepts it, and the Admin API refuses bad or unauthorised changes", async () => {
  const t = await setup();
  await t.publish();
  const csrf = csrfOf(await t.page());
  for (const path of ["/portal/o/alpha/branding/requirements", "/portal/o/alpha/branding/requirement"]) {
    const r = await t.ann.post(path, { csrf, key: "logo", level: "not_applicable" });
    assert.ok([404, 405].includes(r.status), path + " -> " + r.status);
  }
  assert.equal(sql(t.w, "SELECT COUNT(*) n FROM brand_requirements")[0].n, 0);
  assert.equal((await setReq(t, "not-an-item", "required")).status, 422);
  assert.equal((await setReq(t, "logo", "mandatory")).status, 422);
  assert.equal((await setReq(t, "logo", "required", "x".repeat(301))).status, 422);
  assert.equal((await setReq(t, "logo", "required", "bad\u0000note")).status, 422);
  t.w.env.PORTAL_ADMIN_WRITES = "0";
  assert.equal((await setReq(t, "logo", "required", "ok")).status, 403, "writes switched off");
  assert.equal(sql(t.w, "SELECT COUNT(*) n FROM brand_requirements")[0].n, 0);
});

test("existing branding data is untouched, and every change is audited internally (never client-visible)", async () => {
  const t = await setup();
  await t.logo("primary"); await t.publish();
  const snapshot = () => JSON.stringify([sql(t.w, "SELECT * FROM brand_assets ORDER BY id"), sql(t.w, "SELECT * FROM brand_kits ORDER BY organization_id")]);
  const before = snapshot();
  await setReq(t, "logo", "required", "Upload the rest."); await setReq(t, "logo", "recommended", "Upload the rest."); await setReq(t, "logo", "automatic");
  assert.equal(snapshot(), before);
  const audit = sql(t.w, "SELECT action, actor_ref, visibility, detail FROM activity_log WHERE action LIKE 'brand.requirement.%' ORDER BY created_at, rowid");
  assert.deepEqual(audit.map((r) => r.action), ["brand.requirement.set", "brand.requirement.set", "brand.requirement.cleared"]);
  for (const r of audit) { assert.equal(r.visibility, "internal"); assert.equal(r.actor_ref, ADMIN); assert.ok(!r.detail.includes("Upload the rest"), "the note text is not copied into the log"); }
  assert.ok(!/requirement/i.test(await (await t.ann.get("/portal/o/alpha/activity")).text()));
  assert.equal((await setReq(t, "logo", "automatic")).json.changed, false, "clearing what is already automatic changes nothing");
});

test("Admin lists every item with its automatic level and the saved override", async () => {
  const t = await setup();
  await setReq(t, "tagline", "optional", "Later.");
  const r = (await t.call(`/clients/${t.A.id}/branding`)).json.requirements;
  assert.equal(r.available, true);
  assert.deepEqual(r.items.map((i) => i.key), ["logo", "logo.primary", "logo.secondary", "logo.simplified", "logo.submark", "typography", "colours", "tagline", "imagery", "layout", "textures", "iconography", "style"]);
  const tag = r.items.find((i) => i.key === "tagline");
  assert.deepEqual([tag.auto, tag.level, tag.note], ["recommended", "optional", "Later."]);
  assert.equal(r.items.find((i) => i.key === "logo.primary").auto, null);
  assert.match(read("admin/assets/branding.js"), /requirementsSection\(\), logoSection\(\)/);
});

test("every setting works on every item: five settings across the nine sections and the four logo variations, each shown correctly to the client and reversible", async () => {
  const t = await setup();
  await t.publish();
  const SECTIONS = ["logo", "typography", "colours", "tagline", "imagery", "layout", "textures", "iconography", "style"], VARIATIONS = [["primary", "Primary Logo"], ["secondary", "Secondary Logo"], ["simplified", "Simplified Logo"], ["submark", "Sub-mark"]];
  const baseline = norm(await t.page());
  const cls = { required: "required", recommended: "recommended", optional: "optional", not_applicable: "not-applicable" };
  const label = { required: "Required", recommended: "Recommended", optional: "Optional", not_applicable: "Not applicable" };
  let checks = 0;
  for (const level of ["required", "recommended", "optional", "not_applicable"]) {
    for (const key of SECTIONS) {
      assert.equal((await setReq(t, key, level, `Note for ${key} as ${level}`)).status, 200, `${key} ${level}`);
      const html = await t.page();
      const sec = sectionHtml(html, key);
      assert.match(sec, new RegExp(`bk-req bk-req--${cls[level]}"`), `${key} shows ${level}`); assert.ok(sec.includes(`Note for ${key} as ${level}`), `${key} shows its note`);
      assert.doesNotMatch(sec, /Request Design/, `${key}: no paid design offer once Admin has set it`);
      assert.match(html, new RegExp(`href="#${key}">[\\s\\S]*?${label[level].toLowerCase()}</span></a>`), `${key} navigation text says ${label[level].toLowerCase()}`);
      assert.equal((await setReq(t, key, "automatic")).status, 200);
      checks++;
    }
    for (const [v, title] of VARIATIONS) {
      assert.equal((await setReq(t, `logo.${v}`, level, `Logo note ${v} ${level}`)).status, 200, `logo.${v} ${level}`);
      const c = card(await t.page(), title);
      assert.ok(c.includes(`Logo note ${v} ${level}`), `${v} card note`);
      if (level === "not_applicable") assert.match(c, /Not applicable/); else assert.match(c, new RegExp(`bk-req--${cls[level]}"`));
      assert.equal((await setReq(t, `logo.${v}`, "automatic")).status, 200);
      checks++;
    }
  }
  assert.equal(checks, 4 * 13);
  assert.equal(norm(await t.page()), baseline, "after all of that, the page is byte-identical to the automatic one");
  assert.equal(sql(t.w, "SELECT COUNT(*) n FROM brand_requirements")[0].n, 0);
  assert.equal(sql(t.w, "SELECT COUNT(*) n FROM activity_log WHERE action = 'brand.requirement.set'")[0].n, 52);
  assert.equal(sql(t.w, "SELECT COUNT(*) n FROM activity_log WHERE action = 'brand.requirement.cleared'")[0].n, 52);
});

test("Aurora: completion stays separate from priority as files arrive, and the client keeps the free upload path without any paid offer", async () => {
  const t = await setup();
  await t.publish();
  const note = "Please upload the individual logo files for your primary and secondary logos (SVG or PNG).";
  for (const k of ["logo.primary", "logo.secondary"]) assert.equal((await setReq(t, k, "required", note)).status, 200);
  let html = await t.page();
  assert.match(sectionHtml(html, "logo"), /Upload files/); assert.doesNotMatch(sectionHtml(html, "logo"), /Request Design|Already have your logos/);
  assert.match(sectionHtml(html, "logo"), new RegExp(`href="/portal/o/alpha/branding/uploads"`));
  const open = (h) => (card(h, "Primary Logo").match(/bk-req--required/) ? "required" : "") + "/" + (/Not added yet/.test(card(h, "Primary Logo")) ? "incomplete" : "complete");
  assert.equal(open(html), "required/incomplete");
  await t.logo("primary");
  assert.equal(open(await t.page()), "required/complete", "the file arrives: complete, and still marked Required");
  await t.logo("secondary"); await t.logo("simplified"); await t.logo("icon");
  html = await t.page();
  assert.match(sectionHtml(html, "logo"), /bk-done/, "the Logo section itself is complete"); assert.match(card(html, "Primary Logo"), /bk-req--required/, "while its cards still say Required");
  assert.equal(sql(t.w, "SELECT COUNT(*) n FROM service_requests")[0].n, 0, "no paid request was ever created");
});
