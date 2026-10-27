// Backup retention safeguards (Staging development; the purge is OFF unless PORTAL_BACKUP_PURGE is "1" and is never enabled on Production without the owner's approval):
// a backup copy is removed only 90+ days after its file was deleted, never while a live row points to it, never when nothing refers to it, and a deliberately deleted
// file can never be restored. Failures are counted and never throw; an unreadable database deletes nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { openPortalDb } from "./helpers/portal-db.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as repo from "../portal/repo/index.js";
import * as B from "../portal/brand-files.js";
import { backupFiles, restoreFiles, backupStatus } from "../portal/file-backup.js";
import { backupPurge, restorableKeys, purgeEnabled, PURGE_GRACE_DAYS } from "../portal/backup-purge.js";
import { runScheduled } from "../portal/scheduled.js";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";

const DAY = 86400000;
const T0 = new Date("2026-10-27T12:00:00.000Z");
const at = (days) => new Date(T0.getTime() + days * DAY);
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const NIL = "org/00000000-0000-4000-8000-000000000000/files/00000000-0000-4000-8000-0000000000aa";

async function world() {
  const db = openPortalDb(), primary = fakeR2(), backup = fakeR2();
  const org = (await repo.createOrganizationAudited(db, { slug: "purge-co", name: "Purge Co" }, "seed")).organization;
  const user = (await repo.upsertUserFromIdentity(db, { workosUserId: "user_01PURGE0000000", email: "ann@purge.test", name: "Ann" })).user;
  db.raw.prepare("INSERT INTO memberships (id, organization_id, user_id, role, status, created_at, created_by) VALUES (?, ?, ?, 'owner', 'active', ?, 'seed')").run(crypto.randomUUID(), org.id, user.id, T0.toISOString());
  const deps = (now = T0) => ({ db, bucket: primary, env: {}, now });
  const keyOf = (table, id) => db.raw.prepare(`SELECT storage_key FROM ${table} WHERE id = ?`).get(id).storage_key;
  let n = 0; // every logo needs its own role/orientation/tone so generated names never collide
  const asset = async (name) => {
    const i = n++, roles = ["primary", "simplified", "icon"], orient = ["square", "horizontal", "vertical"], tones = ["light", "dark", "colour", "mono"];
    const r = await B.adminUploadAsset(deps(), { organizationId: org.id, actor: "a@f.test", meta: { kind: "logo", logo_role: roles[i % 3], orientation: orient[Math.floor(i / 3) % 3], tone: tones[Math.floor(i / 9) % 4] }, file: { name, bytes: S.svg("<rect id='" + name + "'/>") } });
    assert.equal(r.ok, true, JSON.stringify(r));
    return { id: r.id, key: keyOf("brand_assets", r.id) };
  };
  const upload = async (name) => {
    const r = await B.clientUploadFile(deps(), { role: "owner", organizationId: org.id, userId: user.id, category: "logo", file: { name, bytes: S.png() } });
    assert.equal(r.ok, true, JSON.stringify(r));
    return { id: r.id, key: keyOf("brand_uploads", r.id) };
  };
  const delAsset = (a, now) => B.adminDeleteAsset(deps(now), { organizationId: org.id, assetId: a.id, actor: "a@f.test" });
  const delUpload = (u, now) => B.adminDeleteUpload(deps(now), { organizationId: org.id, uploadId: u.id, actor: "a@f.test" });
  const purge = (opts = {}) => backupPurge({ db, primary, backup, now: at(0), ...opts });
  return { db, primary, backup, org, user, asset, upload, delAsset, delUpload, purge };
}

test("a deleted file's backup copy is removed only once the 90 days have passed; the main bucket and live files are never touched", async () => {
  const w = await world();
  const keep = await w.asset("keep.svg"), gone = await w.asset("gone.svg"), pic = await w.upload("pic.png");
  await backupFiles({ primary: w.primary, backup: w.backup });
  assert.equal(w.backup.store.size, 3);
  await w.delAsset(gone, T0); await w.delUpload(pic, T0);
  assert.equal(w.primary.store.has(gone.key), false, "the main copy is removed at once");
  assert.equal(PURGE_GRACE_DAYS, 90);
  const day89 = await w.purge({ now: at(89.9), dryRun: false });
  assert.deepEqual([day89.ok, day89.deleted, day89.waiting, day89.eligible], [true, 0, 2, 0], "still inside the 90 days: waiting");
  assert.equal(w.backup.store.size, 3);
  const early = await w.purge({ now: at(90), dryRun: true });
  assert.deepEqual([early.eligible, early.deleted, early.dryRun], [2, 0, true], "a dry run reports but deletes nothing");
  assert.equal(w.backup.store.size, 3);
  const real = await w.purge({ now: at(90), dryRun: false });
  assert.deepEqual([real.ok, real.deleted, real.failed, real.remaining, real.dryRun], [true, 2, 0, 0, false]);
  assert.deepEqual([...w.backup.store.keys()], [keep.key], "only the two deleted files' backup copies are gone");
  assert.equal(w.primary.store.has(keep.key), true, "the live file is untouched in the main bucket");
  const again = await w.purge({ now: at(200), dryRun: false });
  assert.deepEqual([again.orphans, again.deleted], [0, 0], "nothing left to do");
});

test("DRY RUN is the default: calling the purge without saying otherwise never deletes", async () => {
  const w = await world();
  const a = await w.asset("a.svg");
  await backupFiles({ primary: w.primary, backup: w.backup });
  await w.delAsset(a, T0);
  const r = await backupPurge({ db: w.db, primary: w.primary, backup: w.backup, now: at(365) });
  assert.deepEqual([r.dryRun, r.eligible, r.deleted], [true, 1, 0]);
  assert.equal(w.backup.store.has(a.key), true);
});

test("ACTIVE FILES are protected: a live file whose main copy was lost keeps its backup copy for ever, and it can be restored", async () => {
  const w = await world();
  const live = await w.asset("live.svg");
  await backupFiles({ primary: w.primary, backup: w.backup });
  await w.primary.delete(live.key); // the main copy is lost; the database row is live
  const r = await w.purge({ now: at(3650), dryRun: false });
  assert.deepEqual([r.protected, r.eligible, r.deleted], [1, 0, 0]);
  assert.equal(w.backup.store.has(live.key), true);
  const back = await restoreFiles({ primary: w.primary, backup: w.backup, only: (keys) => restorableKeys(w.db, keys) });
  assert.deepEqual([back.ok, back.copied], [true, 1]);
  assert.equal(w.primary.store.has(live.key), true, "the live file came back");
});

test("invoice files and request attachments are never purged: any row pointing to the key counts as live", async () => {
  const w = await world();
  const key = `org/${w.org.id}/invoices/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
  w.db.raw.prepare("INSERT INTO invoices (id, organization_id, invoice_number, issue_date, amount_cents, created_by, updated_by, format, content_type, size_bytes, sha256, storage_key) VALUES (?, ?, 'P-1', '2020-01-01', 100, 'o@f.test', 'o@f.test', 'pdf', 'application/pdf', 4, ?, ?)").run("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", w.org.id, "a".repeat(64), key);
  await w.backup.put(key, new Uint8Array([1, 2, 3, 4]));
  const r = await w.purge({ now: at(5000), dryRun: false });
  assert.deepEqual([r.protected, r.deleted], [1, 0]);
  assert.equal(w.backup.store.has(key), true);
});

test("an object nothing refers to is never deleted (left for a human), and the checks' reserved test corner is ignored", async () => {
  const w = await world();
  const stray = `org/${w.org.id}/files/cccccccc-cccc-4ccc-8ccc-cccccccccccc`;
  await w.backup.put(stray, new Uint8Array([9]));
  await w.backup.put(NIL, new Uint8Array([9]));
  const r = await w.purge({ now: at(5000), dryRun: false });
  assert.deepEqual([r.orphans, r.unreferenced, r.deleted], [1, 1, 0], "the reserved key is not even counted");
  assert.equal(w.backup.store.has(stray), true);
  assert.equal(w.backup.store.has(NIL), true);
});

test("a deliberately deleted file is NEVER restored, and neither is an object nothing refers to; the checks' own corner still restores", async () => {
  const w = await world();
  const gone = await w.asset("gone.svg"), live = await w.asset("live2.svg");
  await backupFiles({ primary: w.primary, backup: w.backup });
  await w.delAsset(gone, T0);
  await w.primary.delete(live.key);
  const stray = `org/${w.org.id}/files/dddddddd-dddd-4ddd-8ddd-dddddddddddd`;
  await w.backup.put(stray, new Uint8Array([1]));
  const st = await backupStatus({ primary: w.primary, backup: w.backup });
  assert.equal(st.missingFromPrimary, 3, "the status still counts all three as missing from the main bucket");
  const r = await restoreFiles({ primary: w.primary, backup: w.backup, limit: 50, only: (keys) => restorableKeys(w.db, keys) });
  assert.deepEqual([r.ok, r.copied], [true, 1]);
  assert.deepEqual([...w.primary.store.keys()], [live.key], "only the live file is back; the deleted one and the stray stay out");
  // the proof-of-backup check restores without the filter inside its reserved corner
  await w.backup.put(NIL, new Uint8Array([7]));
  assert.equal((await restoreFiles({ primary: w.primary, backup: w.backup, prefix: "org/00000000-0000-4000-8000-000000000000/" })).copied, 1);
});

test("a file re-created or restored after deletion is live again: its newest row decides", async () => {
  const w = await world();
  const a = await w.asset("a.svg");
  await backupFiles({ primary: w.primary, backup: w.backup });
  await w.delAsset(a, T0);
  // a second row that points to the same key and is live (for example a data repair) protects it
  w.db.raw.prepare("INSERT INTO invoices (id, organization_id, invoice_number, issue_date, amount_cents, created_by, updated_by, format, content_type, size_bytes, sha256, storage_key) VALUES (?, ?, 'P-2', '2020-01-01', 100, 'o@f.test', 'o@f.test', 'pdf', 'application/pdf', 4, ?, ?)").run("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", w.org.id, "a".repeat(64), a.key);
  const r = await w.purge({ now: at(1000), dryRun: false });
  assert.deepEqual([r.protected, r.deleted], [1, 0]);
});

test("failure handling: a refused delete (for example a locked object) is counted, the rest continue, nothing throws and the next run retries", async () => {
  const w = await world();
  const files = [];
  for (let i = 0; i < 3; i++) files.push(await w.asset(`f${i}.svg`));
  await backupFiles({ primary: w.primary, backup: w.backup });
  for (const f of files) await w.delAsset(f, T0);
  const realDelete = w.backup.delete.bind(w.backup);
  let locked = true;
  w.backup.delete = async (key) => { if (locked && key === files[1].key) throw new Error("locked"); return realDelete(key); };
  const first = await w.purge({ now: at(91), dryRun: false });
  assert.deepEqual([first.ok, first.deleted, first.failed, first.remaining], [false, 2, 1, 0]);
  assert.equal(w.backup.store.has(files[1].key), true);
  locked = false;
  const second = await w.purge({ now: at(92), dryRun: false });
  assert.deepEqual([second.ok, second.deleted], [true, 1]);
  assert.equal(w.backup.store.size, 0);
});

test("fail closed: an unreadable database deletes nothing; a missing binding or the same bucket does nothing", async () => {
  const w = await world();
  const a = await w.asset("a.svg");
  await backupFiles({ primary: w.primary, backup: w.backup });
  await w.delAsset(a, T0);
  const broken = { prepare() { throw new Error("D1 down"); } };
  const r = await backupPurge({ db: broken, primary: w.primary, backup: w.backup, now: at(500), dryRun: false });
  assert.deepEqual([r.ok, r.skipped, r.deleted], [false, "database_unreadable", 0]);
  assert.equal(w.backup.store.has(a.key), true);
  assert.equal((await backupPurge({ db: w.db, primary: w.primary, backup: null, now: at(500), dryRun: false })).skipped, "not_configured");
  assert.equal((await backupPurge({ db: w.db, primary: w.backup, backup: w.backup, now: at(500), dryRun: false })).skipped, "same_bucket");
  assert.equal((await backupPurge({ db: w.db, primary: w.primary, backup: w.backup, now: at(500), graceDays: 0, dryRun: false })).skipped, "invalid_grace");
  assert.equal(w.backup.store.has(a.key), true);
  // a failing restore filter copies nothing
  await w.primary.delete(a.key);
  const rr = await restoreFiles({ primary: w.primary, backup: w.backup, only: () => { throw new Error("db down"); } });
  assert.deepEqual([rr.ok, rr.copied], [false, 0]);
  assert.equal(w.primary.store.size, 0);
});

test("the purge is bounded per run and works off a backlog over several runs", async () => {
  const w = await world();
  const files = [];
  for (let i = 0; i < 12; i++) files.push(await w.asset(`b${i}.svg`));
  await backupFiles({ primary: w.primary, backup: w.backup, limit: 50 });
  for (const f of files) await w.delAsset(f, T0);
  const a = await w.purge({ now: at(100), dryRun: false });
  assert.deepEqual([a.deleted, a.remaining], [10, 2]);
  const b = await w.purge({ now: at(100), dryRun: false });
  assert.deepEqual([b.deleted, b.remaining], [2, 0]);
});

test("deleting a file keeps only what an audit needs: type, size, key, who and when; name, hash and notes are scrubbed", async () => {
  const w = await world();
  const a = await w.asset("Secret-Client-Name.svg"), u = await w.upload("Staff-Card-Jane-Doe.png");
  assert.match(w.db.raw.prepare("SELECT original_name FROM brand_uploads WHERE id = ?").get(u.id).original_name, /Staff-Card/);
  await w.delAsset(a, T0); await w.delUpload(u, T0);
  const ar = w.db.raw.prepare("SELECT original_name, sha256, usage_note, license_note, storage_key, format, size_bytes, deleted_at FROM brand_assets WHERE id = ?").get(a.id);
  const ur = w.db.raw.prepare("SELECT original_name, sha256, storage_key, format, size_bytes, deleted_at, deleted_by, uploaded_by FROM brand_uploads WHERE id = ?").get(u.id);
  for (const r of [ar, ur]) {
    assert.equal(r.original_name, "deleted"); assert.equal(r.sha256, "0".repeat(64));
    assert.ok(r.storage_key && r.format && r.size_bytes > 0 && r.deleted_at, "the audit minimum stays");
  }
  assert.equal(ar.usage_note, null); assert.equal(ar.license_note, null);
  assert.ok(ur.deleted_by && ur.uploaded_by);
  // offboarding (delete a whole organization's files) scrubs too
  const w2 = await world();
  const x = await w2.asset("Another-Name.svg"), y = await w2.upload("Another-Card.png");
  await repo.tombstoneAllFiles(w2.db, w2.org.id, "a@f.test", { now: T0 });
  assert.equal(w2.db.raw.prepare("SELECT original_name FROM brand_assets WHERE id = ?").get(x.id).original_name, "deleted");
  assert.equal(w2.db.raw.prepare("SELECT original_name FROM brand_uploads WHERE id = ?").get(y.id).original_name, "deleted");
});

test("the schedule: the purge is OFF unless PORTAL_BACKUP_PURGE is exactly \"1\"; when on it runs only after a run that had nothing to copy", async () => {
  const w = await world();
  const a = await w.asset("a.svg");
  await backupFiles({ primary: w.primary, backup: w.backup });
  await w.delAsset(a, new Date(Date.now() - 100 * DAY));
  {
    const env = { PORTAL_DB: w.db, PORTAL_FILES: w.primary, PORTAL_FILES_BACKUP: w.backup };
    for (const v of [undefined, "", "0", "true", "yes", " 1"]) {
      assert.equal(purgeEnabled({ PORTAL_BACKUP_PURGE: v }), false, JSON.stringify(v));
      const r = await runScheduled({ ...env, ...(v === undefined ? {} : { PORTAL_BACKUP_PURGE: v }) }, { log: () => {} });
      assert.equal(r.purge, null);
    }
    assert.equal(w.backup.store.has(a.key), true, "nothing deleted while the switch is off");
    const logs = [];
    const on = await runScheduled({ ...env, PORTAL_BACKUP_PURGE: "1" }, { log: (e) => logs.push(e) });
    assert.deepEqual([on.purge.ok, on.purge.deleted], [true, 1]);
    assert.ok(logs.some((e) => e.evt === "cron.purge" && e.outcome === "ok" && e.count === 1));
    assert.ok(!JSON.stringify(logs).includes("org/"), "no key in the logs");
    assert.equal(w.backup.store.has(a.key), false);
    const w2 = await world();
    const b = await w2.asset("b.svg");
    await w2.delAsset(b, new Date(Date.now() - 100 * DAY));
    const e2 = { PORTAL_DB: w2.db, PORTAL_FILES: w2.primary, PORTAL_FILES_BACKUP: w2.backup, PORTAL_BACKUP_PURGE: "1" };
    await w2.asset("c.svg"); // a new file the first step must copy
    const r2 = await runScheduled(e2, { log: () => {} });
    assert.equal(r2.backup.copied >= 1 && r2.purge, null, "skipped on a run that copied files");
  }
});

// ---- the Admin routes
const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const NOW_S = Math.floor(Date.now() / 1000);
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
async function adminWorld(purgeOn) {
  resetKeyCacheForTests();
  const w = await world();
  const env = { PORTAL_DB: w.db, PORTAL_ENABLED: "1", PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: "owner@frameworkco.ca", ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }), PORTAL_FILES: w.primary, PORTAL_FILES_BACKUP: w.backup, ...(purgeOn ? { PORTAL_BACKUP_PURGE: "1" } : {}) };
  const call = (path, { method = "POST", json = {} } = {}) => {
    const token = sign({ iss: `https://${TEAM}`, aud: [AUD], email: "owner@frameworkco.ca", iat: NOW_S, exp: NOW_S + 600 });
    return handleAdmin(new Request(ORIGIN + path, { method, headers: { Origin: ORIGIN, "X-Framework-Admin": "1", "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": token }, body: method === "GET" ? undefined : JSON.stringify(json) }), env, {});
  };
  return { w, call };
}

test("Admin: status shows the retention counts; the purge route is a dry run unless PURGE is typed, and refuses to delete while the switch is off", async () => {
  const { w, call } = await adminWorld(false);
  const a = await w.asset("a.svg"), l = await w.asset("l.svg");
  await backupFiles({ primary: w.primary, backup: w.backup });
  await w.delAsset(a, new Date(Date.now() - 100 * DAY));
  const st = await (await call("/api/admin/branding/backup", { method: "GET" })).json();
  assert.deepEqual(st.retention, { ok: true, enabled: false, waiting: 0, due: 1, protected: 0, unreferenced: 0 });
  const dry = await (await call("/api/admin/branding/backup-purge")).json();
  assert.deepEqual([dry.dryRun, dry.eligible, dry.deleted], [true, 1, 0]);
  const refused = await call("/api/admin/branding/backup-purge", { json: { confirm: "PURGE" } });
  assert.deepEqual([refused.status, (await refused.json()).error], [409, "purge_disabled"]);
  assert.equal(w.backup.store.has(a.key), true);
  assert.ok(l.key);
  assert.ok(!JSON.stringify([st, dry]).includes("org/"), "no object name in an answer");
});

test("Admin: with the switch on, only the typed confirmation deletes, it is audited with counts only, and Restore skips deleted files", async () => {
  const { w, call } = await adminWorld(true);
  const a = await w.asset("a.svg"), live = await w.asset("live.svg");
  await backupFiles({ primary: w.primary, backup: w.backup });
  await w.delAsset(a, new Date(Date.now() - 100 * DAY));
  assert.equal((await (await call("/api/admin/branding/backup-purge", { json: { confirm: "purge" } })).json()).dryRun, true, "wrong casing stays a dry run");
  assert.equal(w.backup.store.has(a.key), true);
  const done = await (await call("/api/admin/branding/backup-purge", { json: { confirm: "PURGE" } })).json();
  assert.deepEqual([done.ok, done.deleted, done.dryRun], [true, 1, false]);
  assert.equal(w.backup.store.has(a.key), false);
  const audit = w.db.raw.prepare("SELECT action, detail FROM activity_log WHERE action = 'files.backup.purge'").all();
  assert.equal(audit.length, 1); assert.ok(!/org\//.test(audit[0].detail));
  // restore: lose the live file and a (not yet purged) deleted one
  const b = await w.asset("b.svg");
  await backupFiles({ primary: w.primary, backup: w.backup });
  await w.delAsset(b, new Date());
  await w.primary.delete(live.key);
  const rs = await (await call("/api/admin/branding/backup-restore", { json: { confirm: "RESTORE" } })).json();
  assert.deepEqual([rs.ok, rs.copied], [true, 1]);
  assert.equal(w.primary.store.has(live.key), true);
  assert.equal(w.primary.store.has(b.key), false, "the deliberately deleted file stayed deleted");
});

test("code safety: the only delete is on the backup bucket inside backup-purge.js; the copy-only backup module and the main bucket are untouched by it", () => {
  const purge = read("worker/portal/backup-purge.js").replace(/\/\*[\s\S]*?\*\//g, "");
  const deletes = purge.match(/\.delete\(/g) || [];
  assert.equal(deletes.length, 1);
  assert.match(purge, /backup\.delete\(key\)/);
  assert.ok(!/primary\.(delete|put)\(/.test(purge));
  assert.ok(!/\.delete\(/.test(read("worker/portal/file-backup.js").replace(/\/\*[\s\S]*?\*\//g, "")), "file-backup.js stays copy-only");
  assert.ok(!/PORTAL_BACKUP_PURGE/.test(read("wrangler.jsonc").replace(/^\s*\/\/.*$/gm, "")), "the switch is not set anywhere: off by default on Staging and Production");
});
