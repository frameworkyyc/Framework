// Production rollout Stage 2 verification: the backup really copies files under the SAME unique names, restoring only fills gaps, and the Admin routes that prove it
// (status, run, check, restore) are admin-only, write-gated and show counts and step names only. Run against in-memory buckets here; the same routes are run on the
// real Staging buckets from Admin -> Branding -> Storage.
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import { backupFiles, restoreFiles, backupStatus } from "../portal/file-backup.js";
import { makeKey } from "../portal/files/index.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const T = Math.floor(Date.now() / 1000);
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
const ORG = "11111111-1111-4111-8111-111111111111";
const bytes = (s) => new TextEncoder().encode(s);
const text = (obj) => new TextDecoder().decode(obj.bytes);
const put = (b, key, s) => b.put(key, bytes(s), { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { org: ORG, area: "invoices" } });

async function setup({ backup = true, writes = true } = {}) {
  resetKeyCacheForTests();
  const w = await makeWorld();
  const primary = fakeR2(), second = fakeR2();
  const env = { ...w.env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: "owner@frameworkco.ca", ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }), PORTAL_FILES: primary, ...(backup ? { PORTAL_FILES_BACKUP: second } : {}), ...(writes ? { PORTAL_ADMIN_WRITES: "1" } : {}) };
  const call = (path, { method = "POST", json = {}, token, headers = {} } = {}) => {
    const t = token === undefined ? sign({ iss: `https://${TEAM}`, aud: [AUD], email: "owner@frameworkco.ca", iat: T, exp: T + 600 }) : token;
    const h = { Origin: ORIGIN, "X-Framework-Admin": "1", "Content-Type": "application/json", ...headers };
    if (t) h["Cf-Access-Jwt-Assertion"] = t;
    return handleAdmin(new Request(ORIGIN + path, { method, headers: h, body: method === "GET" ? undefined : JSON.stringify(json) }), env, {});
  };
  return { w, primary, second, env, call };
}
const KEYS = (n) => `org/${ORG}/invoices/00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("backup keeps the SAME unique object names, and restoring fills only the gaps without ever overwriting an existing file", async () => {
  const primary = fakeR2(), backup = fakeR2();
  const a = makeKey(ORG, "invoices"), b = makeKey(ORG, "support"), c = makeKey(ORG, "invoices");
  assert.equal(new Set([a, b, c]).size, 3, "generated names are unique");
  assert.match(a, /^org\/[0-9a-f-]{36}\/invoices\/[0-9a-f-]{36}$/, "organization, area and a random id: no client text in a name");
  await put(primary, a, "invoice A"); await put(primary, b, "support B"); await put(primary, c, "invoice C");
  assert.equal((await backupFiles({ primary, backup })).copied, 3);
  assert.deepEqual([...backup.store.keys()].sort(), [a, b, c].sort(), "every object has exactly the same name in the backup");
  // loss: a file disappears from the main bucket, another is changed by mistake
  await primary.delete(a);
  await put(primary, b, "support B (edited)");
  const status = await backupStatus({ primary, backup });
  assert.deepEqual([status.primary, status.backup, status.missingFromPrimary, status.changed, status.missingFromBackup], [2, 3, 1, 1, 0]);
  const restored = await restoreFiles({ primary, backup });
  assert.deepEqual([restored.copied, restored.failed, restored.remaining], [1, 0, 0]);
  assert.equal(text(primary.store.get(a)), "invoice A", "the lost file is back, identical");
  assert.equal(text(primary.store.get(b)), "support B (edited)", "an existing file is NEVER overwritten by a restore");
  assert.equal(text(backup.store.get(b)), "support B", "and the backup copy is untouched by it");
  assert.equal((await restoreFiles({ primary, backup })).copied, 0, "restoring again changes nothing");
  assert.equal((await restoreFiles({ primary: backup, backup: backup })).skipped, "same_bucket");
});

test("Admin backup check: a real end-to-end proof (write, copy, read back from the backup, simulated loss, restore), a fresh unique name each run, counts only", async () => {
  const s = await setup();
  await put(s.primary, KEYS(1), "a real client invoice");
  const first = await (await s.call("/api/admin/branding/backup-check")).json();
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(first.steps.map((x) => x.name), ["bindings", "write", "new_unique_name", "copy", "backup_has_same_name", "backup_bytes_match", "loss_simulated", "restore", "restored_bytes_match", "cleanup"]);
  assert.ok(first.steps.every((x) => x.ok));
  const testKeysAfterOne = [...s.second.store.keys()].filter((k) => k.includes("00000000-0000-4000-8000-000000000000/files/"));
  assert.equal(testKeysAfterOne.length, 1, "one tiny test object is left in the backup (a locked backup bucket keeps it)");
  assert.equal([...s.primary.store.keys()].filter((k) => k.includes("00000000-0000-4000-8000-000000000000/files/")).length, 0, "the main bucket's test object is cleaned up after the restore was proven");
  const second = await (await s.call("/api/admin/branding/backup-check")).json();
  assert.equal(second.ok, true);
  const names = [...s.second.store.keys()].filter((k) => k.includes("00000000-0000-4000-8000-000000000000/files/"));
  assert.equal(new Set(names).size, 2, "each run uses a new unique name");
  assert.ok(!JSON.stringify([first, second]).includes("org/"), "no object name in an answer");
  assert.equal(text(s.primary.store.get(KEYS(1))), "a real client invoice", "real client files are never touched by the check");
  // the checks' own leftovers never show up as "only in the backup", are never restored into the main bucket and are not re-copied by a normal run
  const st = await (await s.call("/api/admin/branding/backup", { method: "GET" })).json();
  assert.deepEqual([st.primary, st.backup, st.missingFromPrimary, st.missingFromBackup], [1, 0, 0, 1], "only the one real file is counted");
  assert.equal((await (await s.call("/api/admin/branding/backup-restore", { json: { confirm: "RESTORE" } })).json()).copied, 0);
  const keysBefore = [...s.second.store.keys()].length;
  await s.call("/api/admin/branding/backup-run");
  assert.equal([...s.second.store.keys()].length, keysBefore + 1, "a normal run copies the real file only");
  const audit = s.w.db.raw.prepare("SELECT action, detail FROM activity_log WHERE action = 'files.backup.check'").all();
  assert.equal(audit.length, 2);
  assert.ok(!/org\//.test(audit[0].detail));
});

test("Admin backup run, status and restore: counts only; restore needs the typed confirmation; nothing is overwritten or deleted", async () => {
  const s = await setup();
  for (let i = 1; i <= 3; i++) await put(s.primary, KEYS(i), "file " + i);
  let st = await (await s.call("/api/admin/branding/backup", { method: "GET" })).json();
  assert.deepEqual([st.configured, st.primary, st.backup, st.missingFromBackup], [true, 3, 0, 3]);
  const run = await (await s.call("/api/admin/branding/backup-run")).json();
  assert.deepEqual([run.ok, run.copied, run.remaining], [true, 3, 0]);
  st = await (await s.call("/api/admin/branding/backup", { method: "GET" })).json();
  assert.deepEqual([st.primary, st.backup, st.missingFromBackup, st.changed, st.missingFromPrimary], [3, 3, 0, 0, 0]);
  await s.primary.delete(KEYS(2));
  const refused = await s.call("/api/admin/branding/backup-restore", { json: {} });
  assert.deepEqual([refused.status, (await refused.json()).error], [422, "confirmation_required"]);
  assert.equal(s.primary.store.has(KEYS(2)), false, "nothing copied without the confirmation");
  const wrong = await s.call("/api/admin/branding/backup-restore", { json: { confirm: "restore" } });
  assert.equal(wrong.status, 422);
  const done = await (await s.call("/api/admin/branding/backup-restore", { json: { confirm: "RESTORE" } })).json();
  assert.deepEqual([done.ok, done.copied], [true, 1]);
  assert.equal(text(s.primary.store.get(KEYS(2))), "file 2");
  assert.ok(!s.second.calls.some(([op]) => op === "delete"), "nothing is ever deleted from the backup bucket");
  assert.ok(!JSON.stringify(run).includes("org/") && !JSON.stringify(done).includes("org/"));
});

test("the backup routes are admin-only and write-gated, fail clearly without a backup bucket, and never answer to a non-admin", async () => {
  const s = await setup();
  for (const [method, path] of [["GET", "/api/admin/branding/backup"], ["POST", "/api/admin/branding/backup-run"], ["POST", "/api/admin/branding/backup-check"], ["POST", "/api/admin/branding/backup-restore"]]) {
    for (const opts of [{ token: null }, { token: "garbage" }, { headers: { Origin: "https://evil.example" } }, { headers: { "X-Framework-Admin": "0" } }]) {
      if (method === "GET" && opts.headers) continue; // reads need only the admin token
      const r = await s.call(path, { method, json: { confirm: "RESTORE" }, ...opts });
      assert.ok([401, 403].includes(r.status), `${method} ${path} ${JSON.stringify(opts)} -> ${r.status}`);
    }
  }
  const off = await setup({ writes: false });
  assert.equal((await off.call("/api/admin/branding/backup-run")).status, 403);
  assert.equal((await off.call("/api/admin/branding/backup", { method: "GET" })).status, 200, "status can be read");
  const none = await setup({ backup: false });
  assert.deepEqual(await (await none.call("/api/admin/branding/backup", { method: "GET" })).json(), { ok: false, configured: false });
  for (const p of ["backup-run", "backup-check", "backup-restore"]) {
    const r = await none.call("/api/admin/branding/" + p, { json: { confirm: "RESTORE" } });
    assert.deepEqual([r.status, (await r.json()).error], [503, "backup_unavailable"], p);
  }
  assert.equal((await s.call("/api/admin/branding/backup", { method: "PUT" })).status, 405);
});
