/* Branding, logo variations: the client's Logos section always shows four cards (Primary, Secondary, Simplified, Sub-mark). A card with published files shows the real preview and
   a download per format; a card without them shows Framework's own logo for that variation (a static public image, labelled "Example: Framework") and "Not added yet". Framework Admin assigns each logo file to a card through
   the existing "Logo type" (no migration: Secondary is stored as an unset logo_role plus a "secondary-" variant key). Older files keep working and are never guessed into a card. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld, csrfOf } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as brand from "../portal/repo/brand.js";
import { LOGO_VARIATIONS, variationOf } from "../portal/branding-live.js";
import { buildBrandFileName } from "../../admin/assets/brand-names.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const T = () => Math.floor(Date.now() / 1000);
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const ADMIN = "owner@frameworkco.ca";
const base = "/portal/o/alpha/branding";

async function setup() {
  resetKeyCacheForTests();
  const w = await makeWorld();
  const bucket = fakeR2();
  Object.assign(w.env, { PORTAL_BRANDING: "1", PORTAL_FILES: bucket, PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) });
  const A = await w.org("alpha", "Alpha Co"), B = await w.org("beta", "Beta Co");
  await w.invite(A, "ann@alpha.test", "owner"); await w.invite(A, "mia@alpha.test", "member"); await w.invite(B, "bob@beta.test", "owner");
  const ann = w.browser(), mia = w.browser(), bob = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(2, "mia@alpha.test")); await bob.signIn(w.user(3, "bob@beta.test"));
  const call = async (path, { method = "GET", json, form } = {}) => {
    const h = { Origin: ORIGIN, "Cf-Access-Jwt-Assertion": sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: T(), exp: T() + 600 }), ...(method !== "GET" ? { "X-Framework-Admin": "1" } : {}) };
    let body;
    if (form) { const packed = new Response(form); const buf = new Uint8Array(await packed.arrayBuffer()); h["Content-Type"] = packed.headers.get("Content-Type"); h["Content-Length"] = String(buf.length); body = buf; }
    else if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    const res = await handleAdmin(new Request(ORIGIN + "/api/admin" + path, { method, headers: h, body }), w.env, {});
    const type = res.headers.get("Content-Type") || "";
    return { status: res.status, headers: res.headers, json: type.includes("json") ? await res.json() : null };
  };
  const upload = (org, meta, name, bytes) => { const f = new FormData(); f.append("file", new File([bytes], name)); f.append("meta", JSON.stringify(meta)); return call(`/clients/${org.id}/branding/assets`, { method: "POST", form: f }); };
  const publishKit = async (org) => { await brand.saveBrandKit(w.db, org.id, { colours: [{ name: "Ink", role: "primary", hex: "#0A0A0A", note: "" }] }, ADMIN); assert.ok((await brand.setBrandKitStatus(w.db, org.id, "published", ADMIN)).ok); };
  const logo = (role, extra = {}) => ({ kind: "logo", logo_role: role, orientation: "square", tone: "light", published: true, ...extra });
  return { w, A, B, ann, mia, bob, call, upload, publishKit, logo };
}
/** The four cards of the Logos section, in page order. */
const cards = (html) => {
  const logos = html.slice(html.indexOf('id="logo"'), html.indexOf('id="typography"'));
  const parts = logos.split('<li class="lv-card ').slice(1).map((p) => '<li class="lv-card ' + p);
  return parts.map((p) => ({ html: p, has: p.startsWith('<li class="lv-card lv-card--has"'), title: (/lv-card__title">([^<]+)</.exec(p) || [])[1] }));
};

test("the four variations are 01 Primary Logo, 02 Secondary Logo, 03 Simplified Logo and 04 Sub-mark with their descriptions and example images; each Admin logo type maps to exactly one (icon is the Sub-mark)", () => {
  assert.deepEqual(LOGO_VARIATIONS.map((v) => [v.no, v.key, v.title]), [["01", "primary", "Primary Logo"], ["02", "secondary", "Secondary Logo"], ["03", "simplified", "Simplified Logo"], ["04", "submark", "Sub-mark"]]);
  assert.equal(LOGO_VARIATIONS[0].desc, "The main brand identity, typically used for websites, marketing materials, and official communications.");
  assert.equal(LOGO_VARIATIONS[1].desc, "An alternative logo arrangement, useful when the primary layout doesn’t fit the available space.");
  assert.equal(LOGO_VARIATIONS[2].desc, "A reduced wordmark-only variation for applications where a cleaner identity is appropriate.");
  assert.equal(LOGO_VARIATIONS[3].desc, "A compact brand symbol for favicons, social media profiles, watermarks, and small-scale applications.");
  assert.deepEqual(LOGO_VARIATIONS.map((v) => v.example), ["primary", "secondary", "simplified", "submark"].map((k) => `/assets/img/logo-examples/framework-${k}.png`));
  const v = (logoRole, kind = "logo") => variationOf({ kind, logoRole });
  assert.deepEqual([v("primary"), v("secondary"), v("simplified"), v("icon")], ["primary", "secondary", "simplified", "submark"]);
  assert.equal(v(null), null, "no type chosen: not guessed into a card"); assert.equal(v("primary", "document"), null); assert.equal(v("tertiary"), null);
});

test("the four Framework example images are static public assets: real 16:9 PNGs at full size, small, outside private storage, and never referenced as client data", async () => {
  const dir = new URL("../../assets/img/logo-examples/", import.meta.url);
  assert.deepEqual(readdirSync(dir).sort(), ["framework-primary.png", "framework-secondary.png", "framework-simplified.png", "framework-submark.png"]);
  for (const f of readdirSync(dir)) {
    const bytes = readFileSync(new URL(f, dir));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], f + " is a PNG");
    const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
    assert.deepEqual([w, h], [1920, 1080], f + " keeps its original 16:9 size");
    assert.ok(bytes.length < 40000, f + " is light (" + bytes.length + " bytes)");
  }
  // not client data: nothing in the data layer, the file service or the backup refers to the example directory, and no migration or row holds them
  for (const f of ["worker/portal/repo/brand.js", "worker/portal/brand-files.js", "worker/portal/files/storage.js", "worker/portal/file-backup.js", "worker/portal/backup-purge.js", "worker/portal/admin-branding.js"]) assert.ok(!/logo-examples/.test(read(f)), f + " does not know the examples");
  const s = await setup();
  await s.ann.get(base);
  assert.equal(s.w.db.raw.prepare("SELECT count(*) n FROM brand_assets").get().n, 0, "showing the examples creates no asset record");
  assert.equal([...s.w.env.PORTAL_FILES.store.keys()].length, 0, "and nothing in the private bucket");
  assert.deepEqual((await s.call(`/clients/${s.A.id}/branding`)).json.assets, [], "the Admin inventory never lists them");
});

test("with nothing published every client sees the four Framework examples, labelled 'Example: Framework' with the status 'Not added yet', in a fixed order and one frame, with no download", async () => {
  const { ann, mia, bob } = await setup();
  for (const b of [ann, mia]) {
    const html = await (await b.get(base)).text();
    const c = cards(html);
    assert.deepEqual(c.map((x) => x.title), ["Primary Logo", "Secondary Logo", "Simplified Logo", "Sub-mark"]);
    assert.deepEqual([...sectionHtml(html, "logo").matchAll(/class="lv-card__no" aria-hidden="true">(\d\d)</g)].map((m) => m[1]), ["01", "02", "03", "04"]);
    assert.ok(c.every((x) => !x.has && x.html.startsWith('<li class="lv-card lv-card--example">')));
    const files = ["primary", "secondary", "simplified", "submark"];
    c.forEach((x, i) => {
      assert.match(x.html, new RegExp(`<img src="/assets/img/logo-examples/framework-${files[i]}\\.png" alt="Example: the Framework [^"]+" width="1920" height="1080" loading="lazy" decoding="async">`));
      assert.match(x.html, /<p class="lv-card__meta muted small">Example: Framework<\/p>/); assert.match(x.html, /<span class="tag">Not added yet<\/span>/);
      assert.ok(!/<a |Download|\/branding\/files\//.test(x.html), "no link and no download on an example card");
      assert.ok(!/lv-card__stage--logo/.test(x.html));
    });
    assert.match(html, /Cards labelled “Example: Framework” show Framework’s own logo to illustrate that variation\. They are not your logos and are not available to download\./);
    assert.match(html, /<h2 class="bk-sec__title" id="h-logo"><span class="visually-hidden">01 <\/span>Logo <span class="bk-req bk-req--required">/);
  }
  assert.deepEqual(cards(await (await bob.get("/portal/o/beta/branding")).text()).map((x) => x.title), ["Primary Logo", "Secondary Logo", "Simplified Logo", "Sub-mark"]);
});

test("Admin assigns each file with 'Logo type': every type lands on its own card and replaces only that placeholder; the rest stay examples until their files are added", async () => {
  const s = await setup();
  await s.publishKit(s.A);
  const order = [["primary", "Primary Logo"], ["secondary", "Secondary Logo"], ["simplified", "Simplified Logo"], ["icon", "Sub-mark"]];
  const filled = new Set();
  for (const [role, title] of order) {
    const up = await s.upload(s.A, s.logo(role, { orientation: role === "secondary" ? "horizontal" : "square" }), `${role}.png`, S.png(20, 20));
    assert.equal(up.status, 201, JSON.stringify(up.json));
    filled.add(title);
    const html = await (await s.ann.get(base)).text();
    const c = cards(html);
    assert.deepEqual(c.map((x) => [x.title, x.has]), order.map(([, t]) => [t, filled.has(t)]), `after adding ${role}`);
    const card = c.find((x) => x.title === title);
    assert.match(card.html, /<img src="[^"]*\/branding\/files\/[0-9a-f-]{36}\?preview=1" alt="/);
    assert.equal([...sectionHtml(await (await s.ann.get(base)).text(), "logo").matchAll(/logo-examples\/framework-/g)].length, 4 - filled.size, "only the other examples remain"); assert.match(card.html, /<span class="tag">Available<\/span>/); assert.match(card.html, /Download PNG/);
    assert.ok(!/Example: Framework|logo-examples/.test(card.html), "the Framework example is gone from a real logo");
  }
  assert.deepEqual(cards(await (await s.ann.get(base)).text()).map((x) => x.has), [true, true, true, true]);
  assert.ok(!/Example: Framework|logo-examples/.test(sectionHtml(await (await s.ann.get(base)).text(), "logo")), "no example text or image once all four are real");
});

test("Secondary needs no migration: it is stored as an unset logo_role with a 'secondary-' variant key, shown to Admin as Secondary, named Secondary, and a bad type is refused", async () => {
  const s = await setup();
  const up = await s.upload(s.A, s.logo("secondary", { orientation: "horizontal", tone: "dark", transparent: true }), "wide.svg", S.svg());
  assert.equal(up.status, 201); assert.equal(up.json.name, "Alpha-Co-Secondary-Horizontal-Dark-Transparent.svg");
  const row = s.w.db.raw.prepare("SELECT logo_role, variant_key, title FROM brand_assets WHERE id = ?").get(up.json.id);
  assert.deepEqual([row.logo_role, row.variant_key, row.title], [null, "secondary-horizontal-dark-transparent", "Secondary logo, horizontal, dark, transparent"]);
  const listed = (await s.call(`/clients/${s.A.id}/branding`)).json.assets.find((a) => a.id === up.json.id);
  assert.equal(listed.logoRole, "secondary", "Admin sees the type it chose");
  assert.throws(() => s.w.db.raw.prepare("INSERT INTO brand_assets (id, organization_id, kind, title, logo_role, format, content_type, size_bytes, sha256, storage_key, original_name, created_by) VALUES (?, ?, 'logo', 't', 'secondary', 'png', 'image/png', 1, ?, ?, 'x.png', 'a')").run(crypto.randomUUID(), s.A.id, "a".repeat(64), "org/" + "a".repeat(40)), "the database CHECK still allows only the three older values, which is why no migration is needed");
  const bad = await s.upload(s.A, s.logo("tertiary"), "x.png", S.png());
  assert.deepEqual([bad.status, bad.json.error], [422, "invalid_logo_role"]);
  assert.deepEqual(readdirSync(new URL("../../migrations/portal/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort(), ["0001_portal_foundation.sql", "0002_business_profile.sql", "0003_portal_feedback.sql", "0004_invitation_delivery.sql", "0005_branding.sql", "0006_brand_name.sql", "0007_client_services.sql", "0008_approved_emails.sql", "0009_brand_sections.sql", "0010_service_pricing.sql"], "no new migration");
});

test("several formats in one variation: every format downloads, the preview uses an image format, and a PDF-only variation shows a plain tile with its download", async () => {
  const s = await setup();
  await s.publishKit(s.A);
  const ids = {};
  for (const [name, bytes] of [["p.pdf", S.pdf()], ["p.eps", S.eps()], ["p.png", S.png(30, 30)], ["p.svg", S.svg()]]) { const r = await s.upload(s.A, s.logo("primary"), name, bytes); assert.equal(r.status, 201, JSON.stringify(r.json)); ids[name] = r.json.id; }
  const pdfOnly = await s.upload(s.A, s.logo("simplified"), "s.pdf", S.pdf()); assert.equal(pdfOnly.status, 201);
  const c = cards(await (await s.ann.get(base)).text());
  const primary = c[0].html, simplified = c[2].html;
  assert.deepEqual([...primary.matchAll(/Download ([A-Z]+)</g)].map((m) => m[1]), ["SVG", "PNG", "EPS", "PDF"], "SVG and PNG first, then the other formats, all on ONE card");
  assert.equal([...c.map((x) => x.title)].length, 4, "formats never add cards");
  for (const id of Object.values(ids)) assert.ok(primary.includes(`/branding/files/${id}"`), "download link: " + id);
  assert.match(primary, new RegExp(`<img src="[^"]*files/${ids["p.svg"]}\\?preview=1"`), "the SVG is the preview");
  assert.match(primary, /SVG · PNG · EPS · PDF/);
  assert.ok(!/<img/.test(simplified) && /No preview for this format/.test(simplified) && /Download PDF/.test(simplified) && /lv-card__stage--file/.test(simplified));
  for (const id of Object.values(ids)) { const dl = await s.ann.get(`${base}/files/${id}`); assert.equal(dl.status, 200); assert.match(dl.headers.get("content-disposition") || "", /attachment/); }
  assert.equal((await s.mia.get(`${base}/files/${ids["p.png"]}`)).status, 200, "members still download");
  assert.equal((await s.bob.get(`/portal/o/beta/branding/files/${ids["p.png"]}`)).status, 404, "another organization cannot");
  assert.equal((await s.bob.get(`${base}/files/${ids["p.png"]}`)).status, 404);
});

test("more than one version of a variation (for example light and dark): the card previews the first, downloads it, and lists every version under 'All versions'", async () => {
  const s = await setup();
  await s.publishKit(s.A);
  await s.upload(s.A, s.logo("primary", { tone: "dark" }), "dark.png", S.png(10, 10));
  await s.upload(s.A, s.logo("primary", { tone: "light" }), "light.png", S.png(11, 11));
  await s.upload(s.A, s.logo("primary", { tone: "light" }), "light.svg", S.svg());
  const primary = cards(await (await s.ann.get(base)).text())[0].html;
  assert.match(primary, /<summary>All versions \(2\)<\/summary>/);
  assert.match(primary, /2 versions/);
  assert.equal([...primary.matchAll(/For light backgrounds/g)].length >= 1 && [...primary.matchAll(/For dark backgrounds/g)].length >= 1, true);
  assert.equal([...primary.matchAll(/Download [A-Z]+</g)].length, 5, "two buttons for the shown light version and one per file under All versions");
  assert.ok(!/lv-card__stage--dark/.test(primary), "the light version is the preview");
});

test("only published files count: a draft file, an unpublished kit and an archived file leave the example in place", async () => {
  const s = await setup();
  await s.upload(s.A, s.logo("primary", { published: false }), "draft.png", S.png());
  assert.ok(cards(await (await s.ann.get(base)).text()).every((x) => !x.has), "kit not published: all examples");
  await s.publishKit(s.A);
  assert.ok(cards(await (await s.ann.get(base)).text()).every((x) => !x.has), "a draft file is not shown");
  const pub = await s.upload(s.A, s.logo("simplified"), "s.png", S.png());
  assert.deepEqual(cards(await (await s.ann.get(base)).text()).map((x) => x.has), [false, false, true, false]);
  await s.call(`/clients/${s.A.id}/branding/assets/${pub.json.id}/delete`, { method: "POST", json: {} });
  assert.deepEqual(cards(await (await s.ann.get(base)).text()).map((x) => x.has), [false, false, false, false], "deleted: back to the example");
});

test("existing logos keep working: files with an explicit older type land on their card, files with no type are listed as 'Other logo files' and stay downloadable, nothing is guessed", async () => {
  const s = await setup();
  await s.publishKit(s.A);
  const deps = { db: s.w.db, bucket: s.w.env.PORTAL_FILES, env: s.w.env, now: s.w.clock.now() };
  // an older primary logo (horizontal): stays Primary, is NOT mistaken for Secondary
  const old = await s.upload(s.A, s.logo("primary", { orientation: "horizontal" }), "old.png", S.png());
  // an older file with no logo type at all (inserted the way a pre-naming record looks)
  const { putObject, makeKey } = await import("../portal/files/index.js");
  const key = makeKey(s.A.id, "brand-assets"); const bytes = S.png(9, 9);
  const inspected = { sha256: [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join(""), contentType: "image/png" };
  await putObject(s.w.env.PORTAL_FILES, { key, organizationId: s.A.id, bytes, sha256: inspected.sha256, contentType: inspected.contentType });
  s.w.db.raw.prepare("INSERT INTO brand_assets (id, organization_id, kind, title, variant_key, logo_role, orientation, tone, transparent, format, content_type, size_bytes, sha256, storage_key, original_name, published, created_by) VALUES (?, ?, 'logo', 'Legacy logo', 'legacy-mark', NULL, 'square', 'light', 0, 'png', 'image/png', ?, ?, ?, 'Legacy-Mark.png', 1, 'seed')").run("11111111-1111-4111-8111-111111111111", s.A.id, bytes.length, inspected.sha256, key);
  const html = await (await s.ann.get(base)).text();
  const c = cards(html);
  assert.deepEqual(c.map((x) => x.has), [true, false, false, false], "only Primary is filled; the older horizontal primary is not moved to Secondary and the untyped file takes no card");
  assert.match(html, /<p class="acc__group">Other logo files<\/p>/);
  assert.ok(html.includes("/branding/files/11111111-1111-4111-8111-111111111111"), "the untyped file is still listed and downloadable");
  assert.equal((await s.ann.get(`${base}/files/11111111-1111-4111-8111-111111111111`)).status, 200);
  assert.ok(html.includes(`/branding/files/${old.json.id}"`));
  // Admin can place the untyped file on a card by choosing a type; it then leaves the list
  const fixed = await s.call(`/clients/${s.A.id}/branding/assets/11111111-1111-4111-8111-111111111111/update`, { method: "POST", json: { logo_role: "icon" } });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.json));
  const after = await (await s.ann.get(base)).text();
  assert.deepEqual(cards(after).map((x) => x.has), [true, false, false, true]);
  assert.ok(!/Other logo files/.test(after));
  assert.equal(deps.db, s.w.db);
});

test("Admin can move a file to another card: choosing a different Logo type renames it and the card moves with it; the coverage line and labels name the four types", async () => {
  const s = await setup();
  await s.publishKit(s.A);
  const up = await s.upload(s.A, s.logo("icon"), "m.png", S.png());
  assert.equal(up.json.name, "Alpha-Co-Submark-Square-Light.png", "new Sub-mark files are named Submark");
  assert.deepEqual(cards(await (await s.ann.get(base)).text()).map((x) => x.has), [false, false, false, true]);
  const moved = await s.call(`/clients/${s.A.id}/branding/assets/${up.json.id}/update`, { method: "POST", json: { logo_role: "secondary", orientation: "horizontal" } });
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  assert.equal(s.w.db.raw.prepare("SELECT original_name FROM brand_assets WHERE id = ?").get(up.json.id).original_name, "Alpha-Co-Secondary-Horizontal-Light.png");
  assert.deepEqual(cards(await (await s.ann.get(base)).text()).map((x) => x.has), [false, true, false, false]);
  const ui = read("admin/assets/branding.js");
  assert.match(ui, /const LOGO_ROLE = \{ primary: "Primary", secondary: "Secondary", simplified: "Simplified", icon: "Sub-mark" \}/);
  assert.match(ui, /Which of the four logo cards on the client’s Branding page this file belongs to/);
  assert.match(ui, /function logoCards\(\)/); assert.match(ui, /Other logo files/);
  assert.equal(buildBrandFileName({ company: "Alpha", kind: "logo", logo: { role: "secondary", orientation: "horizontal", tone: "light" }, ext: "svg" }).name, "Alpha-Secondary-Horizontal-Light.svg");
});

test("the request workflow is unchanged under the cards: an owner can request logos (or more variations), the status replaces the button, duplicates are refused and a member is told to ask an owner", async () => {
  const s = await setup();
  let html = await (await s.ann.get(base)).text();
  const logosEmpty = html.slice(html.indexOf('id="logo"'), html.indexOf('id="typography"'));
  assert.match(logosEmpty, /<summary class="btn btn--primary">Request Design<span/, "each missing variation has its own black Request Design button");
  assert.match(await (await s.mia.get(base)).text(), /Ask an owner of your organization to send a request for this section/);
  const send = (b, extra = {}) => b.post(`${base}/request`, { csrf: csrfOf(html), section: "brand-logos", ...extra });
  assert.equal((await send(s.ann)).headers.get("Location"), `${base}?requested=1`);
  assert.equal((await send(s.ann)).headers.get("Location"), `${base}?requested=0`, "a second press is the friendly 'already open'");
  assert.equal((await send(s.mia, { csrf: csrfOf(await (await s.mia.get(base)).text()) })).status, 403, "members cannot request");
  html = await (await s.ann.get(base)).text();
  assert.match(html.slice(html.indexOf('id="logo"'), html.indexOf('id="typography"')), /class="tag">Requested</);
  // with a real logo the button offers additions or changes
  const s2 = await setup(); await s2.publishKit(s2.A); await s2.upload(s2.A, s2.logo("primary"), "p.png", S2());
  assert.match((await (await s2.ann.get(base)).text()).slice(0), /Request additions or changes/);
});
const S2 = () => S.png(12, 12);

test("layout and a11y wiring: one column on a phone, two on a tablet, four on a desktop; fixed card proportions; headings, labels and no inline style or script", async () => {
  const css = read("assets/css/portal.css");
  assert.match(css, /\.lv-grid \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /@media \(min-width: 600px\) \{ \.lv-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \} \}/);
  assert.match(css, /@media \(min-width: 1024px\) \{ \.lv-grid \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \} \}/);
  assert.match(css, /\.lv-card__stage \{[^}]*aspect-ratio: 16 \/ 9[^}]*border: 1px solid var\(--hairline\)/);
  assert.match(css, /\.lv-card__stage img \{[^}]*object-fit: contain/, "artwork is contained, never cropped or stretched");
  assert.match(css, /--hairline: #E0E0E0/);
  assert.ok(!/\.lv-card \{[^}]*(border:|box-shadow|border-radius)/.test(css), "no box around the card, no shadow, sharp corners");
  const s = await setup();
  const html = await (await s.ann.get(base)).text();
  assert.ok(!/\sstyle=|<script[^>]*>[^<]|onclick=/i.test(html.replace(/<script[^>]*src=[^>]*><\/script>/g, "")), "no inline style, script or handler");
  const logos = html.slice(html.indexOf('id="logo"'), html.indexOf('id="typography"'));
  assert.equal([...logos.matchAll(/<h3 class="lv-card__title">/g)].length, 4);
  assert.equal([...logos.matchAll(/alt="Example: the Framework /g)].length, 4, "every example image has a descriptive alternative text");
});

test("Admin cards: the page shows four permanent cards with the client page's text, the upload dialog fixes the logo type, and no Version field exists anywhere", () => {
  const ui = read("admin/assets/branding.js"), names = read("admin/assets/brand-names.js"), shared = read("admin/assets/logo-variations.js");
  assert.match(shared, /export const LOGO_VARIATIONS/);
  assert.match(read("worker/portal/branding-live.js"), /import \{ LOGO_VARIATIONS \} from "..\/..\/admin\/assets\/logo-variations.js"/, "the client page and Admin share one catalogue");
  assert.match(ui, /import \{ LOGO_VARIATIONS \} from "\.\/logo-variations\.js"/);
  assert.match(ui, /function logoCard\(def, files\)/); assert.match(ui, /const openLogoUpload = \(def\) => openUpload\(/);
  assert.match(ui, /fixedRole: def\.role/, "the card chooses the logo type");
  assert.match(ui, /"Upload logo"/); assert.match(ui, /"Add format"/); assert.match(ui, /Manage files \(/); assert.match(ui, /Example: Framework/);
  assert.match(ui, /Other logo files \(/);
  assert.ok(!/"Version"/.test(ui) && !/-tone/.test(ui) && !/TONE_FORM/.test(ui), "no Version field in the Admin logo forms");
  assert.ok(!/version/i.test(names.replace(/\/\*[\s\S]*?\*\//, "")), "the name builder no longer asks for a version");
  assert.match(ui, /LOGO_ACCEPT = "\.svg,\.png,\.jpg,\.jpeg,\.webp,\.pdf,\.ai,\.eps"/);
  const css = read("admin/assets/admin.css");
  assert.match(css, /\.adm-lv-grid \{[^}]*grid-template-columns: minmax\(0, 1fr\)/); assert.match(css, /min-width: 600px\) \{ \.adm-lv-grid \{ grid-template-columns: repeat\(2/); assert.match(css, /min-width: 1280px\) \{ \.adm-lv-grid \{ grid-template-columns: repeat\(4/);
  assert.match(css, /\.adm-lv__stage \{[^}]*aspect-ratio: 16 \/ 9[^}]*border: 1px solid var\(--hairline\)[^}]*border-radius: 0/);
  assert.ok(!/\.adm-lv[^{]*\{[^}]*(box-shadow|border-radius: [1-9])/.test(css), "no shadows or rounded corners");
});

test("a logo is uploaded without a version: the card's type and the shape are enough, the file name has no background word, formats share one stem and one card, and the file can still be downloaded", async () => {
  const s = await setup(); await s.publishKit(s.A);
  const meta = { kind: "logo", logo_role: "primary", orientation: "square", published: true };
  const png = await s.upload(s.A, meta, "a.png", S.png());
  assert.equal(png.status, 201, JSON.stringify(png.json));
  assert.equal(png.json.name, "Alpha-Co-Primary-Square.png");
  for (const [n, bytes, ext] of [["a.svg", S.svg(), "svg"], ["a.pdf", S.pdf(), "pdf"], ["a.eps", S.eps(), "eps"], ["a.jpg", S.jpeg(), "jpg"], ["a.webp", S.webp(), "webp"]]) {
    const r = await s.upload(s.A, meta, n, bytes); assert.equal(r.status, 201, n + JSON.stringify(r.json)); assert.equal(r.json.name, "Alpha-Co-Primary-Square." + ext);
  }
  assert.equal(s.w.db.raw.prepare("SELECT COUNT(*) AS n FROM brand_assets WHERE tone IS NOT NULL").get().n, 0, "no version is stored for new files");
  const html = await (await s.ann.get(base)).text();
  assert.deepEqual(cards(html).map((x) => x.has), [true, false, false, false], "all six formats sit on the Primary card; the others keep their examples");
  assert.equal((await s.call(`/clients/${s.A.id}/branding/assets/${png.json.id}/download`)).status, 200);
  assert.equal((await s.upload(s.A, meta, "dup.png", S.png(9, 9))).json.error, "duplicate_name", "the same type, shape and format is never silently overwritten");
  const view = await s.call(`/clients/${s.A.id}/branding`);
  assert.equal(view.json.assets.filter((a) => a.logoRole === "primary").length, 6);
});

test("existing records keep their version: files with a stored background keep their name and value, and editing other details never touches it", async () => {
  const s = await setup(); await s.publishKit(s.A);
  const old = await s.upload(s.A, s.logo("primary", { tone: "dark" }), "o.png", S.png());
  assert.equal(old.json.name, "Alpha-Co-Primary-Square-Dark.png", "the API still accepts a background for older integrations");
  const note = await s.call(`/clients/${s.A.id}/branding/assets/${old.json.id}/update`, { method: "POST", json: { usage_note: "On dark backgrounds", logo_role: "primary", orientation: "square", transparent: false } });
  assert.equal(note.status, 200);
  const row = s.w.db.raw.prepare("SELECT tone, original_name FROM brand_assets WHERE id = ?").get(old.json.id);
  assert.deepEqual([row.tone, row.original_name], ["dark", "Alpha-Co-Primary-Square-Dark.png"]);
  const moved = await s.call(`/clients/${s.A.id}/branding/assets/${old.json.id}/update`, { method: "POST", json: { logo_role: "secondary", orientation: "square", transparent: false } });
  assert.equal(moved.status, 200);
  assert.equal(s.w.db.raw.prepare("SELECT tone FROM brand_assets WHERE id = ?").get(old.json.id).tone, "dark", "a move between cards keeps the stored value");
  assert.deepEqual(cards(await (await s.ann.get(base)).text()).map((x) => x.has), [false, true, false, false]);
});

test("Admin picture preview: a logo image is shown inline from the existing download route, is not counted as a download, other kinds and other clients are refused", async () => {
  const s = await setup();
  const up = await s.upload(s.A, s.logo("primary"), "a.png", S.png());
  const guide = await s.upload(s.A, { kind: "guideline", title: "Brand guidelines" }, "g.pdf", S.pdf());
  const count = () => s.w.db.raw.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE action = 'brand.asset.download'").get().n;
  const before = count();
  const pic = await s.call(`/clients/${s.A.id}/branding/assets/${up.json.id}/download?preview=1`);
  assert.equal(pic.status, 200); assert.equal(pic.headers.get("Content-Disposition"), "inline"); assert.equal(pic.headers.get("Content-Type"), "image/png");
  assert.match(pic.headers.get("Content-Security-Policy"), /sandbox/); assert.equal(count(), before, "a preview is not a download");
  const dl = await s.call(`/clients/${s.A.id}/branding/assets/${up.json.id}/download`);
  assert.match(dl.headers.get("Content-Disposition"), /attachment/); assert.equal(count(), before + 1, "a real download is still recorded");
  assert.equal((await s.call(`/clients/${s.A.id}/branding/assets/${guide.json.id}/download?preview=1`)).status, 404, "only logos are ever shown as pictures");
  assert.equal((await s.call(`/clients/${s.B.id}/branding/assets/${up.json.id}/download?preview=1`)).status, 404, "another client's file is never reachable");
});

/* ------------------------------------------------------------------ the nine numbered sections */

const SECTIONS = [["01", "logo", "Logo"], ["02", "typography", "Typography"], ["03", "colours", "Brand Colours"], ["04", "tagline", "Tagline"], ["05", "imagery", "Brand Imagery"], ["06", "layout", "Layout System"], ["07", "textures", "Textures"], ["08", "iconography", "Iconography"], ["09", "style", "Design Style"]];
const sectionHtml = (html, key) => { const i = html.indexOf(`<section class="bk-sec" id="${key}"`); const j = html.indexOf("</section>", i); return html.slice(i, j); };

test("the nine sections are one shared catalogue: exact numbers, names and order for the client page and Admin, all always shown", async () => {
  const { BRAND_SECTIONS } = await import("../../admin/assets/brand-sections.js");
  assert.deepEqual(BRAND_SECTIONS.map((d) => [d.no, d.key, d.title]), SECTIONS);
  for (const d of BRAND_SECTIONS) { assert.ok(d.desc.length > 20 && d.desc.length < 140, d.key); assert.equal(d.id, d.key); }
  const ui = read("admin/assets/branding.js");
  assert.match(ui, /import \{ BRAND_SECTIONS, SECTION_FILE_KEYS, TYPE_SLOT_DEFS, sectionOf \} from "\.\/brand-sections\.js"/);
  assert.match(ui, /logoSection\(\), typographySection\(\), coloursSection\(\), taglineSection\(\), \.\.\.\["imagery", "layout", "textures", "iconography", "style"\]\.map/, "Admin lists the same nine, in order");
  assert.ok(ui.indexOf("logoSection(), typographySection()") < ui.lastIndexOf("otherFilesSection()"), "documents and other files come after the nine");
  const s = await setup();
  for (const b of [s.ann, s.mia]) {
    const html = await (await b.get(base)).text();
    assert.deepEqual([...html.matchAll(/<section class="bk-sec" id="(\w+)"/g)].map((m) => m[1]), SECTIONS.map((x) => x[1]));
    assert.deepEqual([...html.matchAll(/<p class="bk-sec__no" aria-hidden="true">(\d\d)</g)].map((m) => m[1]), SECTIONS.map((x) => x[0]));
  }
});

test("empty sections show a muted Framework example, labelled 'Example: Framework' with 'Not added yet', with no link, copy button or download; Typography shows its own example cards", async () => {
  const s = await setup();
  const html = await (await s.ann.get(base)).text();
  const { BRAND_SECTIONS } = await import("../../admin/assets/brand-sections.js");
  for (const d of BRAND_SECTIONS.filter((x) => !["logo", "typography"].includes(x.key))) {
    const sec = sectionHtml(html, d.key);
    assert.ok(sec.includes('<div class="bk-eg bk-eg--'), d.key + " has its example panel");
    assert.ok(sec.includes('<span class="tag">Not added yet</span> <span class="bk-eg__tag">Example: Framework</span>'), d.key + " is labelled an example");
    const eg = sec.slice(sec.indexOf('<div class="bk-eg')); // the offer above it carries the free-upload link; the example itself carries nothing
    assert.ok(!/Download|data-copy|<a /.test(eg), d.key + " offers nothing to download or copy");
    assert.ok(!/bk-empty/.test(sec), d.key + " no longer shows a bare empty state");
  }
  const type = sectionHtml(html, "typography");
  assert.equal([...type.matchAll(/tf-card--example/g)].length, 3); assert.ok(!/Download|data-copy/.test(type));
});

test("files Admin places in sections 05 to 09 show in that section only: previews for images, a file tile otherwise, downloads, never in the other-files list, other clients never see them", async () => {
  const s = await setup(); await s.publishKit(s.A); await s.publishKit(s.B);
  const put = (org, section, name, bytes, extra = {}) => s.upload(org, { kind: "other", title: extra.title || name.replace(/\..*/, ""), section, published: true, ...extra }, name, bytes);
  const img = await put(s.A, "imagery", "Hero.png", S.png(), { title: "Hero photo" });
  const lay = await put(s.A, "layout", "Grid.pdf", S.pdf(), { title: "Grid guide" });
  const tex = await put(s.A, "textures", "Paper.svg", S.svg(), { title: "Paper" });
  const ico = await put(s.A, "iconography", "Icons.png", S.png(9, 9), { title: "Icon set" });
  const sty = await put(s.A, "style", "Mood.webp", S.webp(), { title: "Mood board" });
  for (const r of [img, lay, tex, ico, sty]) assert.equal(r.status, 201, JSON.stringify(r.json));
  const legacy = await s.upload(s.A, { kind: "other", title: "Old brochure", published: true }, "brochure.pdf", S.pdf());
  const theirs = await put(s.B, "imagery", "Beta.png", S.png(7, 7), { title: "Beta photo" });
  const html = await (await s.ann.get(base)).text();
  const inSec = (key, id) => sectionHtml(html, key).includes(`/branding/files/${id}`);
  assert.ok(inSec("imagery", img.json.id) && inSec("layout", lay.json.id) && inSec("textures", tex.json.id) && inSec("iconography", ico.json.id) && inSec("style", sty.json.id));
  assert.ok(!inSec("imagery", lay.json.id) && !inSec("layout", img.json.id), "each file only in its own section");
  assert.match(sectionHtml(html, "imagery"), new RegExp(`<img src="/portal/o/alpha/branding/files/${img.json.id}\\?preview=1" alt="Hero photo"`));
  assert.match(sectionHtml(html, "layout"), /bk-tile__ext">PDF</, "a PDF is a file tile, not a picture");
  assert.match(sectionHtml(html, "imagery"), /Download<span class="visually-hidden"> Hero photo \(PNG/);
  const more = html.slice(html.indexOf('id="additional"'));
  assert.ok(more.includes(legacy.json.id), "an older 'other' file with no section stays under Documents and other files");
  for (const id of [img, lay, tex, ico, sty]) assert.ok(!more.includes(id.json.id), "a placed file is not repeated there");
  assert.ok(!html.includes(theirs.json.id) && !html.includes("Beta photo"), "another client's file is not in this page");
  assert.equal((await s.ann.get(`${base}/files/${img.json.id}?preview=1`)).status, 200);
  assert.equal((await s.ann.get(`${base}/files/${theirs.json.id}?preview=1`)).status, 404, "nor reachable");
  assert.equal((await s.bob.get(`${base}/files/${img.json.id}`)).status, 404);
  assert.equal((await s.ann.get(`${base}/files/${legacy.json.id}?preview=1`)).status, 404, "a file with no section is never shown as a picture");
  assert.equal((await s.ann.get(`${base}/files/${legacy.json.id}`)).status, 200, "but it still downloads");
});

test("Admin places, moves and removes a file from a section explicitly: nothing is reclassified silently, other kinds can't be placed, unknown sections are refused", async () => {
  const s = await setup(); await s.publishKit(s.A);
  const old = await s.upload(s.A, { kind: "other", title: "Older file", published: true }, "o.png", S.png());
  assert.equal((await s.call(`/clients/${s.A.id}/branding`)).json.assets.find((a) => a.id === old.json.id).variantKey, null, "unplaced stays unplaced");
  const nameBefore = s.w.db.raw.prepare("SELECT original_name FROM brand_assets WHERE id = ?").get(old.json.id).original_name;
  const move = (section) => s.call(`/clients/${s.A.id}/branding/assets/${old.json.id}/update`, { method: "POST", json: { section } });
  assert.equal((await move("textures")).status, 200);
  const row = () => s.w.db.raw.prepare("SELECT variant_key, original_name, kind FROM brand_assets WHERE id = ?").get(old.json.id);
  assert.deepEqual([row().variant_key, row().original_name, row().kind], ["section-textures", nameBefore, "other"], "only the placement changes, not the name or kind");
  assert.match(sectionHtml(await (await s.ann.get(base)).text(), "textures"), /branding\/files\//);
  assert.equal((await move("style")).status, 200); assert.equal(row().variant_key, "section-style");
  const renamed = await s.call(`/clients/${s.A.id}/branding/assets/${old.json.id}/update`, { method: "POST", json: { title: "Better name" } });
  assert.equal(renamed.status, 200); assert.equal(row().variant_key, "section-style", "renaming keeps the section");
  assert.equal((await move(null)).status, 200); assert.equal(row().variant_key, null, "taken back out of the section");
  assert.equal((await move("tagline")).json.error, "invalid_section");
  assert.equal((await move("logo")).json.error, "invalid_section");
  const font = await s.upload(s.A, { kind: "font", title: "Face", downloadable: false, published: true }, "f.ttf", S.ttf());
  assert.equal((await s.call(`/clients/${s.A.id}/branding/assets/${font.json.id}/update`, { method: "POST", json: { section: "imagery" } })).json.error, "invalid_section", "only 'other' files can be placed");
  assert.equal((await s.upload(s.A, { kind: "guideline", title: "G", section: "imagery" }, "g.pdf", S.pdf())).json.error, "invalid_section");
  assert.equal((await s.upload(s.A, { kind: "other", title: "Q", section: "bogus" }, "q.png", S.png())).json.error, "invalid_section");
});

test("typography and colours: families, weights, example text and codes render; HEX and RGB each have a copy control; fonts keep their downloads", async () => {
  const s = await setup();
  await brand.saveBrandKit(s.w.db, s.A.id, { colours: [{ name: "Ink", role: "primary", hex: "#0A0A0A", note: "" }, { name: "Signal", role: "accent", hex: "#B3261E", note: "" }], typography: [{ role: "heading", family: "Switzer", weights: [400, 700], usage: "Headings", source_url: null }] }, ADMIN);
  await s.upload(s.A, { kind: "font", title: "Switzer Regular", downloadable: true, license_note: "OFL", published: true }, "f.ttf", S.ttf());
  assert.ok((await brand.setBrandKitStatus(s.w.db, s.A.id, "published", ADMIN)).ok);
  const html = await (await s.ann.get(base)).text();
  const type = sectionHtml(html, "typography");
  assert.match(type, /type__family">Switzer</); assert.match(type, /Regular <span class="muted">400<\/span>/); assert.match(type, /Bold <span class="muted">700<\/span>/);
  assert.match(type, /bk-type__sample">The quick brown fox/); assert.match(type, /Download TTF/);
  const col = sectionHtml(html, "colours");
  assert.match(col, /data-copy="#0A0A0A"/); assert.match(col, /data-copy="10, 10, 10"/); assert.match(col, /data-copy="179, 38, 30"/); assert.match(col, /RGB <code>10, 10, 10<\/code>/);
  assert.match(sectionHtml(html, "tagline"), /bk-eg--tagline/, "the tagline shows its example: text isn't stored yet");
});

test("requests, uploads and permissions are unchanged by the nine-section layout", async () => {
  const s = await setup();
  const html = await (await s.ann.get(base)).text();
  assert.match(sectionHtml(html, "logo"), /<summary class="btn btn--primary">Request Design<span/);
  assert.match(sectionHtml(html, "typography"), /<summary class="btn btn--primary">Request Design<span/);
  assert.match(sectionHtml(html, "colours"), /<summary class="btn btn--primary">Request Design<span/);
  assert.match(html.slice(html.indexOf('id="guidelines"')), /<summary class="btn btn--small">Request<span/);
  assert.match(html, /href="\/portal\/o\/alpha\/branding\/uploads"/);
  assert.match(await (await s.mia.get(base)).text(), /Ask an owner of your organization/);
  assert.equal((await s.bob.get("/portal/o/alpha/branding")).status, 404, "another organization still can't open it");
});

/* ------------------------------------------------------------------ 02 Typography: three slots, specimens, hierarchy; pricing presentation (inactive) */

const TF = (extra = {}) => ({ role: "heading", family: "Switzer", weights: [400, 700], usage: "Headlines and titles", source_url: null, ...extra });
const saveType = (s, org, typography) => s.call(`/clients/${org.id}/branding/kit`, { method: "PUT", json: { typography } });
const font = (s, org, title, extra = {}) => s.upload(org, { kind: "font", title, downloadable: true, license_note: "OFL", published: true, ...extra }, title.replace(/\W+/g, "-") + ".ttf", S.ttf());
const publishOnly = async (s, org) => { assert.ok((await brand.saveBrandKit(s.w.db, org.id, {}, ADMIN)).ok); assert.ok((await brand.setBrandKitStatus(s.w.db, org.id, "published", ADMIN)).ok); };

test("typeface records: a slot, styles and font files are optional and validated; older records still validate and gain empty values; one slot can't be used twice", () => {
  const ok = (l) => brand.normaliseTypography(l);
  const legacy = ok([{ role: "heading", family: "Switzer", weights: [400, 600], usage: "x", source_url: null }]);
  assert.ok(legacy.ok); assert.deepEqual(legacy.value[0], { family: "Switzer", role: "heading", slot: null, weights: [400, 600], styles: [], usage: "x", source_url: null, file_ids: [] });
  const id = "11111111-1111-4111-8111-111111111111";
  const full = ok([TF({ slot: "primary", styles: ["italic", "normal"], file_ids: [id.toUpperCase()] }), TF({ family: "Switzer", role: "body", slot: "secondary" })]);
  assert.ok(full.ok, "one family may fill several roles"); assert.deepEqual(full.value[0].styles, ["normal", "italic"]); assert.deepEqual(full.value[0].file_ids, [id]);
  for (const bad of [{ slot: "tertiary" }, { styles: ["bold"] }, { file_ids: ["not-an-id"] }, { file_ids: new Array(7).fill(id) }]) assert.equal(ok([TF(bad)]).ok, false, JSON.stringify(bad));
  assert.equal(ok([TF({ slot: "primary" }), TF({ family: "Other", slot: "primary" })]).ok, false, "a slot holds one typeface");
});

test("Admin assigns typefaces to Primary, Secondary and Accent and picks their font files; a file of another client or a deleted file is refused; removing a typeface leaves the rest", async () => {
  const s = await setup(); await publishOnly(s, s.A);
  const mine = (await font(s, s.A, "Switzer Regular")).json.id, theirs = (await font(s, s.B, "Beta Sans")).json.id;
  assert.equal((await saveType(s, s.A, [TF({ slot: "primary", file_ids: [theirs] })])).status, 422, "another organization's file");
  assert.equal((await saveType(s, s.A, [TF({ slot: "primary", file_ids: ["99999999-9999-4999-8999-999999999999"] })])).status, 422, "an unknown file");
  const saved = await saveType(s, s.A, [TF({ slot: "primary", file_ids: [mine] }), TF({ family: "Inter", role: "body", slot: "secondary", weights: [400] }), TF({ family: "Playfair", role: "other", slot: "accent", weights: [400], styles: ["italic"] })]);
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const view = (await s.call(`/clients/${s.A.id}/branding`)).json.kit.typography;
  assert.deepEqual(view.map((t) => t.slot), ["primary", "secondary", "accent"]); assert.deepEqual(view[0].file_ids, [mine]);
  assert.equal((await saveType(s, s.A, view.filter((t) => t.slot !== "accent"))).status, 200);
  const after = (await s.call(`/clients/${s.A.id}/branding`)).json;
  assert.deepEqual(after.kit.typography.map((t) => t.slot), ["primary", "secondary"]); assert.equal(after.assets.filter((a) => a.kind === "font").length, 1, "the font file is untouched");
});

test("client page: the three slots show their typeface or a restrained empty card; the Accent slot says it is optional; Primary alone shows normally", async () => {
  const s = await setup(); await publishOnly(s, s.A);
  await saveType(s, s.A, [TF({ slot: "primary" })]);
  const html = await (await s.ann.get(base)).text();
  const type = sectionHtml(html, "typography");
  const cards = type.split('<li class="tf-card ').slice(1);
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map((c) => (/lv-card__title">([^<]+)</.exec(c) || [])[1]), ["Primary Typeface", "Secondary Typeface", "Accent Typeface"]);
  assert.match(cards[0], /^tf-card--has/); assert.match(cards[0], /tf-card__family">Switzer</); assert.match(cards[0], /Regular <span class="muted">400/); assert.match(cards[0], /Bold <span class="muted">700/); assert.match(cards[0], /ABCDEFGHIJKLMNOPQRSTUVWXYZ/); assert.match(cards[0], /0123456789/);
  assert.match(cards[0], /Headlines and titles/);
  assert.match(cards[1], /^tf-card--example/); assert.match(cards[1], /<span class="tag">Not added yet<\/span>/); assert.match(cards[1], /General Sans/); assert.match(cards[1], /Example: Framework/); assert.doesNotMatch(cards[1], /Download|data-copy|<a /);
  assert.doesNotMatch(cards[1], /Switzer/, "Framework's Primary is not shown in the client's Secondary slot");
  assert.match(cards[2], /^tf-card--example/); assert.match(cards[2], /<span class="tag">Optional<\/span>/); assert.match(cards[2], /Illustrative only: a generic serif, not a Framework typeface/); assert.match(cards[2], /Not every brand needs an Accent Typeface/);
  assert.match(cards[0], /Switzer/); assert.doesNotMatch(cards[0], /Example: Framework/, "the client's own typeface carries no example label");
});

test("specimens: with a downloadable font file the specimen is set in the real font (generated @font-face, no inline style); without one it is a labelled fallback preview and says it is not the brand's font", async () => {
  const s = await setup(); await publishOnly(s, s.A);
  const file = (await font(s, s.A, "Switzer Bold")).json.id;
  await saveType(s, s.A, [TF({ slot: "primary", file_ids: [file] }), TF({ family: "Inter", role: "body", slot: "secondary", weights: [400] })]);
  const res = await s.ann.get(base); const html = await res.text();
  assert.match(html, new RegExp('<link rel="stylesheet" href="/portal/o/alpha/branding/fonts.css">'));
  assert.ok(!/ style="/.test(html), "no inline style");
  const [p, sec] = sectionHtml(html, "typography").split('<li class="tf-card ').slice(1);
  assert.match(p, /tf-card__aa sp-primary/); assert.match(p, /Specimen set in the font file Framework uploaded for you/); assert.match(p, /data-font-check="fwb-primary"/); assert.doesNotMatch(p, /Fallback preview<\/span>/);
  assert.match(p, /Download TTF/);
  assert.match(sec, /<span class="tag tf-card__flag">Fallback preview<\/span>/); assert.match(sec, /Fallback preview: shown in this page’s own typeface, not in Inter\. No font file has been added\./); assert.doesNotMatch(sec, /sp-secondary/);
  const css = await s.ann.get(`${base}/fonts.css`);
  assert.equal(css.status, 200); assert.match(css.headers.get("content-type"), /^text\/css/);
  const text = await css.text();
  assert.match(text, new RegExp(`@font-face\\{font-family:"fwb-primary";src:url\\("/portal/o/alpha/branding/files/${file}\\?font=1"\\) format\\("truetype"\\);font-weight:700;font-style:normal`));
  assert.match(text, /\.sp-primary\{font-family:"fwb-primary",sans-serif\}/); assert.ok(!/secondary/.test(text), "no rule for a typeface without a font file");
  assert.match(res.headers.get("content-security-policy"), /font-src 'self' https:\/\/cdn\.fontshare\.com/);
  assert.ok(!/<link[^>]+fonts\.css/.test(await (await s.ann.get(`${base}/uploads`)).text()), "only the Branding page loads it");
});

test("fonts are served for specimens only when the licence allows sharing the file, only to the owning organization, and a specimen load is not counted as a download", async () => {
  const s = await setup(); await publishOnly(s, s.A); await publishOnly(s, s.B);
  const ok = (await font(s, s.A, "Switzer Regular")).json.id;
  const licensed = (await font(s, s.A, "Licensed Serif", { downloadable: false, license_note: "Licensed" })).json.id;
  const logo = (await s.upload(s.A, s.logo("primary"), "a.png", S.png())).json.id;
  const theirs = (await font(s, s.B, "Beta Sans")).json.id;
  await saveType(s, s.A, [TF({ slot: "primary", file_ids: [ok, licensed] })]);
  const count = () => s.w.db.raw.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE action = 'brand.asset.download'").get().n;
  const before = count();
  assert.equal((await s.ann.get(`${base}/files/${ok}?font=1`)).status, 200); assert.equal(count(), before, "not recorded as a download");
  assert.equal((await s.ann.get(`${base}/files/${licensed}?font=1`)).status, 404, "an unlicensed font is never served");
  assert.equal((await s.ann.get(`${base}/files/${logo}?font=1`)).status, 404, "font mode is for fonts only");
  assert.equal((await s.ann.get(`${base}/files/${theirs}?font=1`)).status, 404, "another organization's font");
  assert.equal((await s.bob.get(`${base}/files/${ok}?font=1`)).status, 404);
  assert.equal((await s.ann.get(`${base}/files/${ok}`)).status, 200); assert.equal(count(), before + 1, "a real download is still recorded");
  assert.match(sectionHtml(await (await s.ann.get(base)).text(), "typography"), /licence doesn’t allow sharing the file/);
  const bobCss = await (await s.bob.get("/portal/o/beta/branding/fonts.css")).text();
  assert.ok(!bobCss.includes(ok), "a stylesheet only names its own organization's fonts");
  assert.equal((await s.mia.get(`${base}/fonts.css`)).status, 200, "members may view");
});

test("older typefaces with no slot stay visible under 'Other typefaces' with their existing downloads; nothing is moved into a slot", async () => {
  const s = await setup(); await publishOnly(s, s.A);
  await font(s, s.A, "Switzer Regular");
  await brand.saveBrandKit(s.w.db, s.A.id, { typography: [{ role: "heading", family: "Switzer", weights: [400, 600], usage: "Headlines", source_url: null }] }, ADMIN);
  const html = await (await s.ann.get(base)).text();
  const type = sectionHtml(html, "typography");
  assert.equal([...type.matchAll(/tf-card--has/g)].length, 0, "no slot is filled by guesswork");
  assert.equal([...type.matchAll(/tf-card--example/g)].length, 3, "empty slots show muted Framework examples");
  assert.match(type, /Other typefaces/); assert.match(type, /hasn’t assigned these typefaces to a role yet/); assert.match(type, /type__family">Switzer</); assert.match(type, /Download TTF/);
  assert.match(type, /This uses Framework’s typography/, "the hierarchy is a labelled example, not the client's");
});

test("Typography Hierarchy: five levels in order, illustrative (no approved scale invented), no sizes shown as specifications, a missing role is a labelled Framework example (never the client's other typeface), fallback is stated", async () => {
  const s = await setup(); await publishOnly(s, s.A);
  await saveType(s, s.A, [TF({ slot: "primary" })]);
  const type = sectionHtml(await (await s.ann.get(base)).text(), "typography");
  const hier = type.slice(type.indexOf('id="typography-hierarchy"'));
  assert.deepEqual([...hier.matchAll(/tf-level__name">([^<]+)</g)].map((m) => m[1]), ["Heading 1", "Heading 2", "Heading 3", "Body Text", "Caption / Small Label"]);
  assert.match(hier, /Typography Hierarchy/); assert.match(hier, /<strong>Illustrative preview\.<\/strong>/); assert.match(hier, /not approved specifications/);
  assert.ok(!/\d\s?(px|pt|rem)\b|line height/i.test(hier), "no invented sizes or line heights");
  assert.match(hier, /Primary Typeface · Switzer/); assert.match(hier, /Relative size: Largest/);
  assert.equal([...hier.matchAll(/Primary Typeface · Switzer/g)].length, 3, "the client's Primary covers the heading levels only");
  assert.equal([...hier.matchAll(/tf-level tf-level--example/g)].length, 2, "Body and Caption have no Secondary, so they are examples");
  assert.equal([...hier.matchAll(/Example: Framework · General Sans/g)].length, 2); assert.match(hier, /Rows labelled “Example: Framework” stand in for roles you haven’t added yet/);
  assert.match(hier, /use a standard typeface here, because no font file is available/);
  const f = (await font(s, s.A, "Switzer Bold")).json.id;
  await saveType(s, s.A, [TF({ slot: "primary", file_ids: [f] }), TF({ family: "Inter", role: "body", slot: "secondary", weights: [400] })]);
  const real = sectionHtml(await (await s.ann.get(base)).text(), "typography"); const h2 = real.slice(real.indexOf('id="typography-hierarchy"'));
  assert.match(h2, /tf-l-h1 sp-primary fw-w700/); assert.match(h2, /Secondary Typeface · Inter/); assert.doesNotMatch(h2, /tf-level--example/, "with both roles set there are no examples"); assert.doesNotMatch(h2, /tf-l-body sp-secondary/, "Inter has no file, so it is not shown as Inter");
});

test("empty typography: a restrained empty state with the existing request button and a way to share fonts; no price is shown by default; a member is told to ask an owner", async () => {
  const s = await setup(); await publishOnly(s, s.A);
  s.w.db.raw.exec("DROP TABLE service_prices"); // a database without the pricing migration: no price anywhere
  const html = await (await s.ann.get(base)).text(); const type = sectionHtml(html, "typography");
  assert.match(type, /No typefaces have been added yet\./); assert.match(type, /<summary class="btn btn--primary">Request Design<span/); assert.match(type, /href="\/portal\/o\/alpha\/branding\/uploads">Upload them for free/); assert.ok(!/Share them with Framework/.test(type), "one upload link, not two");
  assert.equal([...type.matchAll(/tf-card--example/g)].length, 3, "three muted Framework examples"); assert.ok(!/tf-card--has/.test(type), "nothing is presented as the client's");
  assert.match(type, /Switzer/); assert.match(type, /General Sans/); assert.match(type, /Semibold <span class="muted">600/); assert.match(type, /Medium <span class="muted">500/);
  assert.match(type, /This uses Framework’s typography/); assert.ok(!/Download|data-copy/.test(type.replace(/Download or install/g, "")), "examples are never downloadable");
  assert.ok(!/\$\s?\d|CAD|Starting at|bk-price/.test(html), "no price anywhere on the page by default");
  assert.match(sectionHtml(await (await s.mia.get(base)).text(), "typography"), /Ask an owner of your organization/);
  assert.equal((await s.ann.post(`${base}/request`, { csrf: csrfOf(html), section: "brand-typography" })).status, 303, "the existing request workflow");
  assert.match(sectionHtml(await (await s.ann.get(base)).text(), "typography"), /class="tag">Requested</);
});

test("Admin typography wiring: slots, styles, file choice and hierarchy-free save; the three roles come from one shared catalogue", () => {
  const ui = read("admin/assets/branding.js"), shared = read("admin/assets/brand-sections.js");
  assert.match(shared, /TYPE_SLOT_DEFS/); assert.match(ui, /TYPE_SLOT_DEFS\.filter\(\(d\) => !rows\.some\(\(r\) => r\.slot === d\.key\)\)\.map\(\(d\) => button\(`Add \$\{d\.title\}`/);
  assert.match(ui, /slot: t\.slot \|\| null/); assert.match(ui, /styles: t\.styles/); assert.match(ui, /file_ids: t\.file_ids/); assert.match(ui, /Approved styles/); assert.match(ui, /Short usage description/);
  const js = read("assets/js/portal-branding.js");
  assert.ok(js.includes("data-font-check") && js.includes("document.fonts"), "the card judges the real font faces");
  assert.doesNotMatch(js, /document\.fonts\.load\(/, "no longer decided by what the browser matches for one weight and style");
  assert.match(js, /f\.load\(\)\.then\(function \(\) \{ return true; \}, function \(\) \{ return false; \}\)/); assert.match(js, /r\.some\(Boolean\) \? ok\(\) : fail\(\)/, "fallback only when every face fails; the real-font state returns when one loads");
  assert.match(js, /if \(!faces\.length\) return;/, "no faces to judge: the card stays as rendered");
  assert.match(read("assets/css/portal.css"), /\.tf-card__stage--fallback \.tf-card__aa:not\(\[class\*="sp-"\]\) \{ font-family: var\(--font-display\); \}/, "a specimen with a loaded font family is never overridden by the fallback face");
});

/* ------------------------------------------------------------------ navigation dividers and example previews */

test("navigation dividers: one dark line above and one dark line below, same thickness, no lighter line in between; links, numbering and layout untouched", () => {
  const css = read("assets/css/portal.css");
  const nav = /\.bk-nav \{([^}]*)\}/.exec(css)[1];
  assert.match(nav, /border-top: 1px solid var\(--ink\)/); assert.match(nav, /border-bottom: 1px solid var\(--ink\)/);
  assert.doesNotMatch(nav, /hairline/, "no lighter divider under the navigation");
  assert.doesNotMatch(/\.bk \{([^}]*)\}/.exec(css)[1], /border/, "the sections add no second line under it");
  assert.match(css, /\.bk-nav ol \{[^}]*grid-template-columns: minmax\(0, 1fr\)/); assert.match(css, /min-width: 600px\) \{ \.bk-nav ol \{ grid-template-columns: repeat\(3/);
});

test("examples are application content: not client records, not assets, not downloadable; approved content always replaces them; the other examples stay", async () => {
  const s = await setup(); await publishOnly(s, s.A);
  // an organization with nothing: examples everywhere, and nothing in its records or its files
  const empty = await (await s.bob.get("/portal/o/beta/branding")).text();
  for (const k of ["typography", "colours", "tagline", "imagery", "layout", "textures", "iconography", "style"]) assert.ok(/Example: Framework/.test(sectionHtml(empty, k)), k + " shows an example");
  assert.equal((await s.call(`/clients/${s.B.id}/branding`)).json.assets.length, 0, "Admin sees no placeholder files");
  assert.equal(s.w.db.raw.prepare("SELECT COUNT(*) AS n FROM brand_assets").get().n, 0); assert.equal(s.w.db.raw.prepare("SELECT COUNT(*) AS n FROM brand_uploads").get().n, 0);
  assert.ok(!/\/branding\/files\//.test(empty), "no file link of any kind on an empty page");
  assert.ok(!/data-copy|<a [^>]*\bdownload\b|class="btn btn--small"[^>]*download/i.test(empty), "no copy button or download link");
  // real content replaces only its own example
  await brand.saveBrandKit(s.w.db, s.A.id, { colours: [{ name: "Moss", role: "primary", hex: "#3A5A40", note: "" }], typography: [TF({ slot: "primary" })] }, ADMIN);
  const img = await s.upload(s.A, { kind: "other", title: "Hero", section: "imagery", published: true }, "hero.png", S.png());
  const html = await (await s.ann.get(base)).text();
  assert.match(sectionHtml(html, "colours"), /Moss/); assert.doesNotMatch(sectionHtml(html, "colours"), /Example: Framework|swatch--example/, "the client's palette replaces the example");
  assert.match(sectionHtml(html, "imagery"), new RegExp(img.json.id)); assert.doesNotMatch(sectionHtml(html, "imagery"), /Example: Framework|arch-/);
  const type = sectionHtml(html, "typography");
  assert.match(type, /tf-card tf-card--has/); assert.equal([...type.matchAll(/tf-card--example/g)].length, 2, "Secondary and Accent stay as examples");
  for (const k of ["tagline", "layout", "textures", "iconography", "style"]) assert.match(sectionHtml(html, k), /Example: Framework/, k + " keeps its example");
  assert.ok(!/Example: Framework/.test(sectionHtml(html, "colours")));
  // other organization's page is unaffected and exposes none of Alpha's content
  const theirs = await (await s.bob.get("/portal/o/beta/branding")).text();
  assert.ok(!theirs.includes("Moss") && !theirs.includes(img.json.id));
});

test("example content: Framework typography (Switzer 600/700, General Sans 400/500/600), a generic labelled Accent, Framework's palette without copy buttons, no price", async () => {
  const E = await import("../portal/brand-examples.js");
  assert.deepEqual(E.TYPE_EXAMPLES.primary.weights, [["Semibold", 600], ["Bold", 700]]); assert.deepEqual(E.TYPE_EXAMPLES.secondary.weights, [["Regular", 400], ["Medium", 500], ["Semibold", 600]]);
  assert.equal(E.TYPE_EXAMPLES.primary.family, "Switzer"); assert.equal(E.TYPE_EXAMPLES.secondary.family, "General Sans"); assert.match(E.TYPE_EXAMPLES.accent.family, /Illustrative/);
  const colours = E.exampleColours();
  for (const hex of ["#0A0A0A", "#5C5C5C", "#E0E0E0", "#F5F5F5", "#B3261E"]) assert.ok(colours.includes(hex)); assert.ok(colours.includes("RGB 10, 10, 10")); assert.ok(!/data-copy|<button/.test(colours));
  const all = [E.exampleColours(), E.exampleTagline(), E.exampleImagery(), E.exampleLayout(), E.exampleTextures(), E.exampleIcons(), E.exampleStyle()].join("");
  assert.ok(!/ style="|<script|<a |href=|\$\s?\d|CAD/.test(all), "no inline style, script, link or price");
  assert.equal([...all.matchAll(/<span class="bk-eg__tag">Example: Framework<\/span>/g)].length, 7);
  const imgs = [...all.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(imgs.length && imgs.every((u) => u.startsWith("/assets/img/")), "images are Framework's own static files: " + imgs.join());
  const ids = [...all.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]); assert.equal(new Set(ids).size, ids.length, "unique ids");
  const css = read("assets/css/portal.css");
  assert.match(css, /\.bk-eg \{ background: var\(--mist\)/); assert.match(css, /\.lv-card__stage--example \{ background: var\(--mist\)/);
  assert.ok(!/\.(bk-eg|tf-card--example|tf-level--example|lv-card__stage--example)[^{]*\{[^}]*(opacity|gradient|box-shadow|border-radius: [1-9])/.test(css), "muted by colour, not opacity; no gradients, shadows or rounded corners");
});

test("typography specimens stay on one line: sized from the card width, no wrapping, for example and client typefaces alike", () => {
  const css = read("assets/css/portal.css");
  assert.match(css, /\.tf-card__stage \{[^}]*container-type: inline-size/);
  const aa = /\.tf-card__aa \{([^}]*)\}/.exec(css)[1];
  assert.match(aa, /white-space: nowrap/); assert.match(aa, /font-size: clamp\(18px, 13cqw, 46px\)/); assert.doesNotMatch(aa, /overflow-wrap/);
  assert.match(aa, /font-size: clamp\(20px, 2\.6vw, 34px\);[^}]*font-size: clamp\(18px, 13cqw/, "a plain fallback comes first for browsers without container units");
});

test("03 Brand Colours: at most six swatches in a balanced grid: 3 columns from 600px, 2 on a phone, 1 on the narrowest; example and client colours share it; Copy buttons stack the same way in narrow columns", () => {
  const css = read("assets/css/portal.css");
  assert.match(css, /\.swatches \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /@media \(max-width: 360px\) \{ \.swatches \{ grid-template-columns: minmax\(0, 1fr\); \} \}/);
  assert.match(css, /@media \(min-width: 600px\) \{ \.swatches \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \} \}/);
  assert.doesNotMatch(css, /\.swatches \{ grid-template-columns: repeat\((4|5)/, "no four- or five-column layouts remain");
  assert.match(css, /\.swatch \{ min-width: 0; container-type: inline-size; \}/);
  assert.match(css, /@container \(max-width: 220px\) \{ \.swatch__code \{ display: block; \} \.swatch__code \.copy:not\(\[hidden\]\) \{ display: block;/);
  assert.match(css, /\.bk-eg--colours \.swatches \{ margin: 0; \}/, "the example palette uses the same grid");
});

/* ------------------------------------------------------------------ 04 Tagline (stored in brand_kits.sections_json, migration 0009) */

/** A database as it is before migration 0009: the same schema with that one column dropped. */
const withoutSections = (s) => s.w.db.raw.exec("ALTER TABLE brand_kits DROP COLUMN sections_json");
const saveTag = (s, org, tagline) => s.call(`/clients/${org.id}/branding/kit`, { method: "PUT", json: { sections: { tagline } } });
const TAG = { primary: "Clear thinking, beautifully made.", alternates: ["Built to be remembered", "Design with intent"], guidelines: "Use beside the logo, never above it.\n\nNever stretch or restyle it." };

test("tagline storage is optional until migration 0009 is applied: the code works without the column, says so plainly, and keeps every other kit save working", async () => {
  const s = await setup(); withoutSections(s);
  const view = await s.call(`/clients/${s.A.id}/branding`);
  assert.equal(view.json.capabilities.sections, false, "Admin is told storage isn't available yet");
  const refused = await saveTag(s, s.A, TAG);
  assert.equal(refused.status, 409); assert.equal(refused.json.error, "sections_unavailable");
  assert.equal(s.w.db.raw.prepare("SELECT COUNT(*) AS n FROM brand_kits WHERE organization_id = ?").get(s.A.id).n, 0, "a refused tagline creates and changes nothing");
  assert.equal((await s.call(`/clients/${s.A.id}/branding/kit`, { method: "PUT", json: { colours: [{ name: "Ink", role: "primary", hex: "#0A0A0A", note: "" }] } })).status, 200, "colours still save");
  await publishOnly(s, s.A);
  assert.match(sectionHtml(await (await s.ann.get(base)).text(), "tagline"), /bk-eg--tagline/, "the client keeps the labelled example");
});

test("Admin saves, edits and removes a tagline; the client sees it only once the kit is published, with a Copy button beside each tagline; other kit content is untouched both ways", async () => {
  const s = await setup();
  await s.call(`/clients/${s.A.id}/branding/kit`, { method: "PUT", json: { colours: [{ name: "Ink", role: "primary", hex: "#0A0A0A", note: "" }], typography: [TF({ slot: "primary" })], brand_name: "Alpha" } });
  assert.equal((await s.call(`/clients/${s.A.id}/branding`)).json.capabilities.sections, true);
  const saved = await saveTag(s, s.A, TAG); assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual(saved.json.kit.sections.tagline, TAG);
  const kit = (await s.call(`/clients/${s.A.id}/branding`)).json.kit;
  assert.deepEqual(kit.sections.tagline, TAG); assert.equal(kit.colours.length, 1); assert.equal(kit.typography.length, 1); assert.equal(kit.brandName, "Alpha", "saving a tagline leaves the rest of the kit alone");
  assert.match(sectionHtml(await (await s.ann.get(base)).text(), "tagline"), /bk-eg--tagline/, "a draft kit shows the example, not the tagline");
  await publishOnly(s, s.A);
  const html = sectionHtml(await (await s.ann.get(base)).text(), "tagline");
  assert.ok(!/bk-eg/.test(html), "the example is gone once a tagline is approved");
  assert.match(html, /<p class="bk-tag__primary">Clear thinking, beautifully made\.<\/p>/);
  assert.deepEqual([...html.matchAll(/data-copy="([^"]*)"/g)].map((m) => m[1]), [TAG.primary, ...TAG.alternates], "a Copy button beside each tagline");
  assert.equal([...html.matchAll(/<button class="copy"[^>]* hidden>Copy<span class="visually-hidden"> (primary|alternate) tagline<\/span><\/button>/g)].length, 3);
  assert.match(html, /Alternate taglines/); assert.match(html, /<p>Use beside the logo, never above it\.<\/p><p>Never stretch or restyle it\.<\/p>/, "guidelines keep their paragraphs");
  // edit: change the primary, drop one alternate, add blanks and a duplicate (dropped)
  const edited = await saveTag(s, s.A, { primary: "  Made with care.  ", alternates: ["Design with intent", "", "Design with intent", "   "], guidelines: null });
  assert.deepEqual(edited.json.kit.sections.tagline, { primary: "Made with care.", alternates: ["Design with intent"], guidelines: null });
  // saving colours afterwards keeps the tagline
  await s.call(`/clients/${s.A.id}/branding/kit`, { method: "PUT", json: { colours: [{ name: "Moss", role: "primary", hex: "#3A5A40", note: "" }] } });
  assert.equal((await s.call(`/clients/${s.A.id}/branding`)).json.kit.sections.tagline.primary, "Made with care.");
  assert.match(sectionHtml(await (await s.ann.get(base)).text(), "tagline"), /Made with care\./);
  // an alternate without a primary is shown honestly
  await saveTag(s, s.A, { primary: "", alternates: ["Only an alternate"], guidelines: null });
  const partial = sectionHtml(await (await s.ann.get(base)).text(), "tagline");
  assert.match(partial, /The primary tagline hasn’t been added yet/); assert.match(partial, /Only an alternate/);
  // remove everything: the example returns
  assert.equal((await saveTag(s, s.A, { primary: "", alternates: [], guidelines: "" })).status, 200);
  assert.match(sectionHtml(await (await s.ann.get(base)).text(), "tagline"), /bk-eg--tagline/);
  assert.equal((await saveTag(s, s.A, null)).status, 200);
  assert.equal(s.w.db.raw.prepare("SELECT activity_log.action FROM activity_log WHERE action = 'brand.kit.sections_saved' LIMIT 1").get().action, "brand.kit.sections_saved", "tagline changes are audited");
});

test("tagline validation: single-line text up to 120 characters, at most six alternates, guidelines up to 600, only the tagline key; the server is the authority", async () => {
  const s = await setup();
  const bad = [{ primary: "x".repeat(121) }, { primary: "two\nlines" }, { alternates: new Array(7).fill(0).map((_, i) => "alt " + i) }, { alternates: ["x".repeat(121)] }, { alternates: "not a list" }, { guidelines: "g".repeat(601) }, { primary: "ok", extra: 1 }, { primary: 42 }];
  for (const t of bad) { const r = await saveTag(s, s.A, t); assert.equal(r.status, 422, JSON.stringify(t).slice(0, 60)); assert.equal(r.json.error, "invalid_sections"); }
  for (const body of [{ sections: { colours: [] } }, { sections: [] }, { sections: "x" }, { sections: { tagline: [] } }]) assert.equal((await s.call(`/clients/${s.A.id}/branding/kit`, { method: "PUT", json: body })).status, 422, JSON.stringify(body));
  assert.equal(s.w.db.raw.prepare("SELECT COUNT(*) AS n FROM brand_kits WHERE sections_json IS NOT NULL AND sections_json != '{}'").get().n, 0, "nothing invalid was stored");
  const max = await saveTag(s, s.A, { primary: "p".repeat(120), alternates: new Array(6).fill(0).map((_, i) => "a".repeat(119) + i), guidelines: "g".repeat(600) });
  assert.equal(max.status, 200, "the limits themselves are accepted");
});

test("tagline text is escaped everywhere it is shown, a client can't change it, and another organization never sees it", async () => {
  const s = await setup(); await publishOnly(s, s.A); await publishOnly(s, s.B);
  const evil = { primary: `<img src=x onerror="alert(1)"> & "quoted"`, alternates: [`</p><script>alert(2)</script>`, `'single' <b>bold</b>`], guidelines: `<script>alert(3)</script>\n<a href="javascript:alert(4)">x</a>` };
  assert.equal((await saveTag(s, s.A, evil)).status, 200);
  const html = await (await s.ann.get(base)).text(); const sec = sectionHtml(html, "tagline");
  assert.ok(!/<img src=x|<script>alert|<b>bold|href="javascript/.test(html), "no markup from the tagline reaches the page");
  assert.match(sec, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &quot;quoted&quot;/);
  assert.match(sec, /data-copy="&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &quot;quoted&quot;"/, "the copied text is the plain text, safely quoted in the attribute");
  assert.ok(!/<script/i.test(sec));
  // clients have no way to write: no client route, and the Admin API refuses them
  assert.equal((await s.ann.post(`${base}/kit`, { sections: JSON.stringify({ tagline: { primary: "hijack" } }) })).status, 404);
  const noAccess = await handleAdmin(new Request(ORIGIN + `/api/admin/clients/${s.A.id}/branding/kit`, { method: "PUT", headers: { Origin: ORIGIN, "Content-Type": "application/json", "X-Framework-Admin": "1" }, body: JSON.stringify({ sections: { tagline: { primary: "hijack" } } }) }), s.w.env, {});
  assert.ok([401, 403].includes(noAccess.status), "the Admin API needs Access");
  assert.ok(!(await (await s.ann.get(base)).text()).includes("hijack"));
  // organization isolation
  const theirs = await (await s.bob.get("/portal/o/beta/branding")).text();
  assert.ok(!theirs.includes("quoted") && !theirs.includes("alert(")); assert.match(sectionHtml(theirs, "tagline"), /bk-eg--tagline/);
  assert.equal((await saveTag(s, s.B, { primary: "Beta line" })).status, 200);
  const both = [await (await s.ann.get(base)).text(), await (await s.bob.get("/portal/o/beta/branding")).text()];
  assert.ok(!both[0].includes("Beta line") && !both[1].includes("quoted") && both[1].includes("Beta line"));
});

test("Admin tagline form: primary, add/remove alternates (up to six), usage guidelines, save and remove, and a plain notice when storage isn't available", () => {
  const ui = read("admin/assets/branding.js");
  assert.match(ui, /function taglineSection\(\)/); assert.match(ui, /"Primary tagline"/); assert.match(ui, /"Add alternate tagline"/); assert.match(ui, /Remove alternate tagline/); assert.match(ui, /"Usage guidelines \(optional\)"/);
  assert.match(ui, /sections: \{ tagline \}/); assert.match(ui, /"Save tagline"/); assert.match(ui, /"Remove tagline"/); assert.match(ui, /maxlength: "120"/); assert.match(ui, /maxlength: "600"/);
  assert.match(ui, /caps\(\)\.sections !== false/); assert.match(ui, /sections_unavailable/); assert.ok(!/waiting for approval/.test(ui), "the old placeholder notice is gone");
  assert.match(read("migrations/portal/0009_brand_sections.sql"), /ALTER TABLE brand_kits ADD COLUMN sections_json TEXT CHECK \(sections_json IS NULL OR \(json_valid\(sections_json\) AND json_type\(sections_json\) = 'object' AND length\(sections_json\) <= 12000\)\);/);
});

test("Admin status messages have one 1px border and no ring around it when a script focuses them; interactive elements keep their focus rings", () => {
  const css = read("admin/assets/admin.css");
  assert.match(css, /\.adm-msg \{[^}]*border: 1px solid var\(--hairline\)/);
  assert.match(css, /\.adm-msg:focus \{ outline: none; \}/, "a focused message gets no second outline");
  assert.doesNotMatch(css, /\.adm-msg[^{]*\{[^}]*border: 2px/, "success, info, warning and error all stay one 1px border");
  assert.match(css, /\.adm-msg\.is-warning, \.adm-msg\.is-error \{ border-color: var\(--ink\); font-weight: 500; \}/);
  for (const sel of [".adm-icon-btn:focus-visible", ".adm-small:focus-visible", ".adm-linkbtn:focus-visible", ".adm-choice:focus-within"]) assert.ok(css.includes(sel), sel + " keeps its focus ring");
  assert.match(read("assets/css/styles.css"), /:focus-visible \{\s*outline: 2px solid var\(--ink\);/, "the site-wide keyboard focus ring is unchanged");
});

test("Admin Branding opens with every section and list collapsed (the nine numbered sections, New uploads and Service requests); only a click or a Manage files jump opens one", () => {
  const ui = read("admin/assets/branding.js");
  const first = ui.slice(ui.indexOf("if (first) {"), ui.indexOf("const publish = "));
  assert.ok(!/opened\.add\(/.test(first), "nothing is opened on arrival");
  assert.match(ui, /open: opened\.has\(id\)/, "a section opens only when it is in the clicked set");
  assert.match(ui, /chip\("pending", `\$\{fresh\} new`/, "the new-uploads count stays in its heading");
  assert.match(ui, /chip\("pending", `\$\{open\} open`/, "the open-requests count stays in its heading");
});
