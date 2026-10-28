/* Branding: the complete Admin <-> client workflow in one world (real Admin API, real client portal, shared database and bucket). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as brand from "../portal/repo/brand.js";
import * as B from "../portal/brand-files.js";
import { isKnownBrandingService } from "../portal/brand-services.js";
import { rows, count } from "./helpers/portal-db.mjs";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const now = () => Math.floor(Date.now() / 1000);
const sign = (claims) => { const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), body = b64u(JSON.stringify(claims)); return `${head}.${body}.${b64u(createSign("RSA-SHA256").update(head + "." + body).sign(pair.privateKey))}`; };
const claims = (over = {}) => ({ iss: `https://${TEAM}`, aud: [AUD], email: "owner@frameworkco.ca", exp: now() + 600, iat: now(), ...over });
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");


const ORIGIN_PORTAL = ORIGIN;
const LOGO = { kind: "logo", logo_role: "primary", orientation: "horizontal", tone: "light", transparent: true };

/** One world: the real Admin API and the real client portal share a database and a bucket, exactly as on Staging. */
async function setup() {
  resetKeyCacheForTests();
  const w = await makeWorld();
  const bucket = fakeR2();
  const A = await w.org("alpha", "Alpha Co");
  await w.invite(A, "ann@alpha.test", "owner"); await w.invite(A, "mia@alpha.test", "member");
  Object.assign(w.env, { PORTAL_FILES: bucket, PORTAL_BRANDING: "1", PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: "owner@frameworkco.ca", ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) });
  const env = w.env;
  const ann = w.browser(), mia = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(2, "mia@alpha.test"));
  const call = async (path, { method = "GET", token = sign(claims()), headers = {}, e = env, json, form, origin = ORIGIN, csrf = true } = {}) => {
    const h = { ...(origin ? { Origin: origin } : {}), ...(csrf && method !== "GET" ? { "X-Framework-Admin": "1" } : {}), ...headers };
    if (token) h["Cf-Access-Jwt-Assertion"] = token;
    let body;
    if (form) { const packed = new Response(form); const buf = new Uint8Array(await packed.arrayBuffer()); h["Content-Type"] = packed.headers.get("Content-Type"); h["Content-Length"] = String(buf.length); body = buf; }
    else if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    const res = await handleAdmin(new Request(ORIGIN + "/api/admin" + path, { method, headers: h, body }), e, { fetch: async () => { throw new Error("no network in these tests"); } });
    const type = res.headers.get("Content-Type") || "";
    return { status: res.status, headers: res.headers, json: type.includes("json") ? await res.json() : null, bytes: type.includes("json") ? null : new Uint8Array(await res.arrayBuffer()) };
  };
  const adminUpload = (meta, name, bytes) => { const f = new FormData(); f.append("file", new File([bytes], name)); f.append("meta", JSON.stringify(meta)); return call(`/clients/${A.id}/branding/assets`, { method: "POST", form: f }); };
  const clientUpload = async (b, name, bytes, category = "logo") => {
    const tok = /name="csrf" value="([^"]+)"/.exec(await (await b.get("/portal/o/alpha/branding/uploads")).text())[1];
    const fd = new FormData(); fd.set("csrf", tok); fd.set("category", category); fd.set("file", new Blob([bytes]), name);
    return b.send("/portal/o/alpha/branding/uploads", { method: "POST", body: fd, headers: { "Sec-Fetch-Site": "same-origin", Origin: ORIGIN_PORTAL } });
  };
  return { w, A, bucket, ann, mia, call, adminUpload, clientUpload };
}
const page = async (b, p = "") => (await b.get("/portal/o/alpha/branding" + p)).text();

test("Admin to client, end to end: nothing shows until published; publishing, unpublishing and deleting in Admin are reflected for the client immediately; downloads return the exact bytes", async () => {
  const { w, A, ann, mia, call, adminUpload } = await setup();
  assert.match(await page(mia), /Nothing here yet/);

  // Admin drafts a deliverable and a kit: the client still sees the empty state and cannot fetch the file
  const up = await adminUpload({ ...LOGO, published: false }, "logo.png", S.png(12, 12));
  assert.equal(up.status, 201, JSON.stringify(up.json));
  const id = up.json.id;
  const kit = await call(`/clients/${A.id}/branding/kit`, { method: "PUT", json: { colours: [{ name: "Ink", role: "primary", hex: "#0a0a0a", note: "" }], typography: [] } }); assert.equal(kit.status, 200, JSON.stringify(kit.json));
  assert.match(await page(mia), /Nothing here yet/);
  assert.equal((await mia.get(`/portal/o/alpha/branding/files/${id}`)).status, 404);

  // kit published but the file still a draft: colours show, the file does not
  assert.equal((await call(`/clients/${A.id}/branding/kit/publish`, { method: "POST", json: {} })).status, 200);
  let html = await page(mia);
  assert.match(html, /data-copy="#0A0A0A"/); assert.ok(!html.includes(id));
  assert.equal((await mia.get(`/portal/o/alpha/branding/files/${id}`)).status, 404);

  // file published: it appears and downloads byte for byte under its generated name
  assert.equal((await call(`/clients/${A.id}/branding/assets/${id}/update`, { method: "POST", json: { published: true } })).status, 200);
  html = await page(mia); assert.ok(html.includes(id));
  const dl = await mia.get(`/portal/o/alpha/branding/files/${id}`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get("content-disposition"), /Alpha-Co-Primary-Horizontal-Light-Transparent\.png/);
  assert.deepEqual(new Uint8Array(await dl.arrayBuffer()), S.png(12, 12));
  assert.equal(w.db.raw.prepare("SELECT count(*) n FROM activity_log WHERE action = 'brand.asset.download' AND entity_id = ?").get(id).n, 1, "the download is on record");

  // unpublish the file, then the kit, then delete: each is reflected at once
  await call(`/clients/${A.id}/branding/assets/${id}/update`, { method: "POST", json: { published: false } });
  assert.equal((await mia.get(`/portal/o/alpha/branding/files/${id}`)).status, 404);
  await call(`/clients/${A.id}/branding/assets/${id}/update`, { method: "POST", json: { published: true } });
  await call(`/clients/${A.id}/branding/kit/unpublish`, { method: "POST", json: {} });
  assert.match(await page(ann), /Nothing here yet/); assert.equal((await ann.get(`/portal/o/alpha/branding/files/${id}`)).status, 404);
  await call(`/clients/${A.id}/branding/kit/publish`, { method: "POST", json: {} });
  assert.equal((await call(`/clients/${A.id}/branding/assets/${id}/delete`, { method: "POST", json: {} })).status, 200);
  assert.equal((await mia.get(`/portal/o/alpha/branding/files/${id}`)).status, 404); assert.ok(!(await page(mia)).includes(id));
});

test("client to Admin, end to end: an upload appears in Admin with who sent it; Admin can open it, mark it seen, hold and release it; the client sees each state; the client's removal clears it everywhere", async () => {
  const { w, A, bucket, ann, mia, call, clientUpload } = await setup();
  assert.equal((await clientUpload(mia, "Old logo.png", S.png(9, 9))).status, 303);
  const view = (await call(`/clients/${A.id}/branding`)).json;
  assert.equal(view.uploads.length, 1); assert.equal(view.uploads[0].uploader.email, "mia@alpha.test"); assert.equal(view.uploads[0].seen, false);
  const up = view.uploads[0];
  const adminDl = await call(`/clients/${A.id}/branding/uploads/${up.id}/download`);
  assert.equal(adminDl.status, 200); assert.deepEqual(adminDl.bytes, S.png(9, 9));
  assert.equal((await call(`/clients/${A.id}/branding/uploads/seen`, { method: "POST", json: {} })).json.marked, 1);

  assert.equal((await call(`/clients/${A.id}/branding/uploads/${up.id}/hold`, { method: "POST", json: {} })).status, 200);
  assert.match(await page(ann, "/uploads"), /On hold/); assert.equal((await ann.get(`/portal/o/alpha/branding/uploads/${up.id}/download`)).status, 404);
  assert.equal((await call(`/clients/${A.id}/branding/uploads/${up.id}/release`, { method: "POST", json: {} })).status, 200);
  assert.equal((await ann.get(`/portal/o/alpha/branding/uploads/${up.id}/download`)).status, 200);

  // the client's shared upload and Framework's deliverables never mix
  assert.ok(!(await page(ann)).includes("Old logo"));

  // a member cannot remove; the owner can; Admin's list and the bucket follow
  const tok = /name="csrf" value="([^"]+)"/.exec(await page(ann, "/uploads"))[1];
  const del = (b, t) => b.send(`/portal/o/alpha/branding/uploads/${up.id}/delete`, { method: "POST", body: new URLSearchParams({ csrf: t }).toString(), headers: { "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "same-origin", Origin: ORIGIN_PORTAL } });
  assert.equal((await del(mia, /name="csrf" value="([^"]+)"/.exec(await page(mia, "/uploads"))[1])).status, 403);
  assert.equal((await del(ann, tok)).status, 303);
  assert.equal((await call(`/clients/${A.id}/branding`)).json.uploads.length, 0); assert.equal(bucket.store.size, 0);
  assert.ok(w.db.raw.prepare("SELECT count(*) n FROM activity_log WHERE action LIKE 'brand.upload.%'").get().n >= 3, "creation, download and removal are all audited");
});
