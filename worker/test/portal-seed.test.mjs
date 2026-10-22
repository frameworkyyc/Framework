// The Staging-only seed SQL is reviewed, safe, and works with the real sign-in flow. (It is never executed against any real database.)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import { count, rows } from "./helpers/portal-db.mjs";

const read = (p) => readFileSync(new URL("../../migrations/" + p, import.meta.url), "utf8");
const SEED = read("portal-seed/staging-test-org.sql");
const CLEAN = read("portal-seed/staging-test-org-cleanup.sql");
const withEmail = (email) => SEED.replace("__INVITEE_EMAIL__", email);

test("the seed is not a migration: wrangler's migrations folder never contains it", () => {
  assert.deepEqual(readdirSync(new URL("../../migrations/portal/", import.meta.url)).filter((f) => /seed|test-org/i.test(f)), []);
  assert.ok(!/migrations_dir/.test(SEED));
});
test("the seed has exactly one placeholder, no transaction control, and names only portal tables", () => {
  const code = SEED.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.equal((code.match(/__INVITEE_EMAIL__/g) || []).length, 1);
  assert.ok(!/\b(BEGIN|COMMIT|PRAGMA|DROP|ALTER|TRIGGER|ATTACH)\b/i.test(code));
  assert.ok(!/DELETE|UPDATE\s/i.test(code), "the seed only inserts");
  for (const m of code.matchAll(/INTO\s+(\w+)/g)) assert.ok(["organizations", "projects", "activity_log", "invitations"].includes(m[1]), m[1]);
  assert.ok(!/@(?!example)/.test(code.replace("__INVITEE_EMAIL__", "")), "no real email addresses in the file");
  assert.ok(/framework-portal-staging/.test(SEED) && /DO NOT RUN against Production/.test(SEED));
});
test("left unedited the seed FAILS and no invitation exists (the placeholder is rejected by the database)", async () => {
  const w = await makeWorld();
  assert.throws(() => w.db.raw.exec(SEED), /constraint/i);
  assert.equal(count(w.db, "invitations"), 0);
  assert.equal((SEED.match(/__INVITEE_EMAIL__/g) || []).length, 1, "a single occurrence, so a single manual edit");
});
test("edited seed + real sign-in: the invited person lands in the test organization with the sample data", async () => {
  const w = await makeWorld();
  w.db.raw.exec(withEmail("tester@example.com"));
  // seeds use the database clock; the harness clock is fixed in the past of the invitation window, so move it to 'now'
  w.clock.t = new Date();
  const b = w.browser();
  const res = await b.signIn(w.user(7, "Tester@Example.com"));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("Location"), "/portal");
  assert.equal((await b.get("/portal")).headers.get("Location"), "/portal/o/framework-test");
  const html = await (await b.get("/portal/o/framework-test/progress")).text();
  assert.match(html, /Framework Test Organization/);
  assert.match(html, /Test website/);
  assert.match(html, /Project created/);
  assert.equal(rows(w.db, "SELECT role FROM memberships")[0].role, "owner");
});
test("re-running leaves exactly one of everything; the duplicate invitation fails loudly", async () => {
  const w = await makeWorld();
  w.db.raw.exec(withEmail("tester@example.com"));
  assert.throws(() => w.db.raw.exec(withEmail("tester@example.com")), /UNIQUE/);
  assert.equal(count(w.db, "organizations"), 1);
  assert.equal(count(w.db, "invitations", "status = 'pending'"), 1);
  assert.equal(count(w.db, "projects"), 1);
  assert.equal(count(w.db, "activity_log"), 1);
});
test("cleanup removes the test organization and its dependants after a sign-in, and touches nothing else", async () => {
  const w = await makeWorld();
  const other = await w.org("other", "Other Org");
  await w.invite(other, "x@example.com");
  w.db.raw.exec(withEmail("tester@example.com"));
  w.clock.t = new Date();
  await w.browser().signIn(w.user(7, "tester@example.com"));
  w.db.raw.exec(CLEAN);
  assert.equal(count(w.db, "organizations"), 1);
  assert.equal(count(w.db, "organizations", "slug = 'framework-test'"), 0);
  assert.equal(count(w.db, "invitations"), 1);
  assert.equal(count(w.db, "memberships"), 0);
  assert.equal(count(w.db, "portal_sessions"), 0);
  assert.equal(count(w.db, "projects"), 0);
});
