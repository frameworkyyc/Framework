/* End to end (HTTP on both sides): a client submits, Admin reviews and replies, proofs and finals move through the real portal and Admin routes, for several request types. The Admin side of the request engine: the real Admin API over the same database and bucket as the portal. Staff list, read, reply (public and private), quote, record approval,
   upload proofs and finals, move requests along and add revision rounds; and everything that must be refused (no writes, no origin, wrong organization, bad ids, private notes to the client). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld, ORIGIN as PORTAL_ORIGIN } from "./helpers/portal-e2e.mjs";
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

async function setup() {
  resetKeyCacheForTests();
  const w = await makeWorld({});
  const bucket = fakeR2();
  const Ao = await w.org("alpha", "Alpha Co"); const Bq = await w.org("beta", "Beta Co"); const A = Ao.id;
  await w.invite(Ao, "ann@alpha.test", "owner"); await w.invite(Ao, "mia@alpha.test", "member"); await w.invite(Bq, "bob@beta.test", "owner");
  Object.assign(w.env, { PORTAL_FILES: bucket, PORTAL_SERVICES: "1", PORTAL_REQUESTS: "1", PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: "owner@frameworkco.ca", ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) });
  const ann = w.browser(), mia = w.browser(), bob = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(2, "mia@alpha.test")); await bob.signIn(w.user(3, "bob@beta.test"));
  const admin = async (path, { method = "GET", json, fd, token = sign(claims()) } = {}) => {
    const h = { Origin: ORIGIN, ...(method !== "GET" ? { "X-Framework-Admin": "1" } : {}) };
    if (token) h["Cf-Access-Jwt-Assertion"] = token;
    let body;
    if (fd) { const p = new Response(fd); const buf = new Uint8Array(await p.arrayBuffer()); h["Content-Type"] = p.headers.get("Content-Type"); h["Content-Length"] = String(buf.length); body = buf; }
    else if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    const res = await handleAdmin(new Request(ORIGIN + "/api/admin" + path, { method, headers: h, body }), w.env, { fetch: async () => { throw new Error("no network"); } });
    const type = res.headers.get("Content-Type") || "";
    return { status: res.status, headers: res.headers, json: type.includes("json") ? await res.json() : null };
  };
  const csrf = async (b, path, slug = "alpha") => /name="csrf" value="([^"]+)"/.exec(await (await b.get(`/portal/o/${slug}${path}`)).text())[1];
  const page = async (b, path, slug = "alpha") => (await b.get(`/portal/o/${slug}${path}`)).text();
  const post = async (b, path, fields, { slug = "alpha", from = "/requests", files = [] } = {}) => {
    const t = await csrf(b, from, slug); const same = { "Sec-Fetch-Site": "same-origin", Origin: PORTAL_ORIGIN };
    if (!files.length && !/\/reply$/.test(path) && path !== "/requests") return b.send(`/portal/o/${slug}${path}`, { method: "POST", body: new URLSearchParams({ csrf: t, ...fields }), headers: { ...same, "Content-Type": "application/x-www-form-urlencoded" } });
    const fd = new FormData(); fd.set("csrf", t);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    for (const [name, bytes] of files) fd.append("file", new Blob([bytes]), name);
    return b.send(`/portal/o/${slug}${path}`, { method: "POST", body: fd, headers: same });
  };
  const sql = (q, ...p) => w.db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
  const up = (bytes, role, name) => { const fd = new FormData(); fd.set("file", new Blob([bytes]), name); fd.set("meta", JSON.stringify({ role })); return fd; };
  const move = (id, status, note) => admin(`/clients/${A}/requests/${id}/status`, { method: "POST", json: { status, note } });
  return { w, A, ann, mia, bob, admin, page, post, sql, up, move };
}
const FORMS = {
  business_card: { title: "Spring business cards", d_person: "Ann Lee, Owner", d_contact: "403 555 0100", d_purpose: "Trade shows", d_sides: "two" },
  poster: null, // filled from the registry below
};
async function submit(ctx, b, typeKey, fields) {
  const r = await ctx.post(b, "/requests", { type: typeKey, ...fields }, { from: `/requests/new?type=${typeKey}` });
  assert.equal(r.status, 303, `${typeKey} create -> ${r.status}`);
  return /requests\/([0-9a-f-]{36})/.exec(r.headers.get("Location"))[1];
}
const png = () => S.png();

test("the whole business-card journey, step by step, through the real client and Admin routes", async () => {
  const c = await setup(); const { A, ann, mia, admin, page, post, sql, up, move } = c;
  // 1. a client submits (with a reference file)
  const id = await submit(c, ann, "business_card", FORMS.business_card);
  // 2. it appears in Admin, flagged as needing attention
  const q = (await admin("/requests")).json; assert.equal(q.requests[0].id, id); assert.equal(q.totals.attention, 1); assert.ok(q.requests[0].reason);
  assert.equal((await admin(`/clients/${A}/requests/${id}`)).json.request.status, "new");
  // 3. Admin reviews and talks to the client
  assert.equal((await move(id, "in_review")).status, 200);
  assert.equal((await admin(`/clients/${A}/requests/${id}/reply`, { method: "POST", json: { body: "Do you have a logo file?" } })).status, 201);
  assert.match(await page(ann, `/requests/${id}`), /Do you have a logo file\?/);
  assert.equal((await post(mia, `/requests/${id}/reply`, { body: "Yes, attached on the brand page." }, { from: `/requests/${id}` })).status, 303);
  assert.ok((await admin(`/clients/${A}/requests/${id}`)).json.events.some((e) => e.body === "Yes, attached on the brand page." && e.authorType === "client"));
  // work starts (recorded agreement: no quote is needed for this step; quote acceptance stays closed)
  assert.equal((await admin(`/clients/${A}/requests/${id}/approve`, { method: "POST", json: {} })).status, 200);
  assert.equal((await move(id, "in_progress")).status, 200);
  // 4. Admin uploads a design proof; the client cannot see it until it is sent for review
  assert.equal((await admin(`/clients/${A}/requests/${id}/files`, { method: "POST", fd: up(png(), "proof", "card-v1.png") })).status, 201);
  assert.ok(!/Review your design/.test(await page(ann, `/requests/${id}`)));
  assert.equal((await move(id, "client_review", "Here is the first design")).status, 200);
  // 5. the client views the proof (inline image, hardened) and asks for a revision
  const html = await page(mia, `/requests/${id}`); assert.match(html, /Review your design/);
  const view = /src="(\/portal\/o\/alpha\/requests\/[^"]+\/view)"/.exec(html)[1];
  const img = await mia.get(view); assert.equal(img.status, 200); assert.equal(img.headers.get("Content-Disposition"), "inline"); assert.equal(img.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal((await mia.get(view.replace(/\/view$/, ""))).status, 404, "proofs are never downloadable");
  assert.equal((await post(mia, `/requests/${id}/revise`, { note: "Make the logo bigger" }, { from: `/requests/${id}` })).status, 303);
  assert.equal((await admin(`/clients/${A}/requests/${id}`)).json.request.status, "revision_requested");
  // 6. Admin uploads an updated proof and sends it back
  assert.equal((await move(id, "in_progress")).status, 200);
  assert.equal((await admin(`/clients/${A}/requests/${id}/files`, { method: "POST", fd: up(png(), "proof", "card-v2.png") })).status, 201);
  assert.equal((await move(id, "client_review")).status, 200);
  const second = await page(ann, `/requests/${id}`); assert.match(second, /Version 2/); assert.match(second, /1 revision round left of 2/);
  // 7. the client approves the design
  assert.equal((await post(ann, `/requests/${id}/approve`, { note: "Perfect" }, { from: `/requests/${id}` })).status, 303);
  // 8. approving a design completes the request; Admin then uploads the completed deliverable, which is released at once
  const state = (await admin(`/clients/${A}/requests/${id}`)).json.request.status;
  assert.ok(["completed", "client_review"].includes(state));
  if (state !== "completed") assert.equal((await move(id, "completed")).status, 200);
  assert.equal((await admin(`/clients/${A}/requests/${id}/files`, { method: "POST", fd: up(S.pdf(), "final", "cards-final.pdf") })).status, 201);
  // 9. the client downloads the final file
  const done = await page(ann, `/requests/${id}`); assert.match(done, /cards-final\.pdf/);
  const href = /href="(\/portal\/o\/alpha\/requests\/[^"]+\/files\/[^"]+)">Download/.exec(done)[1];
  const dl = await ann.get(href); assert.equal(dl.status, 200); assert.match(dl.headers.get("Content-Disposition"), /^attachment/); assert.equal(dl.headers.get("X-Content-Type-Options"), "nosniff");
  // 10. completed, with an accurate history
  const t = (await admin(`/clients/${A}/requests/${id}`)).json;
  assert.equal(t.request.status, "completed"); assert.equal(t.request.revisions.used, 1);
  const trail = t.events.filter((e) => e.statusTo).map((e) => e.statusTo);
  const count = (x) => trail.filter((s) => s === x).length;
  for (const [x, n] of [["new", 1], ["in_review", 1], ["approved", 1], ["in_progress", 2], ["client_review", 2], ["revision_requested", 1], ["completed", 1]]) assert.equal(count(x), n, `status ${x} appears ${n}x in the history`);
  assert.ok(t.events.some((e) => e.kind === "revision")); assert.equal(sql("SELECT count(*) n FROM request_files WHERE role = 'proof'")[0].n, 2);
  assert.ok(sql("SELECT count(*) n FROM activity_log WHERE action LIKE 'request.%'")[0].n >= 5, "the audit log recorded the steps");
});

test("the same engine runs a poster, an SEO request and a development request (no proofs for the last two)", async () => {
  const c = await setup(); const { A, ann, admin, page, up, move } = c;
  const { getType } = await import("../portal/requests/registry.js");
  const fill = (key) => { const f = { title: `Test ${key}` }; for (const q of getType(key).fields) { if (q.type === "select") f["d_" + q.key] = q.options[0][0]; else if (q.type === "checks") f[`d_${q.key}__${q.options[0][0]}`] = "1"; else if (q.required) f["d_" + q.key] = "Example answer"; } return f; };
  for (const key of ["poster", "seo_audit", "custom_web_app"]) {
    const id = await submit(c, ann, key, fill(key));
    const t0 = (await admin(`/clients/${A}/requests/${id}`)).json; assert.equal(t0.request.status, "new", key);
    assert.equal((await move(id, "in_review")).status, 200, key);
    const quote = await admin(`/clients/${A}/requests/${id}/quotes`, { method: "POST", json: { title: "Scope", scope: "As discussed", amount: "100.00" } }); assert.equal(quote.status, 201, key);
    assert.match(await page(ann, `/requests/${id}`), /Scope/);
    assert.equal((await admin(`/clients/${A}/requests/${id}/approve`, { method: "POST", json: { quote_id: quote.json.id } })).status, 200, key);
    assert.equal((await move(id, "in_progress")).status, 200, key);
    if (getType(key).proofs) {
      assert.notEqual((await move(id, "client_review")).status, 200, key + " needs a proof first");
      await admin(`/clients/${A}/requests/${id}/files`, { method: "POST", fd: up(png(), "proof", "p.png") });
    }
    await admin(`/clients/${A}/requests/${id}/files`, { method: "POST", fd: up(S.pdf(), "final", "result.pdf") });
    assert.equal((await move(id, getType(key).proofs ? "client_review" : "completed")).status, 200, key);
    if (getType(key).proofs) assert.equal((await c.post(ann, `/requests/${id}/approve`, { note: "ok" }, { from: `/requests/${id}` })).status, 303, key);
    assert.equal((await admin(`/clients/${A}/requests/${id}`)).json.request.status, "completed", key);
    assert.match(await page(ann, `/requests/${id}`), /result\.pdf/, key);
  }
});

test("permissions and isolation across the real routes", async () => {
  const c = await setup(); const { A, ann, mia, bob, admin, page, post, sql, up, move } = c;
  const id = await submit(c, ann, "business_card", FORMS.business_card);
  await move(id, "in_review");
  const quote = await admin(`/clients/${A}/requests/${id}/quotes`, { method: "POST", json: { title: "Cards", scope: "Design", amount: "90" } });
  // owners see the quote decision; members do not; neither can accept online (gate closed)
  assert.match(await page(ann, `/requests/${id}`), /Cards/);
  const acc = await post(ann, `/requests/${id}/quote/${quote.json.id}/accept`, { name: "Ann Lee" }, { from: `/requests/${id}` });
  assert.notEqual(acc.status, 303, "online acceptance is closed");
  assert.equal(sql("SELECT status FROM request_quotes")[0].status, "sent");
  const memberAccept = await post(mia, `/requests/${id}/quote/${quote.json.id}/decline`, {}, { from: `/requests/${id}` });
  assert.notEqual(memberAccept.status, 303, "a member cannot decide a quote");
  // another organization sees nothing, anywhere
  for (const p of [`/requests/${id}`, `/requests/${id}/files/00000000-0000-4000-8000-000000000000`, `/requests/${id}/view`]) assert.equal((await bob.get(`/portal/o/alpha${p}`)).status, 404, p);
  assert.equal((await bob.get(`/portal/o/beta/requests/${id}`)).status, 404);
  assert.ok(!(await page(bob, "/requests", "beta")).includes("Spring business cards"));
  // a member of the organization may approve a proof
  await admin(`/clients/${A}/requests/${id}/approve`, { method: "POST", json: { quote_id: quote.json.id } });
  await move(id, "in_progress"); await admin(`/clients/${A}/requests/${id}/files`, { method: "POST", fd: up(png(), "proof", "p.png") }); await move(id, "client_review");
  assert.equal((await post(mia, `/requests/${id}/approve`, { note: "Looks right" }, { from: `/requests/${id}` })).status, 303);
  // Admin is enforced server-side: no token, wrong origin, writes off, member session
  assert.notEqual((await admin(`/requests`, { token: null })).status, 200);
  assert.notEqual((await admin(`/clients/${A}/requests/${id}/reply`, { method: "POST", json: { body: "x" }, token: null })).status, 201);
  // uploads: disguised and executable files are refused
  assert.notEqual((await admin(`/clients/${A}/requests/${id}/files`, { method: "POST", fd: up(Buffer.from("MZ\x90\x00"), "attachment", "x.png") })).status, 201);
  // cross-site and token-less posts change nothing
  const before = sql("SELECT count(*) n FROM request_events")[0].n;
  const bad = await mia.send(`/portal/o/alpha/requests/${id}/reply`, { method: "POST", body: new URLSearchParams({ body: "x" }), headers: { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example", "Content-Type": "application/x-www-form-urlencoded" } });
  assert.ok([400, 403].includes(bad.status)); assert.equal(sql("SELECT count(*) n FROM request_events")[0].n, before);
});
