// A disposable, obviously fake certificate chain for tests and dry runs. It is NOT Apple's and the Worker never serves a pass signed with it.
import crypto from "node:crypto";
import { buildCert, parseCert } from "./pki.mjs";

export function makeTestChain({ passTypeId = "pass.ca.frameworkco.card", team = "TESTTEAM00", days = 30 } = {}) {
  const rsa = () => crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const ca = rsa(), leaf = rsa();
  const notBefore = new Date(Date.now() - 3600e3), notAfter = new Date(Date.now() + days * 864e5);
  const caName = { CN: "Framework TEST intermediate (not Apple)", O: "Framework TEST", C: "CA" };
  const wwdr = buildCert({ subject: caName, issuer: caName, issuerKey: ca.privateKey, publicKey: ca.publicKey, serial: 1, notBefore, notAfter });
  const signer = buildCert({
    subject: { UID: passTypeId, CN: "Pass Type ID: " + passTypeId, OU: team, O: "Framework TEST", C: "CA" },
    issuer: caName, issuerKey: ca.privateKey, publicKey: leaf.publicKey, serial: 0x1234abcd, notBefore, notAfter,
  });
  return { signer: parseCert(signer), intermediate: parseCert(wwdr), privateKey: leaf.privateKey, teamIdentifier: team };
}
