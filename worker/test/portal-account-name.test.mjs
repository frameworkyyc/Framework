// The account holder's display name: where it comes from, when the Business Profile's primary contact may stand in for it,
// self-service editing, persistence across sign-out/sign-in, and isolation between people.
import test from "node:test";
import assert from "node:assert/strict";
import { makeWorld, csrfOf } from "./helpers/portal-e2e.mjs";
import { saveProfileStep } from "../portal/repo/business-profile.js";

const rows = (w, email) => w.db.raw.prepare("SELECT name FROM portal_users WHERE email = ?").all(email).map((r) => ({ name: r.name }));
const nameless = (u) => ({ id: u.id, email: u.email }); // a one-time-code sign-in: WorkOS sends no first or last name

async function setup() {
  const w = await makeWorld();
  const alpha = await w.org("alpha", "Alpha Co"), beta = await w.org("beta", "Beta Co");
  await w.invite(alpha, "jj@alpha.test", "owner");
  await w.invite(alpha, "mia@alpha.test", "member");
  await w.invite(beta, "bob@beta.test", "owner");
  const jj = w.browser(), mia = w.browser(), bob = w.browser();
  await jj.signIn(nameless(w.user(1, "jj@alpha.test")));
  await mia.signIn(nameless(w.user(2, "mia@alpha.test")));
  await bob.signIn(nameless(w.user(3, "bob@beta.test")));
  return { w, alpha, beta, jj, mia, bob };
}
const contact = async (org, w, cname, cemail) => {
  const uid = w.db.raw.prepare("SELECT user_id FROM memberships WHERE organization_id = ?").get(org.id).user_id;
  return saveProfileStep(w.db, org.id, uid, "contact", { cname, cemail }, { now: w.clock.now() });
};
const text = async (b, path) => (await b.get(path)).text();
const saveName = async (b, fields, csrf) => b.post("/portal/o/alpha/account", { csrf: csrf ?? csrfOf(await text(b, "/portal/o/alpha/account")), ...fields });

test("root cause: a one-time-code sign-in stores no name, so Account says Not set while the profile's contact name lives in a separate, per-organization table", async () => {
  const { w, jj } = await setup();
  assert.deepEqual(rows(w, "jj@alpha.test"), [{ name: null }]);
  const html = await text(jj, "/portal/o/alpha/account");
  assert.match(html, /<dt>Name<\/dt><dd>Not set<\/dd>/);
  assert.match(html, /<label for="an">Your name<\/label>/, "and the person can fix it right there");
});

test("when the profile's contact email is the signed-in email, its name is shown (and suggested), but never stored by itself", async () => {
  const { w, alpha, jj } = await setup();
  await contact(alpha, w, "JJ", "JJ@Alpha.test");
  const html = await text(jj, "/portal/o/alpha/account");
  assert.match(html, /<dt>Name<\/dt><dd>JJ<\/dd>/);
  assert.match(html, /value="JJ"/);
  assert.match(html, /Suggested from your Business Profile/);
  assert.match(await text(jj, "/portal/o/alpha"), /Welcome back, JJ\./);
  assert.deepEqual(rows(w, "jj@alpha.test"), [{ name: null }], "display only: the account is untouched until the person confirms");
});

test("a primary contact with a different email is a different person: never shown as the account holder's name", async () => {
  const { w, alpha, jj, mia } = await setup();
  await contact(alpha, w, "Pat Contact", "pat@alpha.test");
  for (const b of [jj, mia]) {
    const html = await text(b, "/portal/o/alpha/account");
    assert.match(html, /<dt>Name<\/dt><dd>Not set<\/dd>/);
    assert.ok(!html.includes("Pat Contact"));
    assert.ok(!html.includes("Suggested from your Business Profile"));
  }
});

test("a name from the sign-in provider is never replaced by the profile contact", async () => {
  const w = await makeWorld();
  const alpha = await w.org("alpha", "Alpha Co");
  await w.invite(alpha, "ann@alpha.test", "owner");
  const ann = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); // Test User1
  await contact(alpha, w, "Somebody Else", "ann@alpha.test");
  const html = await text(ann, "/portal/o/alpha/account");
  assert.match(html, /<dt>Name<\/dt><dd>Test User1<\/dd>/);
  assert.ok(!html.includes("Suggested from"));
});

test("saving the name persists across refresh, sign-out and a fresh sign-in (the empty name WorkOS sends does not erase it)", async () => {
  const { w, jj } = await setup();
  const res = await saveName(jj, { name: "  JJ Rivera " });
  assert.equal(res.status, 303);
  assert.match(res.headers.get("Location"), /\/portal\/o\/alpha\/account\?saved=1$/);
  assert.deepEqual(rows(w, "jj@alpha.test"), [{ name: "JJ Rivera" }]);
  const after = await text(jj, "/portal/o/alpha/account?saved=1");
  assert.match(after, /<dt>Name<\/dt><dd>JJ Rivera<\/dd>/);
  assert.match(after, /Name saved\./);
  assert.match(await text(jj, "/portal/o/alpha/account"), /JJ Rivera/);
  const out = await jj.post("/portal/logout", { csrf: csrfOf(await text(jj, "/portal/o/alpha/account")) });
  assert.equal(out.status, 303);
  const again = w.browser();
  await again.signIn(nameless(w.user(1, "jj@alpha.test")));
  assert.match(await text(again, "/portal/o/alpha/account"), /<dt>Name<\/dt><dd>JJ Rivera<\/dd>/);
  assert.match(await text(again, "/portal/o/alpha"), /Welcome back, JJ\./);
});

test("confirming the suggestion stores it; an edited name wins over the suggestion afterwards", async () => {
  const { w, alpha, jj } = await setup();
  await contact(alpha, w, "JJ", "jj@alpha.test");
  await saveName(jj, { name: "JJ" });
  assert.deepEqual(rows(w, "jj@alpha.test"), [{ name: "JJ" }]);
  await saveName(jj, { name: "Jordan J." });
  const html = await text(jj, "/portal/o/alpha/account");
  assert.match(html, /<dt>Name<\/dt><dd>Jordan J\.<\/dd>/);
  assert.ok(!html.includes("Suggested from"));
});

test("validation and CSRF: bad input is refused with the form kept, and nothing is saved", async () => {
  const { w, jj } = await setup();
  const empty = await saveName(jj, { name: "   " });
  assert.equal(empty.status, 422);
  assert.match(await empty.text(), /Enter your name/);
  assert.equal((await saveName(jj, { name: "x".repeat(121) })).status, 422);
  assert.equal((await saveName(jj, { name: "a\u0000b" })).status, 422);
  assert.equal((await saveName(jj, { name: "JJ" }, "not-a-token")).status, 403);
  assert.equal((await saveName(jj, { name: "JJ" }, "")).status, 403);
  assert.deepEqual(rows(w, "jj@alpha.test"), [{ name: null }]);
  const xss = await saveName(jj, { name: '<script>alert(1)</script>' });
  assert.equal(xss.status, 303);
  assert.ok(!(await text(jj, "/portal/o/alpha/account")).includes("<script>alert(1)"), "escaped on output");
});

test("isolation: a save changes only the signed-in person's own row; ids in the request body are ignored; other organizations cannot be targeted", async () => {
  const { w, jj, mia, bob } = await setup();
  const mine = await w.db.raw.prepare("SELECT id FROM portal_users WHERE email = 'bob@beta.test'").all();
  await saveName(jj, { name: "JJ", user_id: mine[0].id, id: mine[0].id, email: "bob@beta.test", organization_id: "x" });
  assert.deepEqual(rows(w, "jj@alpha.test"), [{ name: "JJ" }]);
  assert.deepEqual(rows(w, "mia@alpha.test"), [{ name: null }], "same organization, untouched");
  assert.deepEqual(rows(w, "bob@beta.test"), [{ name: null }], "other organization, untouched");
  const cross = await bob.post("/portal/o/alpha/account", { csrf: csrfOf(await text(bob, "/portal/o/beta/account")), name: "Hacked" });
  assert.equal(cross.status, 404, "no membership in alpha: same 404 as a missing organization");
  assert.deepEqual(rows(w, "jj@alpha.test"), [{ name: "JJ" }]);
  assert.match(await text(mia, "/portal/o/alpha/account"), /<dt>Name<\/dt><dd>Not set<\/dd>/);
});
