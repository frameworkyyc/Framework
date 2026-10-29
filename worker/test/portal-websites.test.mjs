/* Websites, phase 1: the database foundation (migration 0011) and Framework Admin's management of each client's websites (several per client). "No website" is not stored; status is
   separate from whether Framework manages the website; an optional private screenshot; nothing is shown to clients and no client route exists yet. The four website services join
   the central pricing editor as custom quotes. */
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
import { PRICING_SERVICES } from "../portal/branding-pricing.js";
import { BRAND_REQUESTS } from "../portal/brand-services.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const nowS = () => Math.floor(Date.now() / 1000);
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const rowsOf = (w, q, ...p) => w.db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const MIGRATION = read("migrations/portal-proposed/0011_websites.sql");

async function setup({ migrated = true, storage = true } = {}) {
  resetKeyCacheForTests();
  const w = await makeWorld();
  const bucket = fakeR2();
  Object.assign(w.env, { PORTAL_BRANDING: "1", PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) });
  if (storage) w.env.PORTAL_FILES = bucket;
  const A = await w.org("alpha", "Alpha Co"), Bo = await w.org("beta", "Beta Co");
  await w.invite(A, "ann@alpha.test", "owner");
  const ann = w.browser(); await ann.signIn(w.user(1, "ann@alpha.test"));
  if (migrated) w.db.raw.exec(MIGRATION);
  const call = async (path, { method = "GET", json, form, headers = {} } = {}) => {
    const h = { Origin: ORIGIN, "Cf-Access-Jwt-Assertion": sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: nowS(), exp: nowS() + 600 }), ...(method !== "GET" ? { "X-Framework-Admin": "1" } : {}), ...headers };
    let body;
    if (form) { const packed = new Response(form); const buf = new Uint8Array(await packed.arrayBuffer()); h["Content-Type"] = packed.headers.get("Content-Type"); h["Content-Length"] = String(buf.length); body = buf; }
    else if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    const res = await handleAdmin(new Request(ORIGIN + "/api/admin" + path, { method, headers: h, body }), w.env, {});
    const type = res.headers.get("Content-Type") || "";
    return { status: res.status, headers: res.headers, json: type.includes("json") ? await res.json() : null, bytes: type.includes("json") ? null : new Uint8Array(await res.arrayBuffer()) };
  };
  const base = (org) => `/clients/${org.id}/websites`;
  const create = (org, body) => call(base(org), { method: "POST", json: body });
  const shot = (org, id, name, bytes) => { const f = new FormData(); f.append("file", new File([bytes], name)); return call(`${base(org)}/${id}/screenshot`, { method: "POST", form: f }); };
  return { w, bucket, A, Bo, ann, call, base, create, shot };
}
const SITE = { name: "Main website", url: "https://alpha.example.ca", origin: "client", status: "live" };

test("migration 0011 is additive and enforces its rules: no website row for 'no website', status separate from the managed flag, an address when there is a site, one private screenshot, milestones tied to their website", async () => {
  assert.ok(!/\bDROP\b|(?<!ON )\b(DELETE|UPDATE)\b|\bRENAME\b/i.test(MIGRATION.replace(/--.*$/gm, "")), "nothing that exists is removed or changed");
  const s = await setup({ migrated: false });
  const before = rowsOf(s.w, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((r) => r.name);
  s.w.db.raw.exec(MIGRATION);
  const after = rowsOf(s.w, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((r) => r.name);
  assert.deepEqual(after.filter((t) => !before.includes(t)), ["website_milestones", "websites"], "two new tables, nothing else");
  assert.deepEqual(before.filter((t) => !after.includes(t)), []);
  const db = s.w.db.raw;
  const ins = (o = {}) => { const r = { id: crypto.randomUUID(), organization_id: s.A.id, name: "Site", url: "https://a.example.ca", origin: "client", status: "live", ...o }; db.prepare(`INSERT INTO websites (${Object.keys(r).join(",")}) VALUES (${Object.keys(r).map(() => "?").join(",")})`).run(...Object.values(r)); return r; };
  assert.doesNotThrow(() => ins()); assert.doesNotThrow(() => ins({ status: "existing", managed_by_framework: 1 })); assert.doesNotThrow(() => ins({ status: "in_development", origin: "framework", url: null }));
  assert.throws(() => ins({ status: "none" }), /constraint/i, "'No website' is not a stored status");
  assert.throws(() => ins({ status: "live", url: null }), /constraint/i, "a live website has an address"); assert.throws(() => ins({ status: "existing", url: null }), /constraint/i);
  assert.throws(() => ins({ status: "in_development", origin: "client", url: null }), /constraint/i, "Framework builds what is in development");
  for (const bad of ["ftp://a.example.ca", "javascript:alert(1)", "https://a b.ca", "https://a.ca/<x>", 'https://a.ca/"x"', "x"]) assert.throws(() => ins({ url: bad }), /constraint/i, bad);
  assert.throws(() => ins({ managed_by_framework: 2 }), /constraint/i); assert.throws(() => ins({ origin: "other" }), /constraint/i); assert.throws(() => ins({ domain_owner: "them" }), /constraint/i);
  assert.throws(() => ins({ launch_date: "2026-1-5" }), /constraint/i); assert.throws(() => ins({ domain_renewal: "soon" }), /constraint/i); assert.throws(() => ins({ name: "" }), /constraint/i); assert.throws(() => ins({ name: "x".repeat(81) }), /constraint/i);
  assert.throws(() => ins({ screenshot_key: "k".repeat(48) }), /constraint/i, "a screenshot is all-or-nothing");
  const full = { screenshot_key: "k".repeat(48), screenshot_name: "a.png", screenshot_format: "png", screenshot_type: "image/png", screenshot_size: 10, screenshot_sha256: "a".repeat(64) };
  assert.doesNotThrow(() => ins(full)); assert.throws(() => ins(full), /UNIQUE|constraint/i, "one object, one website");
  const site = ins({ name: "Parent" });
  const ms = (o = {}) => { const r = { id: crypto.randomUUID(), organization_id: s.A.id, website_id: site.id, title: "Design", ...o }; db.prepare(`INSERT INTO website_milestones (${Object.keys(r).join(",")}) VALUES (${Object.keys(r).map(() => "?").join(",")})`).run(...Object.values(r)); };
  assert.doesNotThrow(() => ms()); assert.doesNotThrow(() => ms({ status: "done", completed_at: "2026-10-29T00:00:00Z" }));
  assert.throws(() => ms({ status: "done" }), /constraint/i, "done needs its completion time"); assert.throws(() => ms({ completed_at: "2026-10-29T00:00:00Z" }), /constraint/i); assert.throws(() => ms({ status: "stuck" }), /constraint/i);
  assert.throws(() => ms({ organization_id: s.Bo.id }), /FOREIGN KEY|constraint/i, "a milestone of another organization's website is refused");
  assert.throws(() => db.prepare("DELETE FROM websites WHERE id = ?").run(site.id), /FOREIGN KEY|constraint/i, "a website with milestones cannot be removed");
  const col = rowsOf(s.w, "PRAGMA table_info(support_requests)").find((c) => c.name === "website_id");
  assert.ok(col && col.notnull === 0 && col.dflt_value === null, "support_requests.website_id is nullable; every existing request stays NULL");
});

test("migration 0011 adds the four website services to the pricing editor as custom quotes, leaving every existing price alone", async () => {
  const s = await setup({ migrated: false });
  const prices = () => Object.fromEntries(rowsOf(s.w, "SELECT service_key, price_type, price_cad FROM service_prices").map((r) => [r.service_key, [r.price_type, r.price_cad]]));
  const before = prices(); assert.equal(Object.keys(before).length, 13);
  s.w.db.raw.exec(MIGRATION);
  const after = prices();
  for (const k of Object.keys(before)) assert.deepEqual(after[k], before[k], k + " is untouched");
  for (const k of ["website-design", "website-redesign", "website-seo", "website-maintenance"]) assert.deepEqual(after[k], ["custom_quote", null], k + " defaults to a custom quote");
  assert.equal(Object.keys(after).length, 17);
  assert.deepEqual(PRICING_SERVICES.filter((x) => x.section === "website").map((x) => [x.key, x.name, x.defaultType]), [["website-design", "Website Design", "custom_quote"], ["website-redesign", "Website Redesign", "custom_quote"], ["website-seo", "SEO", "custom_quote"], ["website-maintenance", "Website Maintenance", "custom_quote"]]);
  assert.ok(!BRAND_REQUESTS.some((r) => /website/.test(r.key)), "they are not Branding requests");
  const r = await s.call("/service-pricing");
  assert.equal(r.json.services.length, 17); assert.deepEqual(r.json.services.slice(13).map((x) => [x.key, x.section, x.type, x.priceCad, x.stored]), [["website-design", "website", "custom_quote", null, true], ["website-redesign", "website", "custom_quote", null, true], ["website-seo", "website", "custom_quote", null, true], ["website-maintenance", "website", "custom_quote", null, true]]);
  const saved = await s.call("/service-pricing", { method: "POST", json: { prices: [{ key: "website-seo", type: "starting_at", priceCad: 400 }] } });
  assert.equal(saved.status, 200); assert.deepEqual(saved.json.services.find((x) => x.key === "website-seo").priceCad, 400);
});

test("web addresses and dates: a bare domain gets https, only http(s) is kept, and credentials, odd characters, private-looking hosts and bad dates are refused", () => {
  const ok = (raw, out) => assert.equal(sites.validateWebAddress(raw), out, String(raw));
  ok("example.ca", "https://example.ca/"); ok(" https://Example.ca/shop ", "https://example.ca/shop"); ok("http://example.ca", "http://example.ca/"); ok("example.ca:8080/x", "https://example.ca:8080/x"); ok("", null); ok(null, null); ok(undefined, null); ok("   ", null);
  for (const bad of ["javascript:alert(1)", "ftp://example.ca", "mailto:a@b.co", "data:text/html,x", "https://user:pw@example.ca", "https://localhost", "https://192.168.0.1", "https://[::1]/", "exa mple.ca", "https://example.ca/<x>", 'https://example.ca/"', "https://" + "a".repeat(300) + ".ca", 5, {}]) assert.equal(sites.validateWebAddress(bad), undefined, String(bad));
  assert.equal(sites.validateDate("2026-10-29"), "2026-10-29"); assert.equal(sites.validateDate(""), null); assert.equal(sites.validateDate(null), null);
  for (const bad of ["2026-02-30", "2026-13-01", "26-10-29", "2026/10/29", 20261029, "2026-10-29T00:00:00Z"]) assert.equal(sites.validateDate(bad), undefined, String(bad));
});

test("Admin API: a client with no websites has none (not a stored 'no website'); websites are added, several per client, with status separate from the managed flag", async () => {
  const s = await setup();
  const empty = await s.call(s.base(s.A));
  assert.equal(empty.status, 200); assert.equal(empty.json.available, true); assert.deepEqual(empty.json.websites, []); assert.equal(empty.json.capabilities.writes, true); assert.equal(empty.json.capabilities.storage, true); assert.equal(empty.json.limits.maxWebsites, 12);
  assert.equal(rowsOf(s.w, "SELECT count(*) n FROM websites")[0].n, 0, "nothing is stored for a client without a website");
  const a = await s.create(s.A, { ...SITE, managed_by_framework: false });
  const b = await s.create(s.A, { name: "Online shop", url: "shop.alpha.example.ca", origin: "framework", status: "live", managed_by_framework: true, launch_date: "2026-09-01", published: true, domain_registrar: "Namecheap", domain_owner: "client", domain_renewal: "2027-03-01", hosting_provider: "Cloudflare", hosting_owner: "framework", hosting_renewal: "2027-01-15", management_notes: "Updates monthly." });
  const c = await s.create(s.A, { name: "New site", origin: "framework", status: "in_development", managed_by_framework: false });
  assert.deepEqual([a.status, b.status, c.status], [201, 201, 201]);
  const list = (await s.call(s.base(s.A))).json.websites;
  assert.deepEqual(list.map((x) => x.name), ["Main website", "Online shop", "New site"]);
  const by = Object.fromEntries(list.map((x) => [x.name, x]));
  assert.deepEqual([by["Main website"].status, by["Main website"].managedByFramework], ["live", false], "live but not managed");
  assert.deepEqual([by["Online shop"].status, by["Online shop"].managedByFramework], ["live", true], "live and managed: the same status, a different yes/no");
  assert.equal(by["Online shop"].url, "https://shop.alpha.example.ca/"); assert.deepEqual(by["Online shop"].domain, { registrar: "Namecheap", owner: "client", renewal: "2027-03-01" }); assert.deepEqual(by["Online shop"].hosting, { provider: "Cloudflare", owner: "framework", renewal: "2027-01-15" });
  assert.equal(by["Online shop"].launchDate, "2026-09-01"); assert.equal(by["Online shop"].managementNotes, "Updates monthly."); assert.equal(by["Online shop"].published, true); assert.equal(by["Main website"].published, false);
  assert.equal(by["New site"].url, null); assert.equal(by["New site"].origin, "framework");
  assert.ok(!JSON.stringify(list).match(/screenshot_key|storage|"key"/i), "no storage key ever leaves");
  const other = await s.call(s.base(s.Bo));
  assert.deepEqual(other.json.websites, [], "another client's list is separate");
  assert.equal(rowsOf(s.w, "SELECT count(*) n FROM activity_log WHERE action = 'website.created' AND actor_ref = ? AND visibility = 'internal'", ADMIN)[0].n, 3, "each addition is audited");
});

test("Admin API: edits change only what is sent, status and the managed flag move independently, and rules that link fields are refused with nothing changed", async () => {
  const s = await setup();
  const id = (await s.create(s.A, { ...SITE })).json.id;
  const upd = (body) => s.call(`${s.base(s.A)}/${id}/update`, { method: "POST", json: body });
  const get = async () => (await s.call(s.base(s.A))).json.websites[0];
  assert.equal((await upd({ managed_by_framework: true })).status, 200);
  let w = await get(); assert.deepEqual([w.status, w.managedByFramework, w.name], ["live", true, "Main website"], "only the flag changed");
  assert.equal((await upd({ status: "existing" })).status, 200); w = await get(); assert.deepEqual([w.status, w.managedByFramework], ["existing", true], "status changed, the flag did not");
  assert.equal((await upd({ managed_by_framework: false, published: true, launch_date: "2026-10-01", url: "alpha.example.ca/new" })).status, 200); w = await get();
  assert.deepEqual([w.managedByFramework, w.published, w.launchDate, w.url], [false, true, "2026-10-01", "https://alpha.example.ca/new"]);
  assert.equal((await upd({ launch_date: null, domain_registrar: null })).status, 200); assert.equal((await get()).launchDate, null);
  const before = await get();
  for (const [body, code] of [[{ name: "" }, "invalid_name"], [{ url: "javascript:x" }, "invalid_url"], [{ origin: "agency" }, "invalid_origin"], [{ status: "none" }, "invalid_status"], [{ status: "in_development" }, "invalid_combination"], [{ url: null }, "invalid_combination"],
    [{ launch_date: "2026-02-31" }, "invalid_date"], [{ domain_owner: "them" }, "invalid_party"], [{ managed_by_framework: "yes" }, "invalid_managed_by_framework"], [{ management_notes: "x".repeat(1001) }, "invalid_text"], [{ sort_order: -1 }, "invalid_sort_order"], [{}, "invalid_input"]]) {
    const r = await upd(body); assert.equal(r.status, 422, JSON.stringify(body)); assert.equal(r.json.error, code, JSON.stringify(body));
  }
  assert.deepEqual(await get(), before, "every refused change left the website as it was");
  assert.equal((await upd({ nonsense: 1 })).status, 400, "unknown fields are refused");
  assert.equal((await s.call(`${s.base(s.A)}/${crypto.randomUUID()}/update`, { method: "POST", json: { name: "x" } })).status, 404);
  assert.equal((await s.call(`${s.base(s.Bo)}/${id}/update`, { method: "POST", json: { name: "Hijack" } })).status, 404, "another client's website id is simply not found");
  assert.equal((await get()).name, "Main website");
  assert.ok(rowsOf(s.w, "SELECT detail FROM activity_log WHERE action = 'website.updated'").every((r) => !/http|alpha\.example/.test(r.detail)), "the audit names the fields changed, not their values");
});

test("Admin API: websites are archived and restored, never deleted; the per-client limit holds; archived ones free up a place", async () => {
  const s = await setup();
  const ids = [];
  for (let i = 0; i < 12; i++) { const r = await s.create(s.A, { name: "Site " + i, url: `https://s${i}.example.ca`, origin: "client", status: "existing" }); assert.equal(r.status, 201); ids.push(r.json.id); }
  const over = await s.create(s.A, { name: "One too many", url: "https://x.example.ca", origin: "client", status: "existing" });
  assert.equal(over.status, 409); assert.equal(over.json.error, "too_many");
  const arch = await s.call(`${s.base(s.A)}/${ids[0]}/archive`, { method: "POST", json: {} });
  assert.equal(arch.status, 200); assert.equal(arch.json.changed, true);
  assert.equal((await s.call(`${s.base(s.A)}/${ids[0]}/archive`, { method: "POST", json: {} })).json.changed, false, "idempotent");
  const list = (await s.call(s.base(s.A))).json.websites; assert.equal(list.at(-1).name, "Site 0"); assert.ok(list.at(-1).archivedAt); assert.equal(list.length, 12, "archived websites stay listed, last");
  assert.equal((await s.create(s.A, { name: "Now there is room", url: "https://y.example.ca", origin: "client", status: "existing" })).status, 201);
  assert.equal((await s.call(`${s.base(s.A)}/${ids[0]}/restore`, { method: "POST", json: {} })).json.changed, false, "restoring would exceed the limit: it stays archived");
  assert.equal((await s.call(`${s.base(s.A)}/${ids[1]}/archive`, { method: "POST", json: {} })).status, 200);
  assert.equal((await s.call(`${s.base(s.A)}/${ids[0]}/restore`, { method: "POST", json: {} })).json.changed, true);
  assert.equal((await s.call(`${s.base(s.A)}/${ids[1]}/update`, { method: "POST", json: { name: "Edit archived" } })).status, 404, "an archived website is read-only until restored");
  assert.equal(rowsOf(s.w, "SELECT count(*) n FROM websites")[0].n, 13, "nothing was deleted");
  assert.equal(rowsOf(s.w, "SELECT published FROM websites WHERE id = ?", ids[1])[0].published, 0, "archiving also withdraws it from clients");
});

test("screenshots: a PNG, JPG or WebP is stored privately and shown to Admin as a sandboxed picture; replacing and removing delete the old object; nothing else is accepted", async () => {
  const s = await setup();
  const id = (await s.create(s.A, { ...SITE })).json.id;
  const set = await s.shot(s.A, id, "home.png", S.png(20, 12));
  assert.equal(set.status, 200, JSON.stringify(set.json));
  const row = rowsOf(s.w, "SELECT screenshot_key, screenshot_name, screenshot_format, screenshot_type, screenshot_size FROM websites WHERE id = ?", id)[0];
  assert.match(row.screenshot_key, new RegExp(`^org/${s.A.id}/websites/[0-9a-f-]{36}$`), "a private object under this organization's own prefix"); assert.equal(row.screenshot_type, "image/png"); assert.equal(row.screenshot_format, "png");
  assert.ok(await s.bucket.get(row.screenshot_key), "the object exists");
  const got = await s.call(`${s.base(s.A)}/${id}/screenshot`);
  assert.equal(got.status, 200); assert.equal(got.headers.get("Content-Type"), "image/png"); assert.equal(got.headers.get("Content-Disposition"), "inline"); assert.match(got.headers.get("Content-Security-Policy"), /sandbox/); assert.equal(got.headers.get("X-Content-Type-Options"), "nosniff"); assert.match(got.headers.get("Cache-Control"), /no-store/);
  assert.equal(got.bytes.length, row.screenshot_size);
  const w = (await s.call(s.base(s.A))).json.websites[0]; assert.deepEqual([w.screenshot.name, w.screenshot.format], ["home.png", "png"]);
  const again = await s.shot(s.A, id, "home2.webp", S.webp()); assert.equal(again.status, 200);
  const row2 = rowsOf(s.w, "SELECT screenshot_key, screenshot_format FROM websites WHERE id = ?", id)[0];
  assert.notEqual(row2.screenshot_key, row.screenshot_key); assert.equal(await s.bucket.get(row.screenshot_key), null, "the replaced picture is deleted at once"); assert.ok(await s.bucket.get(row2.screenshot_key));
  for (const [name, bytes, code, status] of [["a.svg", S.svg(), "type_not_allowed", 415], ["a.pdf", S.pdf(), "type_not_allowed", 415], ["a.zip", new Uint8Array([80, 75, 3, 4]), "type_not_allowed", 415], ["a.png", S.pdf(), "content_mismatch", 422], ["empty.png", new Uint8Array(0), "empty_file", 422], ["a.exe", S.png(), "invalid_name_file", 422]]) {
    const r = await s.shot(s.A, id, name, bytes); assert.equal(r.status, status, name); assert.equal(r.json.error, code, name);
  }
  const big = await s.shot(s.A, id, "big.png", new Uint8Array(6 * 1024 * 1024)); assert.ok([413, 422].includes(big.status) && /too_large|content/.test(big.json.error), "over 5 MB is refused");
  assert.equal(rowsOf(s.w, "SELECT screenshot_key FROM websites WHERE id = ?", id)[0].screenshot_key, row2.screenshot_key, "every refusal left the screenshot as it was");
  assert.equal((await s.shot(s.Bo, id, "x.png", S.png())).status, 404, "another client cannot touch it"); assert.equal((await s.call(`${s.base(s.Bo)}/${id}/screenshot`)).status, 404);
  const rm = await s.call(`${s.base(s.A)}/${id}/screenshot/remove`, { method: "POST", json: {} });
  assert.equal(rm.status, 200); assert.equal(await s.bucket.get(row2.screenshot_key), null, "the stored picture is deleted"); assert.equal((await s.call(`${s.base(s.A)}/${id}/screenshot`)).status, 404);
  assert.equal((await s.call(`${s.base(s.A)}/${id}/screenshot/remove`, { method: "POST", json: {} })).status, 200, "removing nothing is fine");
  assert.equal(rowsOf(s.w, "SELECT count(*) n FROM activity_log WHERE action IN ('website.screenshot_set', 'website.screenshot_removed')")[0].n, 3);
});

test("screenshot objects are accounted for: the orphan check knows them, offboarding keeps website records' pictures, and a failed row update removes the object it stored", async () => {
  const s = await setup();
  const id = (await s.create(s.A, { ...SITE })).json.id;
  await s.shot(s.A, id, "home.png", S.png());
  const deps = { db: s.w.db, bucket: s.bucket, env: s.w.env, now: new Date() };
  assert.deepEqual(await B.findOrphanObjects(deps, { organizationId: s.A.id }), [], "a live screenshot is not an orphan");
  const key = rowsOf(s.w, "SELECT screenshot_key FROM websites")[0].screenshot_key;
  await B.deleteOrganizationFiles(deps, { organizationId: s.A.id, actor: ADMIN });
  assert.ok(await s.bucket.get(key), "website records are kept, like invoices and support records");
  const { adminSetScreenshot } = await import("../portal/website-files.js");
  const failing = { ...deps, db: new Proxy(s.w.db, { get: (t, p) => (p === "batch" ? async () => { throw new Error("boom"); } : t[p]) }) };
  const before = [...(await s.bucket.list({ prefix: `org/${s.A.id}/websites/` })).objects].length;
  await assert.rejects(() => adminSetScreenshot(failing, { organizationId: s.A.id, websiteId: id, actor: ADMIN, file: { name: "b.png", bytes: S.png(9, 9) } }));
  assert.equal([...(await s.bucket.list({ prefix: `org/${s.A.id}/websites/` })).objects].length, before, "no stray object is left behind");
});

test("guards: websites need an admin, writes need PORTAL_ADMIN_WRITES and the admin header, and a database without the migration, or without storage, answers plainly", async () => {
  const s = await setup();
  const id = (await s.create(s.A, { ...SITE })).json.id;
  s.w.env.PORTAL_ADMIN_WRITES = "0";
  const off = await s.create(s.A, { ...SITE }); assert.equal(off.status, 403); assert.equal(off.json.error, "writes_disabled");
  assert.equal((await s.call(s.base(s.A))).json.capabilities.writes, false); s.w.env.PORTAL_ADMIN_WRITES = "1";
  const noHeader = await handleAdmin(new Request(ORIGIN + "/api/admin" + s.base(s.A), { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, exp: nowS() + 600, iat: nowS() }) }, body: JSON.stringify(SITE) }), s.w.env, {});
  assert.equal(noHeader.status, 403);
  assert.ok([401, 403].includes((await handleAdmin(new Request(ORIGIN + "/api/admin" + s.base(s.A)), s.w.env, {})).status), "no admin, no websites");
  assert.equal((await handleAdmin(new Request(ORIGIN + "/api/admin" + s.base(s.A), { headers: { "Cf-Access-Jwt-Assertion": sign({ iss: `https://${TEAM}`, aud: [AUD], email: "x@else.test", exp: nowS() + 600, iat: nowS() }) } }), s.w.env, {})).status, 403);
  assert.ok((await s.call(`${s.base(s.A)}/${id}`, { method: "DELETE" })).status >= 400, "there is no delete route"); assert.equal(rowsOf(s.w, "SELECT count(*) n FROM websites")[0].n, 1); assert.equal((await s.call(s.base(s.A), { method: "PUT", json: {} })).status, 405);
  assert.equal((await s.call("/clients/not-a-uuid/websites")).status, 404); assert.equal((await s.call(`/clients/${crypto.randomUUID()}/websites`)).status, 404);
  const bare = await setup({ migrated: false }); const un = await bare.call(bare.base(bare.A)); assert.equal(un.status, 200); assert.deepEqual(un.json, { available: false });
  assert.equal((await bare.create(bare.A, SITE)).json.available, false, "nothing is written without the migration");
  const nos = await setup({ storage: false }); const nid = (await nos.create(nos.A, SITE)).json.id;
  assert.equal((await nos.call(nos.base(nos.A))).json.capabilities.storage, false); assert.equal((await nos.shot(nos.A, nid, "a.png", S.png())).status, 503); assert.equal((await nos.create(nos.A, { ...SITE, name: "Still works" })).status, 201, "everything but pictures works without storage");
});

test("the Admin client page links to Websites with counts, and the client list and detail keep working on a database without the migration", async () => {
  const s = await setup();
  await s.create(s.A, { ...SITE, managed_by_framework: true }); await s.create(s.A, { name: "Build", origin: "framework", status: "in_development" }); await s.create(s.A, { name: "Old", url: "https://old.example.ca", origin: "client", status: "existing" });
  const d = await s.call(`/clients/${s.A.id}`); assert.deepEqual(d.json.websites, { total: 3, live: 1, inDevelopment: 1, existing: 1, managed: 1 });
  const bare = await setup({ migrated: false }); assert.equal((await bare.call(`/clients/${bare.A.id}`)).json.websites, null, "no migration: no tile, no error");
  const ui = read("admin/assets/websites.js"), clients = read("admin/assets/clients.js"), dash = read("admin/assets/client-dashboard.js");
  assert.match(clients, /\\\/website\|/); assert.match(clients, /import\("\.\/websites\.js"\)/); assert.match(dash, /label: "Website"/); assert.match(dash, /href: `\/admin\/clients\/\$\{encodeURIComponent\(org\.id\)\}\/website`/);
  assert.ok(!/innerHTML|insertAdjacentHTML|style:/.test(ui), "no HTML injection or inline styles"); assert.match(ui, /rel: "noopener noreferrer"/); assert.match(ui, /type: "file", accept: "\.png,\.jpg,\.jpeg,\.webp"/);
  assert.match(ui, /Separate from where it stands/); assert.match(ui, /Never put passwords or logins here/);
});

test("the Website section stays hidden from clients: no client route, no hub change, no flag turned on", async () => {
  const s = await setup();
  await s.create(s.A, { ...SITE, published: true });
  for (const path of ["/portal/o/alpha/website", "/portal/o/alpha/websites", "/portal/o/alpha/website/1"]) { const r = await s.ann.get(path); const t = await r.text(); assert.ok(!/alpha\.example\.ca|Main website/.test(t), path + " shows nothing of the websites"); }
  const home = await (await s.ann.get("/portal/o/alpha")).text();
  assert.ok(!/alpha\.example\.ca|Main website/.test(home), "nothing about a website reaches the client's home");
  const router = read("worker/portal/router.js"), cfg = read("worker/portal/config.js");
  assert.ok(!/websites?\.js|PORTAL_WEBSITE/.test(router + cfg), "the client router and config know nothing of websites yet");
  assert.ok(!/PORTAL_WEBSITE/.test(read("wrangler.jsonc")), "no flag is set in any environment");
});
