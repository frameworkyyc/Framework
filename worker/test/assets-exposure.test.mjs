// Static-asset exposure guard. wrangler.jsonc publishes the WHOLE repository root as static assets (assets.directory "./"), filtered only by the
// .assetsignore denylist, so any new root file is public unless it is ignored. This test applies .assetsignore to the files on disk (what a
// deploy uploads) and fails unless the published set is exactly the reviewed website. A new root file, dotfile, config, doc or data file
// therefore fails CI until someone either adds it to .assetsignore or deliberately adds it to the approved list below.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../../", import.meta.url);

// ---- the reviewed public surface (change these on purpose, in a reviewed commit) ----
const APPROVED_ROOT_FILES = [
  "404.html", "_headers", "about.html", "assessment.html", "card.html", "client-feedback.html", "contact.html",
  "index.html", "method.html", "portfolio.html", "privacy.html", "robots.txt", "services.html", "sitemap.xml",
];
const APPROVED_ROOT_DIRS = ["admin", "assets"];
const APPROVED_EXTENSIONS = ["css", "html", "jpg", "js", "png", "svg"]; // inside admin/ and assets/
const MUST_STAY_IGNORED = [
  ".node-version", ".assetsignore", ".gitignore", ".dev.vars", ".git/", ".github/", ".wrangler/", "node_modules/",
  "wrangler.jsonc", "README.md", "CNAME", "PRIVACY-OPERATIONS.md", "worker/", "migrations/",
];

/** The subset of .gitignore syntax .assetsignore uses here: "name", "name/", and * ? globs without a slash in the middle. Anything else fails loudly. */
function parseIgnore(text) {
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((line) => {
    assert.ok(!line.startsWith("!"), `negation is not supported by this test: ${line}`);
    assert.ok(!line.includes("**"), `"**" is not supported by this test: ${line}`);
    const dirOnly = line.endsWith("/");
    const name = dirOnly ? line.slice(0, -1) : line;
    assert.ok(!name.includes("/") && !name.startsWith("/"), `patterns with a slash in the middle are not supported by this test: ${line}`);
    const re = new RegExp("^" + name.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]") + "$");
    return { line, dirOnly, re };
  });
}
const rules = parseIgnore(readFileSync(new URL(".assetsignore", root), "utf8"));
const isIgnored = (name, isDir) => rules.some((r) => r.re.test(name) && (!r.dirOnly || isDir));

/** Every file a deploy would publish, as repository-relative paths. */
function published(dirUrl = root, prefix = "") {
  const out = [];
  for (const e of readdirSync(dirUrl, { withFileTypes: true })) {
    if (isIgnored(e.name, e.isDirectory())) continue;
    if (e.isDirectory()) out.push(...published(new URL(e.name + "/", dirUrl), prefix + e.name + "/"));
    else out.push(prefix + e.name);
  }
  return out.sort();
}
const files = published();

test("the published root is exactly the reviewed website: no unapproved root file, directory or dotfile is publicly deployable", () => {
  const rootFiles = files.filter((f) => !f.includes("/")).sort();
  const rootDirs = [...new Set(files.filter((f) => f.includes("/")).map((f) => f.split("/")[0]))].sort();
  assert.deepEqual(rootFiles, APPROVED_ROOT_FILES, "an unapproved root file would be public: add it to .assetsignore, or approve it here on purpose");
  assert.deepEqual(rootDirs, APPROVED_ROOT_DIRS, "an unapproved directory would be public");
});
test("no dotfile or dot-directory is published at any depth (the one exception class is none)", () => {
  assert.deepEqual(files.filter((f) => f.split("/").some((seg) => seg.startsWith("."))), []);
});
test("files inside admin/ and assets/ are only web assets (no maps, docs, data, config, scripts, archives or sources)", () => {
  for (const f of files.filter((f) => f.includes("/"))) {
    const ext = f.includes(".") ? f.split(".").pop().toLowerCase() : "";
    assert.ok(APPROVED_EXTENSIONS.includes(ext), `${f}: .${ext} is not an approved public asset type`);
  }
});
test("every intended website asset is still published (the guard did not hide the site)", () => {
  for (const f of APPROVED_ROOT_FILES) assert.ok(files.includes(f), f);
  assert.ok(files.some((f) => f.startsWith("assets/css/")) && files.some((f) => f.startsWith("assets/js/")) && files.some((f) => f.startsWith("assets/img/")));
  assert.ok(files.includes("assets/css/styles.css") && files.includes("assets/img/favicon.svg"), "files the client portal pages load");
  assert.ok(files.includes("admin/index.html") && files.some((f) => f.startsWith("admin/assets/")), "the admin app (served only after the Cloudflare Access check)");
  assert.ok(files.length >= 60, "the whole site, not a handful of files: " + files.length);
});
test(".assetsignore keeps excluding configuration, source, migrations, docs and the Node pin", () => {
  const lines = readFileSync(new URL(".assetsignore", root), "utf8").split("\n").map((l) => l.trim());
  for (const entry of MUST_STAY_IGNORED) assert.ok(lines.includes(entry), `${entry} must stay in .assetsignore`);
  for (const p of ["worker/index.js", "wrangler.jsonc", ".node-version", ".github/workflows/ci.yml", "migrations/portal/0001_portal_foundation.sql", "worker/test/ci-workflow.test.mjs"]) {
    assert.ok(!files.includes(p), `${p} must not be published`);
  }
});
test("the matcher is honest: it ignores what it should and publishes what it should", () => {
  assert.equal(isIgnored(".node-version", false), true);
  assert.equal(isIgnored("worker", true), true);
  assert.equal(isIgnored("worker", false), false, "a directory-only rule does not hide a plain file named worker");
  assert.equal(isIgnored("index.html", false), false);
  assert.equal(isIgnored(".nvmrc", false), false, "an unlisted dotfile is NOT ignored, which is exactly what the other tests catch");
});
