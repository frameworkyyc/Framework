// Client portal Stage 2D: tenant isolation and authorization regression tests, driven through the real router.
// Authentication alone must never grant organization access; membership, organization status and role are re-checked on EVERY request.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWorld, csrfOf, stripRef } from "./helpers/portal-e2e.mjs";
import * as repo from "../portal/repo/index.js";
import * as store from "../portal/repo/sessions.js";
import { count } from "./helpers/portal-db.mjs";

const text = (r) => r.text();
const loc = (r) => r.headers.get("Location");

/** Two organizations with distinct, recognizable data and four people. */
async function world() {
  const w = await makeWorld();
  const A = await w.org("alpha", "Alpha Dental");
  const B = await w.org("bravo", "Bravo Bakery");
  const mk = async (org, name, extra = {}) => (await repo.createProject(w.db, org.id, { name, summary: name + " summary", ...extra })).project;
  const pA = await mk(A, "ALPHA-PROJECT-SECRET");
  const pB = await mk(B, "BRAVO-PROJECT-SECRET");
  for (const [org, label] of [[A, "ALPHA"], [B, "BRAVO"]]) {
    await repo.recordActivity(w.db, { organizationId: org.id, actorType: "admin", actorRef: "admin@frameworkco.ca", action: `${label.toLowerCase()}.visible_event`, visibility: "client" });
    await repo.recordActivity(w.db, { organizationId: org.id, actorType: "admin", actorRef: "admin@frameworkco.ca", action: `${label.toLowerCase()}.internal_only`, visibility: "internal" });
  }
  await w.invite(A, "alice@a.test", "owner");
  await w.invite(B, "bob@b.test", "owner");
  await w.invite(A, "amy@a.test", "member");
  await w.invite(A, "carol@both.test", "member");
  await w.invite(B, "carol@both.test", "owner");
  const people = { alice: w.user(1, "alice@a.test"), bob: w.user(2, "bob@b.test"), amy: w.user(3, "amy@a.test"), carol: w.user(4, "carol@both.test"), nobody: w.user(5, "nobody@x.test") };
  const browsers = {};
  for (const [n, u] of Object.entries(people)) { browsers[n] = w.browser(); assert.equal((await browsers[n].signIn(u)).status, 303, n); }
  return { w, A, B, pA, pB, people, browsers, userId: async (n) => (await repo.getUserByWorkosId(w.db, people[n].id)).id };
}
const ORG_PATHS = (slug, pid) => [`/portal/o/${slug}`, `/portal/o/${slug}/projects`, `/portal/o/${slug}/activity`, `/portal/o/${slug}/members`, `/portal/o/${slug}/projects/${pid}`];

test("access matrix: every person x organization x page returns exactly the reviewed status", async () => {
  const { browsers, pA, pB } = await world();
  // alice: owner of A only; bob: owner of B only; amy: member of A; carol: member of A + owner of B; nobody: no memberships
  const expect = {
    alice: { alpha: [200, 200, 200, 200, 200], bravo: [404, 404, 404, 404, 404] },
    bob: { alpha: [404, 404, 404, 404, 404], bravo: [200, 200, 200, 200, 200] },
    amy: { alpha: [200, 200, 200, 403, 200], bravo: [404, 404, 404, 404, 404] },
    carol: { alpha: [200, 200, 200, 403, 200], bravo: [200, 200, 200, 200, 200] },
    nobody: { alpha: [404, 404, 404, 404, 404], bravo: [404, 404, 404, 404, 404] },
  };
  for (const [who, orgs] of Object.entries(expect)) for (const [slug, statuses] of Object.entries(orgs)) {
    const paths = ORG_PATHS(slug, slug === "alpha" ? pA.id : pB.id);
    for (let i = 0; i < paths.length; i++) assert.equal((await browsers[who].get(paths[i])).status, statuses[i], `${who} ${paths[i]}`);
  }
});
test("another organization's data never appears in any page, for any person", async () => {
  const { browsers, pA, pB } = await world();
  const forbiddenFor = { alice: /BRAVO|Bravo|bob@b\.test/, bob: /ALPHA|Alpha|alice@a\.test|amy@a\.test/, amy: /BRAVO|Bravo|bob@b\.test/ };
  for (const [who, re] of Object.entries(forbiddenFor)) {
    const slug = who === "bob" ? "bravo" : "alpha";
    for (const path of [...ORG_PATHS(slug, slug === "alpha" ? pA.id : pB.id), "/portal"]) {
      const res = await browsers[who].get(path);
      if (res.status !== 200) continue;
      assert.ok(!re.test(await text(res)), `${who} ${path}`);
    }
  }
});
test("client pages show client-visible activity only; internal entries and admin details never appear", async () => {
  const { browsers } = await world();
  const html = (await text(await browsers.alice.get("/portal/o/alpha/activity")));
  assert.match(html, /Alpha visible event/);
  assert.ok(!/internal/i.test(html));
  assert.ok(!/admin@frameworkco/.test(html));
  assert.ok(!/internal/i.test(await text(await browsers.alice.get("/portal/o/alpha"))));
});
test("existence is not revealed: 'not a member' and 'no such organization' are indistinguishable", async () => {
  const { browsers } = await world();
  const real = await browsers.alice.get("/portal/o/bravo");
  const fake = await browsers.alice.get("/portal/o/does-not-exist");
  const unnamed = await browsers.alice.get("/portal/o/zz");
  assert.equal(real.status, 404);
  const [rb, fb, ub] = [stripRef(await text(real)), stripRef(await text(fake)), stripRef(await text(unnamed))];
  assert.equal(rb, fb);
  assert.equal(rb, ub);
  for (const h of ["Content-Type", "Cache-Control", "Content-Security-Policy"]) assert.equal(real.headers.get(h), fake.headers.get(h));
  const p1 = await browsers.alice.get(`/portal/o/alpha/projects/00000000-0000-4000-8000-000000000000`);
  assert.equal(p1.status, 404);
});
test("a project id from another organization is 'not found' under my slug, and under theirs I am not a member", async () => {
  const { browsers, pA, pB } = await world();
  assert.equal((await browsers.alice.get(`/portal/o/alpha/projects/${pB.id}`)).status, 404);
  assert.equal((await browsers.alice.get(`/portal/o/bravo/projects/${pB.id}`)).status, 404);
  assert.equal((await browsers.bob.get(`/portal/o/bravo/projects/${pA.id}`)).status, 404);
  assert.ok(!(await text(await browsers.alice.get(`/portal/o/alpha/projects/${pB.id}`))).includes("BRAVO"));
});
test("a person with an account but no membership is denied everywhere; authentication alone grants nothing", async () => {
  const { browsers, pA } = await world();
  for (const path of [...ORG_PATHS("alpha", pA.id), ...ORG_PATHS("bravo", pA.id)]) assert.equal((await browsers.nobody.get(path)).status, 404, path);
  assert.equal(loc(await browsers.nobody.get("/portal")), "/portal/no-access");
});
test("the organization comes from the URL slug checked against membership, never from other request inputs", async () => {
  const { w, browsers, A, B } = await world();
  const tries = [
    { query: "?org=bravo&organization_id=" + B.id + "&slug=bravo" },
    { headers: { "X-Organization": "bravo", "X-Org-Id": B.id, "X-Forwarded-Host": "bravo.frameworkco.ca" } },
    { cookie: `org=${B.id}; organization_id=${B.id}` },
  ];
  for (const t of tries) {
    const b = w.browser();
    b.jar = new Map(browsers.alice.jar);
    if (t.cookie) for (const part of t.cookie.split("; ")) b.jar.set(...part.split("="));
    const res = await b.get("/portal/o/alpha" + (t.query || ""), { headers: t.headers || {} });
    assert.equal(res.status, 200);
    const html = await text(res);
    assert.match(html, /Alpha Dental/);
    assert.ok(!/Bravo|BRAVO/.test(html));
  }
  assert.ok(A);
});
test("revoking a membership takes effect on the very next request, without signing the person out", async () => {
  const { w, A, browsers, userId } = await world();
  assert.equal((await browsers.amy.get("/portal/o/alpha")).status, 200);
  assert.equal((await repo.revokeMembership(w.db, A.id, await userId("amy"), "admin@frameworkco.ca")).ok, true);
  assert.equal((await browsers.amy.get("/portal/o/alpha")).status, 404);
  assert.equal((await browsers.amy.get("/portal/o/alpha/projects")).status, 404);
  assert.equal(loc(await browsers.amy.get("/portal")), "/portal/no-access");
  assert.equal((await browsers.amy.get("/portal/no-access")).status, 403, "still signed in, simply without access");
  assert.equal((await repo.restoreMembership(w.db, A.id, await userId("amy"), { actor: "admin@frameworkco.ca" })).ok, true);
  assert.equal((await browsers.amy.get("/portal/o/alpha")).status, 200, "and restoring is immediate too");
});
test("an old invitation can never re-grant a revoked membership", async () => {
  const { w, A, browsers, people, userId } = await world();
  await repo.revokeMembership(w.db, A.id, await userId("amy"), "admin@frameworkco.ca");
  await w.browser().signIn(people.amy); // signs in again; the invitation was already accepted
  assert.equal((await browsers.amy.get("/portal/o/alpha")).status, 404);
  assert.equal(count(w.db, "memberships", "status = 'revoked'"), 1);
});
test("role changes take effect immediately: demoting an owner removes owner-only pages on the next request", async () => {
  const { w, A, browsers, userId } = await world();
  assert.equal((await browsers.alice.get("/portal/o/alpha/members")).status, 200);
  assert.equal((await repo.setMemberRole(w.db, A.id, await userId("alice"), "member", "admin@frameworkco.ca")).error, "last_owner", "alice is alpha's only owner: the database refuses the demotion");
  assert.equal((await repo.setMemberRole(w.db, A.id, await userId("amy"), "owner", "admin@frameworkco.ca")).ok, true);
  await repo.setMemberRole(w.db, A.id, await userId("alice"), "member", "admin@frameworkco.ca");
  assert.equal((await browsers.alice.get("/portal/o/alpha/members")).status, 403);
  assert.equal((await browsers.alice.get("/portal/o/alpha")).status, 200);
  assert.ok(!/Team<\/a>/.test(await text(await browsers.alice.get("/portal/o/alpha"))), "the navigation no longer offers it");
  await repo.setMemberRole(w.db, A.id, await userId("alice"), "owner", "admin@frameworkco.ca");
  assert.equal((await browsers.alice.get("/portal/o/alpha/members")).status, 200);
});
test("a suspended or archived organization is closed to everyone at once, and disappears from the picker", async () => {
  const { w, B, browsers } = await world();
  assert.equal((await browsers.carol.get("/portal")).status, 200, "carol sees a picker");
  assert.match(await text(await browsers.carol.get("/portal")), /Bravo Bakery/);
  for (const status of ["suspended", "archived"]) {
    await repo.setOrganizationStatus(w.db, B.id, status);
    assert.equal((await browsers.bob.get("/portal/o/bravo")).status, 404, status);
    assert.equal((await browsers.carol.get("/portal/o/bravo/projects")).status, 404, status);
    assert.equal(loc(await browsers.bob.get("/portal")), "/portal/no-access");
    assert.equal(loc(await browsers.carol.get("/portal")), "/portal/o/alpha", "only one organization left: straight in");
  }
  await repo.setOrganizationStatus(w.db, B.id, "active");
  assert.equal((await browsers.bob.get("/portal/o/bravo")).status, 200);
});
test("a disabled user is locked out on the next request even though the session row was not revoked", async () => {
  const { w, browsers, userId } = await world();
  await repo.setUserStatus(w.db, await userId("alice"), "disabled");
  const res = await browsers.alice.get("/portal/o/alpha");
  assert.equal(res.status, 303);
  assert.equal(loc(res), "/portal/login?r=ended");
});
test("disabling through the lifecycle revokes every session of that user and no one else's", async () => {
  const { w, browsers, userId } = await world();
  const second = w.browser();
  await second.signIn(w.user(1, "alice@a.test"));
  const { disableUser } = await import("../portal/sessions.js");
  await disableUser(w.db, await userId("alice"));
  assert.equal((await browsers.alice.get("/portal/o/alpha")).status, 303);
  assert.equal((await second.get("/portal/o/alpha")).status, 303);
  assert.equal((await browsers.amy.get("/portal/o/alpha")).status, 200);
});
test("multi-organization person: roles are per organization", async () => {
  const { browsers } = await world();
  const picker = await text(await browsers.carol.get("/portal"));
  assert.match(picker, /Alpha Dental[\s\S]*Member/);
  assert.match(picker, /Bravo Bakery[\s\S]*Owner/);
  assert.equal((await browsers.carol.get("/portal/o/alpha/members")).status, 403);
  assert.equal((await browsers.carol.get("/portal/o/bravo/members")).status, 200);
});
test("team page lists only active members of THIS organization", async () => {
  const { w, A, browsers, userId } = await world();
  let html = await text(await browsers.alice.get("/portal/o/alpha/members"));
  assert.match(html, /alice@a\.test/); assert.match(html, /amy@a\.test/); assert.match(html, /carol@both\.test/);
  assert.ok(!/bob@b\.test/.test(html));
  await repo.revokeMembership(w.db, A.id, await userId("amy"), "admin@frameworkco.ca");
  html = await text(await browsers.alice.get("/portal/o/alpha/members"));
  assert.ok(!/amy@a\.test/.test(html), "revoked members are not listed");
});
test("sessions belong to people, not organizations: one person's cookie never opens another person's organization", async () => {
  const { w, browsers } = await world();
  const thief = w.browser();
  thief.jar.set("__Host-fw_portal", browsers.bob.jar.get("__Host-fw_portal")); // even a stolen cookie only gives Bob's own access
  assert.equal((await thief.get("/portal/o/alpha")).status, 404);
  assert.equal((await thief.get("/portal/o/bravo")).status, 200);
});
test("forged or substituted cookies never authenticate", async () => {
  const { w, browsers } = await world();
  const real = browsers.alice.jar.get("__Host-fw_portal");
  const variants = [real.slice(0, -1) + (real.endsWith("A") ? "B" : "A"), real.toLowerCase() === real ? real.toUpperCase() : real.toLowerCase(), real + "x", "x" + real, real + real, ""];
  for (const v of variants) {
    const b = w.browser();
    b.jar.set("__Host-fw_portal", v);
    assert.ok([303].includes((await b.get("/portal/o/alpha")).status), v.slice(0, 6));
  }
  const dup = w.browser();
  const res = await dup.send("/portal/o/alpha", { headers: { Cookie: `__Host-fw_portal=${real}; __Host-fw_portal=${real}` }, cookies: false });
  assert.equal(res.status, 303, "duplicate cookie names are ambiguous and refused");
  const sessionHash = (await import("../portal/crypto.js")).hashSessionToken;
  const direct = w.browser();
  direct.jar.set("__Host-fw_portal", await sessionHash("Zk3xQ9vB7mLr2TnW8yHcA5dJfG1sPuE4oXiK6bNtMe0", real)); // the stored hash is not a credential
  assert.equal((await direct.get("/portal/o/alpha")).status, 303);
});
test("database stores no raw session tokens", async () => {
  const { w, browsers } = await world();
  const dump = JSON.stringify(w.db.raw.prepare("SELECT * FROM portal_sessions").all());
  for (const b of Object.values(browsers)) assert.ok(!dump.includes(b.jar.get("__Host-fw_portal")));
});

/* ------------------------------------------------------------------ mechanical checks of the router and pages */
const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("scan: organization-scoped data is only ever fetched with the membership's organization id", () => {
  const router = src("../portal/router.js");
  const calls = [...router.matchAll(/\b(listProjects|getProject|listActivity|listMembers)\(([^)]*\))?[^)]*\)/g)].map((m) => m[0]).filter((c) => !c.startsWith("listActive"));
  assert.ok(calls.length >= 5, "found the data calls: " + calls.length);
  for (const c of calls) assert.match(c, /a\.membership\.organizationId/, c);
  assert.ok(!/organizationId\s*[:=]\s*(ctx\.url|m\[|slug|id\b)/.test(router));
  assert.ok(!/searchParams|headers\.get/.test(router.replace(/url\.searchParams\.get\("start"\)/g, "")), "the router reads no request input beyond the path, method and the login 'start' flag");
});
test("scan: every organization route goes through requireOrgAccess with a reviewed policy action", () => {
  const router = src("../portal/router.js");
  const routes = [...router.matchAll(/action: "([a-z.]+)"/g)].map((m) => m[1]);
  assert.deepEqual(routes.sort(), ["account.view", "activity.view", "branding.view", "branding.view", "branding.view", "branding.view", "branding.view", "documents.view", "feedback.submit", "members.view", "org.view", "org.view", "profile.view", "profile.view", "projects.view", "projects.view", "workspace.view"]);
  assert.equal([...router.matchAll(/requireOrgAccess\(/g)].length, 1, "one choke point");
  assert.ok(!/getActiveMembership|listActiveMembershipsForUser\(ctx\.db, (?!got\.session\.userId)/.test(router.replace(/import[^\n]*\n/g, "")), "memberships are only resolved for the signed-in user");
  const pages = src("../portal/pages.js");
  assert.ok(!/ctx\.request|searchParams/.test(pages), "pages render only what they are handed");
  assert.ok(!/innerHTML|<script|javascript:|\bon[a-z]+=/.test(pages), "no scripts or inline handlers");
});
test("scan: the portal modules never log request data or secrets", () => {
  for (const f of ["auth", "guard", "router", "pages", "workos", "sessions", "ratelimit"]) {
    const code = src(`../portal/${f}.js`);
    assert.ok(!/console\.(log|error|warn|info|debug)/.test(code), f + " writes to the console directly");
  }
  const auth = src("../portal/auth.js");
  for (const m of auth.matchAll(/note\(([^;]*)\);/g)) assert.ok(!/(code|state|token|email|cookie|url|search)\b\s*[,)}]/i.test(m[1].replace(/"[^"]*"/g, "")), "note() with request data: " + m[1]);
});
