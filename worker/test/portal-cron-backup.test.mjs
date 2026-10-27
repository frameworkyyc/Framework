// Production rollout preparation: the Worker's scheduled (Cron Trigger) handler and the client-file backup. Nothing here is scheduled on Staging (Previews never
// run cron); these tests run the code directly.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../index.js";
import { backupFiles } from "../portal/file-backup.js";
import { runScheduled } from "../portal/scheduled.js";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import * as sup from "../portal/repo/support.js";

const bytes = (s) => new TextEncoder().encode(s);
const K = (n, area = "invoices") => `org/11111111-1111-4111-8111-111111111111/${area}/00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const put = (b, key, text, meta = { org: "x", area: "invoices" }) => b.put(key, bytes(text), { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: meta });
const quiet = () => {};

test("backup copies new files (invoices and client uploads) with their metadata, skips identical ones, and re-copies a changed one", async () => {
  const primary = fakeR2(), backup = fakeR2();
  await put(primary, K(1), "invoice one");
  await put(primary, K(2, "support"), "client upload", { org: "x", area: "support" });
  await put(primary, K(3, "brand-uploads"), "logo", { org: "x", area: "brand-uploads" });
  const first = await backupFiles({ primary, backup });
  assert.deepEqual([first.ok, first.checked, first.copied, first.failed, first.remaining], [true, 3, 3, 0, 0]);
  assert.deepEqual([...backup.store.keys()].sort(), [K(1), K(3, "brand-uploads"), K(2, "support")].sort());
  assert.equal(new TextDecoder().decode(backup.store.get(K(1)).bytes), "invoice one");
  assert.deepEqual(backup.store.get(K(2, "support")).customMetadata, { org: "x", area: "support" });
  assert.equal(backup.store.get(K(1)).httpMetadata.contentType, "application/octet-stream");
  const again = await backupFiles({ primary, backup });
  assert.deepEqual([again.copied, again.failed], [0, 0], "nothing changed: nothing copied");
  await put(primary, K(1), "invoice one, replaced");
  assert.equal((await backupFiles({ primary, backup })).copied, 1, "a changed object is copied again");
  assert.equal(new TextDecoder().decode(backup.store.get(K(1)).bytes), "invoice one, replaced");
});

test("backup NEVER deletes or overwrites anything it should not: a file deleted from the primary stays in the backup, and the primary is only read", async () => {
  const primary = fakeR2(), backup = fakeR2();
  await put(primary, K(1), "a"); await put(primary, K(2), "b");
  await backupFiles({ primary, backup });
  await primary.delete(K(1));
  primary.calls.length = 0; backup.calls.length = 0;
  const r = await backupFiles({ primary, backup });
  assert.equal(r.ok, true);
  assert.ok(backup.store.has(K(1)), "the backup still has the file the primary lost");
  assert.ok(!primary.calls.some(([op]) => op === "put" || op === "delete"), "the primary is only read");
  assert.ok(!backup.calls.some(([op]) => op === "delete"), "the backup is never deleted from");
  const src = readFileSync(new URL("../portal/file-backup.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/\.delete\(/.test(src), "the module has no delete call at all");
});

test("backup is bounded per run, works off a backlog over several runs, and counts failures without throwing", async () => {
  const primary = fakeR2(), backup = fakeR2();
  for (let i = 1; i <= 7; i++) await put(primary, K(i), "file " + i);
  const a = await backupFiles({ primary, backup, limit: 3 });
  assert.deepEqual([a.copied, a.remaining, a.ok], [3, 4, true]);
  const b = await backupFiles({ primary, backup, limit: 3 });
  assert.deepEqual([b.copied, b.remaining], [3, 1]);
  const c = await backupFiles({ primary, backup, limit: 3 });
  assert.deepEqual([c.copied, c.remaining], [1, 0]);
  assert.equal(backup.store.size, 7);
  // a failing backup bucket is reported, never thrown
  const broken = { ...fakeR2(), put: async () => { throw new Error("R2 unavailable"); } };
  const f = await backupFiles({ primary, backup: broken });
  assert.deepEqual([f.ok, f.copied > 0, f.failed > 0], [false, false, true]);
  assert.equal(JSON.stringify(f).includes("org/"), false, "the result holds counts only, no keys");
  // a failing list is reported too
  const noList = { list: async () => { throw new Error("nope"); } };
  assert.equal((await backupFiles({ primary: noList, backup })).ok, false);
});

test("backup does nothing without a backup binding and refuses the same bucket twice", async () => {
  const primary = fakeR2();
  await put(primary, K(1), "x");
  assert.equal((await backupFiles({ primary })).skipped, "no_backup");
  assert.equal((await backupFiles({ backup: primary })).skipped, "no_primary");
  const same = await backupFiles({ primary, backup: primary });
  assert.deepEqual([same.ok, same.skipped, same.copied], [false, "same_bucket", 0]);
});

test("the scheduled handler: notifications run only when Client Services is switched on, the backup only when both buckets are bound, each independent and silent about content", async () => {
  const w = await makeWorld();
  const A = await w.org("alpha", "Alpha Co");
  await w.invite(A, "ann@a.test", "owner");
  const ann = w.browser(); await ann.signIn(w.user(1, "ann@a.test"));
  const annId = w.db.raw.prepare("SELECT id FROM portal_users WHERE email = 'ann@a.test'").get().id;
  const env = { ...w.env, RESEND_API_KEY: "re_test_FAKE", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>", ASSESSMENT_NOTIFY_TO: "hello@frameworkco.ca", PORTAL_BASE_URL: "https://frameworkco.ca" };
  delete env.PORTAL_SERVICES;
  const req = await sup.createRequest(w.db, A.id, annId, { category: "technical_issue", title: "Help", description: "x" });
  assert.ok(req.ok);
  const sent = [];
  const fetchOk = async (u, init) => { sent.push(JSON.parse(init.body).to[0]); return new Response("{}", { status: 200 }); };
  const lines = [];
  const log = (f) => lines.push(f);
  // switch off: nothing is sent, nothing is touched
  let r = await runScheduled(env, { fetch: fetchOk, log });
  assert.deepEqual(r, { notifications: null, backup: null });
  assert.equal(sent.length, 0);
  // switch on: the pending staff notice goes out (to the configured staff address) with nobody visiting
  w.db.raw.prepare("UPDATE service_notifications SET status = 'pending', attempts = 0").run();
  env.PORTAL_SERVICES = "1";
  r = await runScheduled(env, { fetch: fetchOk, log });
  assert.equal(r.notifications.configured, true);
  assert.ok(sent.includes("hello@frameworkco.ca"), "the staff email went to hello@frameworkco.ca");
  assert.equal(w.db.raw.prepare("SELECT count(*) AS n FROM service_notifications WHERE status = 'pending'").get().n, 0);
  // a second run sends nothing again (no duplicates)
  const before = sent.length;
  await runScheduled(env, { fetch: fetchOk, log });
  assert.equal(sent.length, before);
  // backup: both bindings needed
  const primary = fakeR2(), backup = fakeR2();
  await put(primary, K(1), "invoice");
  assert.equal((await runScheduled({ ...env, PORTAL_FILES: primary }, { fetch: fetchOk, log })).backup, null);
  r = await runScheduled({ ...env, PORTAL_FILES: primary, PORTAL_FILES_BACKUP: backup }, { fetch: fetchOk, log });
  assert.equal(r.backup.copied, 1);
  // a broken task never stops the other and never throws
  const brokenDb = { prepare() { throw new Error("D1 down"); } };
  r = await runScheduled({ ...env, PORTAL_DB: brokenDb, PORTAL_FILES: primary, PORTAL_FILES_BACKUP: fakeR2() }, { fetch: fetchOk, log });
  assert.equal(r.backup.copied, 1);
  assert.ok(r.notifications && (r.notifications.error || r.notifications.sent === 0));
  // logs: outcome words and counts only
  assert.ok(lines.length >= 4);
  for (const l of lines) assert.deepEqual(Object.keys(l).sort().filter((k) => !["evt", "outcome", "count"].includes(k)), []);
  assert.ok(!JSON.stringify(lines).match(/@|org\//));
});

test("the Worker exports a scheduled handler that runs the same code and returns at once; the cron itself is NOT in the configuration yet (it is added in its own reviewed stage)", async () => {
  assert.equal(typeof worker.scheduled, "function");
  const waited = [];
  worker.scheduled({ cron: "*/5 * * * *" }, { PORTAL_ENABLED: "1" }, { waitUntil: (p) => waited.push(p) });
  assert.equal(waited.length, 1);
  await Promise.all(waited);
  const cfg = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/"triggers"|"crons"/.test(cfg), "no schedule is configured in this stage");
  const parsed = JSON.parse(cfg);
  assert.deepEqual(parsed.r2_buckets.map((b) => b.binding), ["PORTAL_FILES", "PORTAL_FILES_BACKUP"], "Production binds its own two buckets (Stage 3); still no cron");
  assert.ok(parsed.previews.r2_buckets.some((b) => b.binding === "PORTAL_FILES_BACKUP"));
});
