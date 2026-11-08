#!/usr/bin/env node
// Apple Wallet pass tool for the Framework digital business card. Pure Node (18+): works the same on Windows, macOS and Linux.
// No OpenSSL, Keychain, Xcode or .p12 file. The private key is created on YOUR computer, stays outside this repository, and is never uploaded.
//
//   node scripts/wallet/wallet.mjs init     [--dir <folder>]                     make the private key + the request file Apple needs
//   node scripts/wallet/wallet.mjs build    --cert <pass.cer> --wwdr <wwdr.cer> --key <key.pem> [--digest sha1]
//   node scripts/wallet/wallet.mjs verify   [file.pkpass]                         full check of the finished pass
//   node scripts/wallet/wallet.mjs status                                         what is ready and what is missing
//   node scripts/wallet/wallet.mjs rehearse                                       full dry run with a disposable fake certificate (nothing is published)
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCsr, loadCert, pem, isAppleWwdr } from "./pki.mjs";
import { META_FILE, OUT_DIR, PASS_FILE, PASS_TYPE_ID, REPO, SERIAL, buildPassJson, buildPkpass, inspectPkpass, loadCardConfig } from "./pass.mjs";
import { makeTestChain } from "./testchain.mjs";

export const fail = (msg) => { const e = new Error(msg); e.userFacing = true; return e; };

// The key and certificates are secrets: refuse any location inside this repository (it is published to the world by the site build).
export function assertOutsideRepo(file) {
  let dir = path.resolve(file);
  while (!fs.existsSync(dir)) dir = path.dirname(dir);
  const real = path.join(fs.realpathSync(dir), path.relative(dir, path.resolve(file)));
  const rel = path.relative(fs.realpathSync(REPO), real);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) throw fail(`Refusing to use ${file}: it is inside the repository. Keep keys and certificates in a private folder outside it.`);
}

const defaultDir = () => path.join(os.homedir(), "framework-wallet-secrets");

export function init({ dir = defaultDir() } = {}) {
  assertOutsideRepo(dir);
  const keyFile = path.join(dir, "pass-private-key.pem"), csrFile = path.join(dir, "pass-request.certSigningRequest");
  if (fs.existsSync(keyFile)) throw fail(`A private key already exists at ${keyFile}. It is not replaced. Use it, or move it away first if you really want a new one.`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const passphrase = process.env.WALLET_KEY_PASSPHRASE;
  const keyPem = passphrase
    ? privateKey.export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase })
    : privateKey.export({ type: "pkcs8", format: "pem" });
  fs.writeFileSync(keyFile, keyPem, { mode: 0o600, flag: "wx" });
  const csr = buildCsr(privateKey, publicKey, { CN: "Framework Wallet Pass", C: "CA" });
  fs.writeFileSync(csrFile, pem("CERTIFICATE REQUEST", csr));
  return { keyFile, csrFile, encrypted: !!passphrase };
}

function loadKey(file) {
  assertOutsideRepo(file);
  const pemText = fs.readFileSync(file);
  try { return crypto.createPrivateKey({ key: pemText, passphrase: process.env.WALLET_KEY_PASSPHRASE }); }
  catch (e) { throw fail(`Could not read the private key ${file}${/passphrase|decrypt/i.test(e.message) ? " (it is protected: set WALLET_KEY_PASSPHRASE first)" : ""}.`); }
}

export function build({ certFile, wwdrFile, keyFile, digest = "sha256", cfg = loadCardConfig(), test = false, outDir = OUT_DIR }) {
  let signer, intermediate, privateKey, teamIdentifier;
  if (test) {
    ({ signer, intermediate, privateKey, teamIdentifier } = makeTestChain());
  } else {
    if (!certFile || !wwdrFile || !keyFile) throw fail("build needs --cert, --wwdr and --key.");
    assertOutsideRepo(certFile); assertOutsideRepo(wwdrFile);
    signer = loadCert(certFile); intermediate = loadCert(wwdrFile); privateKey = loadKey(keyFile);
    if (!signer.x509.checkPrivateKey(privateKey)) throw fail("This private key does not belong to that certificate. Use the key created by the same 'init' run you uploaded the request from.");
    if (signer.subject.UID !== PASS_TYPE_ID) throw fail(`This certificate is for "${signer.subject.UID || "(unknown)"}", not ${PASS_TYPE_ID}. Download the certificate for the Pass Type ID ${PASS_TYPE_ID}.`);
    if (!signer.subject.OU) throw fail("The certificate has no Team ID. Download the Pass Type ID certificate from developer.apple.com.");
    if (!isAppleWwdr(intermediate)) throw fail("--wwdr must be Apple's \"Worldwide Developer Relations\" intermediate certificate (apple.com/certificateauthority).");
    if (!signer.x509.verify(intermediate.x509.publicKey)) throw fail("That intermediate certificate did not issue your pass certificate. Try the other Worldwide Developer Relations certificate listed on apple.com/certificateauthority.");
    teamIdentifier = signer.subject.OU;
  }
  if (signer.notAfter < new Date()) throw fail("The certificate has expired. Create a new one in your Apple Developer account.");
  const pkpass = buildPkpass({ cfg, signer, intermediate, privateKey, teamIdentifier, digest });
  const report = inspectPkpass(pkpass);
  if (report.problems.length) throw fail("The pass failed its own check: " + report.problems.join("; "));
  fs.mkdirSync(outDir, { recursive: true });
  const meta = {
    status: "ready",
    signing: report.apple ? "apple" : "test",
    passTypeIdentifier: report.pass.passTypeIdentifier,
    teamIdentifier,
    serialNumber: SERIAL,
    version: 1,
    builtAt: new Date().toISOString(),
    certNotAfter: signer.notAfter.toISOString(),
    sha256: crypto.createHash("sha256").update(pkpass).digest("hex"),
  };
  fs.writeFileSync(path.join(outDir, PASS_FILE), pkpass);
  fs.writeFileSync(path.join(outDir, META_FILE), JSON.stringify(meta, null, 2) + "\n");
  return { meta, pkpass, outDir, report };
}

// Everything a reviewer or CI needs to know about a finished pass: valid, signed by Apple's chain, and up to date with the card config.
export function verify(file, cfg = loadCardConfig()) {
  const buf = fs.readFileSync(file);
  const report = inspectPkpass(buf);
  const problems = [...report.problems];
  if (!problems.length) {
    const expected = buildPassJson(cfg, { teamIdentifier: report.pass.teamIdentifier });
    if (JSON.stringify(expected) !== JSON.stringify(report.pass)) problems.push("the pass does not match assets/js/card-config.js: rebuild it (node scripts/wallet/wallet.mjs build ...)");
    if (report.pass.passTypeIdentifier !== PASS_TYPE_ID) problems.push("unexpected Pass Type ID " + report.pass.passTypeIdentifier);
    if (report.pass.webServiceURL) problems.push("webServiceURL is set but no update service exists yet");
  }
  return { ok: problems.length === 0, problems, apple: report.apple, pass: report.pass, signer: report.signer };
}

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    else out._.push(argv[i]);
  }
  return out;
}

function status() {
  const lines = [];
  const cfg = loadCardConfig();
  const pass = path.join(OUT_DIR, PASS_FILE), metaFile = path.join(OUT_DIR, META_FILE);
  const badge = path.join(REPO, "assets", "img", "wallet", "add-to-apple-wallet.svg");
  const has = (f) => fs.existsSync(f);
  lines.push(`Signed pass file ........ ${has(pass) ? "present" : "MISSING (run build after Apple issues your certificate)"}`);
  lines.push(`Pass details (meta) ..... ${has(metaFile) ? "present" : "MISSING"}`);
  lines.push(`Official Apple badge .... ${has(badge) ? "present" : "MISSING (download it from Apple; see assets/img/wallet/README.md)"}`);
  lines.push(`Button enabled in card .. ${cfg.walletUrl ? "YES (" + cfg.walletUrl + ")" : "no (walletUrl is empty, the button stays hidden)"}`);
  if (has(metaFile)) {
    const m = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    lines.push(`Signed by ............... ${m.signing}   certificate valid until ${m.certNotAfter}`);
  }
  return lines.join("\n");
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = args(rest);
  switch (cmd) {
    case "init": {
      const r = init({ dir: a.dir });
      console.log(`Done. Two files were created in ${path.dirname(r.keyFile)}\n\n  PRIVATE KEY (never share, never upload, back it up): ${r.keyFile}${r.encrypted ? " (protected by your passphrase)" : ""}\n  Request file to upload to Apple:                     ${r.csrFile}\n\nNext: upload the request file in your Apple Developer account (see scripts/wallet/SETUP.md, step 4).`);
      break;
    }
    case "build": {
      const r = build({ certFile: a.cert, wwdrFile: a.wwdr, keyFile: a.key, digest: a.digest || "sha256" });
      console.log(`Built and checked ${path.join(r.outDir, PASS_FILE)} (${r.pkpass.length} bytes), signed by ${r.meta.signing === "apple" ? "your Apple certificate" : "a TEST certificate"}.\nCertificate valid until ${r.meta.certNotAfter}.\nNext: see scripts/wallet/SETUP.md, step 7.`);
      break;
    }
    case "verify": {
      const file = rest[0] && !rest[0].startsWith("--") ? rest[0] : path.join(OUT_DIR, PASS_FILE);
      const r = verify(file);
      if (!r.ok) { console.error("NOT OK:\n - " + r.problems.join("\n - ")); process.exitCode = 1; break; }
      console.log(`OK: ${file}\n  Pass Type ID ${r.pass.passTypeIdentifier}, Team ${r.pass.teamIdentifier}\n  Signed by ${r.apple ? "an Apple-issued certificate" : "a TEST certificate (not usable on a phone)"}, valid until ${r.signer.notAfter.toISOString().slice(0, 10)}`);
      break;
    }
    case "status": console.log(status()); break;
    case "rehearse": {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wallet-rehearsal-"));
      const r = build({ test: true, outDir: dir });
      const v = verify(path.join(dir, PASS_FILE));
      console.log(v.ok ? `Rehearsal passed: a test-signed pass was built and verified (${r.pkpass.length} bytes) in ${dir}. It cannot be installed on a phone, and nothing was published.` : "Rehearsal FAILED:\n - " + v.problems.join("\n - "));
      if (!v.ok) process.exitCode = 1;
      break;
    }
    default:
      console.log("Usage: node scripts/wallet/wallet.mjs <init|build|verify|status|rehearse>\nSee scripts/wallet/SETUP.md.");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.userFacing ? "Problem: " + e.message : e.stack); process.exitCode = 1; });
}
