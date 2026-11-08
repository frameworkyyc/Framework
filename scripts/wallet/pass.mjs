// Builds the Apple Wallet pass for the Framework digital business card, FROM assets/js/card-config.js (the single source of truth).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import * as der from "./der.mjs";
import { signDetached, verifyDetached } from "./cms.mjs";
import { isAppleWwdr, parseCert } from "./pki.mjs";
import { readZip, writeZip } from "./zip.mjs";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PASS_TYPE_ID = "pass.ca.frameworkco.card";
export const SERIAL = "framework-card-jj-brick-v1";
export const IMAGE_DIR = path.join(REPO, "scripts", "wallet", "pass-images");
export const OUT_DIR = path.join(REPO, "assets", "wallet");
export const PASS_FILE = "Framework-card.pkpass";
export const META_FILE = "pass-meta.json";
export const REQUIRED_IMAGES = ["icon.png", "icon@2x.png", "icon@3x.png", "logo.png", "logo@2x.png", "logo@3x.png"];

export function loadCardConfig(file = path.join(REPO, "assets", "js", "card-config.js")) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox);
  return sandbox.window.FRAMEWORK_CARD;
}

const prettyPhone = (p) => p.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "+1 $1 $2 $3");
const bare = (url) => url.replace(/^https:\/\//, "").replace(/\/$/, "");
const ABOUT = "Business strategy, branding, websites, and systems, for businesses starting out or ready to grow.";

// pass.json. Future automatic updates would add webServiceURL + authenticationToken here (see worker/WALLET.md); they are omitted
// today because Wallet would then try to register with a server that does not exist yet.
export function buildPassJson(cfg, { teamIdentifier, passTypeIdentifier = PASS_TYPE_ID }) {
  const back = [];
  if (cfg.phone) back.push({ key: "b-phone", label: "Phone", value: prettyPhone(cfg.phone) });
  if (cfg.email) back.push({ key: "b-email", label: "Email", value: cfg.email });
  if (cfg.websiteUrl) back.push({ key: "b-web", label: "Website", value: cfg.websiteUrl });
  back.push({ key: "b-card", label: "Digital business card", value: cfg.cardUrl });
  if (cfg.social && cfg.social.instagram) back.push({ key: "b-ig", label: "Instagram", value: cfg.social.instagram });
  back.push({ key: "b-about", label: "About", value: ABOUT });
  back.push({ key: "b-save", label: "Save my contact", value: `Open ${bare(cfg.cardUrl)} and tap Save Contact.` });
  const aux = [];
  if (cfg.phone) aux.push({ key: "phone", label: "PHONE", value: prettyPhone(cfg.phone) });
  if (cfg.email) aux.push({ key: "email", label: "EMAIL", value: cfg.email, textAlignment: "PKTextAlignmentRight" });
  return {
    formatVersion: 1,
    passTypeIdentifier, teamIdentifier,
    serialNumber: SERIAL,
    organizationName: cfg.company,
    description: `${cfg.name}, ${cfg.title} of ${cfg.company}: digital business card`,
    backgroundColor: "rgb(10, 10, 10)", foregroundColor: "rgb(255, 255, 255)", labelColor: "rgb(168, 168, 168)",
    barcodes: [{ format: "PKBarcodeFormatQR", message: cfg.cardUrl, messageEncoding: "iso-8859-1", altText: bare(cfg.cardUrl) }],
    generic: {
      headerFields: cfg.websiteUrl ? [{ key: "web", label: "WEBSITE", value: bare(cfg.websiteUrl), textAlignment: "PKTextAlignmentRight" }] : [],
      primaryFields: [{ key: "name", label: "", value: cfg.name }],
      secondaryFields: [{ key: "title", label: "TITLE", value: cfg.title }, { key: "company", label: "COMPANY", value: cfg.company }],
      auxiliaryFields: aux,
      backFields: back,
    },
  };
}

const sha1 = (b) => crypto.createHash("sha1").update(b).digest("hex");

export function buildPkpass({ cfg, signer, intermediate, privateKey, teamIdentifier, digest }) {
  const files = [{ name: "pass.json", data: Buffer.from(JSON.stringify(buildPassJson(cfg, { teamIdentifier }), null, 2) + "\n") }];
  for (const name of REQUIRED_IMAGES) files.push({ name, data: fs.readFileSync(path.join(IMAGE_DIR, name)) });
  const manifest = Object.fromEntries(files.map((f) => [f.name, sha1(f.data)]));
  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  const signature = signDetached({ content: manifestBuf, signer, intermediate, privateKey, digest });
  return writeZip([...files, { name: "manifest.json", data: manifestBuf }, { name: "signature", data: signature }]);
}

// Checks a .pkpass completely and reports problems; never trusts the file's own claims.
export function inspectPkpass(buf) {
  const problems = [];
  let entries;
  try { entries = readZip(buf); } catch (e) { return { problems: ["not a valid .pkpass archive: " + e.message] }; }
  for (const n of ["pass.json", "manifest.json", "signature", ...REQUIRED_IMAGES]) if (!entries.has(n)) problems.push("missing " + n);
  if (problems.length) return { problems, entries };
  let pass, manifest;
  try { pass = JSON.parse(entries.get("pass.json")); manifest = JSON.parse(entries.get("manifest.json")); } catch (e) { return { problems: ["pass.json or manifest.json is not valid JSON"], entries }; }
  for (const [name, data] of entries) if (name !== "manifest.json" && name !== "signature" && manifest[name] !== sha1(data)) problems.push(`manifest hash does not match ${name}`);
  for (const name of Object.keys(manifest)) if (!entries.has(name)) problems.push(`manifest lists ${name} but it is not in the pass`);
  let signer = null, intermediate = null;
  try {
    const v = verifyDetached(entries.get("signature"), entries.get("manifest.json"));
    if (!v.digestOk) problems.push("signature does not match manifest.json");
    const certs = v.certs.map((c) => parseCert(c));
    const isMine = (c) => c.subject.UID === pass.passTypeIdentifier;
    signer = certs.find(isMine) || null;
    intermediate = certs.find((c) => c !== signer) || null;
    if (!signer) problems.push("signing certificate for " + pass.passTypeIdentifier + " is not inside the signature");
    else {
      if (!crypto.verify(v.digest, v.signedAttributes, signer.x509.publicKey, v.signature)) problems.push("signature is not valid for the signing certificate");
      if (!Buffer.from(v.sid).equals(der.seq(signer.issuerRaw, signer.serialRaw))) problems.push("signer identifier does not match the certificate");
      if (signer.subject.OU !== pass.teamIdentifier) problems.push("teamIdentifier does not match the certificate");
      if (signer.notAfter < new Date()) problems.push("signing certificate has expired");
      if (!intermediate) problems.push("intermediate (WWDR) certificate is missing");
      else if (!signer.x509.verify(intermediate.x509.publicKey)) problems.push("signing certificate was not issued by the embedded intermediate");
    }
  } catch (e) { problems.push("signature: " + e.message); }
  return { problems, entries, pass, signer, intermediate, apple: !!(intermediate && isAppleWwdr(intermediate)) };
}
