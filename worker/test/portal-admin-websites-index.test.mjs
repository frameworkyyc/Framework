/* The Websites section (admin/assets/sites.js) and its one new endpoint, GET /api/admin/websites: every website of every client, read-only, built from data that already exists (no migration). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import * as sites from "../portal/repo/websites.js";
import * as wk from "../portal/repo/website-workspace.js";
import * as analytics from "../portal/repo/website-analytics.js";

const read = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");
const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const nowS = () => Math.floor(Date.now() / 1000);
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };

async function setup() {
  resetKeyCacheForTests();
  const w = await makeWorld({});
  Object.assign(w.env, { PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) });
  const A = await w.org("alpha", "Alpha Co"), B = await w.org("beta", "Beta Co");
  const call = async (path, { method = "GET", auth = true } = {}) => {
    const h = { Origin: ORIGIN, ...(auth ? { "Cf-Access-Jwt-Assertion": sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: nowS(), exp: nowS() + 600 }) } : {}), ...(method !== "GET" ? { "X-Framework-Admin": "1" } : {}) };
    const res = await handleAdmin(new Request(ORIGIN + "/api/admin" + path, { method, headers: h }), w.env, {});
    return { status: res.status, json: (res.headers.get("Content-Type") || "").includes("json") ? await res.json() : null };
  };
  const mk = async (org, over = {}) => (await sites.createWebsite(w.db, org.id, { name: "Main website", url: "https://alpha.example.ca", origin: "client", status: "live", published: true, ...over }, ADMIN, { now: w.clock.now() })).id;
  return { w, A, B, call, mk };
}

test("GET /websites: every client's websites with Production and Staging together, renewals, SEO, connections and what waits on the client; no secrets, no storage keys, no notes", async () => {
  const s = await setup();
  const a = await s.mk(s.A, { name: "Alpha site", domain_renewal: "2027-02-01", management_notes: "private note" });
  const b = await s.mk(s.B, { name: "Beta site", url: "https://beta.example.ca" });
  await wk.setStagingUrl(s.w.db, s.A.id, a, "https://staging.alpha.example.ca", ADMIN);
  const u = await wk.createUpdate(s.w.db, s.A.id, a, { title: "Layout", kind: "approval", environment: "staging", published: true }, ADMIN, { now: s.w.clock.now() });
  await wk.createTask(s.w.db, s.A.id, a, { title: "Photos", cta: "upload", published: true }, ADMIN, { now: s.w.clock.now() });
  await analytics.saveConfig(s.w.db, s.A.id, a, { cf_site_tag: "0123456789abcdef0123456789abcdef" }, ADMIN, { now: s.w.clock.now() });
  const r = await s.call("/websites");
  assert.equal(r.status, 200); assert.equal(r.json.available, true);
  const byName = Object.fromEntries(r.json.websites.map((x) => [x.name, x]));
  assert.deepEqual(Object.keys(byName).sort(), ["Alpha site", "Beta site"]);
  const x = byName["Alpha site"];
  assert.equal(x.organizationName, "Alpha Co"); assert.equal(x.productionUrl, "https://alpha.example.ca/"); assert.equal(x.stagingUrl, "https://staging.alpha.example.ca/");
  assert.equal(x.domain.renewal, "2027-02-01"); assert.deepEqual(x.analytics, { cloudflare: true, searchConsole: false });
  assert.equal(x.awaitingReview, 1); assert.equal(x.openTasks, 1);
  assert.equal(byName["Beta site"].stagingUrl, null); assert.deepEqual(byName["Beta site"].analytics, { cloudflare: false, searchConsole: false }); assert.equal(byName["Beta site"].awaitingReview, 0);
  const text = JSON.stringify(r.json);
  assert.ok(!/management_notes|private note|screenshot_key|cf_site_tag|0123456789abcdef|token/i.test(text), "no notes, keys, tags or tokens");
  const one = await s.call("/websites/" + a); assert.equal(one.status, 200); assert.equal(one.json.website.id, a); assert.equal(one.json.website.organizationId, s.A.id);
  void u;
});

test("archived websites and deleted clients are left out (archived on request); only GET; the id must be a real one; Access is required", async () => {
  const s = await setup();
  const keep = await s.mk(s.A, { name: "Keep" }), gone = await s.mk(s.A, { name: "Archived site", url: "https://old.example.ca" }), other = await s.mk(s.B, { name: "Beta site", url: "https://beta.example.ca" });
  await sites.setWebsiteArchived(s.w.db, s.A.id, gone, true, ADMIN, { now: s.w.clock.now() });
  s.w.db.raw.prepare("UPDATE organizations SET status = 'archived', archived_at = ? WHERE id = ?").run(s.w.clock.now().toISOString(), s.B.id);
  const names = (await s.call("/websites")).json.websites.map((x) => x.name);
  assert.deepEqual(names, ["Keep"]); void keep; void other;
  assert.deepEqual((await s.call("/websites?archived=1")).json.websites.map((x) => x.name).sort(), ["Archived site", "Keep"]);
  assert.equal((await s.call("/websites", { method: "POST" })).status, 405);
  assert.equal((await s.call("/websites/not-an-id")).status, 404);
  assert.equal((await s.call("/websites/00000000-0000-4000-8000-000000000000")).status, 404);
  assert.notEqual((await s.call("/websites", { auth: false })).status, 200, "no Access token, no answer");
});

test("the Websites section: registered, routed, one workspace with the tabs, Production and Staging edited in one place each, nothing inline, no HTML insertion", () => {
  const mods = read("admin/assets/modules.js"), sitesJs = read("admin/assets/sites.js"), blocks = read("admin/assets/site-blocks.js"), clients = read("admin/assets/clients.js");
  assert.match(mods, /id: "websites"[^}]*path: "\/admin\/websites"[^}]*sites\.js/);
  for (const tab of ["Overview", "Environments", "Domain & hosting", "Review", "SEO", "Analytics", "Files", "Milestones"]) assert.ok(sitesJs.includes(`"${tab}"`), tab);
  assert.match(sitesJs, /api\("\/websites"\)/); assert.match(sitesJs, /\/workspace\/staging/); assert.match(sitesJs, /body: \{ url: orNull\(input\.value\) \}/, "the Production address saves through the existing update call");
  assert.match(sitesJs, /seoPanel\(/); assert.match(sitesJs, /analyticsPanel\(/); assert.match(sitesJs, /workspacePanel\(\{[^}]*hideStaging: true/, "the Staging address is edited on the environment card, not twice");
  assert.match(clients, /\/admin\/websites\?client=/, "the old per-client page redirects into the Websites section");
  for (const [name, src] of [["sites.js", sitesJs], ["site-blocks.js", blocks]]) { assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(src), name + ": no markup insertion"); assert.ok(!/setAttribute\(["']style|\.style\./.test(src), name + ": no inline styles"); }
  assert.match(read("worker/admin/router.js"), /handleWebsitesIndexApi/);
  assert.ok(read("worker/portal/admin-websites-index.js").includes("readOnlyDb"), "every query goes through the read-only wrapper");
});
