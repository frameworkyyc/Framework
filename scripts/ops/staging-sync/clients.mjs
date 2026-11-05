/**
 * The only code that talks to Cloudflare for the refresh. Production gets a READ-ONLY client: it can send nothing but a single SELECT / read-only PRAGMA and
 * fetch objects; there is no write method to call. Staging gets a client that refuses any write outside the allow-listed tables. Error messages never carry
 * SQL parameters or row values.
 */
import { ACCOUNT_ID, SOURCE, TARGET } from "./config.mjs";
import { WRITABLE } from "./tables.mjs";

const CF = "https://api.cloudflare.com/client/v4";
const PRAGMA_OK = /^PRAGMA\s+(table_info|index_list|index_info|foreign_key_list|foreign_key_check)\b[^=]*$/i;
const SELECT_OK = /^(SELECT|WITH)\b/i;
const WRITE_WORD = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|VACUUM|REINDEX|TRUNCATE)\b/i;

function oneStatement(sql) {
  const s = String(sql).trim().replace(/;\s*$/, "");
  if (!s || s.includes(";")) throw new Error("guard: exactly one statement is allowed");
  return s;
}

/** Throws unless `sql` is one read-only statement. */
export function assertReadOnlySql(sql) {
  const s = oneStatement(sql);
  if (PRAGMA_OK.test(s)) return s;
  if (SELECT_OK.test(s) && !WRITE_WORD.test(s)) return s;
  throw new Error("guard: only read-only statements are allowed here");
}

const TABLE_LIST = [...WRITABLE].join("|");
const WRITE_OK = [
  new RegExp(`^(INSERT INTO|UPDATE|DELETE FROM)\\s+"?(${TABLE_LIST})"?(\\s|\\()`, "i"),
];
/** Throws unless `sql` is one write to an allow-listed table (or the two fixed bookkeeping inserts). */
export function assertTargetWrite(sql) {
  const s = oneStatement(sql);
  if (/^INSERT OR IGNORE INTO portal_users\b/i.test(s)) return s; // only ever the disabled placeholder
  if (WRITE_OK.some((re) => re.test(s)) && !/\b(DROP|ALTER|CREATE|ATTACH|VACUUM|PRAGMA)\b/i.test(s)) {
    if (/^(UPDATE|DELETE FROM)\s+"?(portal_users|activity_log)"?(\s|\()/i.test(s)) throw new Error("guard: portal_users and activity_log are insert-only");
    if (/^INSERT INTO\s+"?portal_users"?(\s|\()/i.test(s)) throw new Error("guard: portal_users accepts only the placeholder insert");
    return s;
  }
  throw new Error("guard: this write is not allowed on the Staging database");
}

async function cf(fetchImpl, token, path, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchImpl(`${CF}${path}`, { ...init, headers });
  return res;
}
async function json(res, what) {
  let j;
  try { j = await res.json(); } catch { throw new Error(`${what}: unreadable response (HTTP ${res.status})`); }
  if (!j.success) throw new Error(`${what}: ${(j.errors || []).map((e) => `${e.code} ${String(e.message).slice(0, 120)}`).join("; ") || "failed"} (HTTP ${res.status})`);
  return j;
}

function d1Base(id) { return `/accounts/${ACCOUNT_ID}/d1/database/${id}`; }

function d1Common(id, token, fetchImpl, guard) {
  return {
    id,
    async info() { return (await json(await cf(fetchImpl, token, d1Base(id)), "database info")).result; },
    async query(sql, params = []) {
      guard(sql);
      const j = await json(await cf(fetchImpl, token, d1Base(id) + "/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql, params }) }), "query");
      return j.result[0].results;
    },
  };
}

/** Production database: read only. */
export function productionDb({ token, fetchImpl = fetch } = {}) {
  return { role: "source", name: SOURCE.name, ...d1Common(SOURCE.id, token, fetchImpl, assertReadOnlySql) };
}

/** Staging database: reads, plus one atomic `batch` of allow-listed writes. */
export function stagingDb({ token, fetchImpl = fetch } = {}) {
  const base = d1Common(TARGET.id, token, fetchImpl, assertReadOnlySql);
  return {
    role: "target", name: TARGET.name, ...base,
    async batch(statements) {
      for (const s of statements) assertTargetWrite(s.sql);
      if (!statements.length) return [];
      const j = await json(await cf(fetchImpl, token, d1Base(TARGET.id) + "/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batch: statements.map((s) => ({ sql: s.sql, params: s.params || [] })) }) }), "batch");
      return j.result;
    },
  };
}

const KEY_OK = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,298}$/;
function checkKey(key) { if (!KEY_OK.test(key) || key.includes("..") || key.includes("//")) throw new Error("guard: unexpected object key"); return key; }
const objPath = (bucket, key) => `/accounts/${ACCOUNT_ID}/r2/buckets/${bucket}/objects/${encodeURIComponent(checkKey(key))}`;

/** Production file bucket: read only (no put, no delete exists on this object). Resolves to a Buffer, or null when the object is missing. */
export function productionFiles({ token, fetchImpl = fetch } = {}) {
  return {
    role: "source", bucket: SOURCE.filesBucket,
    async get(key) {
      const res = await cf(fetchImpl, token, objPath(SOURCE.filesBucket, key));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`file read failed (HTTP ${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

/** Staging buckets: files and the private backup bucket. Writes go only to these two. */
export function stagingBucket(which, { token, fetchImpl = fetch } = {}) {
  const bucket = which === "backup" ? TARGET.backupBucket : TARGET.filesBucket;
  if (which !== "backup" && which !== "files") throw new Error("unknown Staging bucket");
  return {
    role: "target", bucket,
    async get(key) {
      const res = await cf(fetchImpl, token, objPath(bucket, key));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`file read failed (HTTP ${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },
    async put(key, bytes, contentType = "application/octet-stream") {
      const res = await cf(fetchImpl, token, objPath(bucket, key), { method: "PUT", headers: { "Content-Type": contentType }, body: bytes });
      if (!res.ok) throw new Error(`file write failed (HTTP ${res.status})`);
    },
  };
}
