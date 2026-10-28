/* Branding: generated file names. One pure function (admin/assets/brand-names.js) names every deliverable from the organization and the file's details; the
   server regenerates it, refuses duplicates atomically, and uses it for every download. Existing (legacy) files keep their names. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openPortalDb, rows, count } from "./helpers/portal-db.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as repo from "../portal/repo/index.js";
import * as B from "../portal/brand-files.js";
import { buildBrandFileName, companyPart, descriptionPart, extensionOf } from "../../admin/assets/brand-names.js";

const NOW = new Date("2026-10-27T12:00:00.000Z");
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const LOGO = { kind: "logo", logo_role: "primary", orientation: "square", tone: "light", transparent: true };

async function world(name = "Framework") {
  const db = openPortalDb(), bucket = fakeR2();
  const org = (await repo.createOrganizationAudited(db, { slug: "framework", name }, "seed")).organization;
  const other = (await repo.createOrganizationAudited(db, { slug: "other", name: "Other Co" }, "seed")).organization;
  const user = (await repo.upsertUserFromIdentity(db, { workosUserId: "user_01NAMES0000000", email: "ann@framework.test", name: "Ann" })).user;
  db.raw.prepare("INSERT INTO memberships (id, organization_id, user_id, role, status, created_at, created_by) VALUES (?, ?, ?, 'owner', 'active', ?, 'seed')").run(crypto.randomUUID(), org.id, user.id, NOW.toISOString());
  return { db, bucket, org, other, user, deps: { db, bucket, env: {}, now: NOW } };
}
const up = (w, meta, name, bytes, org = w.org) => B.adminUploadAsset(w.deps, { organizationId: org.id, actor: "a@f.test", meta, file: { name, bytes } });
const nameOf = (w, id) => rows(w.db, "SELECT original_name, title, variant_key, format FROM brand_assets WHERE id = ?", id)[0];

test("the name is built from the company and the logo details, exactly like the example, and is always plain ASCII letters, digits and hyphens", () => {
  const r = buildBrandFileName({ company: "Framework", kind: "logo", logo: { role: "primary", orientation: "square", tone: "light", transparent: true }, ext: "png" });
  assert.deepEqual(r, { ok: true, stem: "Framework-Primary-Square-Light-Transparent", name: "Framework-Primary-Square-Light-Transparent.png", title: "Primary logo, square, light, transparent", variantKey: "primary-square-light-transparent" });
  assert.equal(buildBrandFileName({ company: "Framework", kind: "logo", logo: { role: "icon", orientation: "vertical", tone: "dark" }, ext: "svg" }).name, "Framework-Submark-Vertical-Dark.svg", "no 'Transparent' unless it is");
  assert.equal(buildBrandFileName({ company: "Framework", kind: "guideline", description: "brand guidelines", ext: "pdf" }).name, "Framework-Brand-Guidelines.pdf");
  assert.equal(companyPart("Alpha Café & Co."), "Alpha-Cafe-Co");
  assert.equal(companyPart("iPhone Repair Co"), "iPhone-Repair-Co", "mixed-case words are left alone");
  assert.equal(companyPart("The Extraordinarily Long-Named Heritage Hospitality Collective of Western Canada").length <= 30, true);
  assert.equal(companyPart("Supercalifragilisticexpialidocious-Consolidated").length <= 30, true);
  assert.equal(companyPart("日本語", "frc"), "Frc", "falls back to the portal address");
  assert.equal(companyPart("", ""), "Client");
  assert.equal(descriptionPart("  v2 — final!! "), "V2-Final");
  assert.equal(extensionOf("Logo.JPEG"), "jpg"); assert.equal(extensionOf("noext"), "");
  // the incomplete cases name what is missing
  assert.deepEqual(buildBrandFileName({ company: "F", kind: "logo", logo: { role: "primary" }, ext: "png" }), { ok: false, missing: ["shape", "version"], error: "incomplete_logo_details" });
  assert.deepEqual(buildBrandFileName({ company: "F", kind: "font", description: "  ", ext: "ttf" }), { ok: false, missing: ["name"], error: "invalid_description" });
  for (const company of ["Framework", "Zoë & Sons, Inc.", "  ../../etc/passwd  ", "A".repeat(200), "Ünïcödé Ltd", "<script>alert(1)</script>", "x\u202Ey", "a/b\\c:d*e?f\"g<h>i|j"]) {
    const n = buildBrandFileName({ company, kind: "logo", logo: { role: "primary", orientation: "square", tone: "light", transparent: true }, ext: "png" }).name;
    assert.match(n, /^[A-Za-z0-9-]{1,100}\.png$/, company);
  }
});

test("uploading: the name is generated from the organization and the details; the browser's file name and any title or variant it sends are ignored", async () => {
  const w = await world();
  const r = await up(w, { ...LOGO, title: "Totally Different", variant_key: "evil key" }, "C:\\fakepath\\../../evil name.PNG", S.png());
  assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.name, "Framework-Primary-Square-Light-Transparent.png");
  const row = nameOf(w, r.id);
  assert.deepEqual([row.original_name, row.title, row.variant_key, row.format], ["Framework-Primary-Square-Light-Transparent.png", "Primary logo, square, light, transparent", "primary-square-light-transparent", "png"]);
  const j = await up(w, { ...LOGO }, "photo.JPEG", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]), w.org);
  assert.equal(j.name, "Framework-Primary-Square-Light-Transparent.jpg", "jpeg is written jpg");
});

test("formats of one variant share a stem and differ only by extension; a different detail makes a different name", async () => {
  const w = await world();
  const names = [];
  for (const [file, bytes] of [["a.png", S.png()], ["a.svg", S.svg()], ["a.pdf", S.pdf()], ["a.eps", S.eps()]]) names.push((await up(w, LOGO, file, bytes)).name);
  assert.deepEqual(names, ["png", "svg", "pdf", "eps"].map((e) => `Framework-Primary-Square-Light-Transparent.${e}`));
  assert.equal(new Set(rows(w.db, "SELECT variant_key FROM brand_assets").map((r) => r.variant_key)).size, 1, "one variant key groups the formats");
  assert.equal((await up(w, { ...LOGO, transparent: false }, "a.png", S.png())).name, "Framework-Primary-Square-Light.png");
  assert.equal((await up(w, { ...LOGO, tone: "dark" }, "a.png", S.png())).name, "Framework-Primary-Square-Dark-Transparent.png");
  assert.equal((await up(w, { ...LOGO, logo_role: "simplified", orientation: "horizontal" }, "a.png", S.png())).name, "Framework-Simplified-Horizontal-Light-Transparent.png");
  assert.equal(count(w.db, "brand_assets"), 7);
});

test("duplicates are refused, never overwritten or silently renamed: the first file and its stored bytes stay exactly as they were, and the second leaves nothing in storage", async () => {
  const w = await world();
  const first = await up(w, LOGO, "a.png", S.png(8, 8));
  const keyBefore = rows(w.db, "SELECT storage_key, sha256 FROM brand_assets WHERE id = ?", first.id)[0];
  const second = await up(w, LOGO, "b.png", S.png(16, 16));
  assert.deepEqual(second, { ok: false, error: "duplicate_name" });
  assert.deepEqual(rows(w.db, "SELECT storage_key, sha256 FROM brand_assets WHERE id = ?", first.id)[0], keyBefore);
  assert.equal(count(w.db, "brand_assets"), 1); assert.equal(w.bucket.store.size, 1);
  // case-insensitive, and per organization (another organization may have the same stem; its company part differs anyway)
  w.db.raw.prepare("UPDATE brand_assets SET original_name = lower(original_name) WHERE id = ?").run(first.id);
  assert.equal((await up(w, LOGO, "c.png", S.png())).error, "duplicate_name");
  assert.ok((await up(w, LOGO, "d.png", S.png(), w.other)).ok);
  // a deleted file frees its name
  await B.adminDeleteAsset(w.deps, { organizationId: w.org.id, assetId: first.id, actor: "a@f.test" });
  assert.ok((await up(w, LOGO, "e.png", S.png())).ok);
  // two simultaneous uploads of the same name: exactly one wins, one object stored for it
  const w2 = await world();
  const both = await Promise.all([up(w2, LOGO, "a.png", S.png(8, 8)), up(w2, LOGO, "b.png", S.png(9, 9))]);
  assert.deepEqual(both.map((r) => r.ok).sort(), [false, true]);
  assert.equal(count(w2.db, "brand_assets"), 1); assert.equal(w2.bucket.store.size, 1);
});

test("a database that already holds a file with that name (even in another case) refuses the insert by itself, whatever the application checked", async () => {
  const w = await world();
  const ok = await up(w, LOGO, "a.png", S.png());
  const row = rows(w.db, "SELECT * FROM brand_assets WHERE id = ?", ok.id)[0];
  const file = { ext: "png", contentType: "image/png", size: 5, sha256: "b".repeat(64), storageKey: `org/${w.org.id}/brand-assets/${crypto.randomUUID()}`, name: row.original_name.toUpperCase() };
  assert.deepEqual(await repo.createBrandAsset(w.db, w.org.id, { kind: "logo", title: "x" }, file, "a@f.test"), { ok: false, error: "duplicate_name" });
  assert.equal(count(w.db, "brand_assets"), 1);
});

test("non-logo files are named from the company and a description; the description is required", async () => {
  const w = await world();
  const g = await up(w, { kind: "guideline", title: "brand guidelines" }, "x.pdf", S.pdf()); assert.equal(g.name, "Framework-Brand-Guidelines.pdf");
  assert.equal(nameOf(w, g.id).title, "brand guidelines"); assert.equal(nameOf(w, g.id).variant_key, null);
  const f = await up(w, { kind: "font", title: "Switzer Regular" }, "s.ttf", S.ttf()); assert.equal(f.name, "Framework-Switzer-Regular.ttf");
  const z = await up(w, { kind: "package", title: "Complete brand package" }, "p.zip", S.brandPack()); assert.equal(z.name, "Framework-Complete-Brand-Package.zip");
  assert.deepEqual(await up(w, { kind: "document" }, "d.pdf", S.pdf()), { ok: false, error: "invalid_description" });
  assert.deepEqual(await up(w, { kind: "logo", logo_role: "primary" }, "l.png", S.png()), { ok: false, error: "incomplete_logo_details" });
  assert.deepEqual(await up(w, { ...LOGO, tone: "neon" }, "l.png", S.png()), { ok: false, error: "invalid_tone" });
  assert.deepEqual(await up(w, { kind: "virus", title: "x" }, "l.png", S.png()), { ok: false, error: "invalid_kind" });
  assert.equal(w.bucket.store.size, 3, "refusals stored nothing");
});

test("the generated name is what every download uses (staff and, once published, the client), whatever the original file was called", async () => {
  const w = await world();
  const r = await up(w, { ...LOGO, published: true }, "scan_0042 final FINAL.png", S.png());
  const admin = await B.adminDownloadAsset(w.deps, { organizationId: w.org.id, assetId: r.id, actor: "a@f.test" });
  assert.match(admin.response.headers.get("Content-Disposition"), /^attachment; filename="Framework-Primary-Square-Light-Transparent\.png"; filename\*=UTF-8''Framework-Primary-Square-Light-Transparent\.png$/);
  await repo.saveBrandKit(w.db, w.org.id, {}, "a@f.test"); await repo.setBrandKitStatus(w.db, w.org.id, "published", "a@f.test");
  const client = await B.clientDownloadAsset(w.deps, { role: "member", organizationId: w.org.id, userId: w.user.id, assetId: r.id });
  assert.match(client.response.headers.get("Content-Disposition"), /filename="Framework-Primary-Square-Light-Transparent\.png"/);
  const view = await repo.getClientBrand(w.db, w.org.id);
  assert.equal(view.assets[0].title, "Primary logo, square, light, transparent");
});

test("editing: publication and notes never rename a file; changing a naming detail renames it consistently; a rename onto an existing name is refused and changes nothing", async () => {
  const w = await world();
  const a = await up(w, LOGO, "a.png", S.png()); const b = await up(w, { ...LOGO, tone: "dark" }, "b.png", S.png());
  const edit = (id, patch) => B.adminUpdateAsset(w.deps, { organizationId: w.org.id, assetId: id, actor: "a@f.test", patch });
  assert.deepEqual(await edit(a.id, { published: true, usage_note: "Use on white", sort_order: 3 }), { ok: true, name: "Framework-Primary-Square-Light-Transparent.png" });
  assert.equal(nameOf(w, a.id).original_name, "Framework-Primary-Square-Light-Transparent.png");
  assert.equal((await edit(a.id, { transparent: false })).name, "Framework-Primary-Square-Light.png");
  const row = nameOf(w, a.id); assert.deepEqual([row.title, row.variant_key], ["Primary logo, square, light", "primary-square-light"]);
  assert.deepEqual(await edit(a.id, { tone: "dark", transparent: true }), { ok: false, error: "duplicate_name" }, "would become the same as the other file");
  assert.equal(nameOf(w, a.id).original_name, "Framework-Primary-Square-Light.png");
  assert.equal((await edit(a.id, { kind: "font" })).error, "invalid_input");
  assert.equal((await edit(a.id, { tone: "neon" })).error, "invalid_tone");
  assert.equal((await edit(a.id, { tone: "" })).error, "incomplete_logo_details");
  assert.equal((await edit(a.id, { variant_key: "x", original_name: "Evil.png" })).ok, true, "name and key cannot be set from outside: unknown fields are ignored");
  assert.equal(nameOf(w, a.id).original_name, "Framework-Primary-Square-Light.png");
  assert.equal((await edit(crypto.randomUUID(), { published: true })).error, "not_found");
  assert.ok(b.ok);
});

test("replacing keeps the file's stem and takes the new extension; a clash with another file is refused and leaves the original in place", async () => {
  const w = await world();
  const png = await up(w, LOGO, "a.png", S.png(8, 8)); const svg = await up(w, LOGO, "a.svg", S.svg());
  const rep = (id, name, bytes) => B.adminReplaceAsset(w.deps, { organizationId: w.org.id, assetId: id, actor: "a@f.test", file: { name, bytes } });
  assert.deepEqual(await rep(png.id, "new.png", S.png(16, 16)), { ok: true, id: png.id, name: "Framework-Primary-Square-Light-Transparent.png" }, "same format: same name");
  assert.deepEqual(await rep(png.id, "x.pdf", S.pdf()), { ok: true, id: png.id, name: "Framework-Primary-Square-Light-Transparent.pdf" });
  assert.equal(nameOf(w, png.id).format, "pdf");
  const keys = w.bucket.store.size;
  assert.deepEqual(await rep(svg.id, "y.pdf", S.pdf()), { ok: false, error: "duplicate_name" }, "the pdf of this variant already exists");
  assert.equal(w.bucket.store.size, keys); assert.equal(nameOf(w, svg.id).format, "svg");
});

test("existing files keep their names: a legacy name survives publishing, notes, ordering and replacing; it changes only when a naming detail is edited on purpose", async () => {
  const w = await world();
  const key = `org/${w.org.id}/brand-assets/${crypto.randomUUID()}`;
  const png = S.png(); const inspected = await (await import("../portal/files/index.js")).inspectUpload({ bytes: png, originalName: "a.png", profile: "brand_admin", maxBytes: 1e6 });
  await (await import("../portal/files/index.js")).putObject(w.bucket, { key, organizationId: w.org.id, bytes: png, sha256: inspected.sha256, contentType: "image/png" });
  const id = crypto.randomUUID();
  w.db.raw.prepare("INSERT INTO brand_assets (id, organization_id, kind, title, logo_role, orientation, tone, format, content_type, size_bytes, sha256, storage_key, original_name, created_by) VALUES (?, ?, 'logo', 'Old title', 'primary', 'horizontal', 'light', 'png', 'image/png', ?, ?, ?, 'Old Primary Logo.png', 'legacy')").run(id, w.org.id, png.length, inspected.sha256, key);
  const edit = (patch) => B.adminUpdateAsset(w.deps, { organizationId: w.org.id, assetId: id, actor: "a@f.test", patch });
  assert.equal((await edit({ published: true, usage_note: "n", sort_order: 2 })).name, "Old Primary Logo.png");
  assert.equal((await edit({ tone: "light" })).name, "Old Primary Logo.png", "setting a detail to what it already is changes nothing");
  assert.equal((await B.adminReplaceAsset(w.deps, { organizationId: w.org.id, assetId: id, actor: "a@f.test", file: { name: "n.png", bytes: S.png(12, 12) } })).name, "Old Primary Logo.png");
  assert.equal(nameOf(w, id).title, "Old title");
  assert.equal((await edit({ tone: "dark" })).name, "Framework-Primary-Horizontal-Dark.png", "an intended naming change adopts the standard name");
  // an explicit opt-in adopts the standard name (and still refuses a clash)
  assert.equal((await edit({ standard_name: true })).name, "Framework-Primary-Horizontal-Dark.png", "re-adopting after the change above is a no-op rename to the same standard name");
  w.db.raw.prepare("UPDATE brand_assets SET original_name = 'Old Primary Logo.png' WHERE id = ?").run(id);
  assert.equal((await edit({ standard_name: true, published: true })).name, "Framework-Primary-Horizontal-Dark.png", "an older name is replaced by the standard one only when asked");
  assert.equal(nameOf(w, id).variant_key, "primary-horizontal-dark");
  // legacy names also block new files with the same name, in any case
  w.db.raw.prepare("UPDATE brand_assets SET original_name = 'FRAMEWORK-primary-horizontal-light.PNG', tone = 'dark' WHERE id = ?").run(id);
  assert.equal((await up(w, { ...LOGO, orientation: "horizontal", transparent: false }, "z.png", S.png())).error, "duplicate_name");
});

test("the Admin form uses the shared naming module, shows a live preview with duplicate and missing-detail warnings, and has no manual title or variant fields for logos", () => {
  const ui = strip(read("admin/assets/branding.js"));
  assert.match(ui, /from "\.\/brand-names\.js"/);
  assert.match(ui, /buildBrandFileName\(/);
  assert.match(ui, /aria-live": "polite"/, "the preview is announced politely");
  assert.match(ui, /already exists/i);
  assert.ok(!/Variant name|groups the formats of one logo/.test(ui), "no manual variant field");
  assert.ok(!/id: prefix \+ "-variant"/.test(ui));
  assert.ok(/descriptionBox\.hidden = k === "logo"/.test(ui), "the title is only asked for files that are not logos");
  const src = strip(read("admin/assets/brand-names.js"));
  assert.ok(!/document\.|fetch\(|window\.|import\s/.test(src), "the naming module is pure");
  assert.match(strip(read("worker/portal/brand-files.js")), /from "\.\.\/\.\.\/admin\/assets\/brand-names\.js"/, "the server uses the very same module");
});

/* ------------------------------------------------------------------ brand name */

test("a Brand Name is used instead of the organization's full name; without one the organization's name is used", async () => {
  const w = await world("Framework Test Organization");
  const DARK = { kind: "logo", logo_role: "primary", orientation: "square", tone: "dark" };
  const before = await up(w, DARK, "a.png", S.png());
  assert.equal(before.name, "Framework-Test-Organization-Primary-Square-Dark.png", "no brand name: the organization's name");
  assert.ok((await repo.saveBrandKit(w.db, w.org.id, { brandName: "Framework" }, "a@f.test")).ok);
  const after = await up(w, { ...DARK, tone: "light" }, "b.png", S.png());
  assert.equal(after.name, "Framework-Primary-Square-Light.png");
  assert.equal((await up(w, { ...DARK, transparent: true }, "c.png", S.png())).name, "Framework-Primary-Square-Dark-Transparent.png");
  assert.equal((await up(w, { kind: "guideline", title: "brand guidelines" }, "g.pdf", S.pdf())).name, "Framework-Brand-Guidelines.pdf", "non-logo files too");
  // the exact example from the request
  assert.equal((await up(w, DARK, "d.svg", S.svg())).name, "Framework-Primary-Square-Dark.svg");
  // clearing it goes back to the organization's name for NEW files
  assert.ok((await repo.saveBrandKit(w.db, w.org.id, { brandName: "" }, "a@f.test")).ok);
  assert.equal((await repo.getBrandKit(w.db, w.org.id)).brandName, null);
  assert.equal((await up(w, { ...DARK, tone: "mono" }, "e.png", S.png())).name, "Framework-Test-Organization-Primary-Square-Mono.png");
  assert.equal(before.ok, true);
});

test("existing files are never renamed by setting, changing or clearing the brand name; they change only when explicitly renamed, and then use the current brand name", async () => {
  const w = await world("Framework Test Organization");
  const L = { kind: "logo", logo_role: "primary", orientation: "square", tone: "dark" };
  const a = await up(w, L, "a.png", S.png());
  const guide = await up(w, { kind: "guideline", title: "brand guidelines" }, "g.pdf", S.pdf());
  const names = () => rows(w.db, "SELECT original_name FROM brand_assets ORDER BY original_name").map((r) => r.original_name);
  const start = names();
  for (const brandName of ["Framework", "Acme Studio", "", "Framework"]) { assert.ok((await repo.saveBrandKit(w.db, w.org.id, { brandName }, "a@f.test")).ok); assert.deepEqual(names(), start, `brand name ${JSON.stringify(brandName)} renamed nothing`); }
  const edit = (id, patch) => B.adminUpdateAsset(w.deps, { organizationId: w.org.id, assetId: id, actor: "a@f.test", patch });
  assert.equal((await edit(a.id, { published: true, usage_note: "x" })).name, "Framework-Test-Organization-Primary-Square-Dark.png", "publishing and notes still never rename");
  assert.equal((await edit(a.id, { standard_name: true })).name, "Framework-Primary-Square-Dark.png", "an explicit rename adopts the current brand name");
  assert.equal((await edit(a.id, { tone: "light" })).name, "Framework-Primary-Square-Light.png", "so does a deliberate naming change");
  assert.equal((await edit(guide.id, { standard_name: true })).name, "Framework-Brand-Guidelines.pdf");
  // replacing keeps the stem, whatever the brand name is now
  assert.ok((await repo.saveBrandKit(w.db, w.org.id, { brandName: "Other Brand" }, "a@f.test")).ok);
  assert.equal((await B.adminReplaceAsset(w.deps, { organizationId: w.org.id, assetId: a.id, actor: "a@f.test", file: { name: "x.svg", bytes: S.svg() } })).name, "Framework-Primary-Square-Light.svg");
});

test("the brand name is validated, saved without touching colours or typography (and the other way round), and recorded in the audit trail", async () => {
  const w = await world();
  const save = (x) => repo.saveBrandKit(w.db, w.org.id, x, "a@f.test");
  assert.ok((await save({ colours: [{ name: "Ink", role: "primary", hex: "#000000" }], typography: [{ role: "body", family: "Switzer" }] })).ok);
  assert.ok((await save({ brandName: "  Framework  " })).ok);
  let kit = await repo.getBrandKit(w.db, w.org.id);
  assert.deepEqual([kit.brandName, kit.colours.length, kit.typography.length, kit.status], ["Framework", 1, 1, "draft"]);
  assert.ok((await save({ colours: [] })).ok); kit = await repo.getBrandKit(w.db, w.org.id);
  assert.deepEqual([kit.brandName, kit.colours.length, kit.typography.length], ["Framework", 0, 1], "saving colours keeps the brand name");
  for (const bad of ["日本語", "!!!", "x".repeat(61), "bad\u0007name", 5, {}, ["a"]]) assert.deepEqual(await save({ brandName: bad }), { ok: false, error: "invalid_brand_name" }, JSON.stringify(bad));
  assert.equal((await repo.getBrandKit(w.db, w.org.id)).brandName, "Framework", "a refused value changed nothing");
  for (const good of ["Framework", "Zoë & Sons", "A", "x".repeat(60), "iPhone Co."]) assert.ok((await save({ brandName: good })).ok, good);
  assert.ok((await save({ brandName: null })).ok); assert.equal((await repo.getBrandKit(w.db, w.org.id)).brandName, null);
  assert.ok(count(w.db, "activity_log", "action = 'brand.kit.brand_name_saved'") >= 5);
  assert.throws(() => w.db.raw.prepare("UPDATE brand_kits SET brand_name = ? WHERE organization_id = ?").run("x".repeat(61), w.org.id), /constraint/i, "the database refuses an over-long name by itself");
  assert.throws(() => w.db.raw.prepare("UPDATE brand_kits SET brand_name = '' WHERE organization_id = ?").run(w.org.id), /constraint/i, "…and an empty one");
});

test("the Admin form has a Brand name field whose live example matches the generated names, and says existing files keep their names", () => {
  const ui = strip(read("admin/assets/branding.js"));
  assert.match(ui, /label.*"Brand name \(optional\)"|"Brand name \(optional\)"/);
  assert.match(ui, /const brandCompany = \(\) => \(data\.kit && data\.kit\.brandName\) \|\| data\.organization\.name;/);
  assert.match(ui, /company: brandCompany\(\)/, "the live preview uses it");
  assert.match(ui, /Files already uploaded keep their names/);
  assert.match(ui, /api\(base \+ "\/kit", \{ method: "PUT", body: \{ brand_name: value \|\| null \} \}\)/);
  assert.match(strip(read("worker/portal/brand-files.js")), /kit && kit\.brandName \? kit\.brandName : org\.name/, "the server resolves the same fallback");
  const m = read("migrations/portal/0006_brand_name.sql");
  assert.match(m, /ALTER TABLE brand_kits ADD COLUMN brand_name TEXT CHECK/); assert.ok(!/\b(DROP|DELETE|UPDATE)\b/i.test(m.replace(/--.*$/gm, "")), "additive only");
});
