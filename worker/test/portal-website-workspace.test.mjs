/* The Website review workspace (migration 0030, proposed): environments, updates that need approval, client tasks, request changes; the Admin API behind it; and what happens on a database without 0030.
   Through the real router and the real Admin API in one world. Migration 0030 is applied by hand to the test database (it is still proposed). */
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld, ORIGIN as PORTAL_ORIGIN } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as sites from "../portal/repo/websites.js";
import * as wk from "../portal/repo/website-workspace.js";
import { PORTAL_CSP } from "../portal/http.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ADMIN_ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const nowS = () => Math.floor(Date.now() / 1000);
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
const rows = (w, q, ...p) => w.db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const UUID0 = "00000000-0000-4000-8000-000000000000";
const noInline = (h) => !/ style=|<style|<script|javascript:|\son[a-z]+=["']/i.test(h);

async function setup({ m30 = true, flag = true } = {}) {
  resetKeyCacheForTests();
  const w = await makeWorld({ proposed: m30 ? ["0030_website_workspace.sql"] : [] });
  Object.assign(w.env, { PORTAL_FILES: fakeR2(), PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) });
  if (flag) w.env.PORTAL_WEBSITE = "1";
  const A = await w.org("alpha", "Alpha Co"), B = await w.org("beta", "Beta Co");
  await w.invite(A, "ann@alpha.test", "owner"); await w.invite(A, "mia@alpha.test", "member"); await w.invite(B, "bob@beta.test", "owner");
  const ann = w.browser(), mia = w.browser(), bob = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(2, "mia@alpha.test")); await bob.signIn(w.user(3, "bob@beta.test"));
  const call = async (path, { method = "GET", json } = {}) => {
    const h = { Origin: ADMIN_ORIGIN, "Cf-Access-Jwt-Assertion": sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: nowS(), exp: nowS() + 600 }), ...(method !== "GET" ? { "X-Framework-Admin": "1" } : {}) };
    let body;
    if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    const res = await handleAdmin(new Request(ADMIN_ORIGIN + "/api/admin" + path, { method, headers: h, body }), w.env, {});
    return { status: res.status, json: (res.headers.get("Content-Type") || "").includes("json") ? await res.json() : null };
  };
  const site = async (org, over = {}) => { const r = await sites.createWebsite(w.db, org.id, { name: "Main website", url: "https://alpha.example.ca", origin: "client", status: "live", published: true, ...over }, ADMIN); assert.ok(r.ok, JSON.stringify(r)); return r.id; };
  const page = async (b, slug, id) => (await b.get(`/portal/o/${slug}/website/${id}`));
  const csrf = async (b, slug, id) => /name="csrf" value="([^"]+)"/.exec(await (await page(b, slug, id)).text())[1];
  const post = async (b, slug, path, fields, { token, id } = {}) => b.post(`/portal/o/${slug}${path}`, { csrf: token ?? await csrf(b, slug, id), ...fields });
  const ws = (org, id, p = "") => `/clients/${org.id}/websites/${id}/workspace${p}`;
  return { w, A, B, ann, mia, bob, call, site, page, csrf, post, ws };
}
const text = async (r) => r.text();

test("environments: Production and Staging cards, a quick action on each; Staging is the review environment; a website that has not launched says so", async () => {
  const s = await setup();
  const id = await s.site(s.A);
  let h = await text(await s.page(s.ann, "alpha", id));
  assert.match(h, /Main · Production/); assert.match(h, /Staging · Review here/);
  assert.match(h, /View live site/); assert.match(h, /href="https:\/\/alpha\.example\.ca\/?"/); assert.match(h, /Not set up yet/);
  assert.ok(!/View staging/.test(h), "no staging address, no staging button");
  assert.ok((await s.call(s.ws(s.A, id, "/staging"), { method: "POST", json: { staging_url: "https://staging.alpha.example.ca" } })).status === 200);
  h = await text(await s.page(s.ann, "alpha", id));
  assert.match(h, /View staging/); assert.match(h, /href="https:\/\/staging\.alpha\.example\.ca\/?"/); assert.match(h, /target="_blank" rel="noopener noreferrer"/);
  const dev = await s.site(s.A, { name: "New site", status: "in_development", origin: "framework", url: null });
  const d = await text(await s.page(s.ann, "alpha", dev));
  assert.match(d, /Not launched/); assert.ok(!/View live site/.test(d), "an unlaunched website has no live link");
  for (const bad of ["http://staging.alpha.example.ca", "javascript:alert(1)", "https://u:p@alpha.example.ca", "https://a b.example.ca", "nonsense"]) assert.equal((await s.call(s.ws(s.A, id, "/staging"), { method: "POST", json: { staging_url: bad } })).status, 422, bad);
  assert.equal((await s.call(s.ws(s.A, id, "/staging"), { method: "POST", json: { staging_url: "" } })).status, 200); // clearing it
  assert.match(await text(await s.page(s.ann, "alpha", id)), /Not set up yet/);
});

test("updates: a draft is invisible; a published approval update shows Approve and Reject to an owner, only the status to a member; another organization sees nothing", async () => {
  const s = await setup();
  const id = await s.site(s.A);
  const created = await s.call(s.ws(s.A, id, "/updates"), { method: "POST", json: { title: "Homepage layout updated", detail: "New hero and spacing.", environment: "staging", kind: "approval", published: false } });
  assert.equal(created.status, 201); const uid = created.json.id;
  assert.ok(!(await text(await s.page(s.ann, "alpha", id))).includes("Homepage layout updated"), "a draft is invisible to the client");
  assert.equal((await s.call(s.ws(s.A, id, `/updates/${uid}/update`), { method: "POST", json: { published: true } })).status, 200);
  const owner = await text(await s.page(s.ann, "alpha", id));
  assert.match(owner, /Homepage layout updated/); assert.match(owner, /New hero and spacing\./); assert.match(owner, /Awaiting review/); assert.match(owner, /Staging<\/span>/);
  assert.match(owner, new RegExp(`action="/portal/o/alpha/website/${id}/updates/${uid}/approve"`)); assert.match(owner, new RegExp(`action="/portal/o/alpha/website/${id}/updates/${uid}/reject"`));
  assert.match(owner, /<textarea[^>]*name="note"[^>]*required/, "a rejection asks why");
  const member = await text(await s.page(s.mia, "alpha", id));
  assert.match(member, /Homepage layout updated/); assert.ok(!/updates\/[^"]+\/approve/.test(member) && /An account owner can approve or reject/.test(member), "members see it but do not decide");
  assert.equal((await s.page(s.bob, "beta", id)).status, 404, "another organization cannot open this website's page at all");
  const info = await s.call(s.ws(s.A, id, "/updates"), { method: "POST", json: { title: "Footer links tidied", kind: "info", published: true } });
  const o2 = await text(await s.page(s.ann, "alpha", id)); assert.match(o2, /Informational/); assert.ok(!new RegExp(`updates/${info.json.id}/approve`).test(o2), "an informational update has no buttons");
});

test("approve: one decision, audited; a second click, a replay and a forged id change nothing", async () => {
  const s = await setup();
  const id = await s.site(s.A);
  const uid = (await s.call(s.ws(s.A, id, "/updates"), { method: "POST", json: { title: "Services page refined", published: true } })).json.id;
  const r = await s.post(s.ann, "alpha", `/website/${id}/updates/${uid}/approve`, {}, { id });
  assert.equal(r.status, 303); assert.match(r.headers.get("Location"), /flash=approved/);
  const row = rows(s.w, "SELECT status, decided_by, decision_note FROM website_updates WHERE id = ?", uid)[0];
  assert.deepEqual(row, { status: "approved", decided_by: "ann@alpha.test", decision_note: null });
  assert.equal(rows(s.w, "SELECT COUNT(*) n FROM activity_log WHERE action = 'website.update.approved' AND entity_id = ?", uid)[0].n, 1);
  const again = await s.post(s.ann, "alpha", `/website/${id}/updates/${uid}/approve`, {}, { id });
  assert.match(again.headers.get("Location"), /err=already_decided/); assert.equal(rows(s.w, "SELECT COUNT(*) n FROM activity_log WHERE action IN ('website.update.approved', 'website.update.rejected') AND entity_id = ?", uid)[0].n, 1, "no second decision, no second audit row");
  const rej = await s.post(s.ann, "alpha", `/website/${id}/updates/${uid}/reject`, { note: "I changed my mind" }, { id });
  assert.match(rej.headers.get("Location"), /err=already_decided/); assert.equal(rows(s.w, "SELECT status FROM website_updates WHERE id = ?", uid)[0].status, "approved", "an approved update cannot be flipped by a replay");
  assert.equal((await s.post(s.ann, "alpha", `/website/${id}/updates/${UUID0}/approve`, {}, { id })).status, 404);
  assert.match(await text(await s.page(s.ann, "alpha", id)), /Approved/);
});

test("reject: revision notes are required, kept, shown to Admin; Admin can ask for another review and the earlier decision stays on record", async () => {
  const s = await setup();
  const id = await s.site(s.A);
  const uid = (await s.call(s.ws(s.A, id, "/updates"), { method: "POST", json: { title: "Mobile spacing improved", published: true } })).json.id;
  for (const note of ["", "  ", "no"]) { const r = await s.post(s.ann, "alpha", `/website/${id}/updates/${uid}/reject`, { note }, { id }); assert.match(r.headers.get("Location"), /err=invalid_note/, JSON.stringify(note)); }
  assert.equal(rows(s.w, "SELECT status FROM website_updates WHERE id = ?", uid)[0].status, "awaiting_review", "a rejection without notes changes nothing");
  assert.match(await text(await s.ann.get(`/portal/o/alpha/website/${id}?err=invalid_note`)), /Please say what should change/, "the page says what went wrong, in words");
  const r = await s.post(s.ann, "alpha", `/website/${id}/updates/${uid}/reject`, { note: "The menu overlaps the logo on a phone." }, { id });
  assert.match(r.headers.get("Location"), /flash=rejected/);
  const mine = await text(await s.page(s.ann, "alpha", id)); assert.match(mine, /Rejected/); assert.match(mine, /The menu overlaps the logo on a phone\./); assert.ok(!new RegExp(`updates/${uid}/approve`).test(mine), "a rejected update has no buttons until Framework asks again");
  const admin = (await s.call(s.ws(s.A, id))).json; const u = admin.updates.find((x) => x.id === uid);
  assert.equal(u.status, "rejected"); assert.equal(u.decisionNote, "The menu overlaps the logo on a phone."); assert.equal(u.decidedBy, "ann@alpha.test");
  assert.equal((await s.call(s.ws(s.A, id, `/updates/${uid}/review`), { method: "POST", json: {} })).status, 200);
  const after = (await s.call(s.ws(s.A, id))).json.updates.find((x) => x.id === uid); assert.equal(after.status, "awaiting_review"); assert.equal(after.decisionNote, null);
  assert.match(rows(s.w, "SELECT detail FROM activity_log WHERE action = 'website.update.rejected' AND entity_id = ?", uid)[0].detail, /menu overlaps the logo/, "the earlier rejection reason stays on record");
  assert.match(await text(await s.page(s.ann, "alpha", id)), new RegExp(`updates/${uid}/approve`), "and the client can decide again");
});

test("tasks: Needed from you: published ones only, a due date, a written answer by anyone in the organization, then done; upload tasks open the request form; escaped output", async () => {
  const s = await setup();
  const id = await s.site(s.A);
  await s.call(s.ws(s.A, id, "/staging"), { method: "POST", json: { staging_url: "https://staging.alpha.example.ca" } });
  const draft = (await s.call(s.ws(s.A, id, "/tasks"), { method: "POST", json: { title: "Draft task", cta: "respond" } })).json.id;
  const t = (await s.call(s.ws(s.A, id, "/tasks"), { method: "POST", json: { title: "Updated service description <img src=x onerror=alert(1)>", detail: "A paragraph for the Services page.", cta: "respond", due_date: "2099-12-03", published: true } })).json.id;
  const up = (await s.call(s.ws(s.A, id, "/tasks"), { method: "POST", json: { title: "Hydroelectric project photo", cta: "upload", published: true } })).json.id;
  const rv = (await s.call(s.ws(s.A, id, "/tasks"), { method: "POST", json: { title: "Approve homepage content", cta: "review", published: true } })).json.id;
  let h = await text(await s.page(s.mia, "alpha", id));
  assert.ok(!h.includes("Draft task"), "an unpublished task is invisible"); assert.ok(!h.includes("<img src=x"), "titles are escaped"); assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(h, /Due Dec 3, 2099/); assert.match(h, /Needed/);
  assert.match(h, new RegExp(`/website/${id}/requests/new\\?kind=change&amp;title=Hydroelectric%20project%20photo`), "Upload files opens the request form that accepts files");
  assert.match(h, /View staging/, "a review task points at staging");
  const form = await text(await s.mia.get(`/portal/o/alpha/website/${id}/requests/new?kind=change&title=Hydroelectric%20project%20photo`)); assert.match(form, /value="Hydroelectric project photo"/, "and the title is prefilled");
  const r = await s.post(s.mia, "alpha", `/website/${id}/tasks/${t}/respond`, { text: "Here is the text: we design and build websites." }, { id });
  assert.match(r.headers.get("Location"), /flash=answered/);
  assert.deepEqual(rows(s.w, "SELECT status, response_text, responded_by FROM website_tasks WHERE id = ?", t)[0], { status: "submitted", response_text: "Here is the text: we design and build websites.", responded_by: "mia@alpha.test" });
  assert.match(await text(await s.page(s.ann, "alpha", id)), /Sent to Framework/); assert.match(await text(await s.page(s.ann, "alpha", id)), /We design|we design and build/);
  assert.match((await s.post(s.mia, "alpha", `/website/${id}/tasks/${t}/respond`, { text: "" }, { id })).headers.get("Location"), /err=invalid_text/);
  assert.match((await s.post(s.mia, "alpha", `/website/${id}/tasks/${up}/respond`, { text: "x" }, { id })).headers.get("Location"), /err=not_found/, "an upload task takes no written answer");
  assert.equal((await s.post(s.mia, "alpha", `/website/${id}/tasks/${draft}/respond`, { text: "x" }, { id })).headers.get("Location").includes("err=not_found"), true, "nor does a draft");
  const admin = (await s.call(s.ws(s.A, id))).json.tasks.find((x) => x.id === t); assert.equal(admin.status, "submitted"); assert.match(admin.responseText, /we design and build/);
  assert.equal((await s.call(s.ws(s.A, id, `/tasks/${t}/update`), { method: "POST", json: { status: "done" } })).status, 200);
  assert.match((await s.post(s.mia, "alpha", `/website/${id}/tasks/${t}/respond`, { text: "late" }, { id })).headers.get("Location"), /err=not_found/, "a finished task cannot be answered again");
  assert.equal(rows(s.w, "SELECT status FROM website_tasks WHERE id = ?", t)[0].status, "done");
  assert.equal((await s.call(s.ws(s.A, id, `/tasks/${t}/update`), { method: "POST", json: { status: "submitted" } })).status, 422, "Admin cannot fake the client's answer");
  assert.ok(rv);
});

test("security: CSRF is required, another organization and master access can never decide or answer, nothing is inline, and the CSP is still script-free", async () => {
  const s = await setup();
  const id = await s.site(s.A);
  const uid = (await s.call(s.ws(s.A, id, "/updates"), { method: "POST", json: { title: "A", published: true } })).json.id;
  const tid = (await s.call(s.ws(s.A, id, "/tasks"), { method: "POST", json: { title: "T", cta: "respond", published: true } })).json.id;
  assert.equal((await s.ann.post(`/portal/o/alpha/website/${id}/updates/${uid}/approve`, { csrf: "forged" })).status, 403);
  assert.equal((await s.ann.post(`/portal/o/alpha/website/${id}/tasks/${tid}/respond`, { csrf: "forged", text: "x" })).status, 403);
  assert.equal((await s.bob.post(`/portal/o/beta/website/${id}/updates/${uid}/approve`, { csrf: "x" })).status, 403, "bob's own session has a different CSRF token for any organization");
  const bobTok = /name="csrf" value="([^"]+)"/.exec(await text(await s.bob.get("/portal/o/beta")) + 'name="csrf" value="x"')?.[1] || "x";
  assert.ok([403, 404].includes((await s.bob.post(`/portal/o/beta/website/${id}/updates/${uid}/approve`, { csrf: bobTok })).status), "another organization's website id is never found");
  assert.equal(rows(s.w, "SELECT status FROM website_updates WHERE id = ?", uid)[0].status, "awaiting_review");
  const res = await s.ann.get(`/portal/o/alpha/website/${id}`); const h = await res.text();
  assert.ok(noInline(h), "no inline style, script or handler"); assert.equal(res.headers.get("Content-Security-Policy"), PORTAL_CSP, "the strict script-free CSP is unchanged");
  assert.match(h, /portal-website-workspace\.css/);
  const getRoute = await s.ann.get(`/portal/o/alpha/website/${id}/updates/${uid}/approve`); assert.ok([302, 303].includes(getRoute.status), "a GET never decides anything"); assert.equal(rows(s.w, "SELECT status FROM website_updates WHERE id = ?", uid)[0].status, "awaiting_review");
  // master access previews the page but does not decide for the client
  const staff = s.w.browser(); await staff.signIn(s.w.user(9, "hello@frameworkco.ca"));
  const sp = await staff.get(`/portal/o/alpha/website/${id}`); const sh = await sp.text(); assert.equal(sp.status, 200);
  assert.ok(!/updates\/[^"]+\/approve/.test(sh) && /Only the client’s account owner can approve or reject/.test(sh), "staff see the update but get no decision buttons");
  const tok = /name="csrf" value="([^"]+)"/.exec(sh)[1];
  assert.equal((await staff.post(`/portal/o/alpha/website/${id}/updates/${uid}/approve`, { csrf: tok })).status, 403, "and the server refuses a forged one");
  assert.equal(rows(s.w, "SELECT status FROM website_updates WHERE id = ?", uid)[0].status, "awaiting_review");
});

test("request changes: the form is on the page, posts to the existing change-request workflow, and lands in the same queue", async () => {
  const s = await setup();
  const id = await s.site(s.A);
  const h = await text(await s.page(s.mia, "alpha", id));
  assert.match(h, /Request changes/); assert.match(h, new RegExp(`action="/portal/o/alpha/website/${id}/requests"`)); assert.match(h, /enctype="multipart\/form-data"/); assert.match(h, /type="file"/); assert.match(h, /<option value="change">/);
  const fd = new FormData(); fd.set("csrf", await s.csrf(s.mia, "alpha", id)); fd.set("kind", "change"); fd.set("title", "New opening hours"); fd.set("description", "Footer hours changed.");
  const r = await s.mia.send(`/portal/o/alpha/website/${id}/requests`, { method: "POST", body: fd, headers: { "Sec-Fetch-Site": "same-origin", Origin: PORTAL_ORIGIN } });
  assert.equal(r.status, 303); assert.match(r.headers.get("Location"), /\/website\/requests\//);
  assert.deepEqual(rows(s.w, "SELECT category, website_id, title FROM support_requests")[0], { category: "website_change", website_id: id, title: "New opening hours" });
});

test("without migration 0030 the page still works: environments and the request form, no updates or tasks, Admin says it is unavailable", async () => {
  const s = await setup({ m30: false });
  const id = await s.site(s.A);
  const res = await s.ann.get(`/portal/o/alpha/website/${id}`); const h = await res.text();
  assert.equal(res.status, 200); assert.match(h, /Main · Production/); assert.match(h, /Not set up yet/); assert.match(h, /Request changes/);
  assert.ok(!/Updates &amp; requests|Needed from you|Website updates/.test(h), "the updates section is simply absent");
  assert.deepEqual((await s.call(s.ws(s.A, id))).json, { available: false, website: { id, name: "Main website", url: "https://alpha.example.ca/", status: "live", published: true }, capabilities: { writes: true }, labels: { update: wk.UPDATE_STATUS_LABEL, task: wk.TASK_STATUS_LABEL } });
  assert.equal((await s.call(s.ws(s.A, id, "/updates"), { method: "POST", json: { title: "x" } })).status, 409, "writes say 'unavailable', not a server error");
  assert.equal((await s.call(s.ws(s.A, id, "/staging"), { method: "POST", json: { staging_url: "https://staging.alpha.example.ca" } })).status, 409);
  assert.equal((await wk.getWorkspaceForClient(s.w.db, s.A.id, id)).available, false);
});

test("Admin API: Access and the writes flag still apply, only known fields and values, only this website, the limits hold", async () => {
  const s = await setup();
  const id = await s.site(s.A), other = await s.site(s.B, { name: "Beta site", url: "https://beta.example.ca" });
  assert.equal((await s.call(s.ws(s.A, other))).status, 404, "another organization's website is not found through this organization");
  assert.equal((await s.call(s.ws(s.A, UUID0))).status, 404); assert.equal((await s.call(`/clients/${UUID0}/websites/${id}/workspace`)).status, 404);
  for (const [path, json, status] of [["/updates", { title: "", published: true }, 422], ["/updates", { title: "x", environment: "live" }, 422], ["/updates", { title: "x", kind: "maybe" }, 422], ["/updates", { title: "x", published: "yes" }, 422], ["/updates", { title: "x", rogue: 1 }, 400],
    ["/updates", { title: "x".repeat(121) }, 422], ["/updates", { title: "x", detail: "y".repeat(601) }, 422], ["/tasks", { title: "x", cta: "email" }, 422], ["/tasks", { title: "x", due_date: "2026-02-30" }, 422], ["/tasks", { title: "x", status: "open" }, 400], ["/tasks", { title: "x\nrow" }, 422]]) {
    assert.equal((await s.call(s.ws(s.A, id, path), { method: "POST", json })).status, status, JSON.stringify(json));
  }
  assert.equal(rows(s.w, "SELECT COUNT(*) n FROM website_updates")[0].n + rows(s.w, "SELECT COUNT(*) n FROM website_tasks")[0].n, 0, "nothing invalid was stored");
  const mine = (await s.call(s.ws(s.A, id, "/updates"), { method: "POST", json: { title: "Mine" } })).json.id;
  assert.equal((await s.call(s.ws(s.B, other, `/updates/${mine}/update`), { method: "POST", json: { title: "Hijack" } })).status, 404, "another organization's Admin path cannot edit it");
  assert.equal((await s.call(s.ws(s.A, other, `/updates/${mine}/update`), { method: "POST", json: { title: "Hijack" } })).status, 404, "nor via another website");
  assert.equal(rows(s.w, "SELECT title FROM website_updates WHERE id = ?", mine)[0].title, "Mine");
  s.w.env.PORTAL_ADMIN_WRITES = "0"; assert.equal((await s.call(s.ws(s.A, id, "/updates"), { method: "POST", json: { title: "x" } })).status, 403, "writes are off unless the flag is on"); s.w.env.PORTAL_ADMIN_WRITES = "1";
  assert.equal((await s.call(s.ws(s.A, id), { method: "POST", json: {} })).status, 405);
  for (let i = 0; i < wk.MAX_UPDATES - 1; i++) await wk.createUpdate(s.w.db, s.A.id, id, { title: "u" + i }, ADMIN);
  assert.equal((await s.call(s.ws(s.A, id, "/updates"), { method: "POST", json: { title: "one too many" } })).status, 409, "a website holds a fixed number of updates");
  assert.equal((await s.call(s.ws(s.A, id, `/updates/${mine}/archive`), { method: "POST", json: {} })).status, 200);
  assert.ok(!(await s.call(s.ws(s.A, id))).json.updates.some((u) => u.id === mine), "an archived update leaves the list");
});

test("data layer: a decision is a single compare-and-set (two at once: exactly one wins), and kind changes reset the decision", async () => {
  const s = await setup();
  const id = await s.site(s.A);
  const { id: uid } = await wk.createUpdate(s.w.db, s.A.id, id, { title: "Race", published: true }, ADMIN);
  const who = { userId: "u", email: "ann@alpha.test" };
  const [a, b] = await Promise.all([wk.decideUpdate(s.w.db, s.A.id, id, uid, { decision: "approve" }, who), wk.decideUpdate(s.w.db, s.A.id, id, uid, { decision: "reject", note: "nope, thanks" }, who)]);
  assert.equal([a, b].filter((r) => r.ok).length, 1, JSON.stringify([a, b]));
  assert.equal(rows(s.w, "SELECT COUNT(*) n FROM activity_log WHERE entity_id = ? AND action IN ('website.update.approved', 'website.update.rejected')", uid)[0].n, 1);
  assert.deepEqual(await wk.decideUpdate(s.w.db, s.B.id, id, uid, { decision: "approve" }, who), { ok: false, error: "not_found" }, "the wrong organization");
  assert.equal((await wk.decideUpdate(s.w.db, s.A.id, id, uid, { decision: "maybe" }, who)).error, "invalid_decision");
  assert.equal((await wk.updateUpdate(s.w.db, s.A.id, id, uid, { kind: "info" }, ADMIN)).ok, true);
  assert.deepEqual(rows(s.w, "SELECT kind, status, decided_at, decision_note FROM website_updates WHERE id = ?", uid)[0], { kind: "info", status: "info", decided_at: null, decision_note: null }, "an informational update has no decision");
  assert.equal((await wk.decideUpdate(s.w.db, s.A.id, id, uid, { decision: "approve" }, who)).error, "not_found", "and cannot be approved: it is not an approval update");
  assert.deepEqual(await wk.workspaceAttention(s.w.db, s.A.id), { updates: 0, tasks: 0 });
  await wk.createTask(s.w.db, s.A.id, id, { title: "T", published: true }, ADMIN); await wk.createUpdate(s.w.db, s.A.id, id, { title: "U", published: true }, ADMIN);
  assert.deepEqual(await wk.workspaceAttention(s.w.db, s.A.id), { updates: 1, tasks: 1 });
  assert.deepEqual(await wk.workspaceAttention(s.w.db, s.B.id), { updates: 0, tasks: 0 });
});

test("the migration is additive and proposed: one column and two tables, nothing dropped or rewritten, not in the applied folder", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const sql = readFileSync(new URL("../../migrations/portal-proposed/0030_website_workspace.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
  assert.ok(!/\bDROP\b|\bDELETE FROM\b|\bUPDATE\s+\w+\s+SET\b|\bRENAME\b/i.test(sql), "nothing is dropped, deleted or rewritten");
  assert.deepEqual([...sql.matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+)/g)].map((m) => `${m[1]}.${m[2]}`), ["websites.staging_url"]);
  assert.deepEqual([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]).sort(), ["website_tasks", "website_updates"]);
  assert.ok(!existsSync(new URL("../../migrations/portal/0030_website_workspace.sql", import.meta.url)), "not applied: it waits in migrations/portal-proposed/");
  const s = await setup();
  const id = await s.site(s.A);
  assert.throws(() => s.w.db.raw.prepare("INSERT INTO website_updates (id, organization_id, website_id, title, kind, status, decided_at, decision_note) VALUES (?, ?, ?, 'x', 'approval', 'rejected', ?, NULL)").run(crypto.randomUUID(), s.A.id, id, "2026-01-01T00:00:00Z"), /constraint/i, "the database itself refuses a rejection without a reason");
  assert.throws(() => s.w.db.raw.prepare("INSERT INTO website_updates (id, organization_id, website_id, title) VALUES (?, ?, ?, 'x')").run(crypto.randomUUID(), s.B.id, id), /FOREIGN KEY|constraint/i, "and a row naming another organization's website");
});
