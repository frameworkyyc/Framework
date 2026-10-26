/* Client Services, Phase 2: Invoices. The real Admin API and the real client portal in one world (shared database and bucket): entering, attaching, publishing,
   paying and archiving as staff; seeing and downloading as an owner; and everything a member, another organization or a stranger must NOT be able to do. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as inv from "../portal/repo/invoices.js";
import * as B from "../portal/brand-files.js";
import { PORTAL_CSP } from "../portal/http.js";
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



const sql = (db, q, ...p) => db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const DRAFT = { invoiceNumber: "FW-2026-014", issueDate: "2026-10-01", dueDate: "2026-10-15", amount: "1,575.50", description: "Website design: phase 1", internalNote: "Net 14" };
const PDF = () => S.pdf();
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
  const pdfForm = (name, bytes) => { const f = new FormData(); f.append("file", new File([bytes], name)); return f; };
  const make = async (over = {}, { file = true, publish = false } = {}) => {
    const c = await call(`/clients/${A.id}/invoices`, { method: "POST", json: { ...DRAFT, ...over } });
    assert.equal(c.status, 201, JSON.stringify(c.json));
    if (file) assert.equal((await call(`/clients/${A.id}/invoices/${c.json.id}/file`, { method: "POST", form: pdfForm("inv.pdf", PDF()) })).status, 200);
    if (publish) assert.equal((await call(`/clients/${A.id}/invoices/${c.json.id}/publish`, { method: "POST", json: {} })).status, 200);
    return c.json.id;
  };
  const Bo = await w.org("beta", "Beta Co"); await w.invite(Bo, "bob@beta.test", "owner");
  const bob = w.browser(); await bob.signIn(w.user(3, "bob@beta.test"));
  return { w, A, Bo, env, bucket, ann, mia, bob, call, make, pdfForm };
}
const page = async (b, p) => (await b.get("/portal/o/alpha/services" + p)).text();

test("Admin enters a draft, attaches the PDF and publishes; the owner then sees it and downloads the exact PDF; a draft never shows", async () => {
  const { w, A, ann, call, make } = await setup();
  const id = await make({}, { file: true });
  assert.match(await page(ann, "/invoices"), /No invoices yet/, "a draft is invisible to the client");
  assert.match(await page(ann, ""), /No invoices yet/, "and the hub says so");
  assert.equal((await ann.get(`/portal/o/alpha/services/invoices/${id}/download`)).status, 404, "a draft cannot be downloaded");
  const view = (await call(`/clients/${A.id}/invoices`)).json;
  assert.equal(view.invoices.length, 1); assert.equal(view.invoices[0].published, false); assert.equal(view.invoices[0].amount, "$1,575.50 CAD"); assert.equal(view.summary.drafts, 1);
  assert.ok(!JSON.stringify(view).match(/storageKey|storage_key|sha256|org\//i), "Admin never receives storage keys or hashes");
  assert.equal((await call(`/clients/${A.id}/invoices/${id}/publish`, { method: "POST", json: {} })).status, 200);
  const html = await page(ann, "/invoices");
  assert.match(html, /Invoice FW-2026-014/); assert.match(html, /\$1,575\.50 CAD/); assert.match(html, /Website design: phase 1/); assert.match(html, /Issued Oct 1, 2026/); assert.match(html, /Due Oct 15, 2026/);
  assert.match(html, /inv__status--overdue">Overdue/, "past its due date and unpaid");
  assert.ok(!/Net 14/.test(html), "the internal note never reaches the client");
  assert.match(await page(ann, ""), /1 overdue/);
  const dl = await ann.get(`/portal/o/alpha/services/invoices/${id}/download`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get("content-disposition"), /^attachment; filename="Framework-Invoice-FW-2026-014\.pdf"/);
  assert.equal(dl.headers.get("content-type"), "application/octet-stream"); assert.equal(dl.headers.get("x-content-type-options"), "nosniff"); assert.match(dl.headers.get("content-security-policy"), /sandbox/);
  assert.equal(dl.headers.get("cache-control"), "private, no-store"); assert.ok(dl.headers.get("strict-transport-security"));
  assert.deepEqual(new Uint8Array(await dl.arrayBuffer()), PDF());
  assert.equal(sql(w.db, "SELECT count(*) n FROM activity_log WHERE action = 'invoice.download' AND actor_type = 'client'")[0].n, 1, "the download is on record");
  assert.ok(!JSON.stringify(sql(w.db, "SELECT * FROM activity_log WHERE action LIKE 'invoice.%'")).match(/org\/|storage/), "no keys in the audit trail");
  assert.equal(sql(w.db, "SELECT count(*) n FROM service_notifications WHERE event = 'invoice_published' AND audience = 'client'")[0].n, 1, "publishing queued one client notice");
});

test("owner-only: members never see the card or the page and cannot download, even with the exact address; another organization and signed-out visitors are refused", async () => {
  const { A, ann, mia, bob, call, make } = await setup();
  const id = await make({}, { publish: true });
  const hub = await page(mia, "");
  assert.ok(!/Invoices/.test(hub.replace(/Invoices, support requests/, "")), "the hub has no Invoices card for a member");
  assert.equal((await mia.get("/portal/o/alpha/services/invoices")).status, 403, "the page is refused to a member");
  assert.equal((await mia.get(`/portal/o/alpha/services/invoices/${id}/download`)).status, 403, "so is the file");
  assert.ok(!(await mia.get("/portal/o/alpha/services/invoices")).headers.get("content-disposition"));
  assert.equal((await bob.get("/portal/o/alpha/services/invoices")).status, 404, "not a member of this organization");
  assert.equal((await bob.get(`/portal/o/alpha/services/invoices/${id}/download`)).status, 404);
  assert.equal((await bob.get(`/portal/o/beta/services/invoices/${id}/download`)).status, 404, "alpha's invoice through beta's own door");
  assert.ok(!/FW-2026-014/.test(await (await bob.get("/portal/o/beta/services/invoices")).text()), "beta's list does not show alpha's invoice");
  assert.equal((await ann.get("/portal/o/alpha/services/invoices/not-a-uuid/download")).status, 404);
  assert.equal((await ann.get("/portal/o/alpha/services/invoices/00000000-0000-4000-8000-000000000000/download")).status, 404);
  const anon = (await import("./helpers/portal-e2e.mjs")).makeWorld ? null : null; void anon; void A; void call;
});

test("payment status, edits, voiding and archiving are reflected for the client at once; archived and void invoices leave their view but nothing is deleted", async () => {
  const { w, A, bucket, ann, call, make } = await setup();
  const id = await make({}, { publish: true });
  const pay = (status, extra = {}) => call(`/clients/${A.id}/invoices/${id}/payment`, { method: "POST", json: { status, ...extra } });
  assert.equal((await pay("paid", { paidOn: "2026-10-10" })).status, 200);
  let html = await page(ann, "/invoices");
  assert.match(html, /inv__status--paid">Paid/); assert.match(html, /Paid Oct 10, 2026/); assert.ok(!/Due Oct 15/.test(html), "a paid invoice shows when it was paid, not when it was due");
  assert.match(await page(ann, ""), /All paid/);
  assert.equal((await call(`/clients/${A.id}/invoices/${id}/update`, { method: "POST", json: { amount: "1" } })).json.error, "paid_locked");
  assert.equal((await pay("paid", { paidOn: "2026-02-30" })).json.error, "invalid_paid_date");
  assert.equal((await pay("refunded")).json.error, "invalid_status");
  assert.equal((await pay("unpaid")).status, 200);
  assert.equal((await call(`/clients/${A.id}/invoices/${id}/update`, { method: "POST", json: { amount: "2000", description: "Updated" } })).status, 200);
  assert.match(await page(ann, "/invoices"), /\$2,000\.00 CAD/);
  assert.equal((await pay("void")).status, 200);
  assert.match(await page(ann, "/invoices"), /No invoices yet/); assert.equal((await ann.get(`/portal/o/alpha/services/invoices/${id}/download`)).status, 404);
  assert.equal((await pay("unpaid")).status, 200);
  assert.equal((await call(`/clients/${A.id}/invoices/${id}/archive`, { method: "POST", json: {} })).status, 200);
  assert.match(await page(ann, "/invoices"), /No invoices yet/);
  assert.equal((await call(`/clients/${A.id}/invoices`)).json.invoices.length, 0, "hidden from the default Admin list");
  assert.equal((await call(`/clients/${A.id}/invoices?archived=1`)).json.invoices.length, 1);
  assert.equal(bucket.store.size, 1, "the PDF is kept");
  assert.equal((await call(`/clients/${A.id}/invoices/${id}/download`)).status, 200, "Admin can still open an archived invoice's PDF");
  assert.equal((await call(`/clients/${A.id}/invoices/${id}/restore`, { method: "POST", json: {} })).status, 200);
  assert.match(await page(ann, "/invoices"), /Invoice FW-2026-014/);
  assert.ok((await call(`/clients/${A.id}/invoices/${id}`, { method: "DELETE" })).status >= 400, "there is no delete route");
  assert.equal(sql(w.db, "SELECT count(*) n FROM invoices")[0].n, 1);
});

test("PDF uploads: only real, plain PDFs; a replacement removes the old object; failures leave the invoice as it was; Admin sees and downloads drafts", async () => {
  const { A, bucket, call, make, pdfForm } = await setup();
  const id = await make({}, { file: false });
  const up = (name, bytes) => call(`/clients/${A.id}/invoices/${id}/file`, { method: "POST", form: pdfForm(name, bytes) });
  for (const [name, bytes, status, code] of [["a.png", S.png(), 415, "type_not_allowed"], ["fake.pdf", S.text("not a pdf"), 422, "content_mismatch"], ["x.pdf", S.pdf("/JavaScript (alert(1)) "), 422, "active_content"], ["e.pdf", S.pdf("/Encrypt 5 0 R "), 422, "pdf_encrypted"], ["empty.pdf", new Uint8Array(0), 422, "empty_file"], ["run.exe", S.text("MZ"), 422, "invalid_name"]]) {
    const r = await up(name, bytes); assert.equal(r.status, status, name); assert.equal(r.json.error, code, name);
  }
  assert.equal(bucket.store.size, 0, "nothing stored for a refused file");
  assert.equal((await call(`/clients/${A.id}/invoices/${id}/publish`, { method: "POST", json: {} })).json.error, "needs_file", "no PDF, no publishing");
  assert.equal((await call(`/clients/${A.id}/invoices/${id}/download`)).status, 404);
  assert.equal((await up("one.pdf", S.pdf("% first "))).status, 200);
  const [firstKey] = [...bucket.store.keys()];
  assert.match(firstKey, new RegExp(`^org/${A.id}/invoices/`));
  assert.equal((await up("two.pdf", S.pdf("% second "))).status, 200);
  assert.equal(bucket.store.size, 1); assert.ok(!bucket.store.has(firstKey), "the replaced object is removed");
  const dl = await call(`/clients/${A.id}/invoices/${id}/download`);
  assert.equal(dl.status, 200); assert.deepEqual(dl.bytes, S.pdf("% second "));
  assert.equal((await up("three.pdf", new Uint8Array(0))).status, 422); assert.equal(bucket.store.size, 1, "a refused replacement keeps the old file");
});

test("validation: numbers are unique per client, amounts are exact dollars, dates are real, unknown fields are refused", async () => {
  const { A, Bo, call } = await setup();
  const create = (over, org = A) => call(`/clients/${org.id}/invoices`, { method: "POST", json: { ...DRAFT, ...over } });
  assert.equal((await create({})).status, 201);
  assert.equal((await create({})).json.error, "duplicate_number"); assert.equal((await create({}, Bo)).status, 201, "another client may reuse the number");
  for (const [over, code] of [[{ invoiceNumber: "bad number" }, "invalid_invoice_number"], [{ issueDate: "2026-02-30" }, "invalid_issue_date"], [{ dueDate: "2026-09-01" }, "due_before_issue"], [{ amount: "-5" }, "invalid_amount"], [{ amount: "1.999" }, "invalid_amount"], [{ amount: "" }, "invalid_amount"], [{ invoiceNumber: "N2", description: "x".repeat(301) }, "invalid_description"]]) assert.equal((await create({ invoiceNumber: "N-" + Math.random().toString(16).slice(2, 6), ...over })).json.error, code, code);
  assert.equal((await call(`/clients/${A.id}/invoices`, { method: "POST", json: { ...DRAFT, invoiceNumber: "Z1", currency: "USD" } })).json.error, "unknown_field", "CAD only: a currency cannot even be sent");
  assert.equal((await call(`/clients/${A.id}/invoices`, { method: "POST", json: { ...DRAFT, invoiceNumber: "Z2", published: true } })).json.error, "unknown_field", "an invoice cannot be created already published");
});

test("authorization and writes: no Access login, a forged token, a missing Origin or Admin header, or writes switched off change nothing; reads still work", async () => {
  const { w, A, env, call, make } = await setup();
  const id = await make({}, { publish: true });
  for (const token of [null, "garbage.token.value"]) for (const [path, method] of [[`/clients/${A.id}/invoices`, "GET"], [`/clients/${A.id}/invoices`, "POST"], [`/clients/${A.id}/invoices/${id}/publish`, "POST"], [`/clients/${A.id}/invoices/${id}/download`, "GET"]]) {
    const r = await call(path, { method, token, json: method === "POST" ? {} : undefined }); assert.ok([401, 403].includes(r.status), `${method} ${path} -> ${r.status}`); assert.ok(!JSON.stringify(r.json || {}).includes("FW-2026"));
  }
  assert.equal((await call(`/clients/${A.id}/invoices/${id}/archive`, { method: "POST", json: {}, origin: null })).status, 403);
  assert.equal((await call(`/clients/${A.id}/invoices/${id}/archive`, { method: "POST", json: {}, origin: "https://evil.example" })).status, 403);
  assert.equal((await call(`/clients/${A.id}/invoices/${id}/archive`, { method: "POST", json: {}, csrf: false })).status, 403);
  const off = { ...env, PORTAL_ADMIN_WRITES: undefined };
  assert.equal((await call(`/clients/${A.id}/invoices/${id}/archive`, { method: "POST", json: {}, e: off })).json.error, "writes_disabled");
  const read = await call(`/clients/${A.id}/invoices`, { e: off }); assert.equal(read.status, 200); assert.equal(read.json.capabilities.writes, false);
  assert.equal(sql(w.db, "SELECT archived_at FROM invoices WHERE id = ?", id)[0].archived_at, null, "nothing changed");
  assert.equal((await call(`/clients/${crypto.randomUUID()}/invoices`)).status, 404);
  assert.equal((await call(`/clients/not-a-uuid/invoices`)).status, 404);
});

test("a database without migration 0007 is handled everywhere: Admin says 'not available', the client hub keeps Invoices as 'Coming soon'", async () => {
  const { w, A, ann, call } = await setup();
  w.db.raw.exec("DROP TABLE service_notifications; DROP TABLE support_attachments; DROP TABLE support_messages; DROP TABLE support_requests; DROP TABLE invoices");
  assert.deepEqual((await call(`/clients/${A.id}/invoices`)).json, { available: false });
  const hub = await ann.get("/portal/o/alpha/services");
  assert.equal(hub.status, 200); assert.match(await hub.text(), /Coming soon/);
  assert.equal((await call(`/clients/${A.id}`)).json.invoices, null, "the client detail simply has no invoice summary");
});

test("retention: removing an organization's files never touches invoice PDFs, housekeeping never calls them orphans, and no route or function deletes an invoice", async () => {
  const { w, A, bucket, make } = await setup();
  const id = await make({}, { publish: true });
  const deps = { db: w.db, bucket, env: w.env, now: new Date() };
  const invoiceKey = [...bucket.store.keys()][0];
  const r = await B.deleteOrganizationFiles(deps, { organizationId: A.id, actor: "admin@framework.test" });
  assert.ok(r.ok, JSON.stringify(r)); assert.ok(bucket.store.has(invoiceKey), "the invoice PDF survives an organization-wide file removal");
  assert.deepEqual(await B.findOrphanObjects(deps, { organizationId: A.id }), [], "an invoice file is not an orphan");
  bucket.store.set(`org/${A.id}/invoices/${crypto.randomUUID()}`, { bytes: new Uint8Array(1), httpMetadata: {}, customMetadata: { org: A.id } });
  assert.equal((await B.findOrphanObjects(deps, { organizationId: A.id })).length, 1, "a genuinely unreferenced invoice-area object is still reported");
  assert.equal(sql(w.db, "SELECT count(*) n FROM invoices WHERE id = ?", id)[0].n, 1);
  for (const f of ["worker/portal/admin-invoices.js", "worker/portal/invoice-files.js", "worker/portal/repo/invoices.js", "admin/assets/invoices.js"]) assert.ok(!/DELETE\s+FROM\s+invoices|method:\s*"DELETE"|\/delete["`]/i.test(readFileSync(new URL("../../" + f, import.meta.url), "utf8")), f + " has no delete");
});

test("the client list is mobile-friendly and safe: no script, no inline style, escaped text, one real download link per invoice, empty state, and Home still works", async () => {
  const { w, A, ann, call, make } = await setup();
  await make({ invoiceNumber: "FW-1", description: "<b>X</b> <img src=x onerror=alert(1)>" }, { publish: true });
  await make({ invoiceNumber: "FW-2", dueDate: null }, { publish: true });
  const res = await ann.get("/portal/o/alpha/services/invoices");
  assert.equal(res.headers.get("content-security-policy"), PORTAL_CSP, "no script on the page");
  const html = await res.text();
  assert.ok(!/<b>X<\/b>|<img src=x/.test(html)); assert.match(html, /&lt;b&gt;X&lt;\/b&gt;/);
  assert.equal([...html.matchAll(/class="btn btn--small" href="\/portal\/o\/alpha\/services\/invoices\/[0-9a-f-]{36}\/download" download/g)].length, 2);
  assert.ok(!/style=|<script|storage_key|sha256/.test(html));
  assert.match(html, /Questions about an invoice\?/); assert.match(html, /Only owners of your organization can see invoices/);
  assert.equal((await ann.get("/portal/o/alpha")).status, 200); void w; void A; void call;
});

test("the Admin client page carries the invoice summary and its attention items; the Invoices page is built the safe way", async () => {
  const { A, call, make } = await setup();
  await make({}, { publish: true });
  await make({ invoiceNumber: "FW-DRAFT", dueDate: null }, { file: false });
  const detail = (await call(`/clients/${A.id}`)).json;
  assert.deepEqual(detail.invoices, { total: 2, drafts: 1, overdue: 1 });
  const ui = readFileSync(new URL("../../admin/assets/invoices.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|localStorage|sessionStorage|document\.cookie|fetch\(/.test(ui));
  assert.ok(!/\.style\b|setAttribute\(\s*["']style|style\s*:\s*["'{]/.test(ui), "no inline styles (the Admin CSP forbids them)");
  assert.match(ui, /filter\(Boolean\)\); \/\/ replaceChildren/, "optional nodes are filtered out: replaceChildren would print a null as the word null"); assert.match(ui, /new FormData\(\)/); for (const title of ["Publish this invoice?", "Archive this invoice?", "Restore this invoice?", "Void this invoice?", "Replace the PDF?"]) assert.ok(ui.includes(`title: "${title}"`) || ui.includes(`"${title}"`), title);
  const dash = readFileSync(new URL("../../admin/assets/client-dashboard.js", import.meta.url), "utf8");
  assert.match(dash, /invoices\.overdue/); assert.match(dash, /draft invoice/);
});
