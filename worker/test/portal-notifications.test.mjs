/* Client Services, Phase 4: notifications and indicators. Which events queue an email (and which do not), sending without duplicates or side effects on saved work,
   failure and retry, recipients and content, the Home and Admin indicators, and the global Admin Support Requests list. */
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
import * as inv from "../portal/repo/invoices.js";
import { processNotifications, dispatchNotifications, buildEmail, MAX_ATTEMPTS } from "../portal/service-notifications.js";
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
  w.mail = { sent: [], mode: "ok" };
  w.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.resend.com")) {
      if (w.mail.mode === "throw") throw new TypeError("network down");
      if (w.mail.mode === "500") return new Response(JSON.stringify({ message: "provider is down" }), { status: 500 });
      const body = JSON.parse(init.body); w.mail.sent.push({ to: body.to[0], subject: body.subject, text: body.text, html: body.html, key: init.headers["Idempotency-Key"] });
      return new Response("{}", { status: 200 });
    }
    throw new Error("no network in these tests: " + url);
  };
  Object.assign(w.env, { RESEND_API_KEY: "re_test_key", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>", ASSESSMENT_NOTIFY_TO: "staff@framework.test", PORTAL_INVITE_ALLOWLIST: "ann@alpha.test mia@alpha.test" });
  const origWorkosFetch = w.workos.fetch;
  w.workos.fetch = async (url, init) => (String(url).startsWith("https://api.resend.com") ? w.fetch(url, init) : origWorkosFetch(url, init));
  const env = w.env;
  const ann = w.browser(), mia = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(2, "mia@alpha.test"));
  const call = async (path, { method = "GET", token = sign(claims()), headers = {}, e = env, json, form, origin = ORIGIN, csrf = true } = {}) => {
    const h = { ...(origin ? { Origin: origin } : {}), ...(csrf && method !== "GET" ? { "X-Framework-Admin": "1" } : {}), ...headers };
    if (token) h["Cf-Access-Jwt-Assertion"] = token;
    let body;
    if (form) { const packed = new Response(form); const buf = new Uint8Array(await packed.arrayBuffer()); h["Content-Type"] = packed.headers.get("Content-Type"); h["Content-Length"] = String(buf.length); body = buf; }
    else if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    const res = await handleAdmin(new Request(ORIGIN + "/api/admin" + path, { method, headers: h, body }), e, { fetch: (...a) => w.fetch(...a) });
    const type = res.headers.get("Content-Type") || "";
    return { status: res.status, headers: res.headers, json: type.includes("json") ? await res.json() : null, bytes: type.includes("json") ? null : new Uint8Array(await res.arrayBuffer()) };
  };
  const Bo = await w.org("beta", "Beta Co"); await w.invite(Bo, "bob@beta.test", "owner");
  const bob = w.browser(); await bob.signIn(w.user(3, "bob@beta.test"));
  const tok = async (b, slug, p) => /name="csrf" value="([^"]+)"/.exec(await (await b.get(`/portal/o/${slug}${p}`)).text())[1];
  const send = async (b, path, fields, files = [], { slug = "alpha" } = {}) => {
    const fd = new FormData(); fd.set("csrf", await tok(b, slug, path.endsWith("/reply") ? path.replace(/\/reply$/, "") : "/services/requests/new"));
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    for (const [name, bytes] of files) fd.append("file", new Blob([bytes]), name);
    return b.send(`/portal/o/${slug}${path}`, { method: "POST", body: fd, headers: { "Sec-Fetch-Site": "same-origin", Origin: PORTAL_ORIGIN } });
  };
  const create = async (b = ann, over = {}) => { const r = await send(b, "/services/requests", { category: "website_change", title: "Update our hours", description: "Please change the footer hours.", ...over }); assert.equal(r.status, 303); return /requests\/([0-9a-f-]{36})/.exec(r.headers.get("Location"))[1]; };
  const adminJson = (path, json, o = {}) => call(path, { method: "POST", json, ...o });
  const pending = () => sql(w.db, "SELECT audience, event, entity_type, status, attempts, last_error FROM service_notifications ORDER BY created_at, id");
  const mkInvoice = async (over = {}) => { const c = await inv.createInvoice(w.db, A.id, { invoiceNumber: "FW-1", issueDate: "2026-10-01", dueDate: "2026-10-15", amount: "1500", ...over }, "admin@framework.test"); await inv.setInvoiceFile(w.db, A.id, c.id, { ext: "pdf", contentType: "application/pdf", size: 5, sha256: "a".repeat(64), storageKey: `org/${A.id}/invoices/${crypto.randomUUID()}` }, "admin@framework.test"); return c.id; };
  const quiet = async (fn) => { const k = w.env.RESEND_API_KEY; delete w.env.RESEND_API_KEY; try { return await fn(); } finally { w.env.RESEND_API_KEY = k; } }; // queue changes without sending, to look at the queue itself
  const run = (extra = {}) => processNotifications(w.env, { db: w.db, fetch: w.fetch, ...extra });
  return { w, A, Bo, env, bucket, ann, mia, bob, call, send, create, adminJson, pending, mkInvoice, run, quiet };
}
const sql = (db, q, ...p) => db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const page = async (b, p, slug = "alpha") => (await b.get(`/portal/o/${slug}${p}`)).text();

test("which events queue an email: new request, client reply, Framework reply, quote sent, published invoice; never a private note or a routine status change", async () => {
  const { A, ann, mia, call, create, adminJson, pending, mkInvoice, send } = await setup();
  const id = await create(mia);
  assert.deepEqual(pending().map((n) => [n.audience, n.event]), [["staff", "request_submitted"]]);
  await adminJson(`/clients/${A.id}/support/${id}/reply`, { body: "private", internal: true });
  for (const status of ["in_review", "in_progress", "completed", "declined", "approved"]) await adminJson(`/clients/${A.id}/support/${id}/status`, { status });
  assert.equal(pending().filter((n) => n.audience === "client").length, 0, "no email for private notes, routine statuses or approval");
  await adminJson(`/clients/${A.id}/support/${id}/status`, { status: "quoted", note: "Quote: 1 hour." });
  assert.deepEqual(pending().filter((n) => n.audience === "client").map((n) => n.event), ["request_status"], "a quote is emailed");
  const id2 = await create(ann, { title: "Second" });
  await adminJson(`/clients/${A.id}/support/${id2}/reply`, { body: "Hello" });
  assert.deepEqual(pending().filter((n) => n.audience === "client").map((n) => n.event), ["request_status", "request_staff_reply"]);
  assert.equal((await send(ann, `/services/requests/${id2}/reply`, { body: "Thanks" })).status, 303);
  assert.equal(pending().filter((n) => n.event === "request_client_reply").length, 1);
  const inv1 = await mkInvoice(); await adminJson(`/clients/${A.id}/invoices/${inv1}/publish`, {});
  assert.equal(pending().filter((n) => n.event === "invoice_published").length, 1);
  void call;
});

test("a burst is one email: quick replies queue and send once per side, and publishing twice queues one", async () => {
  const { w, A, ann, mia, create, adminJson, pending, mkInvoice, send, quiet } = await setup();
  await quiet(async () => {
    const id = await create(mia);
    for (let i = 0; i < 3; i++) assert.equal((await send(ann, `/services/requests/${id}/reply`, { body: "more " + i })).status, 303);
    assert.equal(pending().filter((n) => n.event === "request_client_reply").length, 1, "three replies before the first email goes out are one queued notice");
  });
  const idB = await create(mia, { title: "Second request" }); w.mail.sent.length = 0;
  for (let i = 0; i < 3; i++) assert.equal((await send(ann, `/services/requests/${idB}/reply`, { body: "quick " + i })).status, 303);
  assert.equal(w.mail.sent.filter((m) => m.to === "staff@framework.test").length, 1, "three quick replies sent after each other email the staff once (the rest are throttled)");
  assert.deepEqual([...new Set(sql(w.db, "SELECT last_error FROM service_notifications WHERE status = 'skipped'").map((r) => r.last_error))], ["throttled"]);
  w.mail.sent.length = 0;
  for (let i = 0; i < 3; i++) await adminJson(`/clients/${A.id}/support/${idB}/reply`, { body: "reply " + i });
  assert.equal(w.mail.sent.filter((m) => /replied to your request/.test(m.subject) && m.to === "ann@alpha.test").length, 1, "and the client is emailed once for a burst of staff replies");
  const iv = await mkInvoice(); w.mail.sent.length = 0; await adminJson(`/clients/${A.id}/invoices/${iv}/publish`, {}); await adminJson(`/clients/${A.id}/invoices/${iv}/publish`, {});
  assert.equal(pending().filter((n) => n.event === "invoice_published").length, 1); assert.equal(w.mail.sent.filter((m) => /new invoice/.test(m.subject)).length, 1, "one invoice email");
});

test("sending: staff get the detail, clients get a generic notice with a link; recipients are the right people on the approved list; the provider gets an idempotency key", async () => {
  const { w, A, mia, create, adminJson, mkInvoice, run, quiet } = await setup();
  const id = await quiet(async () => {
    const id = await create(mia, { title: "Update our hours" });
    await adminJson(`/clients/${A.id}/support/${id}/reply`, { body: "Secret reply text" });
    const iv = await mkInvoice({ invoiceNumber: "FW-SECRET-77", amount: "98765.43" }); await adminJson(`/clients/${A.id}/invoices/${iv}/publish`, {});
    return id;
  });
  w.mail.sent.length = 0; const out = await run();
  assert.equal(out.sent, 3);
  const staff = w.mail.sent.find((m) => m.to === "staff@framework.test");
  assert.match(staff.subject, /New support request from Alpha Co/); assert.match(staff.text, /Website change: Update our hours/); assert.match(staff.text, new RegExp(`/admin/support/${A.id}/${id}`));
  const toClient = w.mail.sent.filter((m) => m.to !== "staff@framework.test");
  assert.deepEqual([...new Set(toClient.map((m) => m.to))].sort(), ["ann@alpha.test", "mia@alpha.test"], "the owner and the person who sent the request (mia), not everyone");
  const reply = toClient.find((m) => /replied to your request/.test(m.subject)); assert.match(reply.text, new RegExp(`/portal/o/alpha/services/requests/${id}`));
  const invoiceMail = toClient.filter((m) => /new invoice/.test(m.subject)); assert.deepEqual(invoiceMail.map((m) => m.to), ["ann@alpha.test"], "invoices go to owners only");
  assert.match(invoiceMail[0].text, /\/portal\/o\/alpha\/services\/invoices/);
  for (const m of toClient) assert.ok(!/Secret reply text|Update our hours|FW-SECRET-77|98765|\$/.test(m.text + m.html), "client emails carry no request text, invoice number or amount");
  assert.ok(w.mail.sent.every((m) => /^svc-[0-9a-f-]{36}-\d$/.test(m.key)), "every send carries an idempotency key");
  assert.deepEqual(sql(w.db, "SELECT DISTINCT status FROM service_notifications").map((r) => r.status), ["sent"]);
});

test("no duplicates: running the sender again, or twice at once, sends each notice once", async () => {
  const { w, mia, create, run, quiet } = await setup();
  await quiet(() => create(mia));
  w.mail.sent.length = 0;
  const [a, b] = await Promise.all([run(), run()]);
  assert.equal(a.sent + b.sent, 1); assert.equal(w.mail.sent.length, 1, "two concurrent senders, one email");
  assert.equal((await run()).sent, 0); assert.equal(w.mail.sent.length, 1);
});

test("a provider failure never affects saved work: the request, reply and published invoice stay saved; the notice retries, then stops after the limit", async () => {
  const { w, A, mia, ann, create, adminJson, mkInvoice, run, send } = await setup();
  for (const mode of ["throw", "500"]) {
    w.mail.mode = mode;
    const id = await create(mia, { title: "During outage " + mode });
    assert.ok(sql(w.db, "SELECT id FROM support_requests WHERE id = ?", id).length === 1, "the request is saved");
    assert.equal((await send(ann, `/services/requests/${id}/reply`, { body: "x" })).status, 303);
    const iv = await mkInvoice({ invoiceNumber: "OUT-" + mode }); assert.equal((await adminJson(`/clients/${A.id}/invoices/${iv}/publish`, {})).status, 200, "publishing succeeds while email is down");
    assert.equal((await adminJson(`/clients/${A.id}/support/${id}/reply`, { body: "ok" })).status, 201);
  }
  const stuck = sql(w.db, "SELECT status, attempts, last_error FROM service_notifications WHERE status = 'pending' AND attempts > 0");
  assert.ok(stuck.length > 0 && stuck.every((n) => n.last_error && n.attempts >= 1 && n.attempts < MAX_ATTEMPTS), "failed sends stay pending with a reason");
  assert.ok(!JSON.stringify(stuck).match(/re_test_key|Bearer/), "no secret in the stored reason");
  for (let i = 0; i < MAX_ATTEMPTS + 1; i++) await run();
  assert.ok(sql(w.db, "SELECT count(*) n FROM service_notifications WHERE status = 'failed'")[0].n > 0, "after the limit a notice is marked failed and not retried forever");
  assert.equal(sql(w.db, "SELECT count(*) n FROM service_notifications WHERE status = 'pending' AND attempts >= ?", MAX_ATTEMPTS)[0].n, 0);
  w.mail.mode = "ok"; w.mail.sent.length = 0;
  const id = await create(mia, { title: "After recovery" });
  assert.ok(w.mail.sent.some((m) => /After recovery/.test(m.text)), "once the provider is back, new notices go out");
  void id;
});

test("a retry after a half-sent notice reuses the same idempotency key, so the provider can drop the repeat", async () => {
  const { w, A, ann, mia, create, adminJson, run } = await setup();
  const id = await create(mia); await run(); w.mail.sent.length = 0;
  await adminJson(`/clients/${A.id}/support/${id}/reply`, { body: "Hello" });
  const row = sql(w.db, "SELECT id FROM service_notifications WHERE event = 'request_staff_reply'")[0];
  w.mail.mode = "500"; await run(); w.mail.mode = "ok"; await run();
  const keys = w.mail.sent.map((m) => m.key); assert.ok(keys.length >= 2 && keys.every((k) => k.startsWith("svc-" + row.id)), "keys derive from the notice id and the recipient position");
  void ann;
});

test("email not configured: notices wait without using an attempt; a recipient not on the approved list is skipped", async () => {
  const { w, mia, create, run, pending } = await setup();
  delete w.env.RESEND_API_KEY;
  await create(mia);
  const r = await run(); assert.equal(r.configured, false); assert.equal(pending()[0].attempts, 0); assert.equal(pending()[0].status, "pending");
  w.env.RESEND_API_KEY = "re_test_key"; w.env.PORTAL_INVITE_ALLOWLIST = "someone-else@example.test";
  const { A, adminJson } = { A: (await import("./helpers/portal-e2e.mjs")).ORIGIN && null, adminJson: null }; void A; void adminJson;
  w.mail.sent.length = 0; await run();
  assert.deepEqual(w.mail.sent.map((m) => m.to), ["staff@framework.test"], "Framework itself is always notified");
});

test("client notices are skipped when nobody on the approved list would receive them", async () => {
  const { w, A, mia, create, adminJson, run } = await setup();
  const id = await create(mia);
  w.env.PORTAL_INVITE_ALLOWLIST = "someone-else@example.test";
  w.mail.sent.length = 0;
  await adminJson(`/clients/${A.id}/support/${id}/reply`, { body: "Hello" });
  await run();
  assert.equal(w.mail.sent.length, 0, "no client email when nobody on the approved list would receive it");
  assert.equal(sql(w.db, "SELECT status, last_error FROM service_notifications WHERE event = 'request_staff_reply'")[0].last_error, "no_allowed_recipient");
});

test("dispatch uses waitUntil when the platform offers it (the response is not held up) and awaits otherwise", async () => {
  const { w, mia, create } = await setup();
  await create(mia);
  let handed = null;
  const out = dispatchNotifications(w.env, { fetch: w.fetch, waitUntil: (p) => { handed = p; } });
  assert.ok(out && typeof out.then === "function"); await out; assert.ok(handed && typeof handed.then === "function", "the work was handed to waitUntil");
  await handed;
  await dispatchNotifications(w.env, { fetch: w.fetch }); // no waitUntil: awaited, never throws
  assert.doesNotThrow(() => dispatchNotifications({}, {}));
});

test("the email text is plain and escaped: names are escaped in HTML, links are on the portal origin, and there is a reason line", () => {
  const m = buildEmail({ audience: "staff", event: "request_submitted" }, { org: { id: "o1", name: "<b>Evil</b> & Co", slug: "evil" }, request: { id: "r1", title: "<script>x</script>", category: "general" } }, "https://staging.frameworkco.ca");
  assert.ok(!/<script>|<b>Evil/.test(m.html)); assert.match(m.html, /&lt;b&gt;Evil&lt;\/b&gt; &amp; Co/); assert.ok(m.link.startsWith("https://staging.frameworkco.ca/admin/support/"));
  const c = buildEmail({ audience: "client", event: "invoice_published" }, { org: { id: "o1", name: "Alpha", slug: "alpha" }, invoice: { id: "i1" } }, "https://staging.frameworkco.ca");
  assert.match(c.text, /You receive this because you are an owner of Alpha/); assert.match(c.text, /https:\/\/staging\.frameworkco\.ca\/portal\/o\/alpha\/services\/invoices/);
});

test("Client Home and hub indicators: a dot and plain words for new replies, quotes to review and overdue invoices; owners see invoices, members do not", async () => {
  const { A, ann, mia, create, adminJson, mkInvoice } = await setup();
  assert.ok(!/dot--attention[^>]*><\/span>\d+ new/.test(await page(ann, "")), "nothing to call out yet");
  const id = await create(ann, { category: "design_revision", title: "Darker logo" });
  await adminJson(`/clients/${A.id}/support/${id}/reply`, { body: "We can do this." });
  await adminJson(`/clients/${A.id}/support/${id}/status`, { status: "quoted", note: "Quote sent" });
  const iv = await mkInvoice(); await adminJson(`/clients/${A.id}/invoices/${iv}/publish`, {});
  const owner = await page(ann, "");
  const card = /<a class="hub" href="\/portal\/o\/alpha\/services">[\s\S]*?<\/a>/.exec(owner)[0];
  assert.match(card, /dot dot--attention" aria-hidden="true"><\/span>1 new reply · 1 quote to review · 1 overdue invoice/);
  const member = await page(mia, ""), mcard = /<a class="hub" href="\/portal\/o\/alpha\/services">[\s\S]*?<\/a>/.exec(member)[0];
  assert.ok(!/invoice/.test(mcard.replace("Invoices, support requests", "")), "a member's card never mentions invoices");
  const hub = await page(ann, "/services");
  assert.match(hub, /dot dot--attention" aria-hidden="true"><\/span>1 overdue/); assert.match(hub, /dot dot--attention" aria-hidden="true"><\/span>1 new reply · 1 quote to review/);
  await page(ann, `/services/requests/${id}`);
  assert.ok(!/new reply/.test(/<a class="hub" href="\/portal\/o\/alpha\/services">[\s\S]*?<\/a>/.exec(await page(ann, ""))[0]), "opening the request clears the new-reply call-out");
});

test("global Admin Support Requests: every client's requests in one list, what needs attention first, filters, and nothing for a closed request", async () => {
  const { w, A, Bo, ann, bob, call, create, adminJson, send } = await setup();
  const a1 = await create(ann, { title: "Alpha one" }), b1 = await send(bob, "/services/requests", { category: "technical_issue", title: "Beta one", description: "x" }, [], { slug: "beta" });
  const bId = /requests\/([0-9a-f-]{36})/.exec(b1.headers.get("Location"))[1];
  let g = (await call(`/support`)).json;
  assert.deepEqual(g.requests.map((r) => r.title).sort(), ["Alpha one", "Beta one"]); assert.deepEqual(g.requests.map((r) => r.organization.name).sort(), ["Alpha Co", "Beta Co"]); assert.ok(g.requests.every((r) => r.reason === "new"));
  assert.equal(g.totals.attention, 2); assert.equal(g.totals.open, 2);
  await sup.markAdminSeen(w.db, A.id, a1, { now: new Date(w.clock.now().getTime() + 60000) }); // a minute after the request was sent
  g = (await call(`/support`)).json; assert.deepEqual(g.requests.map((r) => r.title), ["Beta one"]); assert.equal(g.totals.attention, 1);
  w.clock.advance(120); // two minutes in, the client writes again: staff last looked a minute in
  await send(ann, `/services/requests/${a1}/reply`, { body: "Another thing" });
  g = (await call(`/support`)).json; assert.deepEqual(g.requests.map((r) => [r.title, r.reason]).sort(), [["Alpha one", "reply"], ["Beta one", "new"]]);
  await adminJson(`/clients/${Bo.id}/support/${bId}/status`, { status: "completed" });
  assert.deepEqual((await call(`/support?scope=attention`)).json.requests.map((r) => r.title), ["Alpha one"], "a closed request never needs attention");
  assert.deepEqual((await call(`/support?scope=closed`)).json.requests.map((r) => r.title), ["Beta one"]);
  assert.equal((await call(`/support?scope=open`)).json.requests.length, 1); assert.equal((await call(`/support?scope=all`)).json.requests.length, 2);
  assert.equal((await call(`/support?scope=bogus`)).json.scope, "attention", "an unknown scope falls back to attention");
  const att = (await call(`/services/attention`)).json; assert.deepEqual(att.support, { total: 2, open: 1, attention: 1 }); assert.equal(att.invoices.drafts, 0);
  assert.ok(!JSON.stringify(g).match(/storage|sha256|org\//i), "no storage details in the list");
  void w;
});

test("global Admin endpoints are Admin-only: no Access login, no Origin or Admin header, or writes switched off change nothing; sending now needs writes", async () => {
  const { w, env, call, create, ann, run } = await setup();
  await create(ann);
  for (const token of [null, "garbage.token.value"]) for (const [path, method] of [["/support", "GET"], ["/services/attention", "GET"], ["/services/notifications/process", "POST"]]) assert.ok([401, 403].includes((await call(path, { method, token, json: method === "POST" ? {} : undefined })).status), path);
  assert.equal((await call("/services/notifications/process", { method: "POST", json: {}, origin: null })).status, 403);
  assert.equal((await call("/services/notifications/process", { method: "POST", json: {}, csrf: false })).status, 403);
  assert.equal((await call("/services/notifications/process", { method: "POST", json: {}, e: { ...env, PORTAL_ADMIN_WRITES: undefined } })).json.error, "writes_disabled");
  assert.equal((await call("/support", { e: { ...env, PORTAL_ADMIN_WRITES: undefined } })).status, 200, "reads work without writes");
  const sent = await call("/services/notifications/process", { method: "POST", json: {} });
  assert.equal(sent.status, 200); assert.equal(sent.json.emails.configured, true);
  w.mail.mode = "500"; await create(ann, { title: "Another" }); w.mail.mode = "ok";
  const r = (await call("/services/notifications/process", { method: "POST", json: {} })).json; assert.ok(r.result.sent >= 1);
  assert.equal((await call("/services/notifications/process", { method: "GET" })).status, 405); void run;
});

test("the Admin pages are built the safe way: the global list and conversation reuse the safe thread view, the dashboard and navigation show counts, and nothing uses innerHTML", () => {
  const g = readFileSync(new URL("../../admin/assets/support-global.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|localStorage|fetch\(/.test(g)); assert.ok(!/\.style\b|style\s*:\s*["'{]/.test(g));
  assert.match(g, /\/admin\/support\/\$\{encodeURIComponent/); assert.match(g, /only: decodeURIComponent\(parts\[3\]\)/); assert.match(g, /Send pending emails now/);
  assert.match(readFileSync(new URL("../../admin/assets/modules.js", import.meta.url), "utf8"), /id: "support", label: "Support Requests", path: "\/admin\/support"/);
  assert.match(readFileSync(new URL("../../admin/assets/admin.js", import.meta.url), "utf8"), /adm-nav__badge/);
  assert.match(readFileSync(new URL("../../admin/assets/overview.js", import.meta.url), "utf8"), /Needs attention/);
});
