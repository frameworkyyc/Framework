// Apple Wallet for the digital business card: signing tool, pass contents, Worker route, and the "no button until a real pass exists" guards.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { readZip, writeZip, crc32 } from "../../scripts/wallet/zip.mjs";
import { buildCsr, buildCert, parseCert, pem } from "../../scripts/wallet/pki.mjs";
import { makeTestChain } from "../../scripts/wallet/testchain.mjs";
import { REQUIRED_IMAGES, IMAGE_DIR, PASS_FILE, META_FILE, OUT_DIR, PASS_TYPE_ID, REPO, buildPassJson, buildPkpass, inspectPkpass, loadCardConfig } from "../../scripts/wallet/pass.mjs";
import { assertOutsideRepo, build, init, verify } from "../../scripts/wallet/wallet.mjs";
import { handleWalletPass } from "../card-wallet.js";

const root = (...p) => path.join(REPO, ...p);
const read = (...p) => fs.readFileSync(root(...p), "utf8");
const cfg = loadCardConfig();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "wallet-test-"));
const hasOpenssl = spawnSync("openssl", ["version"]).status === 0;

function testPass(opts = {}) {
  const chain = makeTestChain(opts.chain);
  const pkpass = buildPkpass({ cfg, ...chain, digest: opts.digest });
  return { chain, pkpass };
}

// ---- building blocks -----------------------------------------------------------------------------------------------
test("zip: round trip, fixed timestamps, CRC checked", () => {
  const files = [{ name: "a.txt", data: Buffer.from("hello hello hello hello") }, { name: "b.png", data: crypto.randomBytes(300) }];
  const zip = writeZip(files);
  assert.deepEqual(writeZip(files), zip, "same input, same bytes");
  const back = readZip(zip);
  assert.equal(back.get("a.txt").toString(), "hello hello hello hello");
  assert.ok(back.get("b.png").equals(files[1].data));
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  const bad = Buffer.from(zip); bad[40] ^= 0xff;
  assert.throws(() => readZip(bad));
});

test("signing: pass builds, verifies, and survives an independent OpenSSL check", { skip: !hasOpenssl && "openssl not installed" }, () => {
  const { pkpass } = testPass();
  const dir = tmp();
  for (const [name, data] of readZip(pkpass)) fs.writeFileSync(path.join(dir, name.replace("@", "_")), data);
  const out = spawnSync("openssl", ["smime", "-verify", "-binary", "-noverify", "-inform", "DER", "-in", path.join(dir, "signature"), "-content", path.join(dir, "manifest.json"), "-out", os.devNull]);
  assert.equal(out.status, 0, String(out.stderr));
  // and a changed manifest must fail OpenSSL too
  fs.appendFileSync(path.join(dir, "manifest.json"), " ");
  const bad = spawnSync("openssl", ["smime", "-verify", "-binary", "-noverify", "-inform", "DER", "-in", path.join(dir, "signature"), "-content", path.join(dir, "manifest.json"), "-out", os.devNull]);
  assert.notEqual(bad.status, 0);
});

test("signing: both digests verify; tampering with any part is caught", () => {
  for (const digest of ["sha256", "sha1"]) {
    const { pkpass } = testPass({ digest });
    assert.deepEqual(inspectPkpass(pkpass).problems, [], digest);
  }
  const { pkpass } = testPass();
  const files = [...readZip(pkpass)].map(([name, data]) => ({ name, data }));
  const mutate = (name, fn) => writeZip(files.map((f) => (f.name === name ? { name, data: fn(Buffer.from(f.data)) } : f)));
  assert.ok(inspectPkpass(mutate("pass.json", (b) => Buffer.from(b.toString().replace("JJ Brick", "J Brick")))).problems.some((p) => /manifest hash/.test(p)));
  assert.ok(inspectPkpass(mutate("logo.png", (b) => { b[b.length - 20] ^= 1; return b; })).problems.some((p) => /manifest hash/.test(p)));
  assert.ok(inspectPkpass(mutate("manifest.json", (b) => Buffer.from(b.toString().replace(/[0-9a-f]/, (c) => (c === "0" ? "1" : "0"))))).problems.length > 0);
  assert.ok(inspectPkpass(mutate("signature", (b) => { b[b.length - 5] ^= 1; return b; })).problems.length > 0);
  assert.ok(inspectPkpass(writeZip(files.filter((f) => f.name !== "icon.png"))).problems.some((p) => /missing icon.png/.test(p)));
  assert.ok(inspectPkpass(Buffer.from("not a zip")).problems.length > 0);
});

test("signing: a test chain is recognised as TEST, never as Apple", () => {
  const { pkpass } = testPass();
  assert.equal(inspectPkpass(pkpass).apple, false);
});

test("request file (CSR): valid PKCS#10 that proves possession of the key", { skip: !hasOpenssl && "openssl not installed" }, () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const file = path.join(tmp(), "r.csr");
  fs.writeFileSync(file, pem("CERTIFICATE REQUEST", buildCsr(privateKey, publicKey, { CN: "Framework Wallet Pass", C: "CA" })));
  const out = spawnSync("openssl", ["req", "-in", file, "-noout", "-verify", "-subject"]);
  assert.equal(out.status, 0, String(out.stderr));
  assert.match(String(out.stdout) + String(out.stderr), /Framework Wallet Pass/);
});

test("certificates: DER reader finds issuer, serial, Team ID and Pass Type ID", () => {
  const { signer, intermediate } = makeTestChain({ team: "ABCDE12345" });
  assert.equal(signer.subject.OU, "ABCDE12345");
  assert.equal(signer.subject.UID, PASS_TYPE_ID);
  assert.ok(signer.issuerRaw.equals(intermediate.subjectRaw));
  assert.ok(signer.x509.verify(intermediate.x509.publicKey));
});

// ---- keys stay outside the repository -------------------------------------------------------------------------------
test("secrets: the tool refuses any key, certificate or output folder inside the repository", () => {
  assert.throws(() => assertOutsideRepo(root("wallet-secrets", "key.pem")), /inside the repository/);
  assert.throws(() => assertOutsideRepo(root("assets", "k.pem")), /inside the repository/);
  assert.throws(() => init({ dir: root("keys") }), /inside the repository/);
  assert.doesNotThrow(() => assertOutsideRepo(path.join(os.tmpdir(), "private", "key.pem")));
  // a symlink pointing into the repo does not get around it
  const link = path.join(tmp(), "sneaky");
  try { fs.symlinkSync(root("assets"), link); assert.throws(() => assertOutsideRepo(path.join(link, "k.pem")), /inside the repository/); } catch (e) { if (e.code !== "EPERM") throw e; }
});

test("init: creates a private key and request file outside the repo, never overwrites a key", () => {
  const dir = path.join(tmp(), "secrets");
  const r = init({ dir });
  const key = crypto.createPrivateKey(fs.readFileSync(r.keyFile));
  assert.equal(key.asymmetricKeyType, "rsa");
  assert.match(fs.readFileSync(r.csrFile, "utf8"), /^-----BEGIN CERTIFICATE REQUEST-----/);
  if (process.platform !== "win32") assert.equal(fs.statSync(r.keyFile).mode & 0o077, 0, "key is private to the owner");
  assert.throws(() => init({ dir }), /already exists/);
});

test("build: refuses the wrong certificate, a non-Apple intermediate, and a key that does not match", () => {
  const dir = tmp();
  const put = (name, buf) => { const f = path.join(dir, name); fs.writeFileSync(f, buf); return f; };
  const good = makeTestChain();
  const keyFile = put("k.pem", good.privateKey.export({ type: "pkcs8", format: "pem" }));
  const certFile = put("pass.cer", good.signer.der), wwdrFile = put("wwdr.cer", good.intermediate.der);
  // the right files, but the intermediate is not Apple's
  assert.throws(() => build({ certFile, wwdrFile, keyFile, outDir: path.join(dir, "o1") }), /Worldwide Developer Relations/);
  // a certificate for a different pass type
  const other = makeTestChain({ passTypeId: "pass.com.example.other" });
  assert.throws(() => build({ certFile: put("o.cer", other.signer.der), wwdrFile, keyFile: put("ok.pem", other.privateKey.export({ type: "pkcs8", format: "pem" })), outDir: path.join(dir, "o2") }), /not pass\.ca\.frameworkco\.card/);
  // a key from somewhere else
  const stranger = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  assert.throws(() => build({ certFile, wwdrFile, keyFile: put("s.pem", stranger.privateKey.export({ type: "pkcs8", format: "pem" })), outDir: path.join(dir, "o3") }), /does not belong/);
  // inputs inside the repo are refused before anything is read
  assert.throws(() => build({ certFile: root("assets", "x.cer"), wwdrFile, keyFile }), /inside the repository/);
  assert.ok(!fs.existsSync(path.join(dir, "o1")), "nothing is written on failure");
});

test("build --test: writes a pass marked as TEST that verify accepts but the Worker would refuse", () => {
  const outDir = tmp();
  const r = build({ test: true, outDir });
  assert.equal(r.meta.signing, "test");
  assert.equal(verify(path.join(outDir, PASS_FILE)).ok, true);
  assert.equal(verify(path.join(outDir, PASS_FILE)).apple, false);
  assert.ok(path.resolve(outDir) !== path.resolve(OUT_DIR));
});

// ---- the pass itself ------------------------------------------------------------------------------------------------
test("pass: contents come from the card configuration and respect Wallet's limits", () => {
  const pass = buildPassJson(cfg, { teamIdentifier: "ABCDE12345" });
  const g = pass.generic;
  assert.equal(pass.passTypeIdentifier, "pass.ca.frameworkco.card");
  assert.equal(pass.serialNumber, "framework-card-jj-brick-v1");
  assert.equal(g.primaryFields[0].value, cfg.name);
  assert.deepEqual(g.secondaryFields.map((f) => f.value), [cfg.title, cfg.company]);
  assert.ok(g.headerFields.length <= 3 && g.primaryFields.length <= 1 && g.secondaryFields.length + g.auxiliaryFields.length <= 4 && g.auxiliaryFields.length <= 4);
  assert.deepEqual(pass.barcodes, [{ format: "PKBarcodeFormatQR", message: cfg.cardUrl, messageEncoding: "iso-8859-1", altText: "frameworkco.ca/card" }]);
  const back = Object.fromEntries(g.backFields.map((f) => [f.key, f.value]));
  assert.equal(back["b-email"], cfg.email);
  assert.equal(back["b-card"], cfg.cardUrl);
  assert.equal(back["b-ig"], cfg.social.instagram);
  assert.match(back["b-phone"], /^\+1 647 215 3773$/);
  const keys = [...g.headerFields, ...g.primaryFields, ...g.secondaryFields, ...g.auxiliaryFields, ...g.backFields].map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length, "field keys are unique");
  assert.match(pass.backgroundColor, /^rgb\(/);
  // minimal by decision: no photo, no location pushes, and no update service until one exists
  for (const forbidden of ["webServiceURL", "authenticationToken", "locations", "beacons", "relevantDate", "userInfo"]) assert.ok(!(forbidden in pass), forbidden);
  assert.ok(!JSON.stringify(pass).includes("thumbnail"));
});

test("pass: images exist at the sizes Wallet needs (icon 29/58/87, logo within 160x50 points)", () => {
  const size = (f) => { const b = fs.readFileSync(path.join(IMAGE_DIR, f)); assert.equal(b.subarray(1, 4).toString(), "PNG"); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  assert.deepEqual(REQUIRED_IMAGES.map(size), [[29, 29], [58, 58], [87, 87], [160, 50], [320, 100], [480, 150]]);
  assert.ok(!fs.existsSync(path.join(IMAGE_DIR, "thumbnail.png")));
});

// ---- Worker route ---------------------------------------------------------------------------------------------------
function envWith(files) {
  return { ASSETS: { fetch: async (req) => { const f = files[new URL(req.url).pathname]; return f === undefined ? new Response("nf", { status: 404 }) : new Response(f, { status: 200 }); } } };
}
const META_OK = JSON.stringify({ status: "ready", signing: "apple", passTypeIdentifier: PASS_TYPE_ID });
const route = (env, { host = "frameworkco.ca", method = "GET" } = {}) => handleWalletPass(new Request(`https://${host}/api/card/wallet.pkpass`, { method }), env);

test("route: 404 until a real Apple-signed pass is marked ready", async () => {
  const pass = "PK-bytes";
  for (const files of [
    {},
    { "/assets/wallet/Framework-card.pkpass": pass },
    { "/assets/wallet/pass-meta.json": META_OK },
    { "/assets/wallet/Framework-card.pkpass": pass, "/assets/wallet/pass-meta.json": JSON.stringify({ status: "ready", signing: "test", passTypeIdentifier: PASS_TYPE_ID }) },
    { "/assets/wallet/Framework-card.pkpass": pass, "/assets/wallet/pass-meta.json": JSON.stringify({ status: "pending", signing: "apple", passTypeIdentifier: PASS_TYPE_ID }) },
    { "/assets/wallet/Framework-card.pkpass": pass, "/assets/wallet/pass-meta.json": JSON.stringify({ status: "ready", signing: "apple", passTypeIdentifier: "pass.other" }) },
    { "/assets/wallet/Framework-card.pkpass": pass, "/assets/wallet/pass-meta.json": "{not json" },
  ]) {
    const res = await route(envWith(files));
    assert.equal(res.status, 404);
    assert.equal(res.headers.get("Content-Type"), "application/json");
  }
});

test("route: a ready pass is served with the Wallet content type and safe headers", async () => {
  const env = envWith({ "/assets/wallet/Framework-card.pkpass": "PK-bytes", "/assets/wallet/pass-meta.json": META_OK });
  const res = await route(env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/vnd.apple.pkpass");
  assert.match(res.headers.get("Content-Disposition"), /filename="Framework-JJ-Brick\.pkpass"/);
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(res.headers.get("X-Robots-Tag"), null, "production is not blocked from anything it serves");
  assert.equal(await res.text(), "PK-bytes");
  const head = await route(env, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const staging = await route(env, { host: "framework.example.workers.dev" });
  assert.equal(staging.headers.get("X-Robots-Tag"), "noindex, nofollow");
  const post = await route(env, { method: "POST" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("Allow"), "GET, HEAD");
});

test("route: wired before the /api/ default, and the update-service prefix is reserved but not served", () => {
  const index = read("worker", "index.js");
  assert.ok(index.indexOf("handleWalletPass") > 0);
  assert.ok(index.indexOf("WALLET_PASS_PATH) return handleWalletPass") < index.indexOf('path.startsWith("/api/")) return json({ error: "not_found" }, 404)'));
  assert.ok(!/api\/card\/wallet\//.test(index.replace(/\/\/.*$/gm, "")), "no update-service endpoints exist yet");
  const w = JSON.parse(read("wrangler.jsonc").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, ""));
  assert.ok(w.assets.run_worker_first.includes("/api/*"), "the pass path is covered by the existing /api/* rule");
});

// ---- the card page: nothing visible until a real pass exists ------------------------------------------------------------
test("card page: Wallet button is hidden by default, below Save Contact, with Apple's badge only loaded when enabled", () => {
  const html = read("card.html");
  assert.match(html, /<a class="card-wallet" id="add-wallet" href="#" hidden><img id="add-wallet-badge" alt="Add to Apple Wallet"[^>]*><\/a>/);
  assert.ok(!/id="add-wallet-badge"[^>]*\ssrc=/.test(html), "no image request unless the button is enabled");
  assert.ok(html.indexOf('id="save-contact"') < html.indexOf('id="add-wallet"') && html.indexOf('id="add-wallet"') < html.indexOf('id="trio"'));
  assert.match(html, /id="apple-credit" hidden>Apple, Apple Watch, iPhone, and iPod touch are trademarks of Apple Inc\., registered in the U\.S\. and other countries\.</);
  // existing features untouched
  for (const id of ["save-contact", "share-card", "toggle-qr", "act-call", "act-text", "act-email", "act-assessment", "act-portfolio", "act-web", "qr-dialog"]) assert.ok(html.includes(`id="${id}"`), id);
  const js = read("assets", "js", "card.js");
  assert.match(js, /iPhone\|iPad\|iPod/);
  assert.match(js, /res\.ok && \/application\\\/vnd\\\.apple\\\.pkpass\/i\.test/);
});

test("card page: the Wallet address in the config is empty or exactly the pass route", () => {
  assert.ok(cfg.walletUrl === "" || cfg.walletUrl === "/api/card/wallet.pkpass", JSON.stringify(cfg.walletUrl));
  assert.ok("walletUrl" in cfg);
});

test("guard: the button can only be enabled once a verified, Apple-signed, current pass and the official badge are in the repo", () => {
  const passFile = path.join(OUT_DIR, PASS_FILE), metaFile = path.join(OUT_DIR, META_FILE);
  const badge = root("assets", "img", "wallet", "add-to-apple-wallet.svg");
  if (cfg.walletUrl) {
    assert.ok(fs.existsSync(passFile) && fs.existsSync(metaFile), "walletUrl is set but the pass or its meta file is missing");
    assert.ok(fs.existsSync(badge), "walletUrl is set but Apple's official badge is missing");
    assert.match(fs.readFileSync(badge, "utf8"), /<svg[\s\S]*<\/svg>/);
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    assert.equal(meta.status, "ready");
    assert.equal(meta.signing, "apple", "a test-signed pass must never be published");
    const v = verify(passFile);
    assert.deepEqual(v.problems, []);
    assert.equal(v.apple, true);
    assert.ok(v.signer.notAfter > new Date(), "the pass certificate has expired: renew it (worker/WALLET.md)");
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(passFile)).digest("hex"), meta.sha256, "meta does not describe this pass file");
  } else {
    if (fs.existsSync(metaFile)) assert.notEqual(JSON.parse(fs.readFileSync(metaFile, "utf8")).signing, "test", "a test-signed pass was committed");
  }
});

test("guard: no private keys or certificates are tracked, and they are ignored by git and the site build", () => {
  const tracked = spawnSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" });
  if (tracked.status === 0) {
    const bad = tracked.stdout.split("\n").filter((f) => /\.(p12|pfx|p8|key|pem|cer|certSigningRequest)$/i.test(f));
    assert.deepEqual(bad, []);
    for (const f of tracked.stdout.split("\n").filter((f) => f && !/\.(png|jpe?g|gif|webp|ico|woff2?|pdf|pkpass|zip|mp4|mov)$/i.test(f))) {
      const p = root(f);
      if (fs.existsSync(p) && fs.statSync(p).size < 2e6) assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(fs.readFileSync(p, "utf8")) || f === "worker/test/card-wallet.test.mjs", `private key material in ${f}`);
    }
  }
  for (const ignore of [".gitignore", ".assetsignore"]) {
    const text = read(ignore);
    for (const pattern of ["*.p12", "*.pem", "*.key", "*.cer", "*.certSigningRequest", "wallet-secrets/"]) assert.ok(text.includes(pattern), `${ignore} lacks ${pattern}`);
  }
  assert.match(read(".assetsignore"), /^scripts\/$/m, "the signing tool is not published");
});
