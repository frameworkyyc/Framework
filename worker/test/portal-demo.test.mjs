// The static demo portal (/portal/demo) and the new client-facing views: static, labelled, fail-closed, no script / inline style, auth intact.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handlePortal } from "../portal/router.js";
import { makeWorld, ORIGIN } from "./helpers/portal-e2e.mjs";

const T0 = new Date("2026-03-10T17:00:00Z");
const css = readFileSync(new URL("../../assets/css/portal.css", import.meta.url), "utf8");


const boom = () => { throw new Error("database touched"); };
const throwing = { prepare: boom, batch: boom, exec: boom };
const world = await makeWorld();
const demoEnv = (over = {}) => ({ ...world.env, PORTAL_DEMO: "1", PORTAL_DB: throwing, ...over });
const get = (path, env = demoEnv(), init) => handlePortal(new Request(ORIGIN + path, init), env, { now: T0 });

const GUIDED = ["/portal/demo/progress", "/portal/demo/profile", ...["business", "location", "offering", "goals", "online", "contact", "personality"].map((x) => "/portal/demo/profile/" + x),
  "/portal/demo/branding", "/portal/demo/website/projects/website", "/portal/demo/content/projects/launch-photography", "/portal/demo/branding/projects/menu-design", "/portal/demo/branding/projects/brand-identity/deliverables/primary-logo-suite", ...["existing", "logo", "guidelines", "identity"].map((x) => "/portal/demo/branding/" + x), "/portal/demo/website", "/portal/demo/marketing", "/portal/demo/content", "/portal/demo/files",
  ...["new-logo", "brand-guidelines", "brand-identity", "website-development", "website-design", "marketing-campaign", "photography-session"].map((x) => "/portal/demo/requests/" + x)];
const PAGES = [...GUIDED, "/portal/demo", "/portal/demo/projects", "/portal/demo/projects/website", "/portal/demo/projects/brand-identity", "/portal/demo/projects/launch-photography",
  "/portal/demo/projects/website/deliverables/interior-page-templates", "/portal/demo/projects/brand-identity/deliverables/brand-strategy-brief", "/portal/demo/activity", "/portal/demo/activity?type=milestone", "/portal/demo/documents", "/portal/demo/documents?project=website", "/portal/demo/account"];

test("every demo page renders from static data without touching the database, a session or a cookie", async () => {
  for (const p of PAGES) {
    const res = await get(p);
    assert.equal(res.status, 200, p);
    assert.equal(res.headers.get("set-cookie"), null, p);
    const html = await res.text();
    assert.match(html, /class="demo-banner"/, p + " carries the demonstration banner");
    assert.match(html, /fictional/i);
    assert.equal([...html.matchAll(/<h1[\s>]/g)].length, 1, p + " has one h1");
    assert.match(html, /<a class="skip-link" href="#main">/);
    assert.match(html, /<main id="main"/);
    assert.match(html, /aria-current="page"/);
  }
});
test("demo pages carry no script, no inline style and no inline handler, and the strict CSP is unchanged", async () => {
  for (const p of PAGES) {
    const res = await get(p);
    const html = await res.text();
    assert.ok(!/<script/i.test(html), p);
    assert.ok(!/\sstyle\s*=/i.test(html), p);
    assert.ok(!/\son[a-z]+\s*=/i.test(html), p);
    assert.ok(!/<form[^>]*method="post"/i.test(html), p + " has no write form");
    const csp = res.headers.get("content-security-policy");
    assert.match(csp, /default-src 'none'/);
    assert.ok(!/script-src|unsafe-inline/.test(csp));
    assert.match(res.headers.get("cache-control") || "", /no-store/);
  }
});
test("the demo is read-only: other methods are refused, unknown paths and projects are 404", async () => {
  for (const m of ["POST", "PUT", "DELETE", "PATCH"]) assert.equal((await get("/portal/demo", demoEnv(), { method: m, body: "x=1" })).status, 405, m);
  for (const p of ["/portal/demo/projects/nope", "/portal/demo/nope", "/portal/demo/projects/website/x", "/portal/demo/members"]) assert.equal((await get(p)).status, 404, p);
});
test("the demo is fail-closed: off without the flag, and never on a production host even with the flag", async () => {
  assert.equal((await get("/portal/demo", demoEnv({ PORTAL_DEMO: undefined }))).status, 404);
  assert.equal((await get("/portal/demo", demoEnv({ PORTAL_DEMO: "true" }))).status, 404);
  assert.equal((await get("/portal/demo", demoEnv({ PORTAL_DEMO: "0" }))).status, 404);
  const prod = demoEnv({ PORTAL_BASE_URL: "https://frameworkco.ca", PORTAL_ALLOW_PRODUCTION: "1" });
  const res = await handlePortal(new Request("https://frameworkco.ca/portal/demo"), prod, { now: T0 });
  assert.equal(res.status, 404);
  const www = demoEnv({ PORTAL_BASE_URL: "https://www.frameworkco.ca", PORTAL_ALLOW_PRODUCTION: "1" });
  assert.equal((await handlePortal(new Request("https://www.frameworkco.ca/portal/demo/projects"), www, { now: T0 })).status, 404);
});
test("query filters are allow-listed: unknown values are ignored and are never reflected", async () => {
  const html = await (await get("/portal/demo/activity?type=%3Cimg%20src=x%3E&project=%22%3E%3Cb%3E")).text();
  assert.ok(!html.includes("<img src=x>") && !html.includes("<b>"));
  const filtered = await (await get("/portal/demo/activity?type=milestone")).text();
  const all = await (await get("/portal/demo/activity")).text();
  assert.ok(filtered.length < all.length);
});
test("project pages: pending client actions link to deliverables and hide when nothing is pending; deliverable pages do not pretend", async () => {
  const web = await (await get("/portal/demo/projects/website")).text();
  assert.match(web, /Needs your attention/);
  assert.match(web, /href="\/portal\/demo\/projects\/website\/deliverables\/interior-page-templates"/);
  assert.ok(!/class="attention"/.test(await (await get("/portal/demo/projects/launch-photography")).text()), "hidden when nothing is pending");
  assert.match(web, /Completed/); assert.match(web, /Target/);
  for (const id of ["milestones", "deliverables", "documents", "details"]) assert.match(web, new RegExp(`href="#${id}"[^>]*>`) ), assert.match(web, new RegExp(`id="${id}"`));
  const d = await (await get("/portal/demo/projects/website/deliverables/interior-page-templates")).text();
  assert.match(d, /not available in this demonstration/i);
  assert.match(d, /aria-disabled="true"/);
  assert.ok(!/<button|<form|<input|<textarea/i.test(d), "no working controls");
  assert.equal((await get("/portal/demo/projects/website/deliverables/nope")).status, 404);
  assert.equal((await get("/portal/demo/projects/brand-identity/deliverables/interior-page-templates")).status, 404);
});
test("demo documents are preview-only: downloads are visibly inert and no file link exists", async () => {
  const html = await (await get("/portal/demo/documents")).text();
  assert.match(html, /not available in the demo/i);
  assert.match(html, /Sample document/);
  assert.ok(!/href="[^"]*\.(pdf|docx?|xlsx?|zip)"/i.test(html));
});

test("live pages use the new design, show honest not-connected blocks and keep tenant isolation", async () => {
  const w = await makeWorld();
  const a = await w.org("alpha", "Alpha Co"), b = await w.org("beta", "Beta Co");
  await w.invite(a, "ann@alpha.test", "owner");
  const br = w.browser();
  const user = w.user(1, "ann@alpha.test");
  const signed = await br.signIn(user);
  assert.ok([302, 303].includes(signed.status), "signed in");
  for (const path of ["", "/projects", "/activity", "/documents", "/account"]) {
    const res = await br.get("/portal/o/alpha" + path);
    assert.equal(res.status, 200, path);
    const html = await res.text();
    assert.match(html, /\/assets\/css\/portal\.css/);
    assert.ok(!/<script/i.test(html) && !/\sstyle\s*=/i.test(html), path);
    assert.ok(!html.includes("Harbour &amp; Pine") && !html.includes("Harbour & Pine"), "no demo content in live pages");
  }
  const docs = await (await br.get("/portal/o/alpha/documents")).text();
  assert.match(docs, /Not connected yet/);
  assert.equal((await br.get("/portal/o/beta")).status, 404);
  assert.equal((await br.get("/portal/o/beta/documents")).status, 404);
  assert.equal((await br.get("/portal/o/beta/account")).status, 404);
});
test("live documents and account require a session", async () => {
  const w = await makeWorld();
  await w.org("alpha", "Alpha Co");
  for (const p of ["/documents", "/account", ""]) {
    const res = await handlePortal(new Request(ORIGIN + "/portal/o/alpha" + p), w.env, { now: T0 });
    assert.ok([302, 303, 401, 404].includes(res.status), p + " " + res.status);
    assert.notEqual(res.status, 200);
  }
});

test("the stylesheet is self-contained: no remote imports or urls, honours reduced motion, print and forced colours, and has focus styles", () => {
  assert.ok(!/@import|url\(\s*["']?https?:/i.test(css));
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media print/);
  assert.match(css, /forced-colors/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.skip-link/);
});

test("project workspace: shared anchor nav sits above two independent stacks that open on the same line", async () => {
  const html = await (await get("/portal/demo/projects/website")).text();
  const jump = html.indexOf('class="jump"'), cols = html.indexOf('class="cols cols--stacks"');
  assert.ok(jump > 0 && cols > jump, "the anchor navigation precedes the columns");
  const stacks = html.slice(cols).split('<div class="stack">').slice(1);
  assert.equal(stacks.length, 2);
  assert.ok(stacks[0].includes('id="milestones"') && stacks[0].includes('id="documents"'));
  assert.ok(stacks[1].includes('id="deliverables"') && stacks[1].includes('id="details"'));
  assert.match(css, /@media \(min-width: 881px\) \{ \.cols--stacks > \.stack > \.section:first-child \{ margin-top: 0; \} \}/);
  assert.match(css, /prefers-reduced-motion: no-preference\) \{ html \{ scroll-behavior: smooth; \} \}/);
});

test("guided home is a plain navigation hub: greeting and six area blocks; the header is Home and Account only", async () => {
  const html = await (await get("/portal/demo")).text();
  assert.match(html, /<h1[^>]*>Welcome back, Alex\.<\/h1>/);
  assert.match(html, /What would you like to work on\?/);
  const links = [...html.matchAll(/class="tile" href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links, ["profile", "branding", "website", "marketing", "content", "files"].map((a) => "/portal/demo/" + a));
  for (const gone of ["Recommended next step", "Onboarding progress", "get you set up", "<progress", "Continue your Business Profile", "complete across", "%"]) assert.ok(!html.includes(gone), gone + " is gone from Home");
  assert.ok(!/class="status/.test(html.slice(html.indexOf('class="tiles"'))), "no status badges on the blocks");
  const header = html.slice(html.indexOf('<nav class="primary"'), html.indexOf("</nav>", html.indexOf('<nav class="primary"')));
  assert.deepEqual([...header.matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]), ["Home", "Account"]);
  for (const p of ["/portal/demo/progress", "/portal/demo/projects", "/portal/demo/activity", "/portal/demo/documents", "/portal/demo/projects/website", "/portal/demo/website"]) assert.ok(!/aria-label="Project pages"|class="filters subnav"/.test(await (await get(p)).text()), p + " has no competing secondary navigation");
  assert.match(await (await get("/portal/demo/progress")).text(), /Welcome back, Alex/);
});
test("projects live inside their service workspaces, by explicit category, with one View project action each", async () => {
  const d = await import("../portal/demo-data.js");
  const projects = d.demoViewModel(T0).projects;
  assert.deepEqual(projects.map((p) => [p.id, p.services]), [["brand-identity", ["branding"]], ["website", ["website"]], ["launch-photography", ["content", "website"]], ["menu-design", ["branding"]]]);
  const where = { branding: ["brand-identity", "menu-design"], website: ["website", "launch-photography"], content: ["launch-photography"], marketing: [] };
  for (const [key, ids] of Object.entries(where)) {
    const html = await (await get("/portal/demo/" + key)).text();
    const links = [...html.matchAll(/href="\/portal\/demo\/[a-z]+\/projects\/([a-z-]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...links].sort(), [...ids].sort(), key);
    assert.equal([...html.matchAll(/View project/g)].length, ids.length, key + " has one action per project");
  }
  const marketing = await (await get("/portal/demo/marketing")).text();
  assert.match(marketing, /No Marketing projects yet/); assert.match(marketing, /href="#requests"/); assert.match(marketing, /id="requests"/);
  const branding = await (await get("/portal/demo/branding")).text();
  assert.match(branding, /Active projects/); assert.match(branding, /Completed projects/);
  assert.ok(branding.indexOf("Café menu design") > branding.indexOf("Brand identity"));
  assert.ok(!/Café menu design/.test(await (await get("/portal/demo/website")).text()), "no keyword-based classification");
});
test("journeys keep their service in breadcrumbs and links; direct URLs keep working and list every service", async () => {
  const proj = await (await get("/portal/demo/branding/projects/brand-identity")).text();
  assert.match(proj, /class="crumb"><a href="\/portal\/demo">Home<\/a> \/ <a href="\/portal\/demo\/branding">Branding<\/a> \/ Brand identity/);
  assert.match(proj, /href="\/portal\/demo\/branding\/projects\/brand-identity\/deliverables\/primary-logo-suite"/);
  const del = await (await get("/portal/demo/website/projects/website/deliverables/interior-page-templates")).text();
  assert.match(del, /<a href="\/portal\/demo">Home<\/a> \/ <a href="\/portal\/demo\/website">Website<\/a> \/ <a href="\/portal\/demo\/website\/projects\/website">Website<\/a> \/ Interior page templates/);
  const photoWeb = await (await get("/portal/demo/website/projects/launch-photography")).text();
  const photoContent = await (await get("/portal/demo/content/projects/launch-photography")).text();
  assert.match(photoWeb, /<a href="\/portal\/demo\/website">Website<\/a> \/ Launch photography/); assert.match(photoContent, /<a href="\/portal\/demo\/content">Content &amp; Photography<\/a> \/ Launch photography/);
  assert.match(photoContent, /Part of: <a href="\/portal\/demo\/content">Content &amp; Photography<\/a> · <a href="\/portal\/demo\/website">Website<\/a>/);
  assert.equal((await get("/portal/demo/marketing/projects/website")).status, 404, "a project is only reachable through its own services");
  assert.equal((await get("/portal/demo/website/projects/brand-identity")).status, 404);
  assert.equal((await get("/portal/demo/website/projects/website/deliverables/nope")).status, 404);
  const direct = await (await get("/portal/demo/projects/website")).text();
  assert.match(direct, /Home<\/a> \/ <a href="\/portal\/demo\/files">Files &amp; Deliverables<\/a> \/ <a href="\/portal\/demo\/projects">Projects<\/a> \/ Website/);
  assert.match((await (await get("/portal/demo/projects/website/deliverables/interior-page-templates")).text()), /Interior page templates/);
  const files = await (await get("/portal/demo/files")).text();
  for (const p of ["progress", "projects", "activity", "documents"]) assert.match(files, new RegExp(`href="/portal/demo/${p}"`));
  assert.match(files, /href="\/portal\/demo\/documents\?project=website"/);
  assert.match(await (await get("/portal/demo/activity")).text(), /Files &amp; Deliverables<\/a> \/ Activity/);
});
test("guided pages: simulated controls are inert and labelled; nothing can be submitted or uploaded", async () => {
  for (const p of GUIDED) {
    const html = await (await get(p)).text();
    assert.ok(!/<form|<button|type="file"|type="submit"|formaction/i.test(html), p + " has no submit or upload control");
    if (/<input|<textarea|<select/.test(html)) assert.match(html, /Demonstration only/, p + " labels its fields as a demonstration");
    for (const m of html.matchAll(/class="btn[^"]*"[^>]*>/g)) if (/(Save|Submit|Choose files|Approve)/.test(html.slice(m.index, m.index + 160))) assert.match(m[0], /aria-disabled="true"|href=/);
  }
});
test("service requests state the review, scoping and quotation terms and never imply authorisation", async () => {
  for (const id of ["new-logo", "brand-guidelines", "brand-identity", "website-development", "website-design", "marketing-campaign", "photography-session"]) {
    const html = await (await get("/portal/demo/requests/" + id)).text();
    assert.match(html, /subject to Framework’s review, scoping and quotation/);
    assert.match(html, /does not authorise any paid work/);
    assert.match(html, /<span class="btn" aria-disabled="true">Submit request/);
    assert.ok(!/<a[^>]*>\s*Submit/i.test(html));
  }
});
test("prerequisites are specific to each service, link to the exact missing step and do not lock sections", async () => {
  const logo = await (await get("/portal/demo/requests/new-logo")).text();
  assert.match(logo, /href="\/portal\/demo\/profile\/personality"/);
  assert.ok(!/href="\/portal\/demo\/profile\/online"/.test(logo), "unrelated steps are not required");
  const design = await (await get("/portal/demo/requests/website-design")).text();
  assert.match(design, /One of these: Existing brand assets or an agreed branding direction/);
  assert.match(design, /href="\/portal\/demo\/branding\/existing"/);
  const photo = await (await get("/portal/demo/requests/photography-session")).text();
  assert.match(photo, /Everything needed for this request is in place/);
  const existing = await (await get("/portal/demo/branding/existing")).text();
  assert.match(existing, /without completing your Business Profile/);
  assert.equal([...existing.matchAll(/class="upload"/g)].length, 4);
  for (const p of ["/portal/demo/branding", "/portal/demo/website", "/portal/demo/marketing", "/portal/demo/content", "/portal/demo/files"]) assert.equal((await get(p)).status, 200, p + " is always explorable");
});
test("guided routes reject unknown steps, services, paths and prototype names", async () => {
  for (const p of ["/portal/demo/profile/nope", "/portal/demo/branding/nope", "/portal/demo/requests/nope", "/portal/demo/requests", "/portal/demo/constructor", "/portal/demo/__proto__", "/portal/demo/profile/constructor", "/portal/demo/requests/constructor", "/portal/demo/website/extra"]) assert.equal((await get(p)).status, 404, p);
});
test("guided data is consistent: done steps are fully answered, unstarted steps are empty, every prerequisite resolves", async () => {
  const d = await import("../portal/guided-data.js");
  for (const s of d.PROFILE_STEPS) {
    const filled = s.fields.filter((f) => f.value).length;
    if (s.state === "done") assert.equal(filled, s.fields.length, s.id);
    if (s.state === "todo") assert.equal(filled, 0, s.id);
  }
  for (const s of d.SERVICES) assert.ok(d.serviceReadiness(s).reqs.length > 0, s.id);
  const sum = d.progressSummary(); assert.ok(sum.done > 0 && sum.done < sum.total);
});
test("live portal pages are untouched by the guided demo", async () => {
  const w = await makeWorld();
  await w.org("alpha", "Alpha Co"); await w.invite(await w.org("alpha2", "Alpha Two"), "x@alpha.test", "owner");
  const a = (await w.db.prepare("SELECT slug FROM organizations WHERE slug='alpha'").first());
  assert.ok(a);
  const br = w.browser();
  await w.invite({ id: (await w.db.prepare("SELECT id FROM organizations WHERE slug='alpha'").first()).id }, "ann2@alpha.test", "owner");
  await br.signIn(w.user(2, "ann2@alpha.test"));
  const html = await (await br.get("/portal/o/alpha")).text();
  assert.ok(!/Let’s get you set up|class="tile"/.test(html));
  assert.equal((await br.get("/portal/o/alpha/demo")).status, 404);
});
