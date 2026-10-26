/* Branding, Phase 3: the client-facing Branding page and the separate uploads area, through the real router (sign-in, CSRF, organization guard).
   Proves: the feature flag; the empty state; draft vs published visibility (kit and each asset); downloads and previews (headers, audit, isolation);
   uploads (validation, CSRF, cross-site, quota, holds, owner-only removal); and that no page carries inline script or style. */
import test from "node:test";
import assert from "node:assert/strict";
import { makeWorld, csrfOf, ORIGIN } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as brand from "../portal/repo/brand.js";
import * as B from "../portal/brand-files.js";
import { PORTAL_CSP, PORTAL_CSP_WITH_SCRIPT } from "../portal/http.js";
import { fileSize } from "../portal/branding-live.js";

const sql = (db, q, ...p) => db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const ADMIN = "admin@framework.test";

async function setup({ flag = true, withBucket = true } = {}) {
  const w = await makeWorld();
  const bucket = fakeR2();
  if (flag) w.env.PORTAL_BRANDING = "1";
  if (withBucket) w.env.PORTAL_FILES = bucket;
  const alpha = await w.org("alpha", "Alpha Co"), beta = await w.org("beta", "Beta Co");
  await w.invite(alpha, "ann@alpha.test", "owner"); await w.invite(alpha, "mia@alpha.test", "member"); await w.invite(beta, "bob@beta.test", "owner");
  const ann = w.browser(), mia = w.browser(), bob = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(3, "mia@alpha.test")); await bob.signIn(w.user(2, "bob@beta.test"));
  const deps = { db: w.db, bucket, env: w.env, now: w.clock.now() };
  const deliver = async (org, meta, name, bytes, publish = true) => {
    const r = await B.adminUploadAsset(deps, { organizationId: org.id, actor: ADMIN, meta: { published: publish, ...meta }, file: { name, bytes } });
    assert.ok(r.ok, JSON.stringify(r));
    return r.id;
  };
  const publishKit = async (org, kit = {}) => {
    assert.ok((await brand.saveBrandKit(w.db, org.id, { colours: [{ name: "Ink", role: "primary", hex: "#0a0a0a", note: "" }, { name: "Paper", role: "neutral", hex: "#FFFFFF", note: "Backgrounds" }], typography: [{ role: "heading", family: "Switzer", weights: [400, 600], usage: "Headlines", source_url: "https://example.com/switzer" }], ...kit }, ADMIN)).ok);
    assert.ok((await brand.setBrandKitStatus(w.db, org.id, "published", ADMIN)).ok);
  };
  return { w, bucket, deps, alpha, beta, ann, mia, bob, deliver, publishKit };
}
const logo = { kind: "logo", logo_role: "primary", orientation: "horizontal", tone: "light", transparent: true };
const upload = (browser, slug, { csrf, category = "logo", file = ["mark.png", S.png()], extra = {}, headers = {}, rights } = {}) => {
  const fd = new FormData();
  if (csrf !== null) fd.set("csrf", csrf);
  fd.set("category", category);
  if (rights) fd.set("font_rights", "1");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  if (file) fd.set("file", new Blob([file[1]]), file[0]);
  return browser.send(`/portal/o/${slug}/branding/uploads`, { method: "POST", body: fd, headers: { "Sec-Fetch-Site": "same-origin", Origin: ORIGIN, ...headers } });
};
const csrfFrom = async (browser, slug) => csrfOf(await (await browser.get(`/portal/o/${slug}/branding/uploads`)).text());
const base = (slug) => `/portal/o/${slug}/branding`;

/* ------------------------------------------------------------------ flag */

test("with PORTAL_BRANDING off, Branding stays a 'Coming soon' page and none of the new routes exist", async () => {
  const { ann } = await setup({ flag: false });
  const page = await (await ann.get(base("alpha"))).text();
  assert.match(page, /Coming soon/);
  for (const p of ["/uploads", "/uploads/00000000-0000-4000-8000-000000000000/download", "/files/00000000-0000-4000-8000-000000000000"]) assert.equal((await ann.get(base("alpha") + p)).status, 404, p);
  const home = await (await ann.get("/portal/o/alpha")).text();
  assert.ok(!/href="\/portal\/o\/alpha\/branding"/.test(home), "Home does not link a section that is not live");
});

test("with the flag on, Home links Branding", async () => {
  const { ann } = await setup();
  assert.match(await (await ann.get("/portal/o/alpha")).text(), /href="\/portal\/o\/alpha\/branding"/);
});

/* ------------------------------------------------------------------ empty state */

test("no brand kit: a useful empty state (not an empty library), with the upload path and a contact", async () => {
  const { ann, mia } = await setup();
  const res = await ann.get(base("alpha"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-security-policy"), PORTAL_CSP, "no script on the empty state");
  const html = await res.text();
  assert.match(html, /Your brand system isn’t ready yet/);
  assert.match(html, /href="\/portal\/o\/alpha\/branding\/uploads"/);
  assert.match(html, /hello@frameworkco\.ca/);
  assert.ok(!/logo-grid|swatches|Download/.test(html), "no library chrome");
  assert.match(await (await mia.get(base("alpha"))).text(), /Your brand system isn’t ready yet/);
});

test("a DRAFT kit (even with published assets) shows the empty state and nothing downloads", async () => {
  const { w, ann, alpha, deliver } = await setup();
  const id = await deliver(alpha, logo, "x.png", S.png(), true);
  await brand.saveBrandKit(w.db, alpha.id, { colours: [{ name: "Ink", role: "primary", hex: "#0A0A0A", note: "" }] }, ADMIN);
  const html = await (await ann.get(base("alpha"))).text();
  assert.match(html, /isn’t ready yet/); assert.ok(!/data-copy|swatch/.test(html));
  assert.equal((await ann.get(`${base("alpha")}/files/${id}`)).status, 404);
});

/* ------------------------------------------------------------------ published brand */

test("a published kit shows logos grouped by variation, colours with codes, typography, fonts and guidelines; unpublished assets never appear", async () => {
  const { ann, alpha, deliver, publishKit } = await setup();
  const pngId = await deliver(alpha, logo, "a.png", S.png());
  const svgId = await deliver(alpha, logo, "a.svg", S.svg());
  const draftId = await deliver(alpha, { ...logo, logo_role: "icon", orientation: "square" }, "d.png", S.png(), false);
  const guideId = await deliver(alpha, { kind: "guideline", title: "Brand Guidelines" }, "guide.pdf", S.pdf());
  const licensed = await deliver(alpha, { kind: "font", title: "Switzer Regular", downloadable: true, license_note: "OFL" }, "f.ttf", S.ttf());
  const locked = await deliver(alpha, { kind: "font", title: "Secret Serif", downloadable: false, license_note: "Licensed to Framework" }, "g.ttf", S.ttf());
  await publishKit(alpha);
  const res = await ann.get(base("alpha"));
  assert.equal(res.headers.get("content-security-policy"), PORTAL_CSP_WITH_SCRIPT, "script only for the copy button, never inline");
  const html = await res.text();
  assert.equal((html.match(/class="logo-card"/g) || []).length, 1, "PNG and SVG of one variation share a card");
  assert.match(html, new RegExp(`files/${pngId}`)); assert.match(html, new RegExp(`files/${svgId}`));
  assert.match(html, /Download PNG/); assert.match(html, /Download SVG/);
  assert.ok(html.includes(`files/${svgId}?preview=1`) || html.includes(`files/${pngId}?preview=1`), "a preview image");
  assert.ok(!html.includes(draftId), "an unpublished asset is not listed");
  assert.match(html, /#0A0A0A/); assert.match(html, /RGB 10, 10, 10/); assert.match(html, /data-copy="#0A0A0A"/);
  assert.match(html, /<rect width="100" height="60" fill="#0A0A0A"\/>/);
  assert.match(html, /Switzer/); assert.match(html, /href="https:\/\/example\.com\/switzer"/);
  assert.match(html, new RegExp(`files/${guideId}`));
  assert.match(html, new RegExp(`files/${licensed}`)); assert.ok(!html.includes(locked), "a font that is not licensed for download has no link");
  assert.match(html, /can’t be shared as files/);
  assert.ok(!/<script[^>]*>[^<]|style=|onclick=|storage_key|sha256|org\/[0-9a-f-]{36}/i.test(html), "no inline script or style, no internals");
});

test("an unpublished kit's colours never reach the page after a kit is un-published", async () => {
  const { w, ann, alpha, publishKit } = await setup();
  await publishKit(alpha);
  assert.match(await (await ann.get(base("alpha"))).text(), /data-copy="#0A0A0A"/);
  await brand.setBrandKitStatus(w.db, alpha.id, "draft", ADMIN);
  assert.ok(!/data-copy|swatch/.test(await (await ann.get(base("alpha"))).text()));
});

test("the brand name appears in the introduction when one is set", async () => {
  const { ann, alpha, publishKit } = await setup();
  await publishKit(alpha, { brandName: "Alpha Atelier" });
  assert.match(await (await ann.get(base("alpha"))).text(), /Alpha Atelier/);
});

/* ------------------------------------------------------------------ downloads */

test("a member downloads a published asset: attachment, generated name, hardened headers, audited; a preview is inline only for logos", async () => {
  const { w, mia, alpha, deliver, publishKit } = await setup();
  const logoId = await deliver(alpha, logo, "a.png", S.png());
  const guideId = await deliver(alpha, { kind: "guideline", title: "Guide" }, "g.pdf", S.pdf());
  await publishKit(alpha);
  const res = await mia.get(`${base("alpha")}/files/${logoId}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /^attachment; filename=/);
  assert.match(res.headers.get("content-disposition"), /Alpha-Co/);
  assert.equal(res.headers.get("content-type"), "application/octet-stream");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("content-security-policy"), /sandbox/);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.ok(res.headers.get("strict-transport-security")); assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), S.png());
  const act = sql(w.db, "SELECT * FROM activity_log WHERE action = 'brand.asset.download'");
  assert.equal(act.length, 1); assert.equal(act[0].organization_id, alpha.id); assert.equal(act[0].entity_id, logoId);
  assert.ok(!JSON.stringify(act).includes("org/"), "the audit row holds no storage key");
  const pv = await mia.get(`${base("alpha")}/files/${logoId}?preview=1`);
  assert.equal(pv.headers.get("content-disposition"), "inline"); assert.equal(pv.headers.get("content-type"), "image/png");
  assert.equal((await mia.get(`${base("alpha")}/files/${guideId}?preview=1`)).status, 404, "a document is never previewed");
  assert.equal((await mia.get(`${base("alpha")}/files/${guideId}`)).status, 200);
});

test("another organization's, unpublished, deleted, malformed and unlicensed-font assets are all the same 404; signed-out visitors are sent to sign in", async () => {
  const { w, bucket, ann, bob, alpha, beta, deliver, publishKit } = await setup();
  const mine = await deliver(alpha, logo, "a.png", S.png());
  const draft = await deliver(alpha, { ...logo, tone: "dark" }, "b.png", S.png(), false);
  const font = await deliver(alpha, { kind: "font", title: "F", downloadable: false, license_note: "x" }, "f.ttf", S.ttf());
  const theirs = await deliver(beta, logo, "t.png", S.png());
  await publishKit(alpha); await publishKit(beta);
  assert.equal((await ann.get(`${base("alpha")}/files/${mine}`)).status, 200);
  for (const id of [draft, font, theirs, "nope", "00000000-0000-4000-8000-000000000000"]) assert.equal((await ann.get(`${base("alpha")}/files/${id}`)).status, 404, id);
  assert.equal((await bob.get(`${base("alpha")}/files/${mine}`)).status, 404, "not a member of alpha");
  assert.equal((await bob.get(`${base("beta")}/files/${mine}`)).status, 404, "alpha's asset through beta's door");
  assert.equal((await bob.get(`${base("beta")}/files/${theirs}`)).status, 200);
  assert.equal(sql(w.db, "SELECT * FROM activity_log WHERE action = 'brand.asset.download'").length, 2);
  const anon = w.browser();
  assert.equal((await anon.get(`${base("alpha")}/files/${mine}`)).status, 303);
  void bucket;
});

test("a file missing from storage fails safely (no leak, no audit row), and a missing storage binding is a plain 503", async () => {
  const { w, bucket, ann, alpha, deliver, publishKit } = await setup();
  const id = await deliver(alpha, logo, "a.png", S.png());
  await publishKit(alpha);
  bucket.store.clear();
  assert.equal((await ann.get(`${base("alpha")}/files/${id}`)).status, 404);
  assert.equal(sql(w.db, "SELECT * FROM activity_log WHERE action = 'brand.asset.download'").length, 0);
  delete w.env.PORTAL_FILES;
  assert.equal((await ann.get(`${base("alpha")}/files/${id}`)).status, 503);
});

/* ------------------------------------------------------------------ uploads */

test("the uploads page: separate from the brand library, a real multipart form with CSRF, limits and an empty list; no script", async () => {
  const { ann } = await setup();
  const res = await ann.get(`${base("alpha")}/uploads`);
  assert.equal(res.status, 200); assert.equal(res.headers.get("content-security-policy"), PORTAL_CSP);
  const html = await res.text();
  assert.match(html, /<form class="upload" method="post" action="\/portal\/o\/alpha\/branding\/uploads" enctype="multipart\/form-data"/);
  assert.match(html, /name="csrf" value="[^"]+"/); assert.match(html, /name="file" type="file"/); assert.match(html, /name="font_rights"/);
  assert.match(html, /Up to 25 MB each/); assert.match(html, /0 of 50 files used/);
  assert.match(html, /No files shared yet/);
  assert.ok(!/<script|style=/.test(html));
});

test("a member uploads a file: stored privately under their organization, listed, audited, and downloadable by their organization only", async () => {
  const { w, bucket, ann, mia, bob, alpha } = await setup();
  const csrf = await csrfFrom(mia, "alpha");
  const res = await upload(mia, "alpha", { csrf, category: "logo", file: ["My Logo.png", S.png()] });
  assert.equal(res.status, 303); assert.equal(res.headers.get("Location"), "/portal/o/alpha/branding/uploads?uploaded=1");
  const [row] = sql(w.db, "SELECT * FROM brand_uploads");
  assert.equal(row.organization_id, alpha.id); assert.equal(row.category, "logo"); assert.equal(row.status, "available");
  assert.ok(row.storage_key.startsWith(`org/${alpha.id}/brand-uploads/`)); assert.ok(bucket.store.has(row.storage_key));
  assert.equal(sql(w.db, "SELECT * FROM activity_log WHERE action = 'brand.upload.created'").length, 1);
  const page = await (await ann.get(`${base("alpha")}/uploads?uploaded=1`)).text();
  assert.match(page, /Uploaded\. Framework will review it\./); assert.match(page, /My Logo\.png/);
  assert.match(page, /1 of 50 files used/);
  const dl = await ann.get(`${base("alpha")}/uploads/${row.id}/download`);
  assert.equal(dl.status, 200); assert.match(dl.headers.get("content-disposition"), /^attachment/); assert.equal(dl.headers.get("content-type"), "application/octet-stream");
  assert.equal((await bob.get(`${base("alpha")}/uploads/${row.id}/download`)).status, 404);
  assert.equal((await bob.get(`${base("beta")}/uploads/${row.id}/download`)).status, 404, "another organization's file through your own door");
  assert.ok(!/My Logo/.test(await (await bob.get(`${base("beta")}/uploads`)).text()), "organizations never see each other's uploads");
});

test("the organization comes from the membership, never the form: a forged organization field is ignored", async () => {
  const { w, mia, alpha, beta } = await setup();
  const csrf = await csrfFrom(mia, "alpha");
  await upload(mia, "alpha", { csrf, extra: { organization_id: beta.id, organization: "beta", slug: "beta" } });
  assert.deepEqual(sql(w.db, "SELECT organization_id FROM brand_uploads").map((r) => r.organization_id), [alpha.id]);
});

test("CSRF and same-site rules: a missing, wrong or another session's token, or a cross-site request, stores nothing", async () => {
  const { w, bucket, ann, mia } = await setup();
  const good = await csrfFrom(mia, "alpha");
  const other = await csrfFrom(ann, "alpha");
  for (const csrf of [null, "", "garbage", other]) assert.equal((await upload(mia, "alpha", { csrf })).status, 403, String(csrf).slice(0, 8));
  assert.equal((await upload(mia, "alpha", { csrf: good, headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal((await upload(mia, "alpha", { csrf: good, headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal(sql(w.db, "SELECT * FROM brand_uploads").length, 0); assert.equal(bucket.store.size, 0);
  assert.equal((await mia.send(`${base("alpha")}/uploads`, { method: "POST", body: new URLSearchParams({ csrf: good }).toString(), headers: { "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "same-origin" } })).status, 400, "urlencoded is not an upload");
});

test("refused uploads keep the person on the page with a plain reason and store nothing", async () => {
  const { w, bucket, mia } = await setup();
  const csrf = await csrfFrom(mia, "alpha");
  const cases = [
    [{ file: ["run.exe", S.text("MZ....")] }, 422, /can’t be uploaded/],
    [{ file: ["fake.png", S.text("not an image")] }, 422, /doesn’t look like/],
    [{ file: null }, 422, /Choose a file/],
    [{ category: "nonsense" }, 422, /Choose what the file is/],
    [{ category: "fonts", file: ["f.ttf", S.ttf()] }, 422, /right to share this font/],
    [{ category: "logo", file: ["f.ttf", S.ttf()] }, 422, /right to share this font/],
  ];
  for (const [o, status, msg] of cases) {
    const res = await upload(mia, "alpha", { csrf, ...o });
    assert.equal(res.status, status, JSON.stringify(Object.keys(o)));
    const html = await res.text();
    assert.match(html, msg, JSON.stringify(o.file ? o.file[0] : o) + " " + (html.match(/form-banner[^>]*>[^<]*/) || [""])[0]); assert.match(html, /data-error-summary/); assert.equal(res.headers.get("content-security-policy"), PORTAL_CSP_WITH_SCRIPT);
  }
  assert.equal(sql(w.db, "SELECT * FROM brand_uploads").length, 0); assert.equal(bucket.store.size, 0);
  const ok = await upload(mia, "alpha", { csrf, category: "fonts", file: ["f.ttf", S.ttf()], rights: true });
  assert.equal(ok.status, 303); assert.equal(sql(w.db, "SELECT font_rights_ack FROM brand_uploads")[0].font_rights_ack, 1);
});

test("size limits: over the per-file limit is 413 without storing; the file and storage allowances are enforced", async () => {
  const { w, bucket, mia } = await setup();
  w.env.PORTAL_FILES_MAX_FILE_BYTES = String(50 * 1024);
  const csrf = await csrfFrom(mia, "alpha");
  const big = new Uint8Array(200 * 1024); big.set(S.png());
  const res = await upload(mia, "alpha", { csrf, file: ["big.png", big] });
  assert.equal(res.status, 413); assert.match(await res.text(), /too large/);
  const declared = await mia.send(`${base("alpha")}/uploads`, { method: "POST", body: "x", headers: { "Content-Type": "multipart/form-data; boundary=x", "Content-Length": String(10 * 1024 * 1024), "Sec-Fetch-Site": "same-origin", Origin: ORIGIN } });
  assert.equal(declared.status, 413, "refused from the header alone");
  assert.equal(sql(w.db, "SELECT * FROM brand_uploads").length, 0); assert.equal(bucket.store.size, 0);
});

test("the file-count allowance is enforced and explained", async () => {
  const { w, mia } = await setup();
  w.env.PORTAL_FILES_MAX_FILES = "2";
  const csrf = await csrfFrom(mia, "alpha");
  for (let i = 0; i < 2; i++) assert.equal((await upload(mia, "alpha", { csrf, file: [`f${i}.png`, S.png(8 + i, 8)] })).status, 303);
  const res = await upload(mia, "alpha", { csrf, file: ["f3.png", S.png(20, 8)] });
  assert.equal(res.status, 422); assert.match(await res.text(), /limit on the number of files/);
  assert.equal(sql(w.db, "SELECT * FROM brand_uploads").length, 2);
});

test("a ZIP is accepted as download-only (never extracted or previewed)", async () => {
  const { w, mia, ann } = await setup();
  const csrf = await csrfFrom(mia, "alpha");
  assert.equal((await upload(mia, "alpha", { csrf, category: "other", file: ["pack.zip", S.brandPack()] })).status, 303);
  const [row] = sql(w.db, "SELECT id FROM brand_uploads");
  const dl = await ann.get(`${base("alpha")}/uploads/${row.id}/download?preview=1`);
  assert.equal(dl.headers.get("content-type"), "application/octet-stream"); assert.match(dl.headers.get("content-disposition"), /^attachment/);
});

test("removal: only an owner may remove a shared upload; a member sees no remove control; another organization cannot; the object is deleted", async () => {
  const { w, bucket, ann, mia, bob } = await setup();
  const csrf = await csrfFrom(mia, "alpha");
  await upload(mia, "alpha", { csrf });
  const [row] = sql(w.db, "SELECT * FROM brand_uploads");
  const memberPage = await (await mia.get(`${base("alpha")}/uploads`)).text();
  assert.ok(!/class="remove"/.test(memberPage)); assert.match(memberPage, /Only an owner/);
  const ownerPage = await (await ann.get(`${base("alpha")}/uploads`)).text();
  assert.match(ownerPage, new RegExp(`action="/portal/o/alpha/branding/uploads/${row.id}/delete"`));
  const post = (b, slug, token, id = row.id, headers = {}) => b.send(`${base(slug)}/uploads/${id}/delete`, { method: "POST", body: new URLSearchParams({ csrf: token }).toString(), headers: { "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "same-origin", Origin: ORIGIN, ...headers } });
  assert.equal((await post(mia, "alpha", csrf)).status, 403, "a member cannot remove");
  assert.equal((await post(ann, "alpha", "bad")).status, 403, "bad token");
  assert.equal((await post(ann, "alpha", await csrfFrom(ann, "alpha"), row.id, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await post(bob, "beta", await csrfFrom(bob, "beta"))).status, 404, "another organization's file through your own door");
  assert.equal((await post(bob, "alpha", await csrfFrom(bob, "beta"))).status, 404);
  assert.equal(sql(w.db, "SELECT * FROM brand_uploads WHERE deleted_at IS NULL").length, 1);
  const res = await post(ann, "alpha", await csrfFrom(ann, "alpha"));
  assert.equal(res.status, 303); assert.equal(res.headers.get("Location"), "/portal/o/alpha/branding/uploads?removed=1");
  assert.equal(sql(w.db, "SELECT * FROM brand_uploads WHERE deleted_at IS NULL").length, 0); assert.equal(bucket.store.size, 0);
  assert.equal((await ann.get(`${base("alpha")}/uploads/${row.id}/download`)).status, 404);
  assert.equal((await ann.get(`${base("alpha")}/uploads/${row.id}/delete`)).status, 303, "a GET never removes anything");
});

test("a file Framework has put on hold is listed as on hold and cannot be downloaded by the client", async () => {
  const { w, mia } = await setup();
  const csrf = await csrfFrom(mia, "alpha");
  await upload(mia, "alpha", { csrf });
  const [row] = sql(w.db, "SELECT * FROM brand_uploads");
  assert.ok((await brand.setUploadHeld(w.db, row.organization_id, row.id, true, ADMIN)).ok);
  const page = await (await mia.get(`${base("alpha")}/uploads`)).text();
  assert.match(page, /On hold/); assert.ok(!page.includes(`${row.id}/download`));
  assert.equal((await mia.get(`${base("alpha")}/uploads/${row.id}/download`)).status, 404);
});

test("uploads are rejected cleanly when file storage is not available", async () => {
  const { w, mia } = await setup({ withBucket: false });
  const csrf = await csrfFrom(mia, "alpha");
  const res = await upload(mia, "alpha", { csrf });
  assert.equal(res.status, 503); assert.match(await res.text(), /File storage isn’t available/);
  assert.equal(sql(w.db, "SELECT * FROM brand_uploads").length, 0);
});

/* ------------------------------------------------------------------ pages */

test("every Branding page is signed-in only, breadcrumbed, and free of inline script and style", async () => {
  const { w, ann, alpha, deliver, publishKit } = await setup();
  await deliver(alpha, logo, "a.png", S.png());
  await publishKit(alpha);
  const anon = w.browser();
  for (const p of ["", "/uploads"]) {
    assert.equal((await anon.get(base("alpha") + p)).status, 303, p);
    const html = await (await ann.get(base("alpha") + p)).text();
    assert.match(html, /class="crumb"|aria-label="Breadcrumb"/i);
    assert.ok(!/style=|<script(?![^>]*src=)|\son[a-z]+=/i.test(html), p);
  }
});

test("fileSize prints plain sizes", () => {
  assert.equal(fileSize(0), "0 B"); assert.equal(fileSize(2048), "2 KB"); assert.equal(fileSize(5 * 1024 * 1024), "5.0 MB"); assert.equal(fileSize(25 * 1024 * 1024), "25 MB"); assert.equal(fileSize(-1), "");
});

/* ------------------------------------------------------------------ Home cards */

test("Home: Business Profile and Branding are two matching whole-card links, each with title, description, status and an arrow; no welcome copy", async () => {
  const { ann, mia, alpha, publishKit } = await setup();
  let html = await (await ann.get("/portal/o/alpha")).text();
  const cards = [...html.matchAll(/<a class="hub" href="([^"]+)">([\s\S]*?)<\/a>/g)];
  assert.deepEqual(cards.map((c) => c[1]), ["/portal/o/alpha/profile", "/portal/o/alpha/branding"]);
  for (const [, , inner] of cards) {
    assert.match(inner, /class="hub__title"/); assert.match(inner, /class="hub__desc"/); assert.match(inner, /class="hub__status"/); assert.match(inner, /class="hub__arrow tile__arrow" aria-hidden="true">→</);
  }
  assert.match(cards[1][2], /Not published yet/); assert.match(cards[1][2], /Upload your existing brand materials/);
  assert.ok(!/class="lead"|home-note|Start your Business Profile/.test(html));
  assert.ok(!/<p class="soon-line">[\s\S]*Branding[\s\S]*<\/p>/.test(html), "Branding is no longer 'coming soon'");
  await publishKit(alpha);
  assert.match(await (await mia.get("/portal/o/alpha")).text(), /Brand system published/);
  await upload(mia, "alpha", { csrf: await csrfFrom(mia, "alpha") });
  assert.match(await (await ann.get("/portal/o/alpha")).text(), /1 file shared with Framework/);
});

test("Home with Branding off: only the Business Profile card, and Branding is listed as coming soon", async () => {
  const { ann } = await setup({ flag: false });
  const html = await (await ann.get("/portal/o/alpha")).text();
  assert.equal([...html.matchAll(/<a class="hub"/g)].length, 1);
  assert.match(/<p class="soon-line">[\s\S]*?<\/p>/.exec(html)[0], /Branding/);
});

test("Home stays up when branding data cannot be read: the Branding card says so and nothing else breaks", async () => {
  const { w, ann } = await setup();
  w.db.raw.exec("DROP TABLE service_requests; DROP TABLE brand_uploads; DROP TABLE brand_assets; DROP TABLE brand_kits");
  const res = await ann.get("/portal/o/alpha");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Status unavailable right now/);
});

/* ------------------------------------------------------------------ accordion */

test("Branding is four native accordion sections, each with a concise summary, rendered closed (script opens them on wide screens); every download is still present", async () => {
  const { ann, alpha, deliver, publishKit } = await setup();
  const a = await deliver(alpha, logo, "a.png", S.png()), b = await deliver(alpha, logo, "a.svg", S.svg());
  const g = await deliver(alpha, { kind: "guideline", title: "Brand Guidelines" }, "g.pdf", S.pdf());
  const d = await deliver(alpha, { kind: "document", title: "Card template" }, "d.pdf", S.pdf());
  const f = await deliver(alpha, { kind: "font", title: "Switzer Regular", downloadable: true, license_note: "OFL" }, "f.ttf", S.ttf());
  await publishKit(alpha);
  const html = await (await ann.get(base("alpha"))).text();
  const secs = [...html.matchAll(/<details class="acc" id="(\w+)"><summary class="acc__head"><span class="acc__text"><h2 class="acc__title">([^<]+)<\/h2><span class="acc__sum">([^<]+)<\/span>/g)].map((m) => m.slice(1));
  assert.deepEqual(secs, [["logos", "Logos", "1 logo variation · SVG, PNG"], ["colours", "Colours", "2 colours"], ["typography", "Typography & Fonts".replace("&", "&amp;"), "1 typeface · Switzer"], ["guidelines", "Brand Guidelines &amp; Documents", "2 files"]]);
  assert.ok(!/<details[^>]* open/.test(html), "closed by default: compact on a phone, and correct without script");
  assert.equal([...html.matchAll(/<summary/g)].length, 4);
  for (const id of [a, b, g, d, f]) assert.ok(html.includes(`/branding/files/${id}"`), "download link kept: " + id);
  assert.match(html, /aria-hidden="true"><\/span><\/summary>/, "the chevron is decorative");
  const js = (await import("node:fs")).readFileSync(new URL("../../assets/js/portal-branding.js", import.meta.url), "utf8");
  assert.match(js, /min-width: 900px/); assert.match(js, /hashchange/);
});
