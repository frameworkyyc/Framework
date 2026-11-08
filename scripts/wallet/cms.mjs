// Detached CMS (PKCS#7) signature over manifest.json: the "signature" file inside a .pkpass.
// Structure follows RFC 5652 SignedData with signed attributes, RSA PKCS#1 v1.5, and the signing and Apple intermediate certificates embedded.
import crypto from "node:crypto";
import * as der from "./der.mjs";
import { OID, algorithm } from "./pki.mjs";

const attribute = (type, value) => der.seq(der.oid(type), der.set(value));

export function signDetached({ content, signer, intermediate, privateKey, digest = "sha256", now = new Date() }) {
  if (!["sha256", "sha1"].includes(digest)) throw new Error("digest must be sha256 or sha1");
  const digestOid = OID[digest];
  const attrs = [
    attribute(OID.contentType, der.oid(OID.data)),
    attribute(OID.signingTime, der.utcTime(now)),
    attribute(OID.messageDigest, der.octets(crypto.createHash(digest).update(content).digest())),
  ];
  // The signature covers the attributes encoded as an ordinary SET (tag 0x31), sorted per DER.
  const toSign = der.setOf(...attrs);
  const signature = crypto.sign(digest, toSign, privateKey);
  const signerInfo = der.seq(
    der.int(1),
    der.seq(signer.issuerRaw, signer.serialRaw),
    algorithm(digestOid),
    der.tlv(0xa0, toSign.subarray(headerLength(toSign))), // [0] IMPLICIT: same content, different tag
    algorithm(OID.rsaEncryption),
    der.octets(signature),
  );
  const signedData = der.seq(
    der.int(1),
    der.set(algorithm(digestOid)),
    der.seq(der.oid(OID.data)), // detached: no content inside
    der.tlv(0xa0, signer.der, intermediate.der),
    der.set(signerInfo),
  );
  return der.seq(der.oid(OID.signedData), der.ctx(0, signedData));
}

const headerLength = (b) => der.read(b).header;

// Independent check of a signature file against the manifest bytes: digest, signature, and which certificates are inside.
export function verifyDetached(signatureDer, content) {
  const info = der.children(der.read(signatureDer));
  if (der.oidToString(info[0].body) !== OID.signedData) throw new Error("not a CMS SignedData");
  const sd = der.children(der.children(info[1])[0]);
  // sd: version, digestAlgorithms, encapContentInfo, [0] certificates, signerInfos
  const certsNode = sd.find((n) => n.tag === 0xa0);
  const signerInfos = sd[sd.length - 1];
  if (!certsNode) throw new Error("no certificates embedded");
  const certs = der.children(certsNode).map((c) => Buffer.from(c.raw));
  const si = der.children(der.children(signerInfos)[0]);
  // si: version, sid, digestAlgorithm, [0] signedAttrs, signatureAlgorithm, signature
  const digestOid = der.oidToString(der.children(si[2])[0].body);
  const digest = digestOid === OID.sha256 ? "sha256" : digestOid === OID.sha1 ? "sha1" : null;
  if (!digest) throw new Error("unsupported digest algorithm " + digestOid);
  const attrsNode = si.find((n) => n.tag === 0xa0);
  const signature = si[si.length - 1].body;
  const asSet = Buffer.concat([Buffer.from([0x31]), attrsNode.raw.subarray(1)]);
  let messageDigest = null;
  for (const a of der.children(attrsNode)) {
    const [type, values] = der.children(a);
    if (der.oidToString(type.body) === OID.messageDigest) messageDigest = der.children(values)[0].body;
  }
  const digestOk = !!messageDigest && crypto.createHash(digest).update(content).digest().equals(messageDigest);
  return { digest, digestOk, certs, signedAttributes: asSet, signature, sid: si[1].raw };
}
