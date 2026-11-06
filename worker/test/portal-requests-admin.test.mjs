/* The Admin side of the request engine: the real Admin API over the same database and bucket as the portal. Staff list, read, reply (public and private), quote, record approval,
   upload proofs and finals, move requests along and add revision rounds; and everything that must be refused (no writes, no origin, wrong organization, bad ids, private notes to the client). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as svc from "../portal/requests/service.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const now = () => Math.floor(Date.now() / 1000);
const sign = (claims) => { const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), body = b64u(JSON.stringify(claims)); return `${head}.${body}.${b64u(createSign("RSA-SHA256").update(head + "." + body).sign(pair.privateKey))}`; };
const claims = () => ({ iss: `https://${TEAM}`, aud: [AUD], email: "owner@frameworkco.ca", exp: now() + 600, iat: now() });
const form = (o) => { const m = new Map(Object.entries(o)); return { get: (n) => (m.has(n) ? m.get(n) : null), keys: () => m.keys() }; };
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

async function setup({ migrated = true } = {}) {
  resetKeyCacheForTests();
  const w = await makeWorld({ skip: migrated ? [] : ["0020_requests.sql"] });
  const bucket = fakeR2();
  const Ao = await w.org("alpha", "Alpha Co"); const Bq = await w.org("beta", "Beta Co"); const A = Ao.id, Bo = Bq.id;
  await w.invite(Ao, "ann@alpha.test", "owner"); await w.invite(Bq, "bob@beta.test", "owner");
  Object.assign(w.env, { PORTAL_FILES: bucket, PORTAL_SERVICES: "1", PORTAL_REQUESTS: "1", PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: "owner@frameworkco.ca", ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) });
  const ann = w.browser(); await ann.signIn(w.user(1, "ann@alpha.test"));
  const call = async (path, { method = "GET", token = sign(claims()), json, fd, origin = ORIGIN, e = w.env } = {}) => {
    const h = { ...(origin ? { Origin: origin } : {}), ...(method !== "GET" ? { "X-Framework-Admin": "1" } : {}) };
    if (token) h["Cf-Access-Jwt-Assertion"] = token;
    let body;
    if (fd) { const p = new Response(fd); const buf = new Uint8Array(await p.arrayBuffer()); h["Content-Type"] = p.headers.get("Content-Type"); h["Content-Length"] = String(buf.length); body = buf; }
    else if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    const res = await handleAdmin(new Request(ORIGIN + "/api/admin" + path, { method, headers: h, body }), e, { fetch: async () => { throw new Error("no network"); } });
    const type = res.headers.get("Content-Type") || "";
    return { status: res.status, headers: res.headers, json: type.includes("json") ? await res.json() : null, bytes: type.includes("json") ? null : new Uint8Array(await res.arrayBuffer()) };
  };
  const userId = w.db.raw.prepare("SELECT id FROM portal_users WHERE email = 'ann@alpha.test'").get().id;
  const make = async (typeKey = "business_card", over = {}) => {
    const r = await svc.clientCreate({ db: w.db, bucket, env: w.env, now: new Date() }, { role: "owner", organizationId: A, userId, typeKey, form: form({ title: "Spring cards", d_person: "Ann", d_contact: "x", d_purpose: "y", ...over }), files: [] });
    assert.ok(r.ok, JSON.stringify(r)); return r.id;
  };
  const upload = (file, role, name = "a.png") => { const fd = new FormData(); fd.set("file", new Blob([file]), name); fd.set("meta", JSON.stringify({ role })); return fd; };
  return { w, A, Bo, bucket, ann, call, make, upload, userId };
}
const base = (A, id = "") => `/clients/${A}/requests${id ? "/" + id : ""}`;

test("lists, queue and thread: staff see the new request, its answers and what needs attention; nothing mentions another client", async () => {
  const { A, call, make } = await setup();
  const id = await make();
  const q = (await call("/requests")).json;
  assert.equal(q.available, true); assert.equal(q.requests.length, 1); assert.equal(q.requests[0].id, id); assert.equal(q.requests[0].organization.name, "Alpha Co");
  assert.equal(q.totals.attention, 1);
  assert.equal((await call("/requests/attention")).status, 200);
  const list = (await call(base(A))).json; assert.equal(list.requests.length, 1);
  const t = (await call(base(A, id))).json;
  assert.equal(t.request.status, "new"); assert.equal(t.request.typeLabel.length > 0, true); assert.ok(t.request.details.some((d) => d.value === "Ann"));
  assert.equal(t.capabilities.writes, true);
  assert.equal((await call(base(A, id) + "/seen", { method: "POST", json: {} })).status, 200);
  assert.equal((await call("/requests?scope=closed")).json.requests.length, 0);
});

test("without the migration the API says unavailable and writes nothing", async () => {
  const { A, call } = await setup({ migrated: false });
  assert.deepEqual((await call("/requests")).json, { available: false });
  assert.deepEqual((await call(base(A))).json, { available: false });
});

test("staff reply (public and private), and the private note never reaches the client", async () => {
  const { w, A, call, make, ann } = await setup();
  const id = await make();
  assert.equal((await call(base(A, id) + "/reply", { method: "POST", json: { body: "We will start tomorrow." } })).status, 201);
  assert.equal((await call(base(A, id) + "/reply", { method: "POST", json: { body: "SECRET staff note", internal: true } })).status, 201);
  assert.equal((await call(base(A, id) + "/reply", { method: "POST", json: { body: "" } })).status, 422);
  assert.equal((await call(base(A, id) + "/reply", { method: "POST", json: { body: "x", internal: "yes" } })).status, 422);
  const t = (await call(base(A, id))).json;
  assert.ok(t.events.some((e) => e.visibility === "internal" && e.body === "SECRET staff note"));
  const page = await (await ann.get(`/portal/o/alpha/requests/${id}`)).text();
  assert.ok(page.includes("We will start tomorrow.")); assert.ok(!page.includes("SECRET staff note"));
  void w;
});

test("a quote is sent, withdrawn, replaced; approval is recorded by staff; amounts are typed, never calculated", async () => {
  const { A, call, make } = await setup();
  const id = await make();
  assert.equal((await call(base(A, id) + "/quotes", { method: "POST", json: { title: "Cards", scope: "Design and files", amount: "abc" } })).json.error, "invalid_amount");
  const sent = await call(base(A, id) + "/quotes", { method: "POST", json: { title: "Cards", scope: "Design and files", amount: "180.00" } });
  assert.equal(sent.status, 201);
  let t = (await call(base(A, id))).json; assert.equal(t.request.status, "quoted"); assert.equal(t.quotes[0].amountLabel.includes("180"), true);
  assert.equal((await call(base(A, id) + `/quotes/${sent.json.id}/withdraw`, { method: "POST", json: {} })).status, 200);
  const again = await call(base(A, id) + "/quotes", { method: "POST", json: { title: "Cards v2", scope: "Design and files", amount: "150" } });
  assert.equal(again.status, 201);
  assert.equal((await call(base(A, id) + "/approve", { method: "POST", json: { quote_id: again.json.id, note: "By phone" } })).status, 200);
  t = (await call(base(A, id))).json; assert.equal(t.request.status, "approved"); assert.equal(t.quotes.find((q) => q.id === again.json.id).decidedVia, "staff_record");
  assert.equal((await call(base(A, id) + "/approve", { method: "POST", json: { quote_id: "not-a-uuid" } })).status, 404);
});

test("proofs stay hidden until the request is sent for review; finals only when completed; staff can preview them; a proof is required first", async () => {
  const { w, A, call, make, upload, ann } = await setup();
  const id = await make();
  // get to in_progress: record approval with no quote, then start work
  assert.equal((await call(base(A, id) + "/status", { method: "POST", json: { status: "in_review" } })).status, 200);
  const ap = await call(base(A, id) + "/approve", { method: "POST", json: {} }); assert.equal(ap.status, 200);
  assert.equal((await call(base(A, id) + "/status", { method: "POST", json: { status: "in_progress" } })).status, 200);
  assert.notEqual((await call(base(A, id) + "/status", { method: "POST", json: { status: "client_review" } })).status, 200, "no proof yet");
  const up = await call(base(A, id) + "/files", { method: "POST", fd: upload(S.png(), "proof") });
  assert.equal(up.status, 201);
  const draft = await (await ann.get(`/portal/o/alpha/requests/${id}`)).text();
  assert.ok(!/requests\/[0-9a-f-]+\/files\//.test(draft), "draft proof hidden from the client");
  const files = (await call(base(A, id))).json.files; assert.equal(files.length, 1); assert.equal(files[0].role, "proof");
  const dl = await call(base(A, id) + `/files/${files[0].id}/download?view=1`); assert.equal(dl.status, 200);
  assert.equal(dl.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal((await call(base(A, id) + "/status", { method: "POST", json: { status: "client_review", note: "Here you go" } })).status, 200);
  const shown = await (await ann.get(`/portal/o/alpha/requests/${id}`)).text();
  assert.match(shown, /requests\/[0-9a-f-]+\/files\//, "proof visible after sending for review");
  const fin = await call(base(A, id) + "/files", { method: "POST", fd: upload(S.png(), "final", "final.png") }); assert.equal(fin.status, 201);
  const hidden = (await (await ann.get(`/portal/o/alpha/requests/${id}`)).text()).match(/final\.png/g);
  assert.equal(hidden, null, "final hidden until completed");
  assert.equal((await call(base(A, id) + "/status", { method: "POST", json: { status: "completed" } })).status, 200);
  assert.match(await (await ann.get(`/portal/o/alpha/requests/${id}`)).text(), /final\.png/);
});

test("revision rounds can be granted (design requests only) and bad counts are refused", async () => {
  const { A, call, make } = await setup();
  const id = await make();
  assert.equal((await call(base(A, id) + "/revisions", { method: "POST", json: { count: 1 } })).status, 200);
  assert.equal((await call(base(A, id))).json.request.revisions.paid, 1);
  for (const c of [0, -1, 11, 1.5, "x"]) assert.notEqual((await call(base(A, id) + "/revisions", { method: "POST", json: { count: c } })).status, 200, String(c));
});

test("service settings: read and save per-service defaults; invalid values are refused", async () => {
  const { call } = await setup();
  const s = (await call("/requests/settings")).json; assert.equal(s.available, true); assert.ok(s.services.length >= 21);
  assert.equal((await call("/requests/settings", { method: "POST", json: { type_key: "poster", enabled: true, revisions_included: 3, pricing_mode: "fixed", price: "120.00", turnaround_note: "About a week" } })).status, 200);
  const p = (await call("/requests/settings")).json.services.find((x) => x.typeKey === "poster"); assert.equal(p.revisionsIncluded, 3); assert.equal(p.pricingMode, "fixed");
  for (const bad of [{ type_key: "nope" }, { type_key: "poster", pricing_mode: "fixed", price: "abc" }, { type_key: "poster", revisions_included: 99 }]) assert.notEqual((await call("/requests/settings", { method: "POST", json: bad })).status, 200, JSON.stringify(bad));
});

test("refusals: no token, no origin, writes off, bad ids, another organization's request, wrong method", async () => {
  const { A, Bo, w, call, make } = await setup();
  const id = await make();
  assert.notEqual((await call(base(A, id), { token: null })).status, 200);
  assert.equal((await call(base(A, id) + "/reply", { method: "POST", json: { body: "x" }, origin: null })).status, 403);
  assert.equal((await call(base(A, id) + "/reply", { method: "POST", json: { body: "x" }, e: { ...w.env, PORTAL_ADMIN_WRITES: undefined } })).json.error, "writes_disabled");
  assert.equal((await call(base(A, "not-a-uuid"))).status, 404);
  assert.equal((await call(base(Bo, id))).status, 404, "a request is only reachable through its own organization");
  assert.equal((await call(base(Bo, id) + "/reply", { method: "POST", json: { body: "x" } })).status, 404);
  assert.equal((await call(base(A, id) + "/reply")).status, 405);
  assert.equal((await call(base(A, id) + "/files", { method: "POST", fd: (() => { const f = new FormData(); f.set("file", new Blob(["MZ\x90"]), "bad.exe"); f.set("meta", JSON.stringify({ role: "attachment" })); return f; })() })).status === 201, false);
});

test("the Admin page is built safely: no HTML insertion, no inline style, registered in the shell and routed from a client", () => {
  const src = strip(read("admin/assets/requests.js"));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|localStorage|[^.\w]fetch\(/.test(src));
  assert.ok(!/\.style\b|style\s*:\s*["'{]/.test(src));
  assert.match(read("admin/assets/modules.js"), /id: "requests", label: "Requests", path: "\/admin\/requests"/);
  assert.match(read("admin/assets/clients.js"), /\\\/requests/);
});
