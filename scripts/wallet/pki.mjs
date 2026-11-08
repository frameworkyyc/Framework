// Certificates and certificate requests, built and read by hand so the signing tool needs no OpenSSL, Keychain or .p12 file.
import crypto from "node:crypto";
import fs from "node:fs";
import * as der from "./der.mjs";

export const OID = {
  sha1: "1.3.14.3.2.26",
  sha256: "2.16.840.1.101.3.4.2.1",
  rsaEncryption: "1.2.840.113549.1.1.1",
  sha256WithRSA: "1.2.840.113549.1.1.11",
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingTime: "1.2.840.113549.1.9.5",
  CN: "2.5.4.3", C: "2.5.4.6", O: "2.5.4.10", OU: "2.5.4.11", UID: "0.9.2342.19200300.100.1.1",
};
const NAME_BY_OID = Object.fromEntries(["CN", "C", "O", "OU", "UID"].map((k) => [OID[k], k]));

export const algorithm = (dotted) => der.seq(der.oid(dotted), der.nul());

const nameDer = (attrs) =>
  der.seq(...Object.entries(attrs).map(([k, v]) => der.set(der.seq(der.oid(OID[k]), k === "C" ? der.printable(v) : der.utf8(v)))));

// Decode a Name into { CN, OU, ... } (the last value wins for repeated attributes).
function decodeName(node) {
  const out = {};
  for (const rdn of der.children(node))
    for (const atv of der.children(rdn)) {
      const [o, v] = der.children(atv);
      const key = NAME_BY_OID[der.oidToString(o.body)];
      if (key) out[key] = v.body.toString("utf8");
    }
  return out;
}

export function parseCert(input) {
  let buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const text = buf.subarray(0, 40).toString("latin1");
  if (text.includes("-----BEGIN")) buf = Buffer.from(buf.toString("latin1").replace(/-----[^-]+-----|\s+/g, ""), "base64");
  const x509 = new crypto.X509Certificate(buf);
  const cert = der.children(der.read(buf));
  const tbs = der.children(cert[0]);
  let i = tbs[0].tag === 0xa0 ? 1 : 0; // skip the optional [0] version
  const serial = tbs[i];
  const issuer = tbs[i + 2];
  const subject = tbs[i + 4];
  return {
    der: buf, x509,
    serialRaw: Buffer.from(serial.raw), issuerRaw: Buffer.from(issuer.raw), subjectRaw: Buffer.from(subject.raw),
    issuer: decodeName(issuer), subject: decodeName(subject),
    notAfter: new Date(x509.validTo), notBefore: new Date(x509.validFrom),
  };
}

export const loadCert = (file) => parseCert(fs.readFileSync(file));

// Apple's intermediate for pass certificates is issued to "Apple Worldwide Developer Relations Certification Authority".
export const isAppleWwdr = (cert) =>
  cert.subject.O === "Apple Inc." && /Worldwide Developer Relations/.test(cert.subject.OU || "") && /Worldwide Developer Relations/.test(cert.subject.CN || "");

// ---- certificate signing request (what Apple needs to issue the Pass Type ID certificate) ---------------------------
export function buildCsr(privateKey, publicKey, subject) {
  const spki = publicKey.export({ type: "spki", format: "der" });
  const info = der.seq(der.int(0), nameDer(subject), spki, der.ctx(0));
  const signature = crypto.sign("sha256", info, privateKey);
  return der.seq(info, algorithm(OID.sha256WithRSA), der.bitString(signature));
}

export const pem = (label, buf) =>
  `-----BEGIN ${label}-----\n${buf.toString("base64").replace(/(.{64})/g, "$1\n").replace(/\n$/, "")}\n-----END ${label}-----\n`;

// ---- certificates (used only for the throwaway test chain and in tests; real certificates come from Apple) ----------
export function buildCert({ subject, issuer, issuerKey, publicKey, serial, notBefore, notAfter }) {
  const tbs = der.seq(
    der.ctx(0, der.int(2)),
    der.int(serial),
    algorithm(OID.sha256WithRSA),
    nameDer(issuer),
    der.seq(der.utcTime(notBefore), der.utcTime(notAfter)),
    nameDer(subject),
    publicKey.export({ type: "spki", format: "der" }),
  );
  return der.seq(tbs, algorithm(OID.sha256WithRSA), der.bitString(crypto.sign("sha256", tbs, issuerKey)));
}
