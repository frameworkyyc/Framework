/* Website management and Additional Services (Website Phase 3), through the real router and the real Admin API in one world (shared database and bucket).
   PORTAL_SERVICES is deliberately NOT set: everything here works without it. Migrations 0011 and 0012 are applied by hand (both are still proposed). */
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
import { inspectUpload } from "../portal/files/index.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ADMIN_ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const nowS = () => Math.floor(Date.now() / 1000);
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const M11 = read("migrations/portal/0011_websites.sql"), M12 = read("migrations/portal/0012_website_management.sql");
const rowsOf = (w, q, ...p) => w.db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const UUID0 = "00000000-0000-4000-8000-000000000000";

async function setup({ m12 = true, flag = true } = {}) {
  resetKeyCacheForTests();
  const w = await makeWorld({ skip: m12 ? [] : ["0012_website_management.sql"] });
  const bucket = fakeR2();
  Object.assign(w.env, { PORTAL_FILES: bucket, PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) });
  if (flag) w.env.PORTAL_WEBSITE = "1";
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

/* ------------------------------------------------------------------ files */

test("the ZIP check: website source files are allowed for a website package; programs and nested archives are not; the strict general rule is unchanged", async () => {
  const web = (bytes, name = "site.zip") => inspectUpload({ bytes, originalName: name, profile: "website_package", maxBytes: 25 * 1024 * 1024, archiveOptions: { webSource: true } });
  assert.equal((await web(WEB_ZIP())).ok, true);
  for (const bad of ["setup.exe", "install.bat", "tool.dll", "macro.docm", "inner.zip", "x.sh"]) assert.deepEqual([bad, (await web(S.zip([{ name: bad, data: S.text("x") }]))).error], [bad, "archive_unsafe_entry"]);
  assert.equal((await inspectUpload({ bytes: WEB_ZIP(), originalName: "site.zip", profile: "brand_admin", maxBytes: 25 * 1024 * 1024 })).error, "archive_unsafe_entry", "the general rule still refuses html, js and php");
  assert.equal((await inspectUpload({ bytes: WEB_ZIP(), originalName: "site.zip", profile: "support", maxBytes: 25 * 1024 * 1024 })).error, "archive_unsafe_entry");
  assert.equal((await web(S.png(), "site.zip")).ok, false, "a picture renamed .zip is refused");
  assert.equal((await web(WEB_ZIP(), "site.png")).ok, false, "only .zip");
});

test("Download website files: disabled until Admin uploads AND publishes; then only that client's members can download it, as an attachment", async () => {
  const s = await setup();
  const id = await s.site(s.A);
  let page = await html(await s.ann.get("/portal/o/alpha/website"));
  assert.match(page, /Download website files/); assert.match(page, /aria-disabled="true">Not available yet/); assert.ok(!/files\/download/.test(page));
  const up = await s.upload(s.A, id, "alpha-site.zip", WEB_ZIP());
  assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.deepEqual(rowsOf(s.w, "SELECT published, name, size_bytes > 0 AS sized FROM website_packages"), [{ published: 0, name: "alpha-site.zip", sized: 1 }], "a new file starts unpublished");
  page = await html(await s.ann.get("/portal/o/alpha/website"));
  assert.ok(!/files\/download/.test(page), "still hidden while unpublished");
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${id}/files/download`)).status, 404);
  assert.equal((await s.publish(s.A, id, true)).status, 200);
  page = await html(await s.ann.get("/portal/o/alpha/website"));
  assert.ok(page.includes(`href="/portal/o/alpha/website/${id}/files/download"`)); assert.match(page, /ZIP, \d/);
  const dl = await s.mia.get(`/portal/o/alpha/website/${id}/files/download`);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get("Content-Type"), "application/octet-stream");
  assert.match(dl.headers.get("Content-Disposition"), /^attachment; filename=/); assert.match(dl.headers.get("Content-Disposition"), /alpha-site\.zip/);
  assert.match(dl.headers.get("Content-Security-Policy"), /sandbox/); assert.equal(dl.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual([...new Uint8Array(await dl.arrayBuffer())], [...WEB_ZIP()], "the exact bytes");
  assert.equal(rowsOf(s.w, "SELECT count(*) AS n FROM activity_log WHERE action = 'website.package.downloaded'")[0].n, 1, "the download is recorded");
  assert.equal((await s.bob.get(`/portal/o/alpha/website/${id}/files/download`)).status, 404, "another organization");
  assert.equal((await s.bob.get(`/portal/o/beta/website/${id}/files/download`)).status, 404, "nor through its own slug");
  assert.notEqual((await s.anon.get(`/portal/o/alpha/website/${id}/files/download`)).status, 200, "signed out");
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${UUID0}/files/download`)).status, 404);
  assert.equal((await s.publish(s.A, id, false)).status, 200);
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${id}/files/download`)).status, 404, "withdrawn");
  await s.publish(s.A, id, true);
  assert.ok((await sites.updateWebsite(s.w.db, s.A.id, id, { published: false }, ADMIN)).ok);
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${id}/files/download`)).status, 404, "an unpublished website offers nothing");
  assert.ok((await sites.updateWebsite(s.w.db, s.A.id, id, { published: true }, ADMIN)).ok);
  assert.ok((await sites.setWebsiteArchived(s.w.db, s.A.id, id, true, ADMIN)).ok);
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${id}/files/download`)).status, 404, "an archived website offers nothing");
});

test("Admin: replacing the file resets it to unpublished and deletes the old object; removing deletes the object; bad files are refused and leave nothing behind; archived websites take none", async () => {
  const s = await setup();
  const id = await s.site(s.A);
  await s.upload(s.A, id, "one.zip", WEB_ZIP()); await s.publish(s.A, id, true);
  const keys = () => [...s.bucket.store.keys()];
  assert.equal(keys().length, 1);
  const again = await s.upload(s.A, id, "two.zip", S.zip([{ name: "index.html", data: S.text("v2") }]));
  assert.equal(again.status, 200);
  assert.equal(keys().length, 1, "the old object is gone"); assert.deepEqual(rowsOf(s.w, "SELECT name, published FROM website_packages"), [{ name: "two.zip", published: 0 }]);
  const bad = await s.upload(s.A, id, "evil.zip", S.zip([{ name: "setup.exe", data: S.text("MZ") }]));
  assert.equal(bad.status, 422); assert.equal(bad.json.error, "archive_unsafe_entry"); assert.equal(keys().length, 1, "nothing stored for a refused file");
  assert.equal((await s.upload(s.A, id, "pic.zip", S.png())).status, 422);
  assert.equal((await s.upload(s.A, id, "big.zip", new Uint8Array(26 * 1024 * 1024))).status, 413, "over the 25 MB ceiling");
  assert.equal((await s.call(`/clients/${s.A.id}/websites/${id}/package/remove`, { method: "POST", json: {} })).status, 200);
  assert.equal(keys().length, 0); assert.equal(rowsOf(s.w, "SELECT count(*) AS n FROM website_packages")[0].n, 0);
  const gone = await s.site(s.A, { name: "Old", url: "https://old.example.ca" });
  assert.ok((await sites.setWebsiteArchived(s.w.db, s.A.id, gone, true, ADMIN)).ok);
  assert.equal((await s.upload(s.A, gone, "x.zip", WEB_ZIP())).status, 404);
  assert.equal((await s.upload(s.Bo, id, "x.zip", WEB_ZIP())).status, 404, "another organization's website");
  const view = await s.call(`/clients/${s.A.id}/websites`);
  assert.equal(view.json.packagesAvailable, true); assert.equal(view.json.limits.packageMaxBytes, 25 * 1024 * 1024);
  assert.ok(!JSON.stringify(view.json).includes("org/"), "no storage key in the Admin view");
});

test("Admin package changes are refused as unavailable until migration 0012 is applied, and the client page still works", async () => {
  const s = await setup({ m12: false });
  const id = await s.site(s.A);
  const r = await s.upload(s.A, id, "x.zip", WEB_ZIP());
  assert.equal(r.status, 409); assert.equal(r.json.error, "unavailable");
  assert.equal((await s.call(`/clients/${s.A.id}/websites`)).json.packagesAvailable, false);
  const page = await html(await s.ann.get("/portal/o/alpha/website"));
  assert.match(page, /Not available yet/); assert.match(page, /Additional services/, "the services grid works from the built-in defaults");
});

/* ------------------------------------------------------------------ requests */

test("Request a change / Get support: ordinary support requests linked to the website, working WITHOUT PORTAL_SERVICES, with attachments, a thread, replies and status", async () => {
  const s = await setup();
  const id = await s.site(s.A);
  assert.equal(s.w.env.PORTAL_SERVICES, undefined);
  assert.equal((await s.ann.get("/portal/o/alpha/services/requests")).status, 404, "Client Services stays off");
  const page = await html(await s.ann.get("/portal/o/alpha/website"));
  assert.ok(page.includes(`/website/${id}/requests/new?kind=change`) && page.includes(`/website/${id}/requests/new?kind=support`));
  const form = await html(await s.ann.get(`/portal/o/alpha/website/${id}/requests/new?kind=change`));
  assert.match(form, /name="title"/); assert.match(form, /name="description"/); assert.match(form, /type="file"/); assert.match(form, /does not authorize any paid work/i);
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${id}/requests/new?kind=bogus`)).status, 404);
  const sent = await s.send(s.ann, `/website/${id}/requests`, { kind: "change", title: "New opening hours", description: "Change the footer hours." }, [["hours.png", S.png()]], { csrfFrom: `/website/${id}/requests/new?kind=change` });
  assert.equal(sent.status, 303);
  const rid = /website\/requests\/([0-9a-f-]{36})\?flash=sent/.exec(sent.headers.get("Location"))[1];
  const row = rowsOf(s.w, "SELECT category, scope, status, website_id FROM support_requests WHERE id = ?", rid)[0];
  assert.deepEqual(row, { category: "website_change", scope: "change", status: "new", website_id: id });
  assert.equal(rowsOf(s.w, "SELECT count(*) AS n FROM support_attachments")[0].n, 1);
  const thread = await html(await s.ann.get(`/portal/o/alpha/website/requests/${rid}`));
  assert.match(thread, /New opening hours/); assert.match(thread, /Website change · Main website/); assert.match(thread, /Framework has received your request/);
  assert.ok(thread.includes(`/website/requests/${rid}/files/`), "attachment links stay under the Website section");
  const list = await html(await s.ann.get("/portal/o/alpha/website/requests"));
  assert.match(list, /New opening hours/); assert.match(list, /Main website/); assert.match(list, /New<\/span>|req-status--new/);
  assert.match(await html(await s.ann.get("/portal/o/alpha/website")), /1 open/);
  // a teammate can follow and reply; staff status changes show up
  assert.equal((await s.mia.get(`/portal/o/alpha/website/requests/${rid}`)).status, 200);
  const reply = await s.send(s.mia, `/website/requests/${rid}/reply`, { body: "Also the phone number." }, [], { csrfFrom: `/website/requests/${rid}` });
  assert.equal(reply.status, 303); assert.match(reply.headers.get("Location"), new RegExp(`/website/requests/${rid}\\?flash=replied`));
  assert.ok((await sup.setRequestStatus(s.w.db, s.A.id, rid, "in_progress", ADMIN, { note: "On it." })).ok);
  assert.match(await html(await s.ann.get("/portal/o/alpha/website/requests")), /In progress/);
  const t2 = await html(await s.ann.get(`/portal/o/alpha/website/requests/${rid}`));
  assert.match(t2, /Framework is working on this/); assert.match(t2, /On it\./);
  // support kind
  const sup2 = await s.send(s.mia, `/website/${id}/requests`, { kind: "support", title: "Form is broken", description: "The contact form errors." }, [], { csrfFrom: `/website/${id}/requests/new?kind=support` });
  assert.equal(sup2.status, 303);
  assert.deepEqual(rowsOf(s.w, "SELECT category, scope FROM support_requests WHERE title = 'Form is broken'"), [{ category: "technical_issue", scope: "support" }]);
  assert.equal(rowsOf(s.w, "SELECT count(*) AS n FROM service_notifications WHERE event = 'request_submitted'")[0].n, 2, "Framework is notified through the existing outbox");
});

test("website requests: another organization's, unpublished and archived websites cannot be written to; a request without a website is not reachable here; bad input is refused", async () => {
  const s = await setup();
  const id = await s.site(s.A), draft = await s.site(s.A, { name: "Draft", url: "https://d.example.ca", published: false }), theirs = await s.site(s.Bo, { name: "Theirs", url: "https://t.example.ca" });
  const post = (b, path, fields, o) => s.send(b, path, fields, [], o);
  for (const target of [theirs, draft, UUID0]) assert.equal((await post(s.ann, `/website/${target}/requests`, { kind: "change", title: "x", description: "y" }, { csrfFrom: `/website/${id}/requests/new?kind=change` })).status, 404, target);
  assert.equal((await s.bob.get(`/portal/o/beta/website/${id}/requests/new?kind=change`)).status, 404);
  assert.equal((await post(s.ann, `/website/${id}/requests`, { kind: "nope", title: "x", description: "y" }, { csrfFrom: `/website/${id}/requests/new?kind=change` })).status, 404);
  assert.equal((await post(s.ann, `/website/${id}/requests`, { kind: "change", title: "x", description: "y" }, { token: "bad" })).status, 403, "CSRF is required");
  const empty = await post(s.ann, `/website/${id}/requests`, { kind: "change", title: "", description: "y" }, { csrfFrom: `/website/${id}/requests/new?kind=change` });
  assert.equal(empty.status, 422); assert.match(await empty.text(), /short title/);
  const plain = await sup.createRequest(s.w.db, s.A.id, rowsOf(s.w, "SELECT id FROM portal_users WHERE email = ?", "ann@alpha.test")[0].id, { category: "general", title: "Plain", description: "No website." });
  assert.ok(plain.ok);
  assert.equal((await s.ann.get(`/portal/o/alpha/website/requests/${plain.id}`)).status, 404, "an unlinked support request is not part of the Website section");
  assert.ok(!/Plain/.test(await html(await s.ann.get("/portal/o/alpha/website/requests"))));
  const good = await post(s.ann, `/website/${id}/requests`, { kind: "change", title: "Mine", description: "Yes" }, { csrfFrom: `/website/${id}/requests/new?kind=change` });
  const rid = /requests\/([0-9a-f-]{36})/.exec(good.headers.get("Location"))[1];
  assert.equal((await s.bob.get(`/portal/o/alpha/website/requests/${rid}`)).status, 404, "another organization cannot read it");
  assert.equal((await s.bob.get(`/portal/o/beta/website/requests/${rid}`)).status, 404);
  assert.ok((await sites.setWebsiteArchived(s.w.db, s.A.id, id, true, ADMIN)).ok);
  assert.equal((await post(s.ann, `/website/${id}/requests`, { kind: "change", title: "x", description: "y" }, { csrfFrom: "/website" })).status, 404, "an archived website takes no new requests");
});

test("Admin sees which website a request is about", async () => {
  const s = await setup();
  const id = await s.site(s.A);
  const r = await s.send(s.ann, `/website/${id}/requests`, { kind: "change", title: "Hours", description: "Update." }, [], { csrfFrom: `/website/${id}/requests/new?kind=change` });
  assert.equal(r.status, 303);
  const list = await s.call(`/clients/${s.A.id}/support`);
  assert.equal(list.json.requests[0].websiteName, "Main website");
});

/* ------------------------------------------------------------------ additional services */

test("Additional Services: a clean grid of the four services, no price unless Admin set one, never 'Included', and each can be requested once", async () => {
  const s = await setup();
  await s.site(s.A);
  let page = await html(await s.ann.get("/portal/o/alpha/website"));
  for (const n of ["Client Admin Portal", "Invoice Sender", "Digital Business Cards", "SEO &amp; Visibility"]) assert.match(page, new RegExp(n));
  assert.equal((page.match(/Request Service<span class="visually-hidden">/g) || []).length, 4);
  assert.ok(!/ws-svc__price/.test(page) && !/Starting at|Custom quote|Included/.test(page.split('id="additional-services"')[1]), "no price is shown until one is configured");
  assert.ok(!/already included|part of your plan/i.test(page));
  const set = (prices) => s.call("/service-pricing", { method: "POST", json: { prices } });
  assert.equal((await set([{ key: "seo-visibility", type: "starting_at", priceCad: 400 }, { key: "invoice-sender", type: "custom_quote" }])).status, 200);
  page = await html(await s.ann.get("/portal/o/alpha/website"));
  assert.match(page, /Starting at \$400 CAD/); assert.match(page, /Custom quote/); assert.match(page, /Starting prices are estimates/);
  const inc = await set([{ key: "seo-visibility", type: "included" }]);
  assert.equal(inc.status, 422, "Included is not offered for an optional service");
  // request
  const r1 = await s.svc(s.ann, { service: "seo-visibility" });
  assert.equal(r1.status, 303); assert.match(r1.headers.get("Location"), /\/website\?requested=1#additional-services/);
  const row = rowsOf(s.w, "SELECT service_key, status, price_snapshot FROM service_requests")[0];
  assert.deepEqual([row.service_key, row.status], ["svc-seo-visibility", "new"]);
  assert.deepEqual(JSON.parse(row.price_snapshot), { service: "seo-visibility", name: "SEO & Visibility", type: "starting_at", priceCad: 400, label: "Starting at $400 CAD" }, "the price the client was shown is recorded");
  page = await html(await s.ann.get("/portal/o/alpha/website?requested=1"));
  assert.match(page, /Your request was sent/); assert.match(page, /status--active">Requested/);
  assert.equal((page.match(/Request Service<span class="visually-hidden">/g) || []).length, 3, "the requested service shows its state instead of a button");
  const r2 = await s.svc(s.ann, { service: "seo-visibility" });
  assert.match(r2.headers.get("Location"), /requested=0/); assert.equal(rowsOf(s.w, "SELECT count(*) AS n FROM service_requests")[0].n, 1, "one open request per service");
  assert.match(await html(await s.ann.get("/portal/o/alpha/website?requested=0")), /already asked/);
  // Admin sees it in the existing request list, by the service's name
  const brand = await s.call(`/clients/${s.A.id}/branding`);
  assert.equal(brand.json.requests.find((x) => x.serviceKey === "svc-seo-visibility").service, "Additional service: SEO & Visibility");
});

test("Additional Services: only owners may request; an unknown or hidden service is refused; CSRF is required; another organization is unaffected", async () => {
  const s = await setup();
  await s.site(s.A);
  const member = await html(await s.mia.get("/portal/o/alpha/website"));
  assert.match(member, /Only account owners can request a service/); assert.ok(!/name="service"/.test(member), "no request controls for a member");
  const forged = await s.svc(s.mia, { service: "invoice-sender" }, { token: await s.csrf(s.ann, "alpha", "/website") });
  assert.ok([403, 404].includes(forged.status), "a member cannot request: " + forged.status);
  assert.equal(rowsOf(s.w, "SELECT count(*) AS n FROM service_requests")[0].n, 0);
  assert.equal((await s.svc(s.ann, { service: "not-a-service" })).status, 404);
  assert.equal((await s.svc(s.ann, { service: "brand-svc-logo-primary" })).status, 404, "a Branding key is not a service here");
  assert.equal((await s.svc(s.ann, { service: "invoice-sender" }, { token: "bad" })).status, 403);
  assert.equal((await s.ann.get("/portal/o/alpha/website/services/request")).status, 303, "a GET just goes back to the page");
  assert.equal((await s.svc(s.bob, { service: "invoice-sender" }, { slug: "beta" })).status, 303);
  assert.deepEqual(rowsOf(s.w, "SELECT organization_id FROM service_requests").map((r) => r.organization_id), [s.Bo.id], "recorded for the requesting organization only");
  assert.ok(!/Requested/.test(await html(await s.ann.get("/portal/o/alpha/website"))), "Alpha does not see Beta's request");
});

test("Additional Services is Admin-editable: name, description, shown or hidden and order change what clients see; the keys are fixed; changes are audited and validated", async () => {
  const s = await setup();
  await s.site(s.A);
  const list = await s.call("/additional-services");
  assert.equal(list.json.available, true); assert.deepEqual(list.json.services.map((x) => x.key), ["client-admin-portal", "invoice-sender", "digital-business-cards", "seo-visibility"]);
  const edit = (body) => s.call("/additional-services", { method: "POST", json: body });
  assert.equal((await edit({ key: "invoice-sender", name: "Invoice Sender Pro", description: "Send invoices fast.", sort_order: 5 })).status, 200);
  assert.equal((await edit({ key: "digital-business-cards", enabled: false })).status, 200);
  let page = await html(await s.ann.get("/portal/o/alpha/website"));
  assert.match(page, /Invoice Sender Pro/); assert.match(page, /Send invoices fast/); assert.ok(!/Digital Business Cards/.test(page), "hidden services disappear");
  assert.ok(page.indexOf("Invoice Sender Pro") < page.indexOf("Client Admin Portal"), "order is respected");
  assert.equal((await s.svc(s.ann, { service: "digital-business-cards" })).status, 404, "a hidden service cannot be requested");
  assert.equal(rowsOf(s.w, "SELECT count(*) AS n FROM activity_log WHERE action = 'portal_service.updated'")[0].n, 2);
  assert.equal((await edit({ key: "invoice-sender", name: "Invoice Sender Pro" })).status, 200);
  assert.equal(rowsOf(s.w, "SELECT count(*) AS n FROM activity_log WHERE action = 'portal_service.updated'")[0].n, 2, "an unchanged save writes nothing");
  for (const bad of [{ key: "nope", name: "x" }, { key: "invoice-sender", name: "" }, { key: "invoice-sender", name: "x".repeat(61) }, { key: "invoice-sender", description: "" }, { key: "invoice-sender", enabled: "yes" }, { key: "invoice-sender", sort_order: -1 }, { key: "invoice-sender", sort_order: 1.5 }]) assert.equal((await edit(bad)).status, 422, JSON.stringify(bad));
  for (const k of ["client-admin-portal", "invoice-sender", "seo-visibility"]) await edit({ key: k, enabled: false });
  page = await html(await s.ann.get("/portal/o/alpha/website"));
  assert.ok(!/Additional services/.test(page), "with every service hidden the section disappears");
  const noWrite = await handleAdmin(new Request(ADMIN_ORIGIN + "/api/admin/additional-services", { method: "POST", headers: { Origin: "https://evil.example", "X-Framework-Admin": "1", "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: nowS(), exp: nowS() + 600 }) }, body: JSON.stringify({ key: "invoice-sender", enabled: true }) }), s.w.env, {});
  assert.equal(noWrite.status, 403, "cross-site writes are refused");
  const bare = await setup({ m12: false });
  const b = await bare.call("/additional-services");
  assert.equal(b.json.available, false); assert.equal(b.json.services.length, 4);
  assert.equal((await bare.call("/additional-services", { method: "POST", json: { key: "invoice-sender", name: "x" } })).status, 409);
});

test("with no website at all the page still offers the Additional Services; with several websites management sits on each website's own page", async () => {
  const s = await setup();
  const empty = await html(await s.ann.get("/portal/o/alpha/website"));
  assert.match(empty, /No website yet/); assert.match(empty, /Additional services/); assert.ok(!/Website management/.test(empty));
  const a = await s.site(s.A), b = await s.site(s.A, { name: "Shop", url: "https://shop.example.ca" });
  const list = await html(await s.ann.get("/portal/o/alpha/website"));
  assert.match(list, /2 websites are listed/); assert.match(list, /Additional services/); assert.ok(!/Download website files/.test(list));
  for (const id of [a, b]) assert.match(await html(await s.ann.get(`/portal/o/alpha/website/${id}`)), /Website management/);
});

test("the new sections add no scripts or inline styles, keep the strict CSP, and stay hidden with the flag off", async () => {
  const s = await setup();
  const id = await s.site(s.A);
  for (const p of ["/website", `/website/${id}`, "/website/requests", `/website/${id}/requests/new?kind=change`]) {
    const res = await s.ann.get("/portal/o/alpha" + p);
    assert.equal(res.status, 200, p);
    const t = await res.text();
    assert.ok(!/<script|\sstyle=|\son[a-z]+=|javascript:/i.test(t), p);
    assert.ok(!/frame-src/.test(res.headers.get("Content-Security-Policy")) || p === "/website" || p === `/website/${id}`, p);
  }
  const off = await setup({ flag: false });
  const oid = await off.site(off.A);
  for (const p of ["/website/requests", `/website/${oid}/requests/new?kind=change`, `/website/${oid}/files/download`]) assert.equal((await off.ann.get("/portal/o/alpha" + p)).status, 404, p);
  assert.equal((await off.svc(off.ann, { service: "invoice-sender" }, { token: "x" })).status, 404);
});

test("migration 0012 is additive: two new tables and four seed rows, nothing existing is changed or removed", async () => {
  const sql = M12.replace(/--.*$/gm, "");
  assert.ok(!/\bDROP\b|(?<!ON )\b(DELETE|UPDATE)\b|\bALTER\b|\bRENAME\b/i.test(sql), "no destructive or altering statement");
  const w = await makeWorld({ skip: ["0012_website_management.sql"] });
  const before = rowsOf(w, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((r) => r.name);
  const prices = rowsOf(w, "SELECT * FROM service_prices ORDER BY service_key");
  w.db.raw.exec(M12); w.db.raw.exec(M12); // and idempotent
  const after = rowsOf(w, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((r) => r.name);
  assert.deepEqual(after.filter((t) => !before.includes(t)), ["portal_services", "website_packages"]);
  assert.deepEqual(rowsOf(w, "SELECT * FROM service_prices ORDER BY service_key"), prices, "no price is added or changed: a price shows only once Admin sets one");
  assert.equal(rowsOf(w, "SELECT count(*) AS n FROM portal_services")[0].n, 4);
  assert.throws(() => w.db.raw.exec("INSERT INTO website_packages (website_id, organization_id, name, format, content_type, size_bytes, sha256, storage_key, uploaded_at, uploaded_by, updated_at, updated_by) VALUES ('" + UUID0 + "', '" + UUID0 + "', 'x.zip', 'zip', 'application/zip', 1, '" + "a".repeat(64) + "', '" + "k".repeat(40) + "', 't', 'u', 't', 'u')"), /FOREIGN KEY|constraint/i, "a package must belong to a website of the same organization");
});
