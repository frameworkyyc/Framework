/* Branding dashboard requests: every client sees the same five sections plus the Full Brand Kit request; an owner can request additions or changes in any of them
   (empty or not); the request is stored in the existing service_requests table, linked to the right organization and person, and visible in Framework Admin;
   a second press never creates a duplicate; members and other organizations are kept out. */
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld, csrfOf } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as brand from "../portal/repo/brand.js";
import * as B from "../portal/brand-files.js";
import { PORTAL_CSP } from "../portal/http.js";
import { BRAND_REQUESTS, brandingService, isKnownBrandingService } from "../portal/brand-services.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ADMIN_ORIGIN = "https://staging.frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const nowS = () => Math.floor(Date.now() / 1000);
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
const ADMIN = "owner@frameworkco.ca";
const rowsOf = (w, q, ...p) => w.db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const base = (s) => `/portal/o/${s}/branding`;

async function setup() {
  resetKeyCacheForTests();
  const w = await makeWorld();
  const bucket = fakeR2();
  Object.assign(w.env, { PORTAL_BRANDING: "1", PORTAL_FILES: bucket, PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) });
  const alpha = await w.org("alpha", "Alpha Co"), beta = await w.org("beta", "Beta Co");
  await w.invite(alpha, "ann@alpha.test", "owner"); await w.invite(alpha, "mia@alpha.test", "member"); await w.invite(beta, "bob@beta.test", "owner");
  const ann = w.browser(), mia = w.browser(), bob = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(2, "mia@alpha.test")); await bob.signIn(w.user(3, "bob@beta.test"));
  const csrf = async (b, slug) => csrfOf(await (await b.get(base(slug))).text());
  const send = async (b, slug, fields = {}, token) => b.post(`${base(slug)}/request`, { csrf: token === undefined ? await csrf(b, slug) : token, ...fields });
  const admin = async (path, { method = "GET", json } = {}) => {
    const h = { Origin: ADMIN_ORIGIN, "Cf-Access-Jwt-Assertion": sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, exp: nowS() + 600, iat: nowS() }), ...(method !== "GET" ? { "X-Framework-Admin": "1", "Content-Type": "application/json" } : {}) };
    const res = await handleAdmin(new Request(ADMIN_ORIGIN + "/api/admin" + path, { method, headers: h, body: json === undefined ? undefined : JSON.stringify(json) }), w.env, {});
    return { status: res.status, json: await res.json() };
  };
  return { w, bucket, alpha, beta, ann, mia, bob, csrf, send, admin };
}

test("the catalogue: six section request keys plus one per priced design service, all valid stored keys, known to the server and titled for Admin", () => {
  assert.deepEqual(BRAND_REQUESTS.slice(0, 6).map((r) => r.key), ["brand-logos", "brand-colours", "brand-typography", "brand-guidelines", "brand-additional", "brand-full-kit"]);
  assert.deepEqual(BRAND_REQUESTS.slice(6).map((r) => r.key), ["logo-primary", "logo-secondary", "logo-simplified", "logo-submark", "typography", "colours", "tagline", "imagery", "layout", "textures", "iconography", "style"].map((k) => "brand-svc-" + k), "the complete kit keeps brand-full-kit");
  for (const r of BRAND_REQUESTS) { assert.match(r.key, /^[a-z0-9-]{2,60}$/); assert.ok(isKnownBrandingService(r.key)); assert.match(brandingService(r.key).title, /^(Brand|Design) request: /); }
  assert.equal(isKnownBrandingService("brand-everything"), false); assert.equal(isKnownBrandingService("__proto__"), false);
  assert.ok(isKnownBrandingService("business-card-design"), "the earlier quote services still exist");
});

test("an owner requests an empty section: the request is stored for the right organization and person, the page shows its status instead of a button, and it is audited", async () => {
  const { w, alpha, ann, send } = await setup();
  const res = await send(ann, "alpha", { section: "brand-logos", note: "We need a primary and an icon version." });
  assert.equal(res.status, 303); assert.equal(res.headers.get("Location"), `${base("alpha")}?requested=1`);
  const r = rowsOf(w, "SELECT organization_id, service_key, status, note, requested_by FROM service_requests");
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].organization_id, r[0].service_key, r[0].status, r[0].note], [alpha.id, "brand-logos", "new", "We need a primary and an icon version."]);
  assert.equal(r[0].requested_by, rowsOf(w, "SELECT id FROM portal_users WHERE email = 'ann@alpha.test'")[0].id);
  assert.equal(rowsOf(w, "SELECT count(*) n FROM activity_log WHERE action = 'service.requested' AND organization_id = ?", alpha.id)[0].n, 1);
  const html = await (await ann.get(res.headers.get("Location"))).text();
  assert.match(html, /Request sent\. Framework will follow up\./);
  const logos = html.slice(html.indexOf('id="logo"'), html.indexOf('id="typography"'));
  assert.match(logos, /class="tag">Requested</); assert.ok(!/<summary class="btn/.test(logos), "no button while the request is open");
  assert.match(html.slice(html.indexOf('id="colours"'), html.indexOf('id="tagline"')), /<summary class="btn btn--primary">Request Design<span/, "other sections keep their button");
});

test("no accidental duplicates: pressing it again, or twice at once, leaves exactly one open request and says so", async () => {
  const { w, ann, send } = await setup();
  const again = await send(ann, "alpha", { section: "brand-colours" });
  assert.equal(again.headers.get("Location"), `${base("alpha")}?requested=1`);
  const dup = await send(ann, "alpha", { section: "brand-colours" });
  assert.equal(dup.status, 303); assert.equal(dup.headers.get("Location"), `${base("alpha")}?requested=0`);
  assert.match(await (await ann.get(dup.headers.get("Location"))).text(), /already open, so we didn’t send it twice/);
  const token = await (async () => csrfOf(await (await ann.get(base("alpha"))).text()))();
  const both = await Promise.all([send(ann, "alpha", { section: "brand-typography" }, token), send(ann, "alpha", { section: "brand-typography" }, token)]);
  assert.deepEqual(both.map((r) => r.status), [303, 303]);
  assert.equal(rowsOf(w, "SELECT count(*) n FROM service_requests WHERE service_key IN ('brand-colours', 'brand-typography')")[0].n, 2, "one per section");
});

test("sections that already have files also offer 'Request additions or changes'", async () => {
  const { w, bucket, alpha, ann } = await setup();
  const deps = { db: w.db, bucket, env: w.env, now: w.clock.now() };
  const up = await B.adminUploadAsset(deps, { organizationId: alpha.id, actor: ADMIN, meta: { kind: "logo", logo_role: "primary", orientation: "square", tone: "light", published: true }, file: { name: "a.png", bytes: S.png() } });
  assert.ok(up.ok);
  await brand.saveBrandKit(w.db, alpha.id, { colours: [{ name: "Ink", role: "primary", hex: "#0A0A0A", note: "" }] }, ADMIN);
  await brand.setBrandKitStatus(w.db, alpha.id, "published", ADMIN);
  const html = await (await ann.get(base("alpha"))).text();
  const sec = (id, next) => html.slice(html.indexOf(`id="${id}"`), html.indexOf(`id="${next}"`));
  assert.match(sec("logo", "typography"), /Download PNG/); assert.match(sec("logo", "typography"), /Request additions or changes/);
  assert.match(sec("colours", "tagline"), /data-copy="#0A0A0A"/); assert.match(sec("colours", "tagline"), /Request additions or changes/);
  assert.match(sec("typography", "colours"), /Not added yet/);
  assert.equal((await ann.post(`${base("alpha")}/request`, { csrf: csrfOf(html), section: "brand-logos" })).status, 303);
  assert.match(await (await ann.get(base("alpha"))).text(), /class="tag">Requested</);
});

test("after Admin closes or declines a request the button returns and a new one can be sent; an in-progress one still shows its status", async () => {
  const { w, alpha, ann, send, admin } = await setup();
  await send(ann, "alpha", { section: "brand-guidelines" });
  const id = rowsOf(w, "SELECT id FROM service_requests")[0].id;
  assert.equal((await admin(`/clients/${alpha.id}/branding/requests/${id}/update`, { method: "POST", json: { status: "contacted", admin_note: "We emailed you." } })).status, 200);
  let html = await (await ann.get(base("alpha"))).text();
  assert.match(html, /class="tag">In progress</); assert.match(html, /Framework has been in touch/);
  assert.equal((await send(ann, "alpha", { section: "brand-guidelines" })).headers.get("Location"), `${base("alpha")}?requested=0`, "still open: no second request");
  await admin(`/clients/${alpha.id}/branding/requests/${id}/update`, { method: "POST", json: { status: "closed", admin_note: null } });
  html = await (await ann.get(base("alpha"))).text();
  assert.match(html, /class="tag">Closed</); assert.match(html.slice(html.indexOf('id="guidelines"'), html.indexOf('id="additional"')), /<summary class="btn btn--small">Request<span/);
  assert.equal((await send(ann, "alpha", { section: "brand-guidelines" })).headers.get("Location"), `${base("alpha")}?requested=1`);
  assert.equal(rowsOf(w, "SELECT count(*) n FROM service_requests WHERE service_key = 'brand-guidelines'")[0].n, 2);
});

test("Full Brand Kit: a prominent request at the bottom of the page, sent like any other", async () => {
  const { w, ann, send } = await setup();
  let html = await (await ann.get(base("alpha"))).text();
  assert.ok(html.indexOf('id="h-kit"') > html.indexOf('id="additional"'), "it comes last");
  assert.match(html, /<summary class="btn btn--primary">Request full brand kit/);
  const res = await send(ann, "alpha", { section: "brand-full-kit", note: "" });
  assert.equal(res.headers.get("Location"), `${base("alpha")}?requested=1`);
  assert.equal(rowsOf(w, "SELECT note FROM service_requests WHERE service_key = 'brand-full-kit'")[0].note, null, "an empty note is stored as nothing");
  html = await (await ann.get(base("alpha"))).text();
  assert.match(html.slice(html.indexOf('id="h-kit"')), /class="tag">Requested</);
});

test("Admin sees every request with its section, status and note, linked to the right client", async () => {
  const { alpha, beta, ann, bob, send, admin } = await setup();
  await send(ann, "alpha", { section: "brand-additional", note: "Social media templates" });
  await send(bob, "beta", { section: "brand-full-kit" });
  const a = await admin(`/clients/${alpha.id}/branding`);
  assert.equal(a.status, 200);
  assert.deepEqual(a.json.requests.map((r) => [r.serviceKey, r.service, r.status, r.note]), [["brand-additional", "Brand request: Additional Brand Assets", "new", "Social media templates"]]);
  const b = await admin(`/clients/${beta.id}/branding`);
  assert.deepEqual(b.json.requests.map((r) => r.serviceKey), ["brand-full-kit"]);
});

test("permissions and isolation: a member cannot send (403, nothing stored); a bad, missing or foreign CSRF token, an unknown section or an over-long note change nothing; the organization always comes from the session", async () => {
  const { w, alpha, beta, ann, mia, bob, send, csrf } = await setup();
  assert.equal((await send(mia, "alpha", { section: "brand-logos" })).status, 403);
  assert.match(await (await mia.get(base("alpha"))).text(), /Ask an owner of your organization/);
  for (const token of [null, "", "garbage", await csrf(bob, "beta")]) assert.equal((await send(ann, "alpha", { section: "brand-logos" }, token)).status, 403, String(token).slice(0, 6));
  assert.equal((await send(ann, "alpha", { section: "brand-everything" })).status, 400);
  assert.equal((await send(ann, "alpha", { section: "" })).status, 400);
  assert.equal((await send(ann, "alpha", { section: "brand-logos", note: "x".repeat(1001) })).status, 400);
  assert.equal(rowsOf(w, "SELECT count(*) n FROM service_requests")[0].n, 0, "none of the refused attempts stored anything");
  // an owner of another organization cannot act on alpha, and fabricated organization fields are ignored
  assert.equal((await bob.post(`${base("alpha")}/request`, { csrf: await csrf(bob, "beta"), section: "brand-logos" })).status, 404);
  const sent = await send(bob, "beta", { section: "brand-logos", organization_id: alpha.id, organization: "alpha", slug: "alpha" });
  assert.equal(sent.status, 303);
  assert.deepEqual(rowsOf(w, "SELECT organization_id, service_key FROM service_requests"), [{ organization_id: beta.id, service_key: "brand-logos" }]);
  assert.ok(!/class="tag">Requested</.test(await (await ann.get(base("alpha"))).text()), "alpha does not see beta's request");
  assert.equal(rowsOf(w, "SELECT count(*) n FROM service_requests WHERE organization_id = ?", alpha.id)[0].n, 0);
});

test("a request needs an active member: a removed owner can no longer send, and a GET never sends anything", async () => {
  const { w, alpha, ann } = await setup();
  assert.equal((await ann.get(`${base("alpha")}/request`)).status, 303, "a GET only redirects");
  assert.equal(rowsOf(w, "SELECT count(*) n FROM service_requests")[0].n, 0);
  const token = csrfOf(await (await ann.get(base("alpha"))).text());
  w.db.raw.prepare("UPDATE memberships SET status = 'revoked', revoked_at = '2026-10-28T00:00:00.000Z', revoked_by = 'admin@framework.test' WHERE organization_id = ? AND user_id = (SELECT id FROM portal_users WHERE email = 'ann@alpha.test')").run(alpha.id);
  const res = await ann.post(`${base("alpha")}/request`, { csrf: token, section: "brand-logos" });
  assert.notEqual(res.status, 303);
  assert.equal(rowsOf(w, "SELECT count(*) n FROM service_requests")[0].n, 0);
});

test("the request area is plain, scriptless HTML: no inline script or style, a labelled note field, native details; the note is never echoed back", async () => {
  const { ann, send } = await setup();
  await send(ann, "alpha", { section: "brand-logos", note: "<script>alert(1)</script>" });
  const res = await ann.get(base("alpha"));
  const html = await res.text();
  assert.ok(!html.includes("<script>alert(1)"), "the note is not rendered anywhere");
  assert.ok(!/\sstyle=|<script|\son[a-z]+=/.test(html.replace(/<link[^>]*>/g, "")), "no inline style, script or handler");
  assert.match(html, /<label for="req-brand-svc-colours">Anything we should know\? \(optional\)<\/label><textarea id="req-brand-svc-colours" name="note" rows="3" maxlength="1000">/);
  assert.equal(res.headers.get("content-security-policy"), PORTAL_CSP, "no script is needed or allowed on the page");
  assert.equal([...html.matchAll(/id="req-brand-[a-z-]+"/g)].length, new Set([...html.matchAll(/id="req-brand-[a-z-]+"/g)].map((m) => m[0])).size, "unique ids");
});
