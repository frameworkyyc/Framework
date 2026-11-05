/**
 * Applies a reviewed plan to STAGING. Order, each step a gate for the next:
 *   1. rebuild the plan from fresh reads and require it to equal the approved plan hash (data that moved since the review stops the run);
 *   2. approvals must name real conflicts / deletion candidates; a restore bookmark and a backup object that actually exists are required;
 *   3. copy the files (verified against the recorded SHA-256) before any row points at them;
 *   4. ONE atomic D1 batch of allow-listed writes (all or nothing);
 *   5. re-read and verify: nothing left to do, foreign keys clean, protected tables (sessions, invitations, memberships, notification queue...) unchanged.
 * Production is only ever read.
 */
import { randomUUID } from "node:crypto";
import { COPIED, MUST_NOT_CHANGE } from "./tables.mjs";
import { PLACEHOLDER_USER } from "./config.mjs";
import { buildPlan, compareSchemas, readSchema, sha256 } from "./plan.mjs";

const q = (id) => `"${String(id).replace(/"/g, '""')}"`;
const where = (spec) => spec.pk.map((c) => `${q(c)} = ?`).join(" AND ");
const pkVals = (spec, row) => spec.pk.map((c) => row[c]);

async function counts(target, tables) {
  const out = {};
  for (const t of tables) { try { out[t] = (await target.query(`SELECT count(*) AS n FROM ${q(t)}`))[0].n; } catch { out[t] = null; } }
  return out;
}

export async function applyPlan({ source, target, files, backup, manifest, overwrite = new Set(), approveDeletions = new Set(), expectedSha, bookmark, backupKey, now = () => new Date().toISOString() }) {
  if (!expectedSha) throw new Error("apply needs the approved plan hash");
  if (!bookmark || !String(bookmark).trim()) throw new Error("apply needs the Staging restore bookmark recorded before the run");
  if (!backupKey) throw new Error("apply needs the backup object key");

  const [srcSchema, tgtSchema] = [await readSchema(source), await readSchema(target)];
  const cmp = compareSchemas(srcSchema, tgtSchema);
  if (cmp.blockers.length) throw new Error("preflight blockers: " + cmp.blockers.join(" | "));
  const { plan, work } = await buildPlan({ source, target, srcSchema, tgtSchema, manifest, common: cmp.common });
  if (plan.planSha !== expectedSha) throw new Error("the data changed since this plan was reviewed; run the dry run again and approve the new plan hash");

  const overwritable = new Set(plan.tables.flatMap((t) => t.overwritable.map((k) => `${t.table}:${k}`)));
  const deletable = new Set(plan.tables.flatMap((t) => t.deletionCandidates.map((k) => `${t.table}:${k}`)));
  for (const k of overwrite) if (!overwritable.has(k)) throw new Error(`overwrite approval ${k} is not a current conflict`);
  for (const k of approveDeletions) if (!deletable.has(k)) throw new Error(`deletion approval ${k} is not a current deletion candidate`);

  const backupObj = await backup.get(backupKey);
  if (!backupObj || !backupObj.length) throw new Error("the backup object is missing or empty; take the backup first");

  const watch = [...MUST_NOT_CHANGE, "portal_users"];
  const before = await counts(target, watch);

  // 3. files first
  const toWrite = [
    ...work.inserts, ...work.updates.filter((u) => !u.conflict),
    ...work.updates.filter((u) => u.conflict && overwrite.has(`${u.spec.table}:${u.key}`)),
  ];
  const fileRefs = [];
  for (const w of toWrite) { const f = w.spec.file; if (f && w.row[f.key]) fileRefs.push({ table: w.spec.table, key: w.key, objectKey: w.row[f.key], sha256: w.row[f.sha] }); }
  const fileResult = { copied: 0, alreadyThere: 0, missing: [], mismatch: [] };
  for (const f of fileRefs) {
    const bytes = await files.src.get(f.objectKey);
    if (!bytes) { fileResult.missing.push(`${f.table}:${f.key}`); continue; }
    if (f.sha256 && sha256(bytes) !== f.sha256) { fileResult.mismatch.push(`${f.table}:${f.key}`); continue; }
    const existing = await files.dst.get(f.objectKey);
    if (existing && sha256(existing) === sha256(bytes)) { fileResult.alreadyThere++; continue; }
    await files.dst.put(f.objectKey, bytes);
    fileResult.copied++;
  }

  // 4. one atomic batch
  const stmts = [];
  const stamp = now();
  stmts.push({ sql: "INSERT OR IGNORE INTO portal_users (id, workos_user_id, email, name, status, disabled_at) VALUES (?, ?, ?, ?, 'disabled', ?)", params: [PLACEHOLDER_USER.id, PLACEHOLDER_USER.workos_user_id, PLACEHOLDER_USER.email, PLACEHOLDER_USER.name, stamp] });
  const wr = (w, kind) => {
    const cols = w.cols;
    if (kind === "insert") return { sql: `INSERT INTO ${q(w.spec.table)} (${cols.map(q).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, params: cols.map((c) => w.row[c] ?? null) };
    const set = cols.filter((c) => !w.spec.pk.includes(c));
    return { sql: `UPDATE ${q(w.spec.table)} SET ${set.map((c) => `${q(c)} = ?`).join(", ")} WHERE ${where(w.spec)}`, params: [...set.map((c) => w.row[c] ?? null), ...pkVals(w.spec, w.row)] };
  };
  for (const w of work.inserts) stmts.push(wr(w, "insert"));
  for (const w of work.updates) if (!w.conflict || overwrite.has(`${w.spec.table}:${w.key}`)) stmts.push(wr(w, "update"));
  const approvedDeletes = work.deletes.filter((d) => approveDeletions.has(`${d.spec.table}:${d.key}`));
  for (const d of [...approvedDeletes].sort((a, b) => COPIED.indexOf(b.spec) - COPIED.indexOf(a.spec))) stmts.push({ sql: `DELETE FROM ${q(d.spec.table)} WHERE ${where(d.spec)}`, params: pkVals(d.spec, d.row) });
  const summary = Object.fromEntries(plan.tables.map((t) => [t.table, { insert: t.insert.length, update: t.update.length, overwritten: [...overwrite].filter((k) => k.startsWith(t.table + ":")).length, deleted: approvedDeletes.filter((d) => d.spec.table === t.table).length }]));
  stmts.push({ sql: "INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, detail, visibility, created_at) VALUES (?, NULL, 'system', 'staging-sync', 'staging.sync.applied', 'staging_sync', ?, 'internal', ?)", params: [randomUUID(), JSON.stringify({ planSha: plan.planSha, bookmark: String(bookmark).slice(0, 80), summary }).slice(0, 1900), stamp] });
  await target.batch(stmts);

  // new manifest = what was just reviewed and written
  const next = { version: 1, syncedAt: stamp, planSha: plan.planSha, tables: {} };
  for (const spec of COPIED) {
    const m = { ...(work.newBase[spec.table] || {}) };
    for (const w of work.updates) if (w.spec === spec && w.conflict && overwrite.has(`${spec.table}:${w.key}`)) m[w.key] = w.srcHash;
    for (const d of approvedDeletes) if (d.spec === spec) delete m[d.key];
    for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
    next.tables[spec.table] = m;
  }

  // 5. verify
  const after = await counts(target, watch);
  const problems = [];
  for (const t of MUST_NOT_CHANGE) if (before[t] !== after[t]) problems.push(`${t} changed (${before[t]} -> ${after[t]})`);
  if (after.portal_users !== null && after.portal_users - before.portal_users > 1) problems.push("portal_users gained more than the placeholder");
  const fk = await target.query("PRAGMA foreign_key_check");
  if (fk.length) problems.push(`${fk.length} foreign key violation(s)`);
  const again = await buildPlan({ source, target, srcSchema: await readSchema(source), tgtSchema: await readSchema(target), manifest: next, common: cmp.common });
  const left = again.plan.tables.reduce((n, t) => n + t.insert.length + t.update.length, 0);
  if (left) problems.push(`${left} row(s) still differ after the apply`);
  return { ok: problems.length === 0, problems, summary, files: fileResult, manifest: next, planSha: plan.planSha };
}
