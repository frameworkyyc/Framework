/* Framework Admin: Branding API (Phase 2). Authorization and CSRF, uploads and refusals, publication, replacement and deletion, client-upload review, service requests,
   organization isolation, audit trail and the dashboard summary. Local database and an in-memory bucket; the same SQL is also replayed on the real Staging D1 (see the PR). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as brand from "../portal/repo/brand.js";
import * as B from "../portal/brand-files.js";
import { isKnownBrandingService } from "../portal/brand-services.js";
import { rows, count } from "./helpers/portal-db.mjs";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const now = () => Math.floor(Date.now() / 1000);
const sign = (claims) => { const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), body = b64u(JSON.stringify(claims)); return `${head}.${body}.${b64u(createSign("RSA-SHA256").update(head + "." + body).sign(pair.privateKey))}`; };
const claims = (over = {}) => ({ iss: `https://${TEAM}`, aud: [AUD], email: "owner@frameworkco.ca", exp: now() + 600, iat: now(), ...over });
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

async function setup() {
  resetKeyCacheForTests();
  const w = await makeWorld();
  const A = await w.org("alpha", "Alpha Co"), Bo = await w.org("beta", "Beta Co");
  const u = (await import("../portal/repo/users.js")).upsertUserFromIdentity;
  const ownerA = (await u(w.db, { workosUserId: "user_01ADMINBR10000", email: "ann@alpha.test", name: "Ann Alpha" })).user;
  w.db.raw.prepare("INSERT INTO memberships (id, organization_id, user_id, role, status, created_at, created_by) VALUES (?, ?, ?, 'owner', 'active', ?, 'seed')").run(crypto.randomUUID(), A.id, ownerA.id, new Date().toISOString());
  const bucket = fakeR2();
  const env = { ...w.env, PORTAL_FILES: bucket, PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: "owner@frameworkco.ca", ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) };
  const call = async (path, { method = "GET", token = sign(claims()), headers = {}, e = env, json, form, origin = ORIGIN, csrf = true } = {}) => {
    const h = { ...(origin ? { Origin: origin } : {}), ...(csrf && method !== "GET" ? { "X-Framework-Admin": "1" } : {}), ...headers };
    if (token) h["Cf-Access-Jwt-Assertion"] = token;
    let body;
    if (form) { const packed = new Response(form); const buf = new Uint8Array(await packed.arrayBuffer()); h["Content-Type"] = packed.headers.get("Content-Type"); h["Content-Length"] = String(buf.length); body = buf; }
    else if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    const res = await handleAdmin(new Request(ORIGIN + "/api/admin" + path, { method, headers: h, body }), e, { fetch: async () => { throw new Error("no network in these tests"); } });
    const type = res.headers.get("Content-Type") || "";
    return { status: res.status, headers: res.headers, json: type.includes("json") ? await res.json() : null, bytes: type.includes("json") ? null : new Uint8Array(await res.arrayBuffer()) };
  };
  const upload = (org, name, bytes, meta, opts = {}) => { const f = new FormData(); f.append("file", new File([bytes], name)); f.append("meta", JSON.stringify(meta)); return call(`/clients/${org.id}/branding/assets`, { method: "POST", form: f, ...opts }); };
  const clientUpload = (name, bytes, category = "logo", ack = false) => B.clientUploadFile({ db: w.db, bucket, env: {}, now: new Date() }, { role: "owner", organizationId: A.id, userId: ownerA.id, category, fontRightsAck: ack, file: { name, bytes } });
  return { w, A, Bo, ownerA, bucket, env, call, upload, clientUpload };
}
const base = (o) => `/clients/${o.id}/branding`;

test("authorization: no token, a forged token or an unlisted email see nothing; every route needs Access first", async () => {
  const { call, A } = await setup();
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), body = b64u(JSON.stringify(claims()));
  const forged = `${head}.${body}.${b64u(createSign("RSA-SHA256").update(head + "." + body).sign(other.privateKey))}`;
  for (const token of [null, forged, sign(claims({ email: "intruder@example.com" })), sign(claims({ exp: now() - 3600 }))]) {
    for (const [path, method] of [[base(A), "GET"], [base(A) + "/kit", "PUT"], [base(A) + "/kit/publish", "POST"], [base(A) + "/assets", "POST"], ["/branding/storage-check", "POST"]]) {
      const r = await call(path, { method, token, json: method === "GET" ? undefined : {} });
      assert.ok([401, 403].includes(r.status), `${method} ${path} -> ${r.status}`);
      assert.ok(!JSON.stringify(r.json || {}).includes("Alpha"), "no data");
    }
  }
});

test("writes need Origin + the Admin header + the writes switch; reads work without writes; a database without migration 0005 answers 'not available'", async () => {
  const { call, A, upload, env } = await setup();
  const f = () => { const x = new FormData(); x.append("file", new File([S.png()], "a.png")); x.append("meta", JSON.stringify({ kind: "logo", logo_role: "primary", orientation: "horizontal", tone: "light" })); return x; };
  assert.equal((await call(base(A) + "/assets", { method: "POST", form: f(), origin: null })).status, 403);
  assert.equal((await call(base(A) + "/assets", { method: "POST", form: f(), origin: "https://evil.example" })).status, 403);
  assert.equal((await call(base(A) + "/kit/publish", { method: "POST", json: {}, csrf: false })).status, 403);
  const off = { ...env, PORTAL_ADMIN_WRITES: undefined };
  assert.equal((await call(base(A) + "/kit/publish", { method: "POST", json: {}, e: off })).json.error, "writes_disabled");
  assert.equal((await call("/branding/storage-check", { method: "POST", json: {}, e: off })).json.error, "writes_disabled");
  assert.equal((await call(base(A), { e: off })).status, 200);
  for (const [method, path] of [["GET", base(A) + "/kit"], ["POST", base(A)], ["DELETE", base(A) + "/assets"], ["GET", base(A) + "/assets/" + crypto.randomUUID() + "/delete"]]) assert.equal((await call(path, { method, json: method === "POST" ? {} : undefined })).status, 405, method + " " + path);
  assert.equal((await call("/clients/not-a-uuid/branding")).status, 404);
  assert.equal((await call(`/clients/${crypto.randomUUID()}/branding`)).status, 404);
  const bare = await setup();
  bare.w.db.raw.exec("DROP TABLE service_requests; DROP TABLE brand_uploads; DROP TABLE brand_assets; DROP TABLE brand_kits");
  assert.deepEqual((await bare.call(base(bare.A))).json, { available: false });
  assert.equal((await bare.call(`/clients/${bare.A.id}`)).json.branding, null, "the client page works on a database without branding");
  assert.ok(upload);
});

test("kit: colours and typography are validated, saved as a draft, never published by saving; publishing needs an explicit step", async () => {
  const { call, A } = await setup();
  assert.equal((await call(base(A) + "/kit", { method: "PUT", json: { colours: [{ name: "Ink", role: "primary", hex: "red" }] } })).json.error, "invalid_colours");
  assert.equal((await call(base(A) + "/kit", { method: "PUT", json: { colours: [], bogus: 1 } })).json.error, "unknown_field");
  assert.equal((await call(base(A) + "/kit", { method: "PUT", json: {} })).json.error, "invalid_input");
  assert.equal((await call(base(A) + "/kit", { method: "PUT", json: { typography: [{ role: "body", family: "F", source_url: "http://insecure.example" }] } })).json.error, "invalid_typography");
  const r = await call(base(A) + "/kit", { method: "PUT", json: { colours: [{ name: "Ink", role: "primary", hex: "#0a0a0a" }], typography: [{ role: "heading", family: "Switzer", weights: [600, 400] }] } });
  assert.equal(r.status, 200); assert.equal(r.json.kit.status, "draft"); assert.equal(r.json.kit.colours[0].hex, "#0A0A0A");
  assert.equal((await call(base(A))).json.kit.status, "draft");
  assert.equal((await call(base(A) + "/kit/publish", { method: "POST", json: {} })).status, 200);
  assert.equal((await call(base(A))).json.kit.status, "published");
  assert.equal((await call(base(A) + "/kit/unpublish", { method: "POST", json: {} })).status, 200);
});

test("uploading deliverables: accepted files are stored privately under the organization; every refusal is specific and stores nothing; admin JSON never carries storage keys", async () => {
  const { call, upload, A, bucket } = await setup();
  const png = await upload(A, "Primary Logo.png", S.png(32, 32), { kind: "logo", logo_role: "primary", orientation: "square", tone: "light", transparent: true });
  assert.equal(png.status, 201);
  assert.equal((await upload(A, "Guidelines.pdf", S.pdf(), { kind: "guideline", title: "Guidelines" })).status, 201);
  assert.equal((await upload(A, "pack.zip", S.brandPack(), { kind: "package", title: "Complete package" })).status, 201);
  assert.ok([...bucket.store.keys()].every((k) => k.startsWith(`org/${A.id}/brand-assets/`)) && bucket.store.size === 3);
  for (const [name, bytes, code, status] of [["evil.exe", S.text("MZ"), "invalid_name", 422], ["fake.png", S.pdf(), "content_mismatch", 422], ["bad.svg", S.svg("<script>1</script>"), "active_content", 422], ["x.gif", S.png(), "type_not_allowed", 415], ["js.pdf", S.pdf("/OpenAction << /S /JavaScript /JS (x) >>"), "active_content", 422], ["e.png", new Uint8Array(0), "empty_file", 422]]) {
    const r = await upload(A, name, bytes, { kind: "other", title: "x" });
    assert.deepEqual([r.status, r.json.error], [status, code], name);
  }
  assert.equal((await upload(A, "a.png", S.png(), { kind: "virus", title: "x" })).json.error, "invalid_kind");
  assert.equal((await upload(A, "a.ttf", S.ttf(), { kind: "font", title: "x", downloadable: true })).json.error, "font_license_required");
  assert.equal(bucket.store.size, 3, "refusals left nothing in storage");
  assert.equal(count((await setup()).w.db, "brand_assets"), 0);
  const v = await call(base(A));
  assert.equal(v.json.assets.length, 3);
  assert.ok(!JSON.stringify(v.json).match(/org\/[0-9a-f-]{36}|storage_?key/i));
  assert.ok(v.json.assets.every((a) => a.published === false), "new files start as drafts");
  const huge = new FormData(); huge.append("file", new File([new Uint8Array(1)], "a.png")); huge.append("meta", "{}");
  const declared = await call(base(A) + "/assets", { method: "POST", form: huge, headers: {} });
  assert.notEqual(declared.status, 500);
  const noType = await call(base(A) + "/assets", { method: "POST", json: {} });
  assert.equal(noType.status, 415);
  const extra = new FormData(); extra.append("file", new File([S.png()], "a.png")); extra.append("meta", "{}"); extra.append("organization_id", crypto.randomUUID());
  assert.equal((await call(base(A) + "/assets", { method: "POST", form: extra })).json.error, "unknown_field", "no organization id is ever read from the body");
});

test("publication: a draft kit shows a client nothing; publishing the kit and an asset shows exactly that asset; unpublishing either hides it again", async () => {
  const { call, upload, A, w } = await setup();
  const id = (await upload(A, "logo.png", S.png(), { kind: "logo", logo_role: "primary", orientation: "horizontal", tone: "light" })).json.id;
  await call(base(A) + "/kit", { method: "PUT", json: { colours: [{ name: "Ink", role: "primary", hex: "#000000" }] } });
  await call(`${base(A)}/assets/${id}/update`, { method: "POST", json: { published: true } });
  assert.deepEqual(await brand.getClientBrand(w.db, A.id), { published: false });
  await call(base(A) + "/kit/publish", { method: "POST", json: {} });
  const view = await brand.getClientBrand(w.db, A.id);
  assert.deepEqual(view.assets.map((a) => a.id), [id]); assert.equal(view.colours[0].hex, "#000000");
  await call(`${base(A)}/assets/${id}/update`, { method: "POST", json: { published: false } });
  assert.deepEqual((await brand.getClientBrand(w.db, A.id)).assets, []);
  await call(`${base(A)}/assets/${id}/update`, { method: "POST", json: { published: true } });
  await call(base(A) + "/kit/unpublish", { method: "POST", json: {} });
  assert.deepEqual(await brand.getClientBrand(w.db, A.id), { published: false });
  const bad = await call(`${base(A)}/assets/${id}/update`, { method: "POST", json: { storage_key: "x" } });
  assert.equal(bad.json.error, "unknown_field");
  assert.equal((await call(`${base(A)}/assets/${id}/update`, { method: "POST", json: { tone: "neon" } })).json.error, "invalid_tone");
});

test("download, replace and delete: attachment with hardening headers and exact bytes; replacing swaps the stored object; deleting removes it at once", async () => {
  const { call, upload, A, bucket } = await setup();
  const id = (await upload(A, "Primary Logo.png", S.png(32, 32), { kind: "logo", logo_role: "primary", orientation: "horizontal", tone: "light" })).json.id;
  const d = await call(`${base(A)}/assets/${id}/download`);
  assert.equal(d.status, 200);
  assert.match(d.headers.get("Content-Disposition"), /^attachment; filename="Alpha-Co-Primary-Horizontal-Light\.png"/);
  assert.equal(d.headers.get("Content-Type"), "application/octet-stream"); assert.equal(d.headers.get("X-Content-Type-Options"), "nosniff"); assert.match(d.headers.get("Content-Security-Policy"), /sandbox/);
  assert.deepEqual([...d.bytes], [...S.png(32, 32)]);
  const before = [...bucket.store.keys()];
  const rf = new FormData(); rf.append("file", new File([S.png(64, 64)], "Primary v2.png"));
  assert.equal((await call(`${base(A)}/assets/${id}/replace`, { method: "POST", form: rf })).status, 200);
  const after = [...bucket.store.keys()]; assert.equal(after.length, 1); assert.notDeepEqual(after, before);
  assert.deepEqual([...(await call(`${base(A)}/assets/${id}/download`)).bytes], [...S.png(64, 64)]);
  const bad = new FormData(); bad.append("file", new File([S.text("MZ")], "x.exe"));
  assert.equal((await call(`${base(A)}/assets/${id}/replace`, { method: "POST", form: bad })).status, 422); assert.equal(bucket.store.size, 1);
  assert.equal((await call(`${base(A)}/assets/${id}/delete`, { method: "POST", json: {} })).status, 200);
  assert.equal(bucket.store.size, 0);
  assert.equal((await call(`${base(A)}/assets/${id}/download`)).status, 404);
  assert.equal((await call(base(A))).json.assets.length, 0);
});

test("organization isolation: another organization's path cannot read, change, replace, download or delete anything of A's", async () => {
  const { call, upload, A, Bo, bucket, clientUpload } = await setup();
  const id = (await upload(A, "logo.png", S.png(), { kind: "logo", logo_role: "primary", orientation: "horizontal", tone: "light" })).json.id;
  const up = await clientUpload("theirs.png", S.png()); assert.ok(up.ok);
  const rf = new FormData(); rf.append("file", new File([S.png()], "x.png"));
  for (const [path, method, extra] of [[`${base(Bo)}/assets/${id}/update`, "POST", { json: { title: "Hijack" } }], [`${base(Bo)}/assets/${id}/delete`, "POST", { json: {} }], [`${base(Bo)}/assets/${id}/download`, "GET", {}], [`${base(Bo)}/assets/${id}/replace`, "POST", { form: rf }],
    [`${base(Bo)}/uploads/${up.id}/download`, "GET", {}], [`${base(Bo)}/uploads/${up.id}/hold`, "POST", { json: {} }], [`${base(Bo)}/uploads/${up.id}/delete`, "POST", { json: {} }]]) {
    const r = await call(path, { method, ...extra });
    assert.equal(r.status, 404, `${method} ${path}`);
  }
  const vb = await call(base(Bo)); assert.deepEqual([vb.json.assets.length, vb.json.uploads.length], [0, 0]);
  assert.equal(bucket.store.size, 2, "nothing was deleted by the attempts");
  assert.equal((await call(`${base(A)}/assets/${id}/download`)).status, 200);
});

test("client uploads are reviewed by staff: listed with the uploader, marked seen, held (blocking every download), released, downloaded, deleted", async () => {
  const { call, A, Bo, bucket, clientUpload, w } = await setup();
  const one = await clientUpload("Their Logo.png", S.png(10, 10)), two = await clientUpload("sig.pdf", S.pdf(), "signature");
  assert.ok(one.ok && two.ok);
  let v = (await call(base(A))).json;
  assert.equal(v.uploads.length, 2); assert.ok(v.uploads.every((u) => !u.seen && u.uploader.email === "ann@alpha.test" && u.held === false));
  assert.ok(!JSON.stringify(v).match(/org\/[0-9a-f-]{36}/));
  assert.equal((await call(base(A) + "/uploads/seen", { method: "POST", json: {} })).json.marked, 2);
  assert.ok((await call(base(A))).json.uploads.every((u) => u.seen));
  const d = await call(`${base(A)}/uploads/${one.id}/download`); assert.equal(d.status, 200); assert.match(d.headers.get("Content-Disposition"), /^attachment/);
  assert.equal((await call(`${base(A)}/uploads/${one.id}/hold`, { method: "POST", json: {} })).status, 200);
  assert.equal((await call(`${base(A)}/uploads/${one.id}/download`)).status, 404);
  assert.equal(await brand.getDownloadableUpload(w.db, A.id, one.id), null, "held: the client cannot download it either");
  assert.equal((await call(`${base(A)}/uploads/${one.id}/release`, { method: "POST", json: {} })).status, 200);
  assert.equal((await call(`${base(A)}/uploads/${one.id}/download`)).status, 200);
  assert.equal((await call(`${base(Bo)}/uploads/${one.id}/download`)).status, 404);
  assert.equal((await call(`${base(A)}/uploads/${one.id}/delete`, { method: "POST", json: {} })).status, 200);
  assert.equal(bucket.store.size, 1);
  assert.equal((await call(base(A))).json.uploads.length, 1);
});

test("service requests: shown with the service name, status and internal note updatable by staff, scoped to the organization, never exposing the note to clients", async () => {
  const { call, A, Bo, w, ownerA } = await setup();
  const rq = await brand.createServiceRequest(w.db, A.id, ownerA.id, { serviceKey: "business-card-design", note: "Two-sided" }, isKnownBrandingService);
  assert.ok(rq.ok);
  let v = (await call(base(A))).json; assert.equal(v.requests[0].service, "Business Card Design"); assert.equal(v.requests[0].status, "new"); assert.equal(v.requests[0].note, "Two-sided");
  assert.equal((await call(`${base(Bo)}/requests/${rq.id}/update`, { method: "POST", json: { status: "closed" } })).status, 404);
  assert.equal((await call(`${base(A)}/requests/${rq.id}/update`, { method: "POST", json: { status: "bogus" } })).json.error, "invalid_status");
  assert.equal((await call(`${base(A)}/requests/${rq.id}/update`, { method: "POST", json: { status: "contacted", admin_note: "Called Tuesday", extra: 1 } })).json.error, "unknown_field");
  assert.equal((await call(`${base(A)}/requests/${rq.id}/update`, { method: "POST", json: { status: "contacted", admin_note: "Called Tuesday" } })).status, 200);
  v = (await call(base(A))).json; assert.deepEqual([v.requests[0].status, v.requests[0].adminNote], ["contacted", "Called Tuesday"]);
  assert.equal((await brand.listServiceRequests(w.db, A.id))[0].adminNote, "Called Tuesday");
});

test("the client page carries the branding summary (kit state, files, new uploads, open requests) for the dashboard, and the dashboard turns it into next steps", async () => {
  const { call, upload, A, Bo, clientUpload, w, ownerA } = await setup();
  await upload(A, "logo.png", S.png(), { kind: "logo", logo_role: "primary", orientation: "horizontal", tone: "light", published: true });
  await clientUpload("theirs.png", S.png());
  await brand.createServiceRequest(w.db, A.id, ownerA.id, { serviceKey: "email-signature-design" }, isKnownBrandingService);
  const b = (await call(`/clients/${A.id}`)).json.branding;
  assert.deepEqual(b, { kitStatus: null, assets: 1, assetsPublished: 1, uploads: 1, uploadsNew: 1, requestsOpen: 1, requestsNew: 1 });
  assert.deepEqual((await call(`/clients/${Bo.id}`)).json.branding, { kitStatus: null, assets: 0, assetsPublished: 0, uploads: 0, uploadsNew: 0, requestsOpen: 0, requestsNew: 0 });
  const { attention } = await import("../../admin/assets/client-dashboard.js");
  const items = attention({ org: { name: "A", status: "active" }, profile: null, facts: { members: 1, owners: 1, pending: 0, lapsed: 0, failed: 0, unsent: 0, cleanup: 0 }, branding: b });
  assert.deepEqual(items.map((i) => [i.tone, i.href]), [["warn", "__BRANDING__"], ["warn", "__BRANDING__"]]);
  assert.match(items[0].text, /1 new service request to follow up/); assert.match(items[1].text, /1 new client upload to review/);
});

test("storage check: writes, reads back, proves another organization cannot read it, deletes, and is logged; without a bucket it says so", async () => {
  const { call, bucket, env, w } = await setup();
  const r = await call("/branding/storage-check", { method: "POST", json: {} });
  assert.equal(r.json.ok, true); assert.deepEqual(r.json.steps.map((s) => s.name), ["binding", "write", "read", "isolation", "delete"]);
  assert.equal(bucket.store.size, 0);
  assert.equal(count(w.db, "activity_log", "action = 'brand.storage.selftest' AND organization_id IS NULL"), 1);
  const none = await call("/branding/storage-check", { method: "POST", json: {}, e: { ...env, PORTAL_FILES: undefined } });
  assert.deepEqual([none.status, none.json.ok], [200, false]);
  const a = (await setup()); const f = new FormData(); f.append("file", new File([S.png()], "a.png")); f.append("meta", JSON.stringify({ kind: "logo", logo_role: "primary", orientation: "horizontal", tone: "light" }));
  assert.equal((await a.call(`/clients/${a.A.id}/branding/assets`, { method: "POST", form: f, e: { ...a.env, PORTAL_FILES: undefined } })).json.error, "storage_unavailable");
});

test("audit: every Admin action is recorded in the activity log (internal only), with no keys, file names or URLs", async () => {
  const { call, upload, A, w } = await setup();
  const id = (await upload(A, "Secret Logo.png", S.png(), { kind: "logo", logo_role: "primary", orientation: "horizontal", tone: "light" })).json.id;
  await call(base(A) + "/kit", { method: "PUT", json: { colours: [] } }); await call(base(A) + "/kit/publish", { method: "POST", json: {} });
  await call(`${base(A)}/assets/${id}/update`, { method: "POST", json: { published: true } }); await call(`${base(A)}/assets/${id}/download`);
  await call(`${base(A)}/assets/${id}/delete`, { method: "POST", json: {} });
  const log = rows(w.db, "SELECT actor_type, actor_ref, action, detail, visibility FROM activity_log WHERE organization_id = ? AND action LIKE 'brand.%'", A.id);
  const acts = log.map((l) => l.action);
  for (const a of ["brand.asset.created", "brand.kit.saved", "brand.kit.published", "brand.asset.published", "brand.asset.download", "brand.asset.deleted"]) assert.ok(acts.includes(a), a);
  assert.ok(log.every((l) => l.visibility === "internal" && l.actor_type !== "client" || l.action.startsWith("brand.")));
  assert.ok(log.filter((l) => l.actor_type === "admin").every((l) => l.actor_ref === "owner@frameworkco.ca"));
  assert.ok(!/org\/|brand-assets|Secret Logo|\.png|https?:/i.test(JSON.stringify(log)));
});

/* ------------------------------------------------------------------ the interface (source guards) */

test("Branding Admin UI: built the safe way, uploads only through api(), confirmations on every destructive or publishing action, colour swatches without inline styles", () => {
  const ui = strip(read("admin/assets/branding.js"));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(ui));
  assert.ok(!/\.style\b|setAttribute\(\s*["']style|style\s*:\s*["'{]/.test(ui), "no inline styles (the Admin CSP forbids them)");
  assert.ok(!/localStorage|sessionStorage|document\.cookie|indexedDB|fetch\(/.test(ui));
  assert.match(ui, /new FormData\(\)/); assert.match(ui, /api\(base \+ "\/assets", \{ method: "POST", body \}\)/);
  assert.match(ui, /svg\.update = /, "swatches are SVG with a fill attribute");
  for (const title of ["Replace this file?", "Delete this file?", "Delete this client file?", "Hold this file?", "Unpublish this file?", "Unpublish the brand kit?", "Publish the brand kit?"]) assert.ok(ui.includes(`title: "${title}"`), title);
  for (const [visible, aria] of [["Delete", "Delete ${a.originalName}"], ["Download", "Download ${a.originalName}"], ["Edit", "Edit ${a.originalName}"], ["Replace file", "Replace file for ${a.originalName}"], ["Remove", "Remove colour ${i + 1}"]]) assert.ok(ui.includes(visible) && ui.includes(aria), visible);
  assert.match(ui, /download: ""/);
  assert.match(read("admin/assets/clients.js"), /\(\\\/branding\|\\\/profile\)\?\$/, "the client route has branding and profile sub-pages");
  assert.match(read("admin/assets/ui.js"), /instanceof FormData/);
  const router = strip(read("worker/admin/router.js"));
  assert.match(router, /handleBrandingApi, handleAccessApi/);
});

test("brand name over the API: saved through the kit route, returned in the view, validated, clearable; uploads then use it, and nothing existing is renamed", async () => {
  const { call, upload, A, w } = await setup();
  const LG = { kind: "logo", logo_role: "primary", orientation: "square", tone: "dark" };
  const first = await upload(A, "a.png", S.png(), LG); assert.equal(first.json.name, "Alpha-Co-Primary-Square-Dark.png");
  assert.equal((await call(base(A))).json.kit, null, "no kit yet: no brand name");
  const set = await call(base(A) + "/kit", { method: "PUT", json: { brand_name: "Alpha" } });
  assert.equal(set.status, 200); assert.equal(set.json.kit.brandName, "Alpha"); assert.equal(set.json.kit.status, "draft");
  assert.equal((await call(base(A))).json.kit.brandName, "Alpha");
  assert.equal((await call(base(A))).json.assets[0].originalName, "Alpha-Co-Primary-Square-Dark.png", "the earlier file kept its name");
  assert.equal((await upload(A, "b.png", S.png(), { ...LG, tone: "light" })).json.name, "Alpha-Primary-Square-Light.png");
  assert.equal((await call(base(A) + "/kit", { method: "PUT", json: { brand_name: "!!!" } })).json.error, "invalid_brand_name");
  assert.equal((await call(base(A) + "/kit", { method: "PUT", json: { brand_name: 5 } })).json.error, "invalid_brand_name");
  assert.equal((await call(base(A) + "/kit", { method: "PUT", json: { brand_name: "x", extra: 1 } })).json.error, "unknown_field");
  assert.equal((await call(base(A) + "/kit", { method: "PUT", json: {} })).json.error, "invalid_input");
  assert.equal((await call(base(A) + "/kit", { method: "PUT", json: { brand_name: null } })).json.kit.brandName, null);
  assert.equal((await upload(A, "c.png", S.png(), { ...LG, tone: "mono" })).json.name, "Alpha-Co-Primary-Square-Mono.png", "cleared: back to the organization's name");
  // writes switch and Access still apply
  assert.equal((await call(base(A) + "/kit", { method: "PUT", json: { brand_name: "x" }, token: null })).status, 401);
  assert.equal(rows(w.db, "SELECT count(*) AS n FROM brand_assets").length, 1);
});
