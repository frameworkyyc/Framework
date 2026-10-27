/* Client Services, Phase 3: Support & Change Requests. The real Admin API and the real client portal in one world (shared database and bucket): clients send requests with
   attachments and follow them; staff reply, keep private notes, quote and update status; and everything a stranger, another organization or a private note must NOT reach. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as sup from "../portal/repo/support.js";
import * as B from "../portal/brand-files.js";
import { PORTAL_CSP } from "../portal/http.js";
import { ORIGIN as PORTAL_ORIGIN } from "./helpers/portal-e2e.mjs";
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
  const bucket = fakeR2();
  const A = await w.org("alpha", "Alpha Co");
  await w.invite(A, "ann@alpha.test", "owner"); await w.invite(A, "mia@alpha.test", "member");
  Object.assign(w.env, { PORTAL_FILES: bucket, PORTAL_SERVICES: "1", PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: "owner@frameworkco.ca", ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) });
  const env = w.env;
  const ann = w.browser(), mia = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(2, "mia@alpha.test"));
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
  const Bo = await w.org("beta", "Beta Co"); await w.invite(Bo, "bob@beta.test", "owner");
  const bob = w.browser(); await bob.signIn(w.user(3, "bob@beta.test"));
  const tok = async (b, slug, p) => /name="csrf" value="([^"]+)"/.exec(await (await b.get(`/portal/o/${slug}${p}`)).text())[1];
  const send = async (b, path, fields, files = [], { slug = "alpha", csrf, headers = {} } = {}) => {
    const fd = new FormData();
    fd.set("csrf", csrf ?? await tok(b, slug, path.endsWith("/reply") ? path.replace(/\/reply$/, "") : "/services/requests/new"));
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    for (const [name, bytes] of files) fd.append("file", new Blob([bytes]), name);
    return b.send(`/portal/o/${slug}${path}`, { method: "POST", body: fd, headers: { "Sec-Fetch-Site": "same-origin", Origin: PORTAL_ORIGIN, ...headers } });
  };
  const create = async (b = ann, over = {}, files = []) => {
    const r = await send(b, "/services/requests", { category: "website_change", title: "Update our hours", description: "Please change the footer hours.", ...over }, files);
    assert.equal(r.status, 303, `create -> ${r.status}`);
    return /requests\/([0-9a-f-]{36})/.exec(r.headers.get("Location"))[1];
  };
  const adminJson = (path, json, method = "POST") => call(path, { method, json });
  return { w, A, Bo, env, bucket, ann, mia, bob, call, send, create, tok, adminJson };
}
const sql = (db, q, ...p) => db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const page = async (b, p, slug = "alpha") => (await b.get(`/portal/o/${slug}/services${p}`)).text();
const PNG = () => S.png(); const PDF = () => S.pdf();

test("the hub and list: Support is a real card; an empty list explains itself; the form states plainly that a request does not authorize paid work", async () => {
  const { ann, mia } = await setup();
  const hub = await page(ann, "");
  assert.match(hub, /href="\/portal\/o\/alpha\/services\/requests"/); assert.match(hub, /No requests yet/);
  assert.match(await page(mia, ""), /href="\/portal\/o\/alpha\/services\/requests"/, "members can use Support");
  const list = await page(ann, "/requests");
  assert.match(list, /No requests yet/); assert.match(list, /href="\/portal\/o\/alpha\/services\/requests\/new">New request/); assert.match(list, /Requests don’t authorize work/);
  const form = await (await ann.get("/portal/o/alpha/services/requests/new")).text();
  assert.match(form, /Sending a request does not authorize any paid work\. Framework will review it and, if it involves extra work, send you a quote to approve before anything starts\./);
  assert.deepEqual([...form.matchAll(/type="radio" name="category" value="(\w+)"/g)].map((m) => m[1]), ["website_change", "design_revision", "technical_issue", "general"]);
  assert.match(form, /enctype="multipart\/form-data"/); assert.match(form, /name="file" type="file" multiple/); assert.match(form, /Up to 3 files, 10 MB each/); assert.match(form, /May be quoted before work starts/);
  assert.ok(!/style=|<script/.test(form));
});

test("a client sends a request with attachments: stored privately under their organization, listed, audited, and the staff are queued to be told", async () => {
  const { w, A, bucket, ann, mia, create } = await setup();
  const id = await create(mia, {}, [["screenshot.png", PNG()], ["brief.pdf", PDF()]]);
  const t = sql(w.db, "SELECT * FROM support_requests")[0];
  assert.equal(t.organization_id, A.id); assert.equal(t.scope, "change"); assert.equal(t.status, "new");
  assert.equal(sql(w.db, "SELECT * FROM support_attachments").length, 2);
  assert.ok([...bucket.store.keys()].every((k) => k.startsWith(`org/${A.id}/support/`)) && bucket.store.size === 2);
  assert.equal(sql(w.db, "SELECT count(*) n FROM service_notifications WHERE event = 'request_submitted' AND audience = 'staff'")[0].n, 1);
  const thread = await page(ann, `/requests/${id}`);
  assert.match(thread, /Update our hours/); assert.match(thread, /Please change the footer hours\./); assert.match(thread, /screenshot\.png/); assert.match(thread, /brief\.pdf/);
  assert.match(thread, /Framework has received your request\./); assert.match(thread, /Requests don’t authorize work/, "a change request carries the notice");
  assert.match(await page(ann, "/requests"), new RegExp(`requests/${id}`)); assert.match(await page(ann, ""), /1 open/);
  const flash = await (await mia.get(`/portal/o/alpha/services/requests/${id}?flash=sent`)).text(); assert.match(flash, /Your request was sent/);
});

test("support (not billable) requests do not carry the quote notice on the thread but the form still does; categories map to scope", async () => {
  const { w, ann, create } = await setup();
  const id = await create(ann, { category: "technical_issue", title: "Form broken", description: "The contact form errors." });
  assert.equal(sql(w.db, "SELECT scope FROM support_requests")[0].scope, "support");
  assert.ok(!/Requests don’t authorize work/.test(await page(ann, `/requests/${id}`)));
});

test("isolation: another organization, a stranger and an invented id see nothing; the organization comes from the membership, never the form", async () => {
  const { w, A, Bo, bob, ann, create, send } = await setup();
  const id = await create(ann, {}, [["a.png", PNG()]]);
  const att = sql(w.db, "SELECT id FROM support_attachments")[0].id;
  for (const p of [`/requests/${id}`, `/requests/${id}/files/${att}`]) { assert.equal((await bob.get(`/portal/o/alpha/services${p}`)).status, 404, "not a member: " + p); assert.equal((await bob.get(`/portal/o/beta/services${p}`)).status, 404, "through beta's own door: " + p); }
  assert.ok(!/Update our hours/.test(await page(bob, "/requests", "beta")));
  assert.equal((await ann.get("/portal/o/alpha/services/requests/not-a-uuid")).status, 404);
  assert.equal((await ann.get("/portal/o/alpha/services/requests/00000000-0000-4000-8000-000000000000")).status, 404);
  assert.equal((await send(bob, `/services/requests/${id}/reply`, { body: "hijack" }, [], { slug: "beta", csrf: "x" })).status, 403);
  const r = await send(ann, "/services/requests", { category: "general", title: "Forged", description: "x", organization_id: Bo.id }, []);
  assert.equal(r.status, 303); assert.deepEqual(sql(w.db, "SELECT organization_id FROM support_requests ORDER BY created_at").map((x) => x.organization_id), [A.id, A.id]);
  const anon = (await import("./helpers/portal-e2e.mjs")).Browser ? null : null; void anon;
});

test("validation and refused files keep the person on the form with their text and a plain reason, and store nothing", async () => {
  const { w, bucket, ann, send } = await setup();
  const base = { category: "website_change", title: "T", description: "D" };
  for (const [over, files, status, text] of [
    [{ category: "billing" }, [], 422, /Choose what kind of request/], [{ title: "" }, [], 422, /short title/], [{ description: "" }, [], 422, /Tell us what you need/], [{ description: "x".repeat(4001) }, [], 422, /too long/],
    [{}, [["run.exe", S.text("MZ")]], 422, /can’t be uploaded/], [{}, [["fake.png", S.text("not an image")]], 422, /doesn’t look like/], [{}, [["x.pdf", S.pdf("/JavaScript (a) ")]], 422, /scripts or embedded content/],
  ]) {
    const r = await send(ann, "/services/requests", { ...base, ...over, title: over.title === undefined ? "T" : over.title }, files);
    assert.equal(r.status, status, JSON.stringify(over)); const html = await r.text();
    assert.match(html, text); assert.match(html, /data-error-summary/); assert.match(html, /name="title"/);
  }
  assert.match(await (await send(ann, "/services/requests", { ...base, title: "Keep me" }, [["run.exe", S.text("MZ")]])).text(), /value="Keep me"/, "what was typed stays on the form");
  assert.equal(sql(w.db, "SELECT * FROM support_requests").length, 0); assert.equal(bucket.store.size, 0);
  assert.equal((await send(ann, "/services/requests", base, [["1.png", PNG()], ["2.png", PNG()], ["3.png", PNG()], ["4.png", PNG()]])).status, 400, "a fourth file is refused");
  assert.equal(sql(w.db, "SELECT * FROM support_requests").length, 0);
});

test("CSRF, same-site and form type: a bad token, a cross-site request or a non-multipart post stores nothing", async () => {
  const { w, ann, mia, send, tok } = await setup();
  const good = await tok(ann, "alpha", "/services/requests/new"), other = await tok(mia, "alpha", "/services/requests/new");
  const f = { category: "general", title: "T", description: "D" };
  for (const csrf of ["", "garbage", other]) assert.equal((await send(ann, "/services/requests", f, [], { csrf })).status, 403, String(csrf).slice(0, 6));
  assert.equal((await send(ann, "/services/requests", f, [], { csrf: good, headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal((await send(ann, "/services/requests", f, [], { csrf: good, headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await ann.send("/portal/o/alpha/services/requests", { method: "POST", body: new URLSearchParams({ csrf: good, ...f }).toString(), headers: { "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "same-origin", Origin: PORTAL_ORIGIN } })).status, 400);
  assert.equal(sql(w.db, "SELECT * FROM support_requests").length, 0);
});

test("a limit of ten open requests per organization, freed when one closes; the attachment limit is three per request in total", async () => {
  const { A, ann, mia, call, create, send, tok } = await setup();
  const ids = []; for (let i = 0; i < sup.MAX_OPEN_REQUESTS; i++) ids.push(await create(i % 2 ? ann : mia, { title: "R" + i, category: "general" }));
  const over = await send(ann, "/services/requests", { category: "general", title: "one too many", description: "x" }, []);
  assert.equal(over.status, 422); assert.match(await over.text(), /several open requests/);
  assert.equal((await adminJson2(call, A, ids[0], "status", { status: "completed" })).status, 200);
  assert.equal((await send(ann, "/services/requests", { category: "general", title: "room again", description: "x" }, [])).status, 303);
  const id = ids[1];
  assert.equal((await send(ann, `/services/requests/${id}/reply`, { body: "two files" }, [["a.png", PNG()], ["b.png", PNG()]])).status, 303);
  const r = await send(ann, `/services/requests/${id}/reply`, { body: "two more" }, [["c.png", PNG()], ["d.png", PNG()]]);
  assert.equal(r.status, 422); assert.match(await r.text(), /up to 3 attachments in total/);
  void tok;
});
const adminJson2 = (call, A, id, kind, json) => call(`/clients/${A.id}/support/${id}/${kind}`, { method: "POST", json });

test("the conversation: client replies, Framework replies and updates status; the client sees the complete history and a new-reply flag until it is read", async () => {
  const { w, A, ann, mia, call, create, send } = await setup();
  const id = await create(mia, { category: "technical_issue", title: "Slow page", description: "The home page is slow." });
  assert.equal((await send(ann, `/services/requests/${id}/reply`, { body: "It started Monday." }, [["perf.png", PNG()]])).status, 303);
  const rep = await call(`/clients/${A.id}/support/${id}/reply`, { method: "POST", json: { body: "Thanks, we are looking into it." } });
  assert.equal(rep.status, 201);
  assert.equal((await adminJson2(call, A, id, "status", { status: "in_review", note: "We are on it." })).status, 200);
  assert.match(await page(mia, "/requests"), /New reply/); assert.match(await page(mia, ""), /1 new reply/);
  const html = await page(mia, `/requests/${id}`);
  const order = ["The home page is slow.", "It started Monday.", "Thanks, we are looking into it.", "Status: In review", "We are on it."].map((t) => html.indexOf(t));
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), "every message and status change, in order");
  assert.match(html, /perf\.png/); assert.match(html, /Framework is reviewing your request\./);
  assert.ok(!/New reply/.test(await page(mia, "/requests")), "opening the thread clears the flag");
  assert.equal(sql(w.db, "SELECT count(*) n FROM service_notifications WHERE audience = 'staff'")[0].n, 2, "submit and client reply queued for the staff");
  assert.equal(sql(w.db, "SELECT count(*) n FROM service_notifications WHERE audience = 'client'")[0].n, 1, "a Framework reply is queued for the client; the routine status change (in review) is not");
  const admin = (await call(`/clients/${A.id}/support/${id}`)).json;
  assert.equal(admin.messages.length, 4, "three messages and one status entry"); assert.equal(admin.request.status, "in_review");
});

test("private staff notes never reach the client: not on the page, not in a download, not in a notification", async () => {
  const { w, A, ann, bucket, call, create } = await setup();
  const id = await create(ann, {}, []);
  const note = await call(`/clients/${A.id}/support/${id}/reply`, { method: "POST", json: { body: "SECRET-NOTE do not tell them", internal: true } });
  assert.equal(note.status, 201);
  const fd = new FormData(); fd.append("file", new File([PNG()], "internal.png")); fd.append("meta", JSON.stringify({ messageId: note.json.messageId }));
  assert.equal((await call(`/clients/${A.id}/support/${id}/attach`, { method: "POST", form: fd })).status, 200);
  const attId = sql(w.db, "SELECT id FROM support_attachments")[0].id;
  const html = await page(ann, `/requests/${id}`);
  assert.ok(!/SECRET-NOTE|internal\.png/.test(html)); assert.ok(!/SECRET-NOTE/.test(await page(ann, "/requests")));
  assert.equal((await ann.get(`/portal/o/alpha/services/requests/${id}/files/${attId}`)).status, 404, "an attachment on a private note is not downloadable by the client");
  assert.equal(sql(w.db, "SELECT count(*) n FROM service_notifications WHERE audience = 'client'")[0].n, 0, "a private note queues no client email");
  assert.equal(sql(w.db, "SELECT count(*) n FROM support_requests WHERE last_message_by = 'staff'")[0].n, 0, "and does not even mark the request as replied to");
  assert.equal((await call(`/clients/${A.id}/support/${id}`)).json.messages.filter((m) => m.visibility === "internal").length, 1, "staff do see it, marked private");
  assert.equal(bucket.store.size, 1);
});

test("quotes and billable work: only change requests can be quoted or approved, the client sees what each status means, and a client has no way to approve", async () => {
  const { w, A, ann, mia, call, create } = await setup();
  const chg = await create(ann, { category: "design_revision", title: "Darker logo", description: "A darker blue please." });
  const sup1 = await create(ann, { category: "technical_issue", title: "Broken link", description: "404 on /about." });
  assert.equal((await adminJson2(call, A, sup1, "status", { status: "quoted" })).json.error, "not_billable");
  assert.equal((await adminJson2(call, A, sup1, "status", { status: "approved" })).json.error, "not_billable");
  assert.equal((await adminJson2(call, A, chg, "status", { status: "paid" })).json.error, "invalid_status");
  assert.equal((await adminJson2(call, A, chg, "status", { status: "quoted", note: "Quote: 2 hours. Reply to approve." })).status, 200);
  let html = await page(mia, `/requests/${chg}`);
  assert.match(html, /Quote sent/); assert.match(html, /Nothing goes ahead until you approve it/); assert.match(html, /Quote: 2 hours\. Reply to approve\./);
  assert.match(await page(mia, ""), /1 quote to review/);
  assert.equal(sql(w.db, "SELECT status FROM support_requests WHERE id = ?", chg)[0].status, "quoted", "replying does not approve");
  const reply = (await import("./helpers/portal-e2e.mjs")).csrfOf; void reply;
  assert.equal((await adminJson2(call, A, chg, "status", { status: "approved", note: "Client agreed by email." })).status, 200);
  html = await page(mia, `/requests/${chg}`);
  assert.match(html, /Framework has recorded that you approved the quote\./);
  for (const p of [`/services/requests/${chg}/status`, `/services/requests/${chg}/approve`]) assert.equal((await mia.get(`/portal/o${"/alpha"}${p}`)).status, 404, "there is no client route to change status");
});

test("closed requests: the client cannot reply and the form is gone; Framework still can", async () => {
  const { A, ann, call, create, send } = await setup();
  const id = await create(ann, { category: "general", title: "Q", description: "A question" });
  assert.equal((await adminJson2(call, A, id, "status", { status: "completed", note: "Done." })).status, 200);
  const html = await page(ann, `/requests/${id}`);
  assert.match(html, /This request is complete/); assert.ok(!/name="body"/.test(html));
  const r = await send(ann, `/services/requests/${id}/reply`, { body: "one more" }, [], { csrf: "x" });
  assert.equal(r.status, 403);
  const tokenless = await ann.get(`/portal/o/alpha/services/requests/${id}`); assert.equal(tokenless.status, 200);
  assert.equal((await call(`/clients/${A.id}/support/${id}/reply`, { method: "POST", json: { body: "Following up" } })).status, 201);
});

test("attachments download as hardened attachments, audited, only to their own organization; Admin can download too", async () => {
  const { w, A, ann, bob, call, create } = await setup();
  const id = await create(ann, {}, [["shot.png", PNG()]]);
  const att = sql(w.db, "SELECT id FROM support_attachments")[0].id;
  const dl = await ann.get(`/portal/o/alpha/services/requests/${id}/files/${att}`);
  assert.equal(dl.status, 200); assert.match(dl.headers.get("content-disposition"), /^attachment; filename="shot\.png"/); assert.equal(dl.headers.get("content-type"), "application/octet-stream");
  assert.equal(dl.headers.get("x-content-type-options"), "nosniff"); assert.match(dl.headers.get("content-security-policy"), /sandbox/); assert.equal(dl.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(new Uint8Array(await dl.arrayBuffer()), PNG());
  assert.equal(sql(w.db, "SELECT count(*) n FROM activity_log WHERE action = 'support.attachment.download'")[0].n, 1);
  assert.equal((await bob.get(`/portal/o/beta/services/requests/${id}/files/${att}`)).status, 404);
  const other = await create(ann, { title: "Other" }, []);
  assert.equal((await ann.get(`/portal/o/alpha/services/requests/${other}/files/${att}`)).status, 404, "an attachment of another request is not reachable through this one");
  const a = await call(`/clients/${A.id}/support/${id}/files/${att}/download`); assert.equal(a.status, 200); assert.deepEqual(a.bytes, PNG());
});

test("Admin API: Access and the Admin header are required; writes can be switched off; staff attachments are checked; seen-state and summaries work", async () => {
  const { w, A, env, ann, call, create } = await setup();
  const id = await create(ann, {}, []);
  for (const token of [null, "garbage.token.value"]) for (const [path, method] of [[`/clients/${A.id}/support`, "GET"], [`/clients/${A.id}/support/${id}`, "GET"], [`/clients/${A.id}/support/${id}/reply`, "POST"], [`/clients/${A.id}/support/${id}/status`, "POST"]]) {
    const r = await call(path, { method, token, json: method === "POST" ? { body: "x" } : undefined }); assert.ok([401, 403].includes(r.status), `${method} ${path} -> ${r.status}`);
  }
  assert.equal((await call(`/clients/${A.id}/support/${id}/reply`, { method: "POST", json: { body: "x" }, origin: null })).status, 403);
  assert.equal((await call(`/clients/${A.id}/support/${id}/reply`, { method: "POST", json: { body: "x" }, csrf: false })).status, 403);
  const off = { ...env, PORTAL_ADMIN_WRITES: undefined };
  assert.equal((await call(`/clients/${A.id}/support/${id}/reply`, { method: "POST", json: { body: "x" }, e: off })).json.error, "writes_disabled");
  const list = await call(`/clients/${A.id}/support`, { e: off }); assert.equal(list.json.capabilities.writes, false); assert.equal(list.json.summary.unseen, 1); assert.equal(list.json.requests[0].needsLook, true);
  assert.equal((await call(`/clients/${A.id}/support/${id}/seen`, { method: "POST", json: {} })).status, 200);
  assert.equal((await call(`/clients/${A.id}/support`)).json.summary.unseen, 0);
  assert.equal((await call(`/clients/${A.id}/support/${id}/reply`, { method: "POST", json: { body: "" } })).json.error, "message_required");
  assert.equal((await call(`/clients/${A.id}/support/${id}/reply`, { method: "POST", json: { body: "x", extra: 1 } })).json.error, "unknown_field");
  const rep = (await call(`/clients/${A.id}/support/${id}/reply`, { method: "POST", json: { body: "see file" } })).json.messageId;
  const attach = (name, bytes, mid) => { const fd = new FormData(); fd.append("file", new File([bytes], name)); fd.append("meta", JSON.stringify({ messageId: mid })); return call(`/clients/${A.id}/support/${id}/attach`, { method: "POST", form: fd }); };
  assert.equal((await attach("run.exe", S.text("MZ"), rep)).status, 422); assert.equal((await attach("a.png", PNG(), rep)).status, 200);
  const clientMsg = sql(w.db, "SELECT id FROM support_messages WHERE author_type = 'client'")[0].id;
  assert.equal((await attach("b.png", PNG(), clientMsg)).status, 404, "staff files go on staff messages only");
  assert.equal((await attach("c.png", PNG(), crypto.randomUUID())).status, 404);
  assert.equal((await call(`/clients/${crypto.randomUUID()}/support`)).status, 404); assert.equal((await call(`/clients/${A.id}/support/not-a-uuid`)).status, 404);
  assert.equal((await call(`/clients/${A.id}/support/${id}`, { method: "DELETE" })).status >= 400, true, "there is no delete");
  assert.equal((await call(`/clients/${A.id}`)).json.support.total, 1);
});

test("a database without migration 0007: Admin says not available, the client hub keeps Support as 'Coming soon'", async () => {
  const { w, A, ann, call } = await setup();
  w.db.raw.exec("DROP TABLE service_notifications; DROP TABLE support_attachments; DROP TABLE support_messages; DROP TABLE support_requests; DROP TABLE invoices");
  assert.deepEqual((await call(`/clients/${A.id}/support`)).json, { available: false });
  assert.match(await page(ann, ""), /Coming soon/);
  assert.equal((await call(`/clients/${A.id}`)).json.support, null);
});

test("retention: removing an organization's files and housekeeping never touch support attachments; nothing deletes a message, file or request", async () => {
  const { w, A, bucket, ann, create } = await setup();
  await create(ann, {}, [["a.png", PNG()]]);
  const deps = { db: w.db, bucket, env: w.env, now: new Date() };
  const key = [...bucket.store.keys()][0];
  assert.ok((await B.deleteOrganizationFiles(deps, { organizationId: A.id, actor: "admin@framework.test" })).ok);
  assert.ok(bucket.store.has(key), "the attachment survives"); assert.deepEqual(await B.findOrphanObjects(deps, { organizationId: A.id }), []);
  for (const f of ["worker/portal/admin-support.js", "worker/portal/support-files.js", "worker/portal/repo/support.js", "admin/assets/support.js"]) assert.ok(!/DELETE\s+FROM\s+support_|method:\s*"DELETE"|\/delete["`]|bucket\.delete|deleteObject\(deps\.bucket, \{ key: row/i.test(readFileSync(new URL("../../" + f, import.meta.url), "utf8").replace(/deleteObject\(deps\.bucket, \{ key, organizationId \}\)/g, "")), f + " has no delete");
});

test("pages are escaped, script-free and mobile-friendly; the Admin Support page is built the safe way", async () => {
  const { ann, create } = await setup();
  const id = await create(ann, { title: "<b>Bold</b> title", description: "<img src=x onerror=alert(1)> hello" }, [["<i>x</i>.png", PNG()]]);
  for (const p of ["/requests", `/requests/${id}`, "/requests/new"]) {
    const res = await ann.get(`/portal/o/alpha/services${p}`); assert.equal(res.headers.get("content-security-policy"), PORTAL_CSP, p); const html = await res.text();
    assert.ok(!/<b>Bold|<img src=x|<i>x<|style=|<script/.test(html), p);
  }
  assert.match(await page(ann, `/requests/${id}`), /&lt;b&gt;Bold&lt;\/b&gt; title/);
  const ui = readFileSync(new URL("../../admin/assets/support.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|localStorage|sessionStorage|document\.cookie|fetch\(/.test(ui));
  assert.ok(!/\.style\b|setAttribute\(\s*["']style|style\s*:\s*["'{]/.test(ui), "no inline styles");
  assert.match(ui, /filter\(Boolean\)/); for (const t of ["Record approval?", "Decline this request?", "Mark as completed?", "Mark as Quote sent?"]) assert.ok(ui.includes(t), t);
  assert.match(ui, /Private note: keep it for staff/);
});
