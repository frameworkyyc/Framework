/* Branding, Phase 1 (infrastructure only: migration, private file storage, validation, repository and permission functions; no routes, no pages).
   Proves: organization isolation, role permissions, draft/published visibility, upload validation, download headers, quotas, replacement, deletion and offboarding. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { openPortalDb, rows, count } from "./helpers/portal-db.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as repo from "../portal/repo/index.js";
import * as B from "../portal/brand-files.js";
import { inspectUpload, cleanFileName, attachmentHeader, makeKey, parseKey, putObject, getObject, deleteObject, fileResponse, limitsFromEnv, DEFAULT_LIMITS, inspectZip, StorageError } from "../portal/files/index.js";
import { can, requirePermission } from "../portal/policy.js";

const NOW = new Date("2026-10-26T12:00:00.000Z");
const MB = 1024 * 1024;

async function world() {
  const db = openPortalDb();
  const bucket = fakeR2();
  const org = async (slug) => (await repo.createOrganizationAudited(db, { slug, name: slug.toUpperCase() }, "seed")).organization;
  const user = async (n, email) => (await repo.upsertUserFromIdentity(db, { workosUserId: `user_01BRAND${n}0000`, email, name: email.split("@")[0] })).user;
  const join = (o, u, role) => db.raw.prepare("INSERT INTO memberships (id, organization_id, user_id, role, status, created_at, created_by) VALUES (?, ?, ?, ?, 'active', ?, 'seed')").run(crypto.randomUUID(), o.id, u.id, role, NOW.toISOString());
  const a = await org("alpha"), b = await org("beta");
  const ownerA = await user(1, "owner@alpha.test"), memberA = await user(2, "member@alpha.test"), ownerB = await user(3, "owner@beta.test"), outsider = await user(4, "outsider@x.test");
  join(a, ownerA, "owner"); join(a, memberA, "member"); join(b, ownerB, "owner");
  const deps = { db, bucket, env: {}, now: NOW };
  return { db, bucket, deps, a, b, ownerA, memberA, ownerB, outsider };
}
const file = (name, bytes) => ({ name, bytes });
const asOwner = (w, extra = {}) => ({ role: "owner", organizationId: w.a.id, userId: w.ownerA.id, ...extra });
const asMember = (w, extra = {}) => ({ role: "member", organizationId: w.a.id, userId: w.memberA.id, ...extra });
const assetMeta = (o = {}) => ({ kind: "logo", logo_role: "primary", orientation: "horizontal", tone: "light", transparent: true, ...o });
async function deliver(w, org, o = {}, f = file("logo.png", S.png()), actor = "admin@framework.test") {
  const r = await B.adminUploadAsset(w.deps, { organizationId: org.id, actor, meta: assetMeta(o.meta), file: f });
  assert.ok(r.ok, JSON.stringify(r));
  return r.id;
}

/* ------------------------------------------------------------------ migration */

test("migration 0005 (approved for Staging only): additive, idempotent, and creates exactly the four branding tables; Production is not mentioned as applied", () => {
  assert.ok(readdirSync(new URL("../../migrations/portal/", import.meta.url)).includes("0005_branding.sql"));
  assert.ok(!readdirSync(new URL("../../migrations/", import.meta.url)).includes("portal-proposed"), "the proposal folder is empty and gone");
  const sql = readFileSync(new URL("../../migrations/portal/0005_branding.sql", import.meta.url), "utf8");
  assert.match(sql, /NOT applied to Production/);
  assert.ok(!/\b(ALTER|DROP)\b|(?<!ON )\b(DELETE|UPDATE)\b/i.test(sql.replace(/--.*$/gm, "")), "no change to anything that exists");
  assert.deepEqual([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]), ["brand_kits", "brand_assets", "brand_uploads", "service_requests"]);
  const db = openPortalDb();
  const tables = rows(db, "SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
  for (const t of ["brand_kits", "brand_assets", "brand_uploads", "service_requests"]) assert.ok(tables.includes(t), t);
  db.raw.exec(sql); // a second run changes nothing
});

test("the schema refuses bad rows by itself (CHECK constraints are the backstop): bad hash, bad kind, font upload without the rights tick, two open requests", async () => {
  const w = await world();
  const ins = (sql, ...p) => w.db.raw.prepare(sql).run(...p);
  assert.throws(() => ins("INSERT INTO brand_assets (id, organization_id, kind, title, format, content_type, size_bytes, sha256, storage_key, original_name, created_by) VALUES (?, ?, 'virus', 't', 'png', 'image/png', 1, ?, ?, 'a.png', 'x')", crypto.randomUUID(), w.a.id, "0".repeat(64), "k".repeat(50)), /constraint/i);
  assert.throws(() => ins("INSERT INTO brand_assets (id, organization_id, kind, title, format, content_type, size_bytes, sha256, storage_key, original_name, created_by) VALUES (?, ?, 'logo', 't', 'png', 'image/png', 1, 'nothex', ?, 'a.png', 'x')", crypto.randomUUID(), w.a.id, "k".repeat(50)), /constraint/i);
  assert.throws(() => ins("INSERT INTO brand_uploads (id, organization_id, category, original_name, format, content_type, size_bytes, sha256, storage_key, uploaded_by, font_rights_ack) VALUES (?, ?, 'fonts', 'a.ttf', 'ttf', 'font/ttf', 1, ?, ?, ?, 0)", crypto.randomUUID(), w.a.id, "0".repeat(64), "k".repeat(50), w.ownerA.id), /constraint/i);
  assert.throws(() => ins("INSERT INTO brand_kits (organization_id, status, updated_by) VALUES (?, 'published', 'x')", w.a.id), /constraint/i, "published needs a publication time");
});

/* ------------------------------------------------------------------ filenames, limits, ZIP */

test("filenames are cleaned: paths, control and bidi characters removed; dangerous or missing extensions refused; the download header cannot be injected", () => {
  assert.deepEqual(cleanFileName("..\\..\\etc/Logo Final.PNG"), { name: "Logo Final.PNG", ext: "png" });
  assert.equal(cleanFileName("photo\u202Egnp.png").name, "photognp.png", "bidi override characters are removed, not displayed");
  assert.equal(cleanFileName("tab\tand\nnewline.pdf").name, "tabandnewline.pdf");
  for (const bad of ["logo.exe.png", "run.png.js", "noextension", ".png", "a.", "x".repeat(130) + ".png", "", null, undefined, 5, {}, "a.verylongextension", "evil.docm", "page.html"]) assert.equal(cleanFileName(bad), null, String(bad));
  const header = attachmentHeader('x"; filename=evil.exe\r\nSet-Cookie: a=b‮.png');
  assert.ok(header.startsWith("attachment;") && !/[\r\n]/.test(header) && !/filename=evil/.test(header.replace(/filename\*?=.*/, "")), header);
  assert.match(attachmentHeader("Café logo.png"), /filename\*=UTF-8''Caf%C3%A9%20logo\.png/);
});

test("limits: 25 MB, 50 files, 250 MB by default; configurable by plain environment values; nonsense or oversized values fall back, never remove a limit", () => {
  assert.deepEqual({ ...DEFAULT_LIMITS }, { maxFileBytes: 25 * MB, maxFiles: 50, quotaBytes: 250 * MB });
  assert.deepEqual({ ...limitsFromEnv({}) }, { ...DEFAULT_LIMITS });
  assert.equal(limitsFromEnv({ PORTAL_FILES_MAX_FILE_BYTES: "10485760", PORTAL_FILES_MAX_FILES: "5", PORTAL_FILES_QUOTA_BYTES: "1048576" }).maxFiles, 5);
  for (const bad of ["0", "-1", "abc", "1e9", "", "999999999999999", " ", "5; DROP"]) assert.equal(limitsFromEnv({ PORTAL_FILES_MAX_FILES: bad }).maxFiles, 50, bad);
  assert.equal(limitsFromEnv({ PORTAL_FILES_MAX_FILE_BYTES: String(500 * MB) }).maxFileBytes, 25 * MB, "above the hard ceiling: default");
});

test("ZIP inspection never extracts; it refuses traversal, symlinks, encryption, executables, nested archives, directory/file disagreement and bomb-shaped claims", () => {
  assert.ok(inspectZip(S.brandPack()).ok);
  const bad = (entries, code) => assert.deepEqual(inspectZip(S.zip(entries)), { ok: false, code });
  bad([{ name: "../../evil.txt", data: S.text("x") }], "archive_unsafe_entry");
  bad([{ name: "/abs/evil.txt", data: S.text("x") }], "archive_unsafe_entry");
  bad([{ name: "a\\b.txt", data: S.text("x") }], "archive_unsafe_entry");
  bad([{ name: "C:evil.txt", data: S.text("x") }], "archive_unsafe_entry");
  bad([{ name: "link", data: S.text("/etc/passwd"), madeBy: 3, attrs: 0o120777 << 16 }], "archive_unsafe_entry");
  bad([{ name: "secret.txt", data: S.text("x"), flags: 1 }], "archive_encrypted");
  bad([{ name: "tool.exe", data: S.text("MZ") }], "archive_unsafe_entry");
  bad([{ name: "inner.zip", data: S.text("PK") }], "archive_unsafe_entry");
  bad([{ name: "a.txt", data: S.text("x"), method: 9 }], "archive_unsupported");
  bad([{ name: "bomb.txt", data: S.text("x"), usize: 900 * MB, csize: 100 }, { name: "bomb2.txt", data: S.text("x"), usize: 900 * MB, csize: 100 }], "archive_too_large");
  const broken = S.zip([{ name: "a.txt", data: S.text("hello") }]); broken[0] = 0; // the first local header no longer matches the directory
  assert.equal(inspectZip(broken).ok, false);
  assert.equal(inspectZip(Uint8Array.from([0x50, 0x4b, 3, 4, 1, 2, 3])).ok, false, "truncated");
  assert.equal(inspectZip(S.zip(Array.from({ length: 2001 }, (_, i) => ({ name: `f${i}.txt` })))).code, "archive_entries");
});

/* ------------------------------------------------------------------ upload validation */

const accept = async (name, bytes, profile = "brand_client") => inspectUpload({ bytes, originalName: name, profile, maxBytes: 25 * MB });

test("upload validation: every allowed type is accepted when its content matches, and the recorded type comes from the bytes", async () => {
  const cases = [["a.png", S.png(), "image/png"], ["a.JPEG", S.jpeg(), "image/jpeg"], ["a.webp", S.webp(), "image/webp"], ["a.svg", S.svg(), "image/svg+xml"], ["a.pdf", S.pdf(), "application/pdf"], ["a.ai", S.pdf(), "application/pdf"],
    ["a.eps", S.eps(), "application/postscript"], ["a.ttf", S.ttf(), "font/ttf"], ["a.otf", S.otf(), "font/otf"], ["a.woff2", S.woff2(), "font/woff2"], ["a.txt", S.text("Primary #112233"), "text/plain"],
    ["a.docx", S.docx(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], ["pack.zip", S.brandPack(), "application/zip"]];
  for (const [name, bytes, mime] of cases) {
    const r = await accept(name, bytes);
    assert.ok(r.ok, name + " " + JSON.stringify(r));
    assert.equal(r.contentType, mime, name);
    assert.match(r.sha256, /^[0-9a-f]{64}$/);
  }
  assert.equal((await accept("a.JPEG", S.jpeg())).ext, "jpg");
});

test("upload validation: mislabelled files, executables, scripts, active content and bad structure are refused with a specific reason", async () => {
  const refuse = async (name, bytes, error, profile) => assert.deepEqual(await accept(name, bytes, profile), { ok: false, error }, name);
  await refuse("a.png", S.pdf(), "content_mismatch");                                   // a PDF pretending to be a PNG
  await refuse("a.pdf", S.png(), "content_mismatch");
  await refuse("a.png", S.text("MZ\u0090 this is a program"), "content_mismatch");
  await refuse("a.jpg", S.png(), "content_mismatch");
  await refuse("a.ttf", S.otf(), "content_mismatch");
  await refuse("logo.exe", S.text("MZ"), "invalid_name");
  await refuse("logo.exe.png", S.png(), "invalid_name");
  await refuse("page.html", S.text("<html>"), "invalid_name");
  await refuse("macro.docm", S.docx(), "invalid_name");
  await refuse("a.gif", S.png(), "type_not_allowed");
  await refuse("a.doc", S.text("x"), "type_not_allowed");
  await refuse("a.rar", S.text("Rar!"), "type_not_allowed");
  await refuse("a.png", new Uint8Array(0), "empty_file");
  await refuse("a.png", S.png(30000, 10), "image_dimensions");
  await refuse("a.png", S.png(), "unknown_profile", "nope");
  assert.deepEqual(await inspectUpload({ bytes: new Uint8Array(11), originalName: "a.txt", profile: "brand_client", maxBytes: 10 }), { ok: false, error: "file_too_large" });
  assert.deepEqual(await inspectUpload({ bytes: "not bytes", originalName: "a.txt", profile: "brand_client", maxBytes: 10 }), { ok: false, error: "no_file" });
  await refuse("a.txt", Uint8Array.from([65, 0, 66]), "content_mismatch");                // NUL byte in "text"
  await refuse("a.txt", Uint8Array.from([0xff, 0xfe, 0xfd]), "content_mismatch");        // not UTF-8
});

test("SVG: scripts, event handlers, external references, entities and style tricks are refused; plain artwork passes", async () => {
  for (const body of ['<script>alert(1)</script>', '<rect onclick="x()" width="1" height="1"/>', '<rect ONLOAD = "x"/>', '<a href="https://evil.example"><rect/></a>', '<image href="data:image/png;base64,AAAA"/>', '<use xlink:href="http://x/y.svg#a"/>',
    '<foreignObject><div/></foreignObject>', '<style>@import url(http://evil/x.css);</style>', '<rect style="fill:url(https://evil/p)"/>', '<a href="javascript:alert(1)"><rect/></a>', '<a href="&#106;avascript:alert(1)"><rect/></a>',
    '<animate attributeName="href" values="javascript:alert(1)"/>', '<iframe src="x"/>']) {
    assert.deepEqual(await accept("a.svg", S.svg(body)), { ok: false, error: "active_content" }, body);
  }
  assert.deepEqual(await accept("a.svg", S.text('<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"/>')), { ok: false, error: "active_content" });
  assert.deepEqual(await accept("a.svg", S.text("<html><body>not svg</body></html>")), { ok: false, error: "content_mismatch" });
  assert.ok((await accept("a.svg", S.svg('<defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="1" height="1"/><a href="#top"><rect/></a>'))).ok, "fragment references are fine");
});

test("PDF, AI and EPS: JavaScript, launch actions, embedded files, auto-open actions, encryption and PostScript file operators are refused (including hex-escaped names)", async () => {
  for (const extra of ["/OpenAction << /S /JavaScript /JS (app.alert(1)) >>", "/AA << >>", "/Names << /EmbeddedFiles 3 0 R >>", "/S /Launch /F (cmd.exe)", "/J#61vaScript 1 0 R", "/Type /RichMedia", "/XFA 4 0 R"]) {
    assert.deepEqual(await accept("a.pdf", S.pdf(extra)), { ok: false, error: "active_content" }, extra);
    assert.deepEqual(await accept("a.ai", S.pdf(extra)), { ok: false, error: "active_content" }, "ai " + extra);
  }
  assert.deepEqual(await accept("a.pdf", S.pdf("/Encrypt 9 0 R")), { ok: false, error: "pdf_encrypted" });
  assert.ok((await accept("a.pdf", S.pdf("/Names << /Dests 1 0 R >>"))).ok, "ordinary names pass");
  for (const extra of ["(/etc/passwd) deletefile\n", "(x) (w) file\n", "(%pipe%rm -rf /) (r) file\n", "(evil.ps) run\n", "currentfile 1 filenameforall\n"]) assert.deepEqual(await accept("a.eps", S.eps(extra)), { ok: false, error: "active_content" }, extra);
  assert.deepEqual(await accept("a.ai", S.eps()), { ok: false, error: "content_mismatch" }, "an old PostScript .ai is not accepted");
});

test("Office files: macros, ActiveX and embedded objects are refused; the document must have its expected parts", async () => {
  for (const extra of [{ name: "word/vbaProject.bin", data: S.text("x") }, { name: "word/activeX/activeX1.xml", data: S.text("x") }, { name: "word/embeddings/oleObject1.bin", data: S.text("x") }])
    assert.deepEqual(await accept("a.docx", S.docx([extra])), { ok: false, error: "active_content" }, extra.name);
  assert.deepEqual(await accept("a.xlsx", S.docx()), { ok: false, error: "content_mismatch" }, "a docx renamed to xlsx");
  assert.deepEqual(await accept("a.docx", S.brandPack()), { ok: false, error: "content_mismatch" }, "a plain zip renamed to docx");
});

/* ------------------------------------------------------------------ storage */

test("storage keys carry the organization and a random id, never client text; a key is only usable by its own organization", async () => {
  const w = await world();
  const key = makeKey(w.a.id, "brand-uploads");
  assert.match(key, new RegExp(`^org/${w.a.id}/brand-uploads/[0-9a-f-]{36}$`));
  assert.notEqual(makeKey(w.a.id, "brand-uploads"), key);
  assert.deepEqual(parseKey(key), { organizationId: w.a.id, area: "brand-uploads" });
  for (const bad of ["", "org/x/brand-uploads/y", `org/${w.a.id}/brand-uploads/../x`, `org/${w.a.id}/other/${crypto.randomUUID()}`, `${key}/`, `/${key}`, null, 5]) assert.equal(parseKey(bad), null, String(bad));
  assert.throws(() => makeKey("not-a-uuid", "files"), StorageError);
  assert.throws(() => makeKey(w.a.id, "../x"), StorageError);
  const bytes = S.png();
  const sha = (await inspectUpload({ bytes, originalName: "a.png", profile: "brand_client", maxBytes: MB })).sha256;
  await putObject(w.bucket, { key, organizationId: w.a.id, bytes, sha256: sha, contentType: "image/png" });
  const stored = w.bucket.store.get(key);
  assert.equal(stored.httpMetadata.contentType, "application/octet-stream", "stored as opaque bytes whatever the file is");
  assert.equal(stored.customMetadata.org, w.a.id);
  assert.ok(await getObject(w.bucket, { key, organizationId: w.a.id }));
  assert.equal(await getObject(w.bucket, { key, organizationId: w.b.id }), null, "another organization cannot read it");
  await assert.rejects(() => putObject(w.bucket, { key, organizationId: w.b.id, bytes, sha256: sha, contentType: "image/png" }), (e) => e.code === "key_organization_mismatch");
  await assert.rejects(() => deleteObject(w.bucket, { key, organizationId: w.b.id }), (e) => e.code === "key_organization_mismatch");
  w.bucket.store.get(key).customMetadata.org = w.b.id; // a tampered object that sits under A's key but claims B
  assert.equal(await getObject(w.bucket, { key, organizationId: w.a.id }), null);
  await assert.rejects(() => putObject(w.bucket, { key: makeKey(w.a.id, "files"), organizationId: w.a.id, bytes, sha256: "0".repeat(64), contentType: "x" }), (e) => e.code === "storage_write_failed", "R2 rejects bytes that do not match the digest");
  await assert.rejects(() => putObject(null, { key, organizationId: w.a.id, bytes, sha256: sha, contentType: "x" }), (e) => e.code === "storage_unavailable");
});

test("downloads are attachments with hardening headers; only a Framework logo image may be inline, and ZIP/PDF/fonts/client files never are", async () => {
  const obj = { body: new Response("x").body };
  const attach = fileResponse({ object: obj, name: "Logo.svg", ext: "svg", size: 1 });
  assert.equal(attach.headers.get("Content-Type"), "application/octet-stream");
  assert.match(attach.headers.get("Content-Disposition"), /^attachment;/);
  assert.equal(attach.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(attach.headers.get("Cache-Control"), "private, no-store");
  assert.match(attach.headers.get("Content-Security-Policy"), /sandbox/);
  assert.equal(attach.headers.get("Content-Length"), "1");
  const inline = fileResponse({ object: { body: null }, name: "x.png", ext: "png", inlineImage: true });
  assert.equal(inline.headers.get("Content-Type"), "image/png");
  assert.equal(inline.headers.get("Content-Disposition"), "inline");
  assert.match(inline.headers.get("Content-Security-Policy"), /sandbox/);
  for (const ext of ["zip", "pdf", "ttf", "docx", "eps", "txt", "html", "constructor"]) {
    const r = fileResponse({ object: { body: null }, name: "a." + ext, ext, inlineImage: true });
    assert.equal(r.headers.get("Content-Type"), "application/octet-stream", ext);
    assert.match(r.headers.get("Content-Disposition"), /^attachment/, ext);
  }
});

/* ------------------------------------------------------------------ brand kit: colours, typography, publication */

test("colours and typography are validated; the kit starts as a draft and saving never publishes", async () => {
  const w = await world();
  assert.ok((await repo.saveBrandKit(w.db, w.a.id, { colours: [{ name: "Ink", role: "primary", hex: "#0a0a0a" }, { name: "Sand", role: "accent", hex: "#D8C3A5", note: "Use sparingly" }], typography: [{ role: "heading", family: "Switzer", weights: [600, 400, 400], usage: "Headings", source_url: "https://fonts.example/switzer" }] }, "admin@f.test")).ok);
  const kit = await repo.getBrandKit(w.db, w.a.id);
  assert.equal(kit.status, "draft");
  assert.equal(kit.colours[0].hex, "#0A0A0A");
  assert.deepEqual(kit.typography[0].weights, [400, 600]);
  for (const colours of [[{ name: "x", role: "primary", hex: "red" }], [{ name: "x", role: "primary", hex: "#12345" }], [{ name: "x", role: "boss", hex: "#123456" }], [{ name: "", role: "primary", hex: "#123456" }], "x", Array(17).fill({ name: "x", role: "primary", hex: "#123456" })])
    assert.equal((await repo.saveBrandKit(w.db, w.a.id, { colours }, "a@f.test")).error, "invalid_colours", JSON.stringify(colours).slice(0, 40));
  for (const typography of [[{ role: "body", family: "F", weights: [450] }], [{ role: "body", family: "F", source_url: "http://insecure.example" }], [{ role: "body", family: "F", source_url: "javascript:alert(1)" }], [{ role: "x", family: "F" }], [{ role: "body", family: "" }]])
    assert.equal((await repo.saveBrandKit(w.db, w.a.id, { typography }, "a@f.test")).error, "invalid_typography", JSON.stringify(typography));
  assert.equal((await repo.saveBrandKit(w.db, w.a.id, { colours: [] }, "")).error, "invalid_actor");
  assert.equal((await repo.getBrandKit(w.db, w.a.id)).colours.length, 2, "a refused save changed nothing");
  assert.equal(await repo.getBrandKit(w.db, w.b.id), null);
  assert.equal((await repo.setBrandKitStatus(w.db, w.b.id, "published", "a@f.test")).error, "not_found", "there is nothing to publish");
});

test("visibility: a client sees NOTHING until the kit is published, and then only published, undeleted assets of their own organization", async () => {
  const w = await world();
  const logo = await deliver(w, w.a, { meta: { published: true } });
  const draftLogo = await deliver(w, w.a, { meta: { tone: "dark" } }, file("draft.png", S.png(9, 9)));
  await repo.saveBrandKit(w.db, w.a.id, { colours: [{ name: "Ink", role: "primary", hex: "#000000" }] }, "a@f.test");
  assert.deepEqual(await repo.getClientBrand(w.db, w.a.id), { published: false }, "kit is a draft: even published assets are hidden");
  assert.equal(await repo.getClientBrandAsset(w.db, w.a.id, logo), null, "and cannot be downloaded");
  assert.deepEqual(await B.clientDownloadAsset(w.deps, { ...asOwner(w), assetId: logo }), { ok: false, error: "not_found" });
  await repo.setBrandKitStatus(w.db, w.a.id, "published", "a@f.test", { now: NOW });
  const view = await repo.getClientBrand(w.db, w.a.id);
  assert.equal(view.published, true);
  assert.deepEqual(view.assets.map((x) => x.id), [logo], "the unpublished asset is not listed");
  assert.equal(await repo.getClientBrandAsset(w.db, w.a.id, draftLogo), null);
  assert.ok(!JSON.stringify(view).match(/storage|sha256|org\/|draft/i), "no keys, hashes or draft state reach the client");
  assert.ok((await B.clientDownloadAsset(w.deps, { ...asOwner(w), assetId: logo })).ok);
  await repo.setBrandKitStatus(w.db, w.a.id, "draft", "a@f.test");
  assert.deepEqual(await repo.getClientBrand(w.db, w.a.id), { published: false }, "unpublishing hides everything again");
  assert.equal((await B.clientDownloadAsset(w.deps, { ...asOwner(w), assetId: logo })).error, "not_found");
  await repo.setBrandKitStatus(w.db, w.a.id, "published", "a@f.test");
  assert.ok((await B.adminDeleteAsset(w.deps, { organizationId: w.a.id, assetId: logo, actor: "a@f.test" })).ok);
  assert.deepEqual((await repo.getClientBrand(w.db, w.a.id)).assets, [], "a deleted asset disappears");
});

test("fonts: listed with their licence note but downloadable only when Admin says so AND records the licence", async () => {
  const w = await world();
  const font = await deliver(w, w.a, { meta: { kind: "font", title: "Switzer", published: true } }, file("Switzer.ttf", S.ttf()));
  assert.equal((await repo.getBrandAssetAdmin(w.db, w.a.id, font)).downloadable, false, "default for fonts: not downloadable");
  await repo.saveBrandKit(w.db, w.a.id, {}, "a@f.test"); await repo.setBrandKitStatus(w.db, w.a.id, "published", "a@f.test");
  assert.equal((await repo.getClientBrand(w.db, w.a.id)).assets[0].canDownload, false);
  assert.equal((await B.clientDownloadAsset(w.deps, { ...asOwner(w), assetId: font })).error, "not_found");
  assert.equal((await repo.updateBrandAsset(w.db, w.a.id, font, { downloadable: true }, "a@f.test")).error, "font_license_required");
  assert.ok((await repo.updateBrandAsset(w.db, w.a.id, font, { downloadable: true, license_note: "Open Font Licence 1.1" }, "a@f.test")).ok);
  assert.equal((await repo.getClientBrand(w.db, w.a.id)).assets[0].canDownload, true);
  assert.ok((await B.clientDownloadAsset(w.deps, { ...asMember(w), assetId: font })).ok);
});

test("asset metadata is validated, and unknown fields cannot be smuggled into the update", async () => {
  const w = await world();
  const id = await deliver(w, w.a);
  assert.equal((await repo.updateBrandAsset(w.db, w.a.id, id, { kind: "virus" }, "a@f.test")).error, "invalid_kind");
  assert.equal((await repo.updateBrandAsset(w.db, w.a.id, id, { variant_key: "Bad Key!" }, "a@f.test")).error, "invalid_variant");
  assert.equal((await repo.updateBrandAsset(w.db, w.a.id, id, { tone: "neon" }, "a@f.test")).error, "invalid_tone");
  assert.equal((await repo.updateBrandAsset(w.db, w.a.id, id, { sort_order: -1 }, "a@f.test")).error, "invalid_sort_order");
  assert.equal((await repo.updateBrandAsset(w.db, w.a.id, id, { storage_key: "org/x", organization_id: w.b.id, sha256: "0" }, "a@f.test")).error, "invalid_input", "only the reviewed fields can be changed");
  assert.equal((await repo.updateBrandAsset(w.db, w.a.id, id, { title: "Renamed", storage_key: "org/x", organization_id: w.b.id }, "a@f.test")).ok, true, "unknown fields are ignored, known ones applied");
  const row = rows(w.db, "SELECT organization_id, storage_key FROM brand_assets WHERE id = ?", id)[0];
  assert.equal(row.organization_id, w.a.id);
  assert.match(row.storage_key, new RegExp(`^org/${w.a.id}/brand-assets/`), "key and organization unchanged");
  assert.equal((await repo.updateBrandAsset(w.db, w.b.id, id, { title: "Hijack" }, "a@f.test")).error, "not_found", "another organization's id is not found");
  assert.equal(rows(w.db, "SELECT title FROM brand_assets WHERE id = ?", id)[0].title, "Renamed");
});

/* ------------------------------------------------------------------ client uploads: permissions, isolation, limits */

test("permissions: owners and members upload and download; only owners delete or request a quote; unknown roles do nothing", async () => {
  assert.ok(can("owner", "branding.view") && can("member", "branding.view") && can("owner", "branding.upload") && can("member", "branding.upload"));
  assert.ok(can("owner", "branding.delete_upload") && !can("member", "branding.delete_upload"));
  assert.ok(can("owner", "branding.request") && !can("member", "branding.request"));
  for (const role of [undefined, null, "", "admin", "OWNER", "viewer", {}, "__proto__"]) for (const a of ["branding.view", "branding.upload", "branding.delete_upload", "branding.request"]) assert.ok(!can(role, a), `${String(role)} ${a}`);
  assert.throws(() => requirePermission("member", "branding.request"));
  const w = await world();
  const up = await B.clientUploadFile(w.deps, { ...asMember(w), category: "logo", file: file("Our Logo.png", S.png()) });
  assert.ok(up.ok, JSON.stringify(up));
  assert.deepEqual(await B.clientDeleteUpload(w.deps, { ...asMember(w), uploadId: up.id }), { ok: false, error: "forbidden" });
  assert.deepEqual(await B.clientRequestService(w.deps, { ...asMember(w), serviceKey: "business-card-design" }), { ok: false, error: "forbidden" });
  assert.ok((await B.clientDownloadUpload(w.deps, { ...asMember(w), uploadId: up.id })).ok, "a member can download a shared upload");
  assert.deepEqual(await B.clientUploadFile(w.deps, { role: "viewer", organizationId: w.a.id, userId: w.memberA.id, category: "logo", file: file("a.png", S.png()) }), { ok: false, error: "forbidden" });
  assert.ok((await B.clientDeleteUpload(w.deps, { ...asOwner(w), uploadId: up.id })).ok, "an owner can delete it (any member's upload)");
  assert.equal(w.bucket.store.size, 0, "and the stored object is gone at once");
});

test("organization isolation: another organization cannot list, download, delete or even detect a file; the same holds for a user who is not a member", async () => {
  const w = await world();
  const up = await B.clientUploadFile(w.deps, { ...asOwner(w), category: "logo", file: file("secret-logo.png", S.png()) });
  const asset = await deliver(w, w.a, { meta: { published: true } });
  await repo.saveBrandKit(w.db, w.a.id, {}, "a@f.test"); await repo.setBrandKitStatus(w.db, w.a.id, "published", "a@f.test");
  const asB = (extra = {}) => ({ role: "owner", organizationId: w.b.id, userId: w.ownerB.id, ...extra });
  assert.deepEqual(await repo.listClientUploads(w.db, w.b.id), []);
  assert.deepEqual(await repo.getClientBrand(w.db, w.b.id), { published: false });
  assert.deepEqual(await B.clientDownloadUpload(w.deps, { ...asB(), uploadId: up.id }), { ok: false, error: "not_found" });
  assert.deepEqual(await B.clientDownloadAsset(w.deps, { ...asB(), assetId: asset }), { ok: false, error: "not_found" });
  assert.deepEqual(await B.clientDeleteUpload(w.deps, { ...asB(), uploadId: up.id }), { ok: false, error: "not_found" });
  assert.deepEqual(await B.adminDownloadUpload(w.deps, { organizationId: w.b.id, uploadId: up.id, actor: "a@f.test" }), { ok: false, error: "not_found" });
  assert.equal((await B.adminDeleteAsset(w.deps, { organizationId: w.b.id, assetId: asset, actor: "a@f.test" })).error, "not_found");
  assert.equal(count(w.db, "brand_uploads", "deleted_at IS NOT NULL"), 0, "nothing was deleted by the attempts");
  // B's session with A's id in the body still cannot upload as A: the organization is whatever the caller passes from the membership, and the user must belong to it
  const forged = await B.clientUploadFile(w.deps, { role: "owner", organizationId: w.a.id, userId: w.ownerB.id, category: "logo", file: file("x.png", S.png()) });
  assert.deepEqual(forged, { ok: false, error: "not_allowed" });
  const outsider = await B.clientUploadFile(w.deps, { role: "member", organizationId: w.a.id, userId: w.outsider.id, category: "logo", file: file("x.png", S.png()) });
  assert.deepEqual(outsider, { ok: false, error: "not_allowed" });
  assert.equal(w.bucket.store.size, 2, "refused uploads leave no stored object behind");
  for (const k of w.bucket.store.keys()) assert.ok(k.startsWith(`org/${w.a.id}/`));
});

test("upload limits: file count and organization quota are enforced inside the insert, so simultaneous uploads cannot overshoot; refused uploads leave nothing stored", async () => {
  const w = await world();
  w.deps.env = { PORTAL_FILES_MAX_FILES: "3", PORTAL_FILES_QUOTA_BYTES: String(1000) };
  const big = (n) => S.text("x".repeat(n));
  const results = await Promise.all([1, 2, 3, 4, 5].map((i) => B.clientUploadFile(w.deps, { ...asOwner(w), category: "other", file: file(`n${i}.txt`, big(10)) })));
  assert.equal(results.filter((r) => r.ok).length, 3, JSON.stringify(results));
  assert.equal(count(w.db, "brand_uploads"), 3);
  assert.equal(w.bucket.store.size, 3, "the refused ones were cleaned out of storage");
  assert.deepEqual(await B.clientUploadFile(w.deps, { ...asOwner(w), category: "other", file: file("late.txt", big(10)) }), { ok: false, error: "file_limit" });
  w.deps.env = { PORTAL_FILES_MAX_FILES: "50", PORTAL_FILES_QUOTA_BYTES: "1000" };
  assert.deepEqual(await B.clientUploadFile(w.deps, { ...asOwner(w), category: "other", file: file("bytes.txt", big(980)) }), { ok: false, error: "quota_exceeded" });
  assert.ok((await B.clientUploadFile(w.deps, { ...asOwner(w), category: "other", file: file("fits.txt", big(960)) })).ok, "exactly within the quota is allowed");
  w.deps.env = { PORTAL_FILES_MAX_FILE_BYTES: "100" };
  assert.deepEqual(await B.clientUploadFile(w.deps, { ...asOwner(w), category: "other", file: file("huge.txt", big(101)) }), { ok: false, error: "file_too_large" });
  const other = await B.clientUploadFile({ ...w.deps, env: {} }, { role: "owner", organizationId: w.b.id, userId: w.ownerB.id, category: "other", file: file("b.txt", big(10)) });
  assert.ok(other.ok, "another organization has its own quota");
});

test("fonts: a client upload of a font needs the rights confirmation; the confirmation is stored; refused files are not stored", async () => {
  const w = await world();
  assert.deepEqual(await B.clientUploadFile(w.deps, { ...asOwner(w), category: "fonts", file: file("Brand.ttf", S.ttf()) }), { ok: false, error: "font_rights_required" });
  assert.deepEqual(await B.clientUploadFile(w.deps, { ...asOwner(w), category: "other", file: file("Brand.otf", S.otf()) }), { ok: false, error: "font_rights_required" }, "a font file in another category needs it too");
  assert.equal(w.bucket.store.size, 0);
  const ok = await B.clientUploadFile(w.deps, { ...asOwner(w), category: "fonts", fontRightsAck: true, file: file("Brand.ttf", S.ttf()) });
  assert.ok(ok.ok);
  assert.equal(rows(w.db, "SELECT font_rights_ack FROM brand_uploads WHERE id = ?", ok.id)[0].font_rights_ack, 1);
});

test("a client's own files are listed without keys or hashes, are never inline, and a held file cannot be downloaded by anyone until released", async () => {
  const w = await world();
  const up = await B.clientUploadFile(w.deps, { ...asMember(w), category: "guidelines", file: file("Guidelines.pdf", S.pdf()) });
  const list = await repo.listClientUploads(w.db, w.a.id);
  assert.deepEqual(Object.keys(list[0]).sort(), ["category", "createdAt", "format", "held", "id", "name", "size"]);
  const res = await B.clientDownloadUpload(w.deps, { ...asOwner(w), uploadId: up.id });
  assert.match(res.response.headers.get("Content-Disposition"), /^attachment; filename="Guidelines\.pdf"/);
  assert.equal(res.response.headers.get("Content-Type"), "application/octet-stream");
  assert.ok((await repo.setUploadHeld(w.db, w.a.id, up.id, true, "a@f.test")).ok);
  assert.equal((await B.clientDownloadUpload(w.deps, { ...asOwner(w), uploadId: up.id })).error, "not_found");
  assert.equal((await B.adminDownloadUpload(w.deps, { organizationId: w.a.id, uploadId: up.id, actor: "a@f.test" })).error, "not_found");
  assert.equal((await repo.listClientUploads(w.db, w.a.id))[0].held, true);
  assert.ok((await repo.setUploadHeld(w.db, w.a.id, up.id, false, "a@f.test")).ok);
  assert.ok((await B.adminDownloadUpload(w.deps, { organizationId: w.a.id, uploadId: up.id, actor: "a@f.test" })).ok);
  assert.ok((await repo.markUploadsSeen(w.db, w.a.id)).marked === 1);
});

/* ------------------------------------------------------------------ audit trail */

test("every download and file change is recorded in the activity log, and nothing in it holds a key, a URL, a file name or a token", async () => {
  const w = await world();
  const up = await B.clientUploadFile(w.deps, { ...asMember(w), category: "logo", file: file("Client Secret Logo.png", S.png()) });
  await B.clientDownloadUpload(w.deps, { ...asOwner(w), uploadId: up.id });
  await B.adminDownloadUpload(w.deps, { organizationId: w.a.id, uploadId: up.id, actor: "staff@framework.test" });
  const asset = await deliver(w, w.a, { meta: { published: true } });
  await repo.saveBrandKit(w.db, w.a.id, {}, "a@f.test"); await repo.setBrandKitStatus(w.db, w.a.id, "published", "a@f.test");
  await B.clientDownloadAsset(w.deps, { ...asMember(w), assetId: asset });
  await B.clientDeleteUpload(w.deps, { ...asOwner(w), uploadId: up.id });
  const log = rows(w.db, "SELECT actor_type, actor_ref, action, entity_type, entity_id, detail, visibility FROM activity_log WHERE organization_id = ? AND action LIKE 'brand.%' ORDER BY created_at, rowid", w.a.id);
  const actions = log.map((l) => l.action);
  for (const a of ["brand.upload.created", "brand.upload.download", "brand.asset.created", "brand.asset.download", "brand.kit.saved", "brand.kit.published", "brand.upload.deleted"]) assert.ok(actions.includes(a), a);
  const downloads = log.filter((l) => /download/.test(l.action));
  assert.deepEqual(downloads.map((d) => [d.actor_type, d.entity_type]), [["client", "brand_upload"], ["admin", "brand_upload"], ["client", "brand_asset"]]);
  assert.equal(downloads[1].actor_ref, "staff@framework.test");
  assert.ok(log.every((l) => l.visibility === "internal"), "file events are staff-visible only");
  const text = JSON.stringify(log);
  assert.ok(!/org\/|brand-uploads|brand-assets|Secret Logo|https?:|token|\.png/i.test(text), "no keys, names, URLs or tokens: " + text);
});

/* ------------------------------------------------------------------ replacement, deletion, offboarding, orphans */

test("replacing a deliverable stores the new file, swaps it on the row, and deletes the old object; a failed swap leaves the original intact", async () => {
  const w = await world();
  const id = await deliver(w, w.a);
  const before = (await repo.getBrandAssetAdmin(w.db, w.a.id, id));
  const r = await B.adminReplaceAsset(w.deps, { organizationId: w.a.id, assetId: id, actor: "a@f.test", file: file("logo-v2.png", S.png(16, 16)) });
  assert.ok(r.ok);
  const after = await repo.getBrandAssetAdmin(w.db, w.a.id, id);
  assert.notEqual(after.storageKey, before.storageKey);
  assert.notEqual(after.sha256, before.sha256);
  assert.equal(after.title, before.title, "metadata and publication are kept");
  assert.ok(!w.bucket.store.has(before.storageKey) && w.bucket.store.has(after.storageKey));
  assert.equal(w.bucket.store.size, 1);
  assert.deepEqual(await B.adminReplaceAsset(w.deps, { organizationId: w.a.id, assetId: id, actor: "a@f.test", file: file("evil.exe", S.text("MZ")) }), { ok: false, error: "invalid_name" });
  assert.deepEqual(await B.adminReplaceAsset(w.deps, { organizationId: w.b.id, assetId: id, actor: "a@f.test", file: file("x.png", S.png()) }), { ok: false, error: "not_found" });
  assert.equal(w.bucket.store.size, 1);
  assert.equal((await repo.getBrandAssetAdmin(w.db, w.a.id, id)).storageKey, after.storageKey);
});

test("if storage cannot delete an object the row is still removed, the failure is recorded for the orphan check, and the orphan is found", async () => {
  const w = await world();
  const up = await B.clientUploadFile(w.deps, { ...asOwner(w), category: "logo", file: file("a.png", S.png()) });
  const realDelete = w.bucket.delete.bind(w.bucket);
  w.bucket.delete = async () => { throw new Error("R2 unavailable"); };
  assert.deepEqual(await B.clientDeleteUpload(w.deps, { ...asOwner(w), uploadId: up.id }), { ok: true, storageCleanup: "pending" });
  assert.equal(count(w.db, "brand_uploads", "deleted_at IS NOT NULL"), 1);
  assert.equal(count(w.db, "activity_log", "action = 'brand.storage.cleanup_failed'"), 1);
  assert.equal((await B.findOrphanObjects(w.deps, { organizationId: w.a.id })).length, 1);
  w.bucket.delete = realDelete;
  assert.deepEqual(await B.findOrphanObjects(w.deps, { organizationId: w.b.id }), [], "per organization");
});

test("offboarding: every object and row of one organization is removed (orphans too), another organization is untouched, and running it twice is harmless", async () => {
  const w = await world();
  await B.clientUploadFile(w.deps, { ...asOwner(w), category: "logo", file: file("a.png", S.png()) });
  await B.clientUploadFile(w.deps, { ...asMember(w), category: "other", file: file("b.txt", S.text("x")) });
  await deliver(w, w.a, { meta: { published: true } });
  await B.clientUploadFile({ ...w.deps }, { role: "owner", organizationId: w.b.id, userId: w.ownerB.id, category: "logo", file: file("keep.png", S.png()) });
  await putObject(w.bucket, { key: makeKey(w.a.id, "files"), organizationId: w.a.id, bytes: S.png(), sha256: (await inspectUpload({ bytes: S.png(), originalName: "x.png", profile: "brand_client", maxBytes: MB })).sha256, contentType: "image/png" }); // an orphan
  const r = await B.deleteOrganizationFiles(w.deps, { organizationId: w.a.id, actor: "admin@f.test" });
  assert.deepEqual({ assets: r.assets, uploads: r.uploads, removed: r.objectsRemoved, failed: r.objectsFailed }, { assets: 1, uploads: 2, removed: 4, failed: 0 });
  assert.deepEqual([...w.bucket.store.keys()].map((k) => k.split("/")[1]), [w.b.id], "only the other organization's object remains");
  assert.equal((await repo.listClientUploads(w.db, w.a.id)).length, 0);
  assert.equal((await repo.listClientUploads(w.db, w.b.id)).length, 1);
  assert.equal((await B.deleteOrganizationFiles(w.deps, { organizationId: w.a.id, actor: "admin@f.test" })).objectsRemoved, 0);
  assert.ok(count(w.db, "activity_log", "action = 'brand.files.deleted_all'") === 2);
});

test("a failed database write after a successful storage write removes the new object (no orphan), and a storage outage is reported without touching the database", async () => {
  const w = await world();
  const realBatch = w.db.batch.bind(w.db);
  w.db.batch = async () => { throw new Error("D1 down"); };
  await assert.rejects(() => B.clientUploadFile(w.deps, { ...asOwner(w), category: "logo", file: file("a.png", S.png()) }), /D1 down/);
  assert.equal(w.bucket.store.size, 0);
  w.db.batch = realBatch;
  assert.deepEqual(await B.clientUploadFile({ ...w.deps, bucket: null }, { ...asOwner(w), category: "logo", file: file("a.png", S.png()) }), { ok: false, error: "storage_unavailable" });
  assert.equal(count(w.db, "brand_uploads"), 0);
  w.bucket.put = async () => { throw new Error("R2 down"); };
  assert.deepEqual(await B.clientUploadFile(w.deps, { ...asOwner(w), category: "logo", file: file("a.png", S.png()) }), { ok: false, error: "storage_write_failed" });
  assert.equal(count(w.db, "brand_uploads"), 0);
});

/* ------------------------------------------------------------------ service requests */

test("service requests: Business Card Design and Email Signature Design only, owners only, one open request per service, reopenable after it closes, scoped per organization", async () => {
  const w = await world();
  assert.ok((await B.clientRequestService(w.deps, { ...asOwner(w), serviceKey: "business-card-design", note: "Two sided please" })).ok);
  assert.deepEqual(await B.clientRequestService(w.deps, { ...asOwner(w), serviceKey: "business-card-design" }), { ok: false, error: "already_requested" });
  assert.ok((await B.clientRequestService(w.deps, { ...asOwner(w), serviceKey: "email-signature-design" })).ok, "a different service is separate");
  assert.deepEqual(await B.clientRequestService(w.deps, { ...asOwner(w), serviceKey: "logo-bomb" }), { ok: false, error: "unknown_service" });
  assert.deepEqual(await B.clientRequestService(w.deps, { ...asOwner(w), serviceKey: "business-card-design", note: "x".repeat(1001) }), { ok: false, error: "invalid_note" });
  assert.ok((await B.clientRequestService(w.deps, { role: "owner", organizationId: w.b.id, userId: w.ownerB.id, serviceKey: "business-card-design" })).ok, "another organization may ask for the same service");
  assert.deepEqual(await B.clientRequestService(w.deps, { role: "owner", organizationId: w.b.id, userId: w.ownerA.id, serviceKey: "email-signature-design" }), { ok: false, error: "not_allowed" }, "the requester must belong to the organization");
  const [first] = (await repo.listServiceRequests(w.db, w.a.id)).filter((r) => r.serviceKey === "business-card-design");
  assert.equal(first.status, "new");
  assert.ok((await repo.updateServiceRequest(w.db, w.a.id, first.id, { status: "contacted", adminNote: "Called Tuesday" }, "staff@f.test")).ok);
  assert.deepEqual(await B.clientRequestService(w.deps, { ...asOwner(w), serviceKey: "business-card-design" }), { ok: false, error: "already_requested" }, "contacted is still open");
  assert.ok((await repo.updateServiceRequest(w.db, w.a.id, first.id, { status: "closed" }, "staff@f.test")).ok);
  assert.ok((await B.clientRequestService(w.deps, { ...asOwner(w), serviceKey: "business-card-design" })).ok, "after closing, a new request is possible");
  assert.equal((await repo.updateServiceRequest(w.db, w.b.id, first.id, { status: "closed" }, "staff@f.test")).error, "not_found", "another organization cannot touch it");
  assert.equal((await repo.updateServiceRequest(w.db, w.a.id, first.id, { status: "bogus" }, "staff@f.test")).error, "invalid_status");
  assert.equal((await repo.listServiceRequests(w.db, w.a.id, { openOnly: true })).length, 2);
});

/* ------------------------------------------------------------------ source guards */

test("the branding code only touches storage through the private storage module and never builds a key, path or header from client text", () => {
  const read = (f) => readFileSync(new URL("../portal/" + f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const service = read("brand-files.js");
  assert.ok(!/\.(put|get|delete|list)\(/.test(service.replace(/deps\.bucket/g, "")), "no direct bucket calls in the service layer");
  for (const f of ["files/storage.js", "files/response.js", "files/sniff.js", "files/names.js", "files/zip.js", "repo/brand.js", "brand-files.js"]) {
    const src = read(f);
    assert.ok(!/innerHTML|eval\(|new Function|child_process|fetch\(/.test(src), f);
    assert.ok(!/\.extract|unzip|inflate|decompress|DecompressionStream/i.test(src), f + ": nothing is ever unpacked");
  }
  const storage = read("files/storage.js");
  assert.ok(!/originalName|\.name\b/.test(storage.replace(/this\.name|err\.name|e\.name/g, "")), "keys never use a file name");
  assert.match(storage, /contentType: "application\/octet-stream"/);
});
