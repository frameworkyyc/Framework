/* Branding, logo variations: the client's Logos section always shows four cards (Primary, Secondary, Simplified, Sub-mark). A card with published files shows the real preview and
   a download per format; a card without them shows a clearly labelled example of a fictional brand and "Not added yet". Framework Admin assigns each logo file to a card through
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
    return { status: res.status, json: type.includes("json") ? await res.json() : null };
  };
  const upload = (org, meta, name, bytes) => { const f = new FormData(); f.append("file", new File([bytes], name)); f.append("meta", JSON.stringify(meta)); return call(`/clients/${org.id}/branding/assets`, { method: "POST", form: f }); };
  const publishKit = async (org) => { await brand.saveBrandKit(w.db, org.id, { colours: [{ name: "Ink", role: "primary", hex: "#0A0A0A", note: "" }] }, ADMIN); assert.ok((await brand.setBrandKitStatus(w.db, org.id, "published", ADMIN)).ok); };
  const logo = (role, extra = {}) => ({ kind: "logo", logo_role: role, orientation: "square", tone: "light", published: true, ...extra });
  return { w, A, B, ann, mia, bob, call, upload, publishKit, logo };
}
/** The four cards of the Logos section, in page order. */
const cards = (html) => {
  const logos = html.slice(html.indexOf('id="logos"'), html.indexOf('id="colours"'));
  const parts = logos.split('<li class="lv-card ').slice(1).map((p) => '<li class="lv-card ' + p);
  return parts.map((p) => ({ html: p, has: p.startsWith('<li class="lv-card lv-card--has"'), title: (/lv-card__title">([^<]+)</.exec(p) || [])[1] }));
};

test("the four variations are Primary, Secondary, Simplified and Sub-mark with their descriptions; each Admin logo type maps to exactly one (icon is the Sub-mark)", () => {
  assert.deepEqual(LOGO_VARIATIONS.map((v) => [v.key, v.title]), [["primary", "Primary"], ["secondary", "Secondary"], ["simplified", "Simplified"], ["submark", "Sub-mark"]]);
  assert.equal(LOGO_VARIATIONS[0].desc, "The main brand logo for websites, print and general branding.");
  assert.equal(LOGO_VARIATIONS[1].desc, "An alternative arrangement, typically horizontal, for headers, banners and wider spaces.");
  assert.equal(LOGO_VARIATIONS[2].desc, "A reduced-detail logo for smaller applications where the full logo isn’t practical.");
  assert.equal(LOGO_VARIATIONS[3].desc, "A compact brand symbol for profile pictures, favicons, icons and watermarks.");
  const v = (logoRole, kind = "logo") => variationOf({ kind, logoRole });
  assert.deepEqual([v("primary"), v("secondary"), v("simplified"), v("icon")], ["primary", "secondary", "simplified", "submark"]);
  assert.equal(v(null), null, "no type chosen: not guessed into a card"); assert.equal(v("primary", "document"), null); assert.equal(v("tertiary"), null);
});

test("with nothing published every client sees the four cards as clearly labelled examples with the status 'Not added yet', in a fixed order and one shape", async () => {
  const { ann, mia, bob } = await setup();
  for (const b of [ann, mia]) {
    const html = await (await b.get(base)).text();
    const c = cards(html);
    assert.deepEqual(c.map((x) => x.title), ["Primary", "Secondary", "Simplified", "Sub-mark"]);
    assert.ok(c.every((x) => !x.has && x.html.startsWith('<li class="lv-card lv-card--example">')));
    for (const x of c) {
      assert.match(x.html, /<span class="lv-card__badge">Example<\/span>/); assert.match(x.html, /<span class="tag">Not added yet<\/span>/);
      assert.match(x.html, /<svg [^>]*role="img" aria-label="Example of /); assert.match(x.html, /Illustration of a fictional brand, not your logo\./);
      assert.ok(!/Download|<img/.test(x.html), "no download and no client image on an example card");
    }
    assert.match(html, /Cards marked “Example” are illustrations of a fictional brand/);
    assert.match(html, /<span class="acc__sum">Not added yet<\/span>/);
  }
  // the same four examples for a client of another organization: examples are not data
  assert.deepEqual(cards(await (await bob.get("/portal/o/beta/branding")).text()).map((x) => x.title), ["Primary", "Secondary", "Simplified", "Sub-mark"]);
});

test("Admin assigns each file with 'Logo type': every type lands on its own card and replaces only that placeholder; the rest stay examples until their files are added", async () => {
  const s = await setup();
  await s.publishKit(s.A);
  const order = [["primary", "Primary"], ["secondary", "Secondary"], ["simplified", "Simplified"], ["icon", "Sub-mark"]];
  const filled = new Set();
  for (const [role, title] of order) {
    const up = await s.upload(s.A, s.logo(role, { orientation: role === "secondary" ? "horizontal" : "square" }), `${role}.png`, S.png(20, 20));
    assert.equal(up.status, 201, JSON.stringify(up.json));
    filled.add(title);
    const html = await (await s.ann.get(base)).text();
    const c = cards(html);
    assert.deepEqual(c.map((x) => [x.title, x.has]), order.map(([, t]) => [t, filled.has(t)]), `after adding ${role}`);
    const card = c.find((x) => x.title === title);
    assert.match(card.html, /<img src="[^"]*\/branding\/files\/[0-9a-f-]{36}\?preview=1" alt="/); assert.match(card.html, /<span class="tag">Available<\/span>/); assert.match(card.html, /Download PNG/);
    assert.ok(!/lv-card__badge/.test(card.html), "the example badge is gone from a real logo");
  }
  assert.match(await (await s.ann.get(base)).text(), /<span class="acc__sum">4 of 4 variations · PNG<\/span>/);
  assert.ok(!/Cards marked “Example”/.test(await (await s.ann.get(base)).text()), "no example note once all four are real");
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
  assert.deepEqual(readdirSync(new URL("../../migrations/portal/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort(), ["0001_portal_foundation.sql", "0002_business_profile.sql", "0003_portal_feedback.sql", "0004_invitation_delivery.sql", "0005_branding.sql", "0006_brand_name.sql", "0007_client_services.sql", "0008_approved_emails.sql"], "no new migration");
});

test("several formats in one variation: every format downloads, the preview uses an image format, and a PDF-only variation shows a plain tile with its download", async () => {
  const s = await setup();
  await s.publishKit(s.A);
  const ids = {};
  for (const [name, bytes] of [["p.pdf", S.pdf()], ["p.png", S.png(30, 30)], ["p.svg", S.svg()]]) { const r = await s.upload(s.A, s.logo("primary"), name, bytes); assert.equal(r.status, 201, JSON.stringify(r.json)); ids[name] = r.json.id; }
  const pdfOnly = await s.upload(s.A, s.logo("simplified"), "s.pdf", S.pdf()); assert.equal(pdfOnly.status, 201);
  const c = cards(await (await s.ann.get(base)).text());
  const primary = c[0].html, simplified = c[2].html;
  assert.deepEqual([...primary.matchAll(/Download ([A-Z]+)</g)].map((m) => m[1]), ["SVG", "PNG", "PDF"], "vector first, then PNG, then PDF");
  for (const id of Object.values(ids)) assert.ok(primary.includes(`/branding/files/${id}"`), "download link: " + id);
  assert.match(primary, new RegExp(`<img src="[^"]*files/${ids["p.svg"]}\\?preview=1"`), "the SVG is the preview");
  assert.match(primary, /SVG · PNG · PDF/);
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
  assert.match(html, /<span class="acc__sum">1 of 4 variations · PNG<\/span>/);
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
  assert.match(ui, /function logoCoverage\(\)/); assert.match(ui, /Client logo cards — /);
  assert.equal(buildBrandFileName({ company: "Alpha", kind: "logo", logo: { role: "secondary", orientation: "horizontal", tone: "light" }, ext: "svg" }).name, "Alpha-Secondary-Horizontal-Light.svg");
});

test("the request workflow is unchanged under the cards: an owner can request logos (or more variations), the status replaces the button, duplicates are refused and a member is told to ask an owner", async () => {
  const s = await setup();
  let html = await (await s.ann.get(base)).text();
  const logosEmpty = html.slice(html.indexOf('id="logos"'), html.indexOf('id="colours"'));
  assert.match(logosEmpty, /<summary class="btn btn--small">Request<span/);
  assert.match(await (await s.mia.get(base)).text(), /Ask an owner of your organization to send a request for this section/);
  const send = (b, extra = {}) => b.post(`${base}/request`, { csrf: csrfOf(html), section: "brand-logos", ...extra });
  assert.equal((await send(s.ann)).headers.get("Location"), `${base}?requested=1`);
  assert.equal((await send(s.ann)).headers.get("Location"), `${base}?requested=0`, "a second press is the friendly 'already open'");
  assert.equal((await send(s.mia, { csrf: csrfOf(await (await s.mia.get(base)).text()) })).status, 403, "members cannot request");
  html = await (await s.ann.get(base)).text();
  assert.match(html.slice(html.indexOf('id="logos"'), html.indexOf('id="colours"')), /class="tag">Requested</);
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
  assert.match(css, /\.lv-card__stage \{[^}]*aspect-ratio: 4 \/ 3/);
  const s = await setup();
  const html = await (await s.ann.get(base)).text();
  assert.ok(!/\sstyle=|<script[^>]*>[^<]|onclick=/i.test(html.replace(/<script[^>]*src=[^>]*><\/script>/g, "")), "no inline style, script or handler");
  const logos = html.slice(html.indexOf('id="logos"'), html.indexOf('id="colours"'));
  assert.equal([...logos.matchAll(/<h3 class="lv-card__title">/g)].length, 4);
  assert.equal([...logos.matchAll(/aria-label="Example of /g)].length, 4);
});
