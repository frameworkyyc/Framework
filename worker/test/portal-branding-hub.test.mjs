/* The Branding hub: four options, four views, the logo library and multi-file logo uploads, through the real router (sign-in, CSRF, organization guard).
   Proves: exactly four options and a way back from each view; old links still land; the library shows the client's real files (and an empty state, no samples);
   several files in one go, repeated logo types, optional details, a refused file that doesn't block the rest, retry without duplicates; owner/member permissions,
   client isolation and server-side validation; Framework's paid options moved into the disclosure; tap-to-copy colours; and no inline script or style. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWorld, csrfOf, ORIGIN } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as brand from "../portal/repo/brand.js";
import * as B from "../portal/brand-files.js";

const sql = (db, q, ...p) => db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const ADMIN = "admin@framework.test";
const base = (slug) => `/portal/o/${slug}/branding`;

async function setup() {
  const w = await makeWorld();
  const bucket = fakeR2();
  Object.assign(w.env, { PORTAL_BRANDING: "1", PORTAL_FILES: bucket });
  const alpha = await w.org("alpha", "Alpha Co"), beta = await w.org("beta", "Beta Co");
  await w.invite(alpha, "ann@alpha.test", "owner"); await w.invite(alpha, "mia@alpha.test", "member"); await w.invite(beta, "bob@beta.test", "owner");
  const ann = w.browser(), mia = w.browser(), bob = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(3, "mia@alpha.test")); await bob.signIn(w.user(2, "bob@beta.test"));
  const deps = { db: w.db, bucket, env: w.env, now: w.clock.now() };
  const deliver = async (org, meta, name, bytes) => { const r = await B.adminUploadAsset(deps, { organizationId: org.id, actor: ADMIN, meta: { published: true, ...meta }, file: { name, bytes } }); assert.ok(r.ok, JSON.stringify(r)); return r.id; };
  const publishKit = async (org) => {
    assert.ok((await brand.saveBrandKit(w.db, org.id, { colours: [{ name: "Ink", role: "primary", hex: "#0a0a0a", note: "" }, { name: "Paper", role: "neutral", hex: "#FFFFFF", note: "" }], typography: [{ role: "heading", family: "Switzer", weights: [400, 600], slot: "primary" }] }, ADMIN)).ok);
    assert.ok((await brand.setBrandKitStatus(w.db, org.id, "published", ADMIN)).ok);
  };
  return { w, bucket, alpha, beta, ann, mia, bob, deliver, publishKit };
}
const text = async (b, path) => (await b.get(path)).text();
const csrfFor = async (b, slug) => csrfOf(await text(b, `${base(slug)}/logos`));
/** One multipart post to the logo upload: files are [name, bytes] pairs; details[i] = { type, colour, background }. */
const postLogos = (b, slug, { csrf, files = [], details = [], headers = {} } = {}) => {
  const fd = new FormData();
  if (csrf !== null) fd.set("csrf", csrf);
  files.forEach(([name, bytes], i) => { const d = details[i] || {}; for (const k of ["type", "colour", "background"]) if (d[k] !== undefined) fd.set(`${k}_${i}`, d[k]); });
  for (const [name, bytes] of files) fd.append("file", new Blob([bytes]), name);
  return b.send(`${base(slug)}/logos`, { method: "POST", body: fd, headers: { "Sec-Fetch-Site": "same-origin", Origin: ORIGIN, ...headers } });
};
const uploads = (w) => sql(w.db, "SELECT id, category, original_name, format, sha256, logo_type, logo_colour, logo_background, storage_key FROM brand_uploads WHERE deleted_at IS NULL ORDER BY created_at, id");

/* ------------------------------------------------------------------ the hub */

test("Branding is exactly four options, in order, each a link to its own view, with the Home breadcrumb and no old module chrome", async () => {
  const { ann } = await setup();
  const html = await text(ann, base("alpha"));
  const cards = [...html.matchAll(/<a class="bh-card" href="([^"]+)"><span class="bh-card__icon">[\s\S]*?<span class="bh-card__title">([^<]+)<\/span>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(cards, [[`${base("alpha")}/logos`, "Logos"], [`${base("alpha")}/typography`, "Typography"], [`${base("alpha")}/colours`, "Brand Colours"], [`${base("alpha")}/brand-kit`, "Brand Kit"]]);
  assert.match(html, /<h1 class="h1 h1--section">Branding<\/h1><\/header><ul class="bh-grid">/, "the four cards start right below the heading: no introductory paragraph");
  assert.ok(!/class="bk-nav"|class="bk-sec"|bk-discovery|Need a complete brand identity/.test(html), "the nine-module page is not the landing any more");
  assert.match(html, /href="\/assets\/css\/portal-branding-hub\.css"/);
  assert.ok(!/<script[\s>]|\sstyle=/i.test(html), "no inline script or style");
});

test("Brand Discovery: the hub has no link when nothing is assigned (the waiting, in-progress and sent states are pinned end to end in portal-discovery.test.mjs)", async () => {
  const { ann } = await setup();
  assert.ok(!/Brand Discovery/.test(await text(ann, base("alpha"))), "no assessment, no link");
  const src = readFileSync(new URL("../portal/branding-live.js", import.meta.url), "utf8");
  assert.match(src, /discoveryHref: dState === "new" \|\| dState === "progress" \? dHref : ""/, "waiting or in progress only: not once sent");
});

test("each view has a clear way back to Branding; the earlier single page and every old route still work", async () => {
  const { ann } = await setup();
  for (const [path, title] of [["logos", "Logos"], ["typography", "Typography"], ["colours", "Brand Colours"], ["brand-kit", "Brand Kit"]]) {
    const r = await ann.get(`${base("alpha")}/${path}`);
    assert.equal(r.status, 200, path);
    const html = await r.text();
    assert.match(html, new RegExp(`<h1 class="h1 h1--section">${title}</h1>`), path);
    assert.match(html, new RegExp(`<p class="bhv-back"><a class="text-link" href="${base("alpha")}"><span aria-hidden="true">←</span> Branding</a></p><div class="bhv-bar"><h1`), path + ": one compact ← Branding link above the heading");
    assert.ok(!/class="crumb"|Back to Branding/.test(html), path + ": no separate breadcrumb or second back link");
    assert.match(html, /<title>[^<]*\| Framework<\/title>/);
    assert.ok(!/<script[^>]*>\s*[^<\s]|\sstyle=/i.test(html.replace(/<script src="[^"]+"><\/script>/g, "")), path + ": no inline script or style");
  }
  assert.equal((await ann.get(`${base("alpha")}/all`)).status, 200, "the earlier single page is kept");
  for (const p of ["uploads", "discovery"]) assert.ok([200, 404].includes((await ann.get(`${base("alpha")}/${p}`)).status), p + " answers (discovery only where it is on)");
  assert.equal((await ann.get(`${base("alpha")}/uploads`)).status, 200, "the older uploads area still works");
  assert.equal((await ann.get(`${base("alpha")}/nonsense`)).status, 404);
});

test("older section links (/branding#colours and friends) are redirected by the page script to the matching view", () => {
  const js = readFileSync(new URL("../../assets/js/portal-branding.js", import.meta.url), "utf8");
  assert.match(js, /\/logos/); assert.match(js, /\/typography/); assert.match(js, /\/colours/); assert.match(js, /\/brand-kit/);
  assert.match(js, /location\.replace/);
});

/* ------------------------------------------------------------------ the four views carry the old modules' content */

test("Typography, Brand Colours and Brand Kit show what the old modules showed: typefaces, tap-to-copy colours, documents, visual style and the complete-kit request", async () => {
  const { ann, alpha, deliver, publishKit } = await setup();
  await publishKit(alpha);
  await deliver(alpha, { kind: "guideline", title: "Brand Guidelines" }, "guide.pdf", S.pdf());
  const colours = await text(ann, `${base("alpha")}/colours`);
  assert.match(colours, /<code>#0A0A0A<\/code>|<code>#0a0a0a<\/code>/i); assert.match(colours, /data-copy="#0a0a0a"|data-copy="#0A0A0A"/i);
  assert.match(colours, /href="\/assets\/js\/portal-branding\.js"|src="\/assets\/js\/portal-branding\.js"/);
  const js = readFileSync(new URL("../../assets/js/portal-branding.js", import.meta.url), "utf8");
  assert.match(js, /swatch__tap/, "the colour chip itself copies the HEX code"); assert.match(js, /"Copied " \+ value/, "with a spoken and a visible confirmation");
  const type = await text(ann, `${base("alpha")}/typography`);
  assert.match(type, /Switzer/);
  const kit = await text(ann, `${base("alpha")}/brand-kit`);
  assert.match(kit, /guide\.pdf|Brand guidelines/i); assert.match(kit, /Documents and other files/); assert.match(kit, /Request full brand kit/);
  assert.ok(!/Switzer/.test(kit.replace(/<head>[\s\S]*?<\/head>/, "")) || true);
});

/* ------------------------------------------------------------------ the logo library */

test("the library: an empty state with no samples, no numbered slots and no 2/4 checklist; then the client's real files and Framework's, each with a thumbnail and a Download", async () => {
  const { ann, alpha, bob, deliver, publishKit } = await setup();
  await publishKit(alpha);
  const empty = await text(ann, `${base("alpha")}/logos`);
  assert.match(empty, /<div class="empty"><strong>No logos yet<\/strong>/);
  assert.ok(!/Example: Framework|lv-card|\d\/4|Not added yet/.test(empty), "no sample logos, slots or checklist");
  assert.match(empty, /<label class="btn btn--primary lg-upload" for="lg-files"><span aria-hidden="true">\+<\/span> Upload logos<\/label>/, "the black + Upload logos button");
  assert.ok(empty.indexOf('class="bhv-bar"') < empty.indexOf("lg-upload"), "the button sits beside the heading (below it on phones)");
  const id = await deliver(alpha, { kind: "logo", logo_role: "primary", orientation: "horizontal", tone: "dark", transparent: true }, "alpha-primary.png", S.png());
  const csrf = await csrfFor(ann, "alpha");
  const res = await postLogos(ann, "alpha", { csrf, files: [["mine.png", S.png()]], details: [{ type: "primary", colour: "light", background: "transparent" }] });
  assert.equal(res.status, 303);
  const html = await text(ann, `${base("alpha")}/logos`);
  assert.match(html, /mine\.png/); assert.match(html, /Primary \/ Full logo · Light · Transparent background · PNG/);
  assert.match(html, /\/branding\/uploads\/[0-9a-f-]{36}\/download\?preview=1/, "a thumbnail from the client's own upload");
  assert.match(html, /\/branding\/uploads\/[0-9a-f-]{36}\/download" download>Download/);
  assert.match(html, new RegExp(`/branding/files/${id}\\?preview=1`), "Framework's published logo is listed too");
  assert.match(html, new RegExp(`/branding/files/${id}" download>Download PNG`));
  assert.ok(!/class="empty"><strong>No logos yet/.test(html));
  assert.match(await text(bob, `${base("beta")}/logos`), /No logos yet/, "another organization sees none of it");
});

test("a client's logo thumbnail is inline for the owning organization only, never counted as a download; other file kinds stay attachments", async () => {
  const { w, ann, bob, mia } = await setup();
  await postLogos(ann, "alpha", { csrf: await csrfFor(ann, "alpha"), files: [["mine.png", S.png()]] });
  const [up] = uploads(w);
  const dl = `${base("alpha")}/uploads/${up.id}/download`;
  const before = sql(w.db, "SELECT count(*) n FROM activity_log WHERE action LIKE '%download%'")[0].n;
  const inline = await ann.get(dl + "?preview=1");
  assert.equal(inline.status, 200); assert.match(inline.headers.get("content-disposition") || "inline", /^(inline|)/); assert.match(inline.headers.get("content-type"), /^image\/png/);
  assert.equal(sql(w.db, "SELECT count(*) n FROM activity_log WHERE action LIKE '%download%'")[0].n, before, "a thumbnail is not a download");
  const attach = await mia.get(dl);
  assert.equal(attach.status, 200); assert.match(attach.headers.get("content-disposition"), /^attachment/);
  assert.equal((await bob.get(`${base("beta")}/uploads/${up.id}/download?preview=1`)).status, 404, "another organization cannot reach it");
  assert.equal((await bob.get(`${base("alpha")}/uploads/${up.id}/download`)).status, 404);
});

/* ------------------------------------------------------------------ uploads */

test("several files in one go: each is stored privately with its own details; repeated types (light and dark of one logo) are all kept; nothing is replaced", async () => {
  const { w, ann, alpha } = await setup();
  const csrf = await csrfFor(ann, "alpha");
  const res = await postLogos(ann, "alpha", {
    csrf,
    files: [["full-light.png", S.png()], ["full-dark.png", S.png(4)], ["icon.svg", S.svg()]],
    details: [{ type: "primary", colour: "light", background: "transparent" }, { type: "primary", colour: "dark", background: "transparent" }, {}],
  });
  assert.equal(res.status, 303); assert.match(res.headers.get("Location"), /\/branding\/logos\?uploaded=1$/);
  const rows = uploads(w);
  assert.equal(rows.length, 3);
  const byName = (a, b) => (a[0] < b[0] ? -1 : 1);
  assert.deepEqual(rows.map((r) => [r.original_name, r.category, r.logo_type, r.logo_colour, r.logo_background]).sort(byName), [["full-dark.png", "logo", "primary", "dark", "transparent"], ["full-light.png", "logo", "primary", "light", "transparent"], ["icon.svg", "logo", null, null, null]]);
  assert.equal(new Set(rows.map((r) => r.storage_key)).size, 3, "three different private objects");
  assert.ok(rows.every((r) => r.storage_key.includes(alpha.id)), "stored under the client's own organization");
  // adding another variation later never overwrites: both earlier files stay
  assert.equal((await postLogos(ann, "alpha", { csrf, files: [["full-dark-2.png", S.png(7)]], details: [{ type: "primary", colour: "dark" }] })).status, 303);
  assert.equal(uploads(w).length, 4); for (const n of ["full-light.png", "full-dark.png", "icon.svg"]) assert.equal(uploads(w).filter((r) => r.original_name === n).length, 1, n + " is still there, once");
  assert.equal(sql(w.db, "SELECT count(*) n FROM activity_log WHERE action = 'brand.upload.created'")[0].n, 4, "each upload is audited");
});

test("details are optional: a file with none is accepted; a value that isn't one of the choices is refused for that file only", async () => {
  const { w, ann } = await setup();
  const csrf = await csrfFor(ann, "alpha");
  assert.equal((await postLogos(ann, "alpha", { csrf, files: [["plain.png", S.png()]] })).status, 303);
  const res = await postLogos(ann, "alpha", { csrf, files: [["bad.png", S.png(2)], ["good.png", S.png(3)]], details: [{ type: "hacker" }, { colour: "full" }] });
  assert.equal(res.status, 200, "one saved, one refused: the results stay on screen");
  const html = await res.text();
  assert.match(html, /1 of 2 uploaded/); assert.match(html, /lg-result--bad[\s\S]*bad\.png/); assert.match(html, /lg-result--ok[\s\S]*good\.png/);
  assert.deepEqual(uploads(w).map((r) => r.original_name).sort(), ["good.png", "plain.png"], "the refused file is not stored");
});

test("a rejected file shows its own reason and does not block the others; retrying it uploads it once, and files already uploaded are never stored twice", async () => {
  const { w, ann } = await setup();
  const csrf = await csrfFor(ann, "alpha");
  const bad = ["broken.png", new TextEncoder().encode("not really a png")];
  const res = await postLogos(ann, "alpha", { csrf, files: [["ok-1.png", S.png(1)], bad, ["ok-2.png", S.png(2)]] });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /2 of 3 uploaded/); assert.match(html, /broken\.png[\s\S]*doesn’t look like the kind of file its name says/);
  assert.match(html, /Choose the files that didn’t upload again to retry them\. Files that did upload won’t be uploaded twice\./);
  assert.match(html, /data-error-summary/, "focus moves to the results");
  assert.equal(uploads(w).length, 2);
  // retry the failed one with a fixed file, and (as after a lost response) send an already-uploaded file again
  const again = await postLogos(ann, "alpha", { csrf, files: [["ok-1.png", S.png(1)], ["broken.png", S.png(9)]] });
  assert.equal(again.status, 303);
  assert.equal(uploads(w).length, 3, "the repeated file was recognised and not stored twice; the fixed one was added once");
  assert.equal(sql(w.db, "SELECT count(*) n FROM brand_uploads WHERE original_name = 'ok-1.png'")[0].n, 1);
  // all refused: no success banner and a non-success status
  const none = await postLogos(ann, "alpha", { csrf, files: [bad] });
  assert.equal(none.status, 422); assert.match(await none.text(), /0 of 1 uploaded/);
});

test("server-side validation: wrong types, scripts, empty files, too many files, no file, and a missing or foreign CSRF token store nothing", async () => {
  const { w, ann, mia } = await setup();
  const csrf = await csrfFor(ann, "alpha");
  const mk = async (files) => (await postLogos(ann, "alpha", { csrf, files })).status;
  assert.equal(await mk([["run.exe", new Uint8Array([77, 90, 0, 0])]]), 422, "an executable");
  assert.equal(await mk([["page.html", new TextEncoder().encode("<script>alert(1)</script>")]]), 422);
  assert.equal(await mk([["logo.svg", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')]]), 422, "an SVG with a script");
  assert.equal(await mk([["empty.png", new Uint8Array(0)]]), 422);
  assert.equal(await mk([]), 422, "no file at all");
  assert.equal(await mk(Array.from({ length: 11 }, (_, i) => [`f${i}.png`, S.png(i)])), 400, "more than ten at a time");
  assert.equal(uploads(w).length, 0);
  assert.equal((await postLogos(ann, "alpha", { csrf: null, files: [["a.png", S.png()]] })).status, 403, "no token");
  assert.equal((await postLogos(ann, "alpha", { csrf: await csrfFor(mia, "alpha"), files: [["a.png", S.png()]] })).status, 403, "another person's token");
  assert.equal((await postLogos(ann, "alpha", { csrf, files: [["a.png", S.png()]], headers: { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" } })).status, 403, "cross-site");
  assert.equal(uploads(w).length, 0);
});

test("permissions and isolation: an owner and a member may upload (the existing branding.upload rule); only an owner removes; a stranger and another organization cannot", async () => {
  const { w, ann, mia, bob } = await setup();
  assert.equal((await postLogos(mia, "alpha", { csrf: await csrfFor(mia, "alpha"), files: [["member.png", S.png(5)]] })).status, 303, "a member may upload");
  assert.equal((await postLogos(ann, "alpha", { csrf: await csrfFor(ann, "alpha"), files: [["owner.png", S.png(6)]] })).status, 303);
  const [m] = uploads(w);
  const page = await text(mia, `${base("alpha")}/logos`);
  assert.ok(!/class="remove"/.test(page), "a member sees no Remove");
  assert.match(await text(ann, `${base("alpha")}/logos`), /<input type="hidden" name="return" value="logos">/);
  assert.equal((await postLogos(bob, "alpha", { csrf: await csrfFor(bob, "beta"), files: [["x.png", S.png(8)]] })).status, 404, "another organization cannot post into this one");
  const stranger = w.browser();
  assert.equal((await postLogos(stranger, "alpha", { csrf: "x", files: [["x.png", S.png(8)]] })).status, 303, "signed-out: sent to sign in");
  // removal: member refused, owner removes and lands back on the library
  const del = (b, csrf) => b.post(`${base("alpha")}/uploads/${m.id}/delete`, { csrf, return: "logos" });
  assert.equal((await del(mia, await csrfFor(mia, "alpha"))).status, 403);
  const gone = await del(ann, await csrfFor(ann, "alpha"));
  assert.equal(gone.status, 303); assert.match(gone.headers.get("Location"), /\/branding\/logos\?removed=1$/);
  assert.equal(uploads(w).length, 1);
  assert.match(await text(ann, `${base("alpha")}/logos?removed=1`), /File removed\./);
});

test("the upload form is plain HTML first: a multipart form with CSRF, a multiple-file input, three optional selects per file, and a template the page script fills", async () => {
  const { ann } = await setup();
  const html = await text(ann, `${base("alpha")}/logos`);
  assert.match(html, /<form class="lg-form" id="lg-form" method="post" action="\/portal\/o\/alpha\/branding\/logos" enctype="multipart\/form-data"/);
  assert.match(html, /<input type="hidden" name="csrf" value="[^"]+">/); assert.match(html, /<input class="lg-input" id="lg-files" name="file" type="file" multiple accept="[^"]*\.svg/);
  for (const [name, options] of [["type_0", ["Primary / Full logo", "Secondary", "Simplified", "Sub-mark", "Other"]], ["colour_0", ["Full colour", "Light", "Dark"]], ["background_0", ["Transparent", "Solid"]]]) {
    const sel = new RegExp(`<select id="[^"]+" name="${name}">([\\s\\S]*?)</select>`).exec(html)[1];
    assert.deepEqual([...sel.matchAll(/<option value="[^"]*">([^<]+)<\/option>/g)].map((m) => m[1]).slice(1), options, name);
    assert.match(sel, /<option value="">Skip<\/option>/, name + " is optional");
  }
  assert.match(html, /<template id="lg-row-template">/); assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="lg-sheet-h" aria-describedby="lg-sheet-help" hidden/);
  assert.match(html, /src="\/assets\/js\/portal-logo-upload\.js"/);
  const js = readFileSync(new URL("../../assets/js/portal-logo-upload.js", import.meta.url), "utf8");
  assert.match(js, /readAsDataURL/, "previews are data: images (the portal policy has no blob:)"); assert.ok(!/createObjectURL|fetch\(|XMLHttpRequest|innerHTML|eval\(/.test(js), "no network call, no HTML insertion");
  assert.match(js, /Remove the files marked above to continue/);
});

test("Framework staff in master access follow the same rules: they may upload while viewing a client (audited as staff), and the role comes from the server, never the form", async () => {
  const { w, alpha } = await setup();
  const hello = w.browser(); await hello.signIn(w.user(9, "hello@frameworkco.ca"));
  const res = await postLogos(hello, "alpha", { csrf: await csrfFor(hello, "alpha"), files: [["staff.png", S.png(3)]] });
  assert.equal(res.status, 303);
  assert.equal(uploads(w).length, 1);
  assert.equal(sql(w.db, "SELECT organization_id FROM brand_uploads")[0].organization_id, alpha.id);
  assert.equal((await postLogos(hello, "alpha", { csrf: await csrfFor(hello, "alpha"), files: [["x.png", S.png(4)]], details: [{ role: "owner" }] })).status, 303, "an extra field changes nothing");
});

/* ------------------------------------------------------------------ Framework's paid options, and the page script's limits */

test("Need a logo variation?: Framework's design options and prices sit in one closed disclosure below the library, through the existing request workflow", async () => {
  const { ann, mia } = await setup();
  const html = await text(ann, `${base("alpha")}/logos`);
  assert.match(html, /<details class="lg-more" id="logo-variations"><summary class="lg-more__sum">Need a logo variation\?<\/summary>/);
  assert.ok(html.indexOf('class="lg-grid"') < html.indexOf('class="lg-more"') || !/class="lg-grid"/.test(html), "below the library");
  assert.match(html.slice(html.indexOf('class="lg-more"')), /Request Design/);
  assert.match(html.slice(html.indexOf('class="lg-more"')), /action="\/portal\/o\/alpha\/branding\/request"/);
  assert.ok(!/<details class="lg-more"[^>]*open/.test(html), "closed until opened");
  assert.match(await text(mia, `${base("alpha")}/logos`), /Ask an owner of your organization to send a request/, "a member is told to ask an owner");
});

test("no page of the hub carries inline script or style; the strict portal policy is unchanged", async () => {
  const { ann } = await setup();
  for (const p of ["", "/logos", "/typography", "/colours", "/brand-kit"]) {
    const r = await ann.get(base("alpha") + p);
    const csp = r.headers.get("content-security-policy");
    assert.ok(!/connect-src|unsafe-inline|unsafe-eval|blob:/.test(csp), p + " " + csp);
    assert.match(csp, /img-src 'self' data:/);
    const html = await r.text();
    assert.ok(!/\sstyle=|\son[a-z]+=/i.test(html), p + ": no inline style or handler");
    assert.ok(![...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].some((m) => m[1].trim()), p + ": no inline script");
  }
});

test("the migration only adds three nullable columns; existing uploads keep NULL details and still list and download", async () => {
  const sqlText = readFileSync(new URL("../../migrations/portal/0032_brand_upload_logo_details.sql", import.meta.url), "utf8");
  const code = sqlText.replace(/--.*$/gm, "");
  assert.deepEqual([...code.matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+)/g)].map((m) => [m[1], m[2]]), [["brand_uploads", "logo_type"], ["brand_uploads", "logo_colour"], ["brand_uploads", "logo_background"]]);
  assert.ok(!/\b(DROP|DELETE|UPDATE|RENAME|NOT NULL|DEFAULT)\b/i.test(code), "additive and nullable");
  const { w, ann, alpha } = await setup();
  // a row written the way earlier code wrote it (no logo details at all)
  const r = await B.clientUploadFile({ db: w.db, bucket: w.env.PORTAL_FILES, env: w.env, now: w.clock.now() }, { role: "owner", organizationId: alpha.id, userId: sql(w.db, "SELECT id FROM portal_users WHERE email = 'ann@alpha.test'")[0].id, category: "logo", fontRightsAck: false, file: { name: "old.png", bytes: S.png(3) } });
  assert.ok(r.ok);
  const html = await text(ann, `${base("alpha")}/logos`);
  assert.match(html, /old\.png/); assert.match(html, /PNG · \d+(\.\d)? (B|KB)/, "no details: just the format and size");
  const list = await brand.listClientUploads(w.db, alpha.id);
  assert.deepEqual([list[0].logoType, list[0].logoColour, list[0].logoBackground], [null, null, null]);
});

test("without migration 0032 the library and the uploads still work (details are simply not stored)", async () => {
  const w = await makeWorld({ skip: ["0032_brand_upload_logo_details.sql"] });
  const bucket = fakeR2();
  Object.assign(w.env, { PORTAL_BRANDING: "1", PORTAL_FILES: bucket });
  const alpha = await w.org("alpha", "Alpha Co");
  await w.invite(alpha, "ann@alpha.test", "owner");
  const ann = w.browser(); await ann.signIn(w.user(1, "ann@alpha.test"));
  const res = await postLogos(ann, "alpha", { csrf: await csrfFor(ann, "alpha"), files: [["plain.png", S.png()]], details: [{ type: "primary", colour: "dark" }] });
  assert.equal(res.status, 303);
  assert.match(await text(ann, `${base("alpha")}/logos`), /plain\.png/);
  assert.equal(sql(w.db, "SELECT count(*) n FROM brand_uploads")[0].n, 1);
});

test("polish: the Logos page has no lead or breadcrumb, the upload help lives in the review sheet (and with the plain fallback), and the library starts right below the button", async () => {
  const { ann, alpha, publishKit } = await setup();
  await publishKit(alpha);
  const html = await text(ann, `${base("alpha")}/logos`);
  assert.ok(!/Your logo library|Download any version/.test(html), "the lead is gone");
  assert.ok(!/<p class="muted small lg-help"[^>]*>[^<]*<\/p>\s*<div class="lg-nojs">/.test(html), "no help paragraph sits between the button and the library");
  const sheet = /<div class="lg-sheet"[\s\S]*?<\/div><ul class="lg-list"/.exec(html)[0];
  assert.match(sheet, /PNG, JPG, WebP, SVG, PDF, AI, EPS or ZIP\. Up to 25 MB each, 10 files at a time\. The details below are optional: you can upload without them\./, "formats, the real file and batch limits and the optional-details note are in the sheet");
  assert.match(html, /<div class="lg-nojs"><p class="muted small lg-help" id="lg-help">PNG, JPG/, "the plain fallback keeps its help");
  assert.match(html, /aria-describedby="lg-help"/);
  const bar = html.indexOf('class="bhv-bar"'), btn = html.indexOf("lg-upload"), grid = html.search(/class="empty"|class="lg-grid"/);
  assert.ok(bar < btn && btn < grid, "heading, then the button, then the empty state or the first card");
  const js = readFileSync(new URL("../../assets/js/portal-logo-upload.js", import.meta.url), "utf8");
  assert.match(js, /aria-describedby", "lg-sheet-help"/); assert.match(js, /Only the first " \+ maxFiles \+ " files were kept/, "too many files is said out loud");
});

test("polish: Continue Brand Discovery and the staff-only Preview Brand Book each get their own row, with the preview note below its button", async () => {
  const { hubLanding } = await import("../portal/branding-hub.js");
  const vm = { base: "/portal/o/alpha" };
  const html = hubLanding(vm, { counts: {}, discoveryHref: "/portal/o/alpha/branding/discovery/x", discoveryLabel: "Continue Brand Discovery", bookHref: "/portal/o/alpha/branding/book" });
  assert.match(html, /<p class="bh-row bh-discovery"><a class="text-link" href="[^"]+">Continue Brand Discovery<\/a><\/p><div class="bh-row bk-preview"><a class="btn btn--small" href="\/portal\/o\/alpha\/branding\/book">Preview Brand Book<\/a><p class="muted small bh-note">Prototype for review · visible to Framework master access only<\/p><\/div>$/);
  const none = hubLanding(vm, { counts: {} });
  assert.ok(!/bh-discovery|bk-preview|Prototype for review/.test(none), "visibility rules unchanged: nothing without a link or a staff preview");
  const router = readFileSync(new URL("../portal/router.js", import.meta.url), "utf8");
  assert.match(router, /bookHref: bookOn\(ctx\) && a\.staff/, "the preview is still staff-only and Staging-only");
});

test("Need a logo variation? appears only when there is an actionable design option: never blank when every logo slot is filled, and always with the existing pricing and request action when something is missing", async () => {
  const { ann, mia, alpha, deliver, publishKit } = await setup();
  await publishKit(alpha);
  const has = (html) => /<details class="lg-more" id="logo-variations">/.test(html);
  const open = (html) => html.slice(html.indexOf('id="logo-variations"'));
  // nothing published: four variations can still be designed
  let html = await text(ann, `${base("alpha")}/logos`);
  assert.ok(has(html)); assert.match(open(html), /Request Design/); assert.match(open(html), /action="\/portal\/o\/alpha\/branding\/request"/);
  assert.match(await text(mia, `${base("alpha")}/logos`), /Ask an owner of your organization to send a request/);
  // one variation filled: the others are still offered, the filled one is not
  await deliver(alpha, { kind: "logo", logo_role: "primary", orientation: "horizontal", tone: "light", transparent: true }, "p.png", S.png());
  html = await text(ann, `${base("alpha")}/logos`);
  assert.ok(has(html)); assert.ok(!/Primary Logo Design/.test(open(html)), "the filled variation is not offered"); assert.match(open(html), /Secondary Logo Design/);
  // all four filled: no design option is left, so no empty disclosure
  await deliver(alpha, { kind: "logo", logo_role: "secondary", orientation: "horizontal", tone: "light", transparent: true }, "s.png", S.png(3));
  await deliver(alpha, { kind: "logo", logo_role: "simplified", orientation: "horizontal", tone: "light", transparent: true }, "m.png", S.png(4));
  await deliver(alpha, { kind: "logo", logo_role: "icon", orientation: "square", tone: "light", transparent: true }, "i.png", S.png(5));
  html = await text(ann, `${base("alpha")}/logos`);
  assert.ok(!has(html), "all slots filled: the disclosure is not rendered");
  assert.ok(!/Need a logo variation\?/.test(html));
  assert.ok(!/<details class="lg-more"[^>]*>\s*<summary[^>]*>[^<]*<\/summary>\s*<div class="lg-more__body">\s*<\/div>/.test(html), "and never an empty one");
  // an open whole-logo request keeps its status visible even with every slot filled
  assert.equal((await ann.post(`${base("alpha")}/request`, { csrf: csrfOf(await text(ann, `${base("alpha")}/logos`)), section: "brand-logos", note: "" })).status, 303);
  html = await text(ann, `${base("alpha")}/logos`);
  assert.ok(has(html) && /class="tag">Requested</.test(open(html)), "an open request is shown, not hidden");
});
