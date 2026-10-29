/* Websites, phase 2: the client's Website page behind PORTAL_WEBSITE, through the real router (sign-in, organization guard). Four states (no website, existing, in development, live),
   several websites per client, status shown separately from "managed by Framework", only published and unarchived websites of the member's own organization, the screenshot only through an
   authorised route, nothing from Admin's private notes, and no inline script or style. Migration 0011 is applied by hand in the test world (it is still a proposed migration). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as sites from "../portal/repo/websites.js";
import * as WF from "../portal/website-files.js";
import { PORTAL_CSP } from "../portal/http.js";

const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const MIGRATION = read("migrations/portal-proposed/0011_websites.sql");
const ADMIN = "admin@framework.test";
const UUID0 = "00000000-0000-4000-8000-000000000000";

async function setup({ flag = true, migrated = true, storage = true } = {}) {
  const w = await makeWorld();
  const bucket = fakeR2();
  if (flag) w.env.PORTAL_WEBSITE = "1";
  if (storage) w.env.PORTAL_FILES = bucket;
  if (migrated) w.db.raw.exec(MIGRATION);
  const alpha = await w.org("alpha", "Alpha Co"), beta = await w.org("beta", "Beta Co");
  await w.invite(alpha, "ann@alpha.test", "owner"); await w.invite(alpha, "mia@alpha.test", "member"); await w.invite(beta, "bob@beta.test", "owner");
  const ann = w.browser(), mia = w.browser(), bob = w.browser(), anon = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(3, "mia@alpha.test")); await bob.signIn(w.user(2, "bob@beta.test"));
  const deps = { db: w.db, bucket, env: w.env, now: w.clock.now() };
  const add = async (org, input) => { const r = await sites.createWebsite(w.db, org.id, input, ADMIN, { now: w.clock.now() }); assert.ok(r.ok, JSON.stringify(r)); return r.id; };
  const addShot = async (org, id) => { const r = await WF.adminSetScreenshot(deps, { organizationId: org.id, websiteId: id, actor: ADMIN, file: { name: "home.png", bytes: S.png(320, 200) } }); assert.ok(r.ok, JSON.stringify(r)); };
  return { w, bucket, alpha, beta, ann, mia, bob, anon, add, addShot, deps };
}
const LIVE = { name: "Main website", url: "https://alpha.example.ca", origin: "client", status: "live", published: true };
const text = async (res) => (await res.text());

test("with PORTAL_WEBSITE off, Website stays 'Coming soon' and none of the new routes exist", async () => {
  const s = await setup({ flag: false });
  const id = await s.add(s.alpha, LIVE);
  const page = await text(await s.ann.get("/portal/o/alpha/website"));
  assert.match(page, /Coming soon/);
  assert.ok(!/alpha\.example\.ca|Main website/.test(page));
  for (const p of [`/website/${id}`, `/website/${id}/screenshot`]) assert.equal((await s.ann.get("/portal/o/alpha" + p)).status, 404, p);
  assert.ok(!/href="\/portal\/o\/alpha\/website"/.test(await text(await s.ann.get("/portal/o/alpha"))), "Home does not link a section that is not live");
});

test("the flag is exactly \"1\", independent of the Branding and Services flags, and set nowhere", () => {
  const cfg = read("worker/portal/config.js");
  assert.match(cfg, /websiteEnabled[\s\S]*PORTAL_WEBSITE\) === "1"/);
  assert.ok(!/PORTAL_WEBSITE/.test(read("wrangler.jsonc")), "no flag is set in any environment");
});

test("state 1, No Website: an empty state with a way to get in touch; nothing is stored for it", async () => {
  const s = await setup();
  const res = await s.ann.get("/portal/o/alpha/website");
  assert.equal(res.status, 200);
  const page = await text(res);
  assert.match(page, /No website yet/);
  assert.match(page, /Talk to us about a website/);
  assert.equal(s.w.db.raw.prepare("SELECT count(*) AS n FROM websites").get().n, 0, "no row exists for 'no website'");
  assert.match(await text(await s.ann.get("/portal/o/alpha")), /href="\/portal\/o\/alpha\/website"/, "Home links the live section");
});

test("state 2, Existing: the client's own site, a clickable link, and an honest 'not managed by Framework'", async () => {
  const s = await setup();
  await s.add(s.alpha, { name: "Our current site", url: "https://old.alpha.test", origin: "client", status: "existing", managed_by_framework: false, published: true });
  const page = await text(await s.ann.get("/portal/o/alpha/website"));
  assert.match(page, /Existing website/);
  assert.match(page, /Not managed by Framework/);
  assert.match(page, /<a class="text-link" href="https:\/\/old\.alpha\.test\/?" target="_blank" rel="noopener noreferrer">/);
  assert.ok(!/No website yet/.test(page));
});

test("state 3, In development: Framework is building it, no address needed, 'managed by Framework'", async () => {
  const s = await setup();
  await s.add(s.alpha, { name: "New shop", origin: "framework", status: "in_development", managed_by_framework: true, published: true });
  const page = await text(await s.ann.get("/portal/o/alpha/website"));
  assert.match(page, /In development/);
  assert.match(page, /Managed by Framework/);
  assert.ok(!/Not managed by Framework/.test(page));
  assert.match(page, /Framework is building this website/);
  assert.ok(!/<a class="text-link" href="https?:/.test(page), "no address, no link");
});

test("state 4, Live: link, launch date, domain and hosting facts; status and 'managed' are separate", async () => {
  const s = await setup();
  await s.add(s.alpha, { ...LIVE, managed_by_framework: true, launch_date: "2026-03-09", domain_registrar: "Namecheap", domain_owner: "client", domain_renewal: "2027-01-15", hosting_provider: "Cloudflare", hosting_owner: "framework" });
  const page = await text(await s.ann.get("/portal/o/alpha/website"));
  assert.match(page, /status--live/);
  assert.match(page, /Managed by Framework/);
  assert.match(page, /Mar 9, 2026/);
  assert.match(page, /Namecheap · owned by You/);
  assert.match(page, /Jan 15, 2027/);
  assert.match(page, /Cloudflare · owned by Framework/);
});

test("several websites: a list, each opening its own page; a member sees the same as an owner", async () => {
  const s = await setup();
  const a = await s.add(s.alpha, LIVE);
  const b = await s.add(s.alpha, { name: "Shop", origin: "framework", status: "in_development", managed_by_framework: true, published: true });
  const list = await text(await s.mia.get("/portal/o/alpha/website"));
  assert.match(list, /2 websites are listed/);
  assert.ok(list.includes(`href="/portal/o/alpha/website/${a}"`) && list.includes(`href="/portal/o/alpha/website/${b}"`));
  const one = await s.mia.get(`/portal/o/alpha/website/${b}`);
  assert.equal(one.status, 200);
  assert.match(await text(one), /Shop/);
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${a}`)).status, 200);
});

test("only published, unarchived websites of the member's own organization are ever shown", async () => {
  const s = await setup();
  const draft = await s.add(s.alpha, { ...LIVE, name: "Draft site", url: "https://draft.alpha.test", published: false });
  const gone = await s.add(s.alpha, { ...LIVE, name: "Retired site", url: "https://retired.alpha.test" });
  assert.ok((await sites.setWebsiteArchived(s.w.db, s.alpha.id, gone, true, ADMIN, { now: s.w.clock.now() })).ok);
  const theirs = await s.add(s.beta, { ...LIVE, name: "Beta site", url: "https://beta.example" });
  const page = await text(await s.ann.get("/portal/o/alpha/website"));
  assert.match(page, /No website yet/, "unpublished and archived websites do not exist for the client");
  for (const id of [draft, gone, theirs, UUID0, "not-an-id"]) assert.equal((await s.ann.get(`/portal/o/alpha/website/${id}`)).status, 404, id);
  assert.match(await text(await s.bob.get("/portal/o/beta/website")), /Beta site/);
  assert.equal((await s.bob.get(`/portal/o/alpha/website`)).status, 404, "another organization's slug is a plain not-found");
});

test("Admin's private management notes, who changed a row and storage details never reach the page", async () => {
  const s = await setup();
  const id = await s.add(s.alpha, { ...LIVE, management_notes: "INTERNAL-NOTE-do-not-show" });
  await s.addShot(s.alpha, id);
  const key = s.w.db.raw.prepare("SELECT screenshot_key AS k, screenshot_sha256 AS h FROM websites WHERE id = ?").get(id);
  for (const path of ["/portal/o/alpha/website", `/portal/o/alpha/website/${id}`]) {
    const page = await text(await s.ann.get(path));
    assert.ok(!/INTERNAL-NOTE|admin@framework|org\/|websites\//.test(page.replace(/\/website\//g, "")), path);
    assert.ok(!page.includes(key.k) && !page.includes(key.h), "no storage key or hash");
  }
});

test("the screenshot: shown through an authorised route with sandboxed headers; another organization, a draft, an archived site and signed-out visitors get nothing", async () => {
  const s = await setup();
  const id = await s.add(s.alpha, LIVE);
  await s.addShot(s.alpha, id);
  const page = await text(await s.ann.get("/portal/o/alpha/website"));
  assert.ok(page.includes(`<img class="ws__shot" src="/portal/o/alpha/website/${id}/screenshot"`), "the image is a same-site route");
  assert.match(page, /alt="Screenshot of Main website"/);
  const img = await s.mia.get(`/portal/o/alpha/website/${id}/screenshot`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("Content-Type"), "image/png");
  assert.match(img.headers.get("Content-Security-Policy"), /sandbox/);
  assert.equal(img.headers.get("Cache-Control"), "private, no-store");
  assert.ok((await img.arrayBuffer()).byteLength > 0);
  assert.equal((await s.bob.get(`/portal/o/alpha/website/${id}/screenshot`)).status, 404, "another organization");
  assert.equal((await s.bob.get(`/portal/o/beta/website/${id}/screenshot`)).status, 404, "another organization's own slug does not find it either");
  const sans = await s.anon.get(`/portal/o/alpha/website/${id}/screenshot`);
  assert.notEqual(sans.status, 200); assert.ok(!sans.headers.get("Content-Type")?.startsWith("image/"));
  assert.ok((await sites.updateWebsite(s.w.db, s.alpha.id, id, { published: false }, ADMIN, { now: s.w.clock.now() })).ok);
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${id}/screenshot`)).status, 404, "withdrawn");
  assert.ok((await sites.updateWebsite(s.w.db, s.alpha.id, id, { published: true }, ADMIN, { now: s.w.clock.now() })).ok);
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${id}/screenshot`)).status, 200);
  assert.ok((await sites.setWebsiteArchived(s.w.db, s.alpha.id, id, true, ADMIN, { now: s.w.clock.now() })).ok);
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${id}/screenshot`)).status, 404, "archived");
});

test("a signed-out visitor is sent to sign in; the page is read-only (POST is refused)", async () => {
  const s = await setup();
  const out = await s.anon.get("/portal/o/alpha/website");
  assert.ok([302, 303].includes(out.status));
  const post = await s.ann.send("/portal/o/alpha/website", { method: "POST", body: "x=1", headers: { "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "same-origin" } });
  assert.equal(post.status, 405);
});

test("a database without migration 0011 shows the empty state, but a real database failure is an error, never 'no website'", async () => {
  const s = await setup({ migrated: false });
  assert.match(await text(await s.ann.get("/portal/o/alpha/website")), /No website yet/);
  const s2 = await setup();
  s2.w.env.PORTAL_DB = new Proxy(s2.w.env.PORTAL_DB, { get: (t, k) => (k === "prepare" ? (q) => { if (/FROM websites/.test(q)) throw new Error("D1_ERROR: network connection lost"); return t.prepare(q); } : t[k]) });
  const res = await s2.ann.get("/portal/o/alpha/website");
  assert.ok(res.status >= 500, "status " + res.status);
  assert.ok(!/No website yet/.test(await res.text()));
});

test("with no storage bucket the screenshot route is a plain 503, and the page still works", async () => {
  const s = await setup({ storage: false });
  const id = await s.add(s.alpha, LIVE);
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${id}/screenshot`)).status, 503);
  assert.equal((await s.ann.get("/portal/o/alpha/website")).status, 200);
});

test("the Website pages carry the strict portal CSP and no inline script or style", async () => {
  const s = await setup();
  const id = await s.add(s.alpha, LIVE);
  for (const p of ["/website", `/website/${id}`]) {
    const res = await s.ann.get("/portal/o/alpha" + p);
    assert.equal(res.headers.get("Content-Security-Policy"), PORTAL_CSP);
    const html = await res.text();
    assert.ok(!/<script|\sstyle=|\son[a-z]+=|javascript:/i.test(html), p);
  }
});

test("only http(s) addresses become links (a stored address is never rendered as a script or other scheme)", async () => {
  const s = await setup();
  const id = await s.add(s.alpha, LIVE);
  s.w.db.raw.exec(`PRAGMA ignore_check_constraints = ON; UPDATE websites SET url = 'javascript:alert(1)' WHERE id = '${id}'; PRAGMA ignore_check_constraints = OFF;`);
  const page = await text(await s.ann.get("/portal/o/alpha/website"));
  assert.ok(!/javascript:/.test(page));
});
