/**
 * Builds the refresh plan from two read-only views of the databases. It never writes anything. Rules (pinned by worker/test/staging-sync.test.mjs):
 *   - A row missing in Staging is INSERTED. A row identical in both is left alone.
 *   - A Staging row changed since the last refresh and not changed in Production is KEPT (reported as staging-edited).
 *   - A row changed on BOTH sides, or already different with no refresh history (first run), is a CONFLICT: nothing is changed unless that exact row is
 *     approved for overwrite.
 *   - A row copied earlier that has vanished from Production is a DELETION CANDIDATE: nothing is deleted unless that exact row is approved.
 *   - Staging-only rows, Staging-only tables and Staging-only columns are never touched. Only columns present in BOTH databases are copied.
 * The plan carries keys, counts and hashes, never row values.
 */
import { createHash } from "node:crypto";
import { COPIED, EXCLUDED, SYSTEM } from "./tables.mjs";
import { PLACEHOLDER_USER } from "./config.mjs";

export const sha256 = (v) => createHash("sha256").update(v).digest("hex");
const q = (id) => `"${String(id).replace(/"/g, '""')}"`;
export const keyOf = (spec, row) => spec.pk.map((c) => String(row[c])).join("|");
export const rowHash = (row, cols) => sha256(JSON.stringify([...cols].sort().map((c) => [c, row[c] === undefined ? null : row[c]])));

/** Columns, indexes and migration names of a database. */
export async function readSchema(db) {
  const tables = (await db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((r) => r.name);
  const cols = {};
  for (const t of COPIED.map((c) => c.table)) {
    if (!tables.includes(t)) continue;
    cols[t] = (await db.query(`PRAGMA table_info(${q(t)})`)).map((c) => ({ name: c.name, notnull: !!c.notnull, dflt: c.dflt_value, pk: c.pk }));
  }
  let migrations = [];
  if (tables.includes("d1_migrations")) migrations = (await db.query("SELECT name FROM d1_migrations ORDER BY id")).map((r) => r.name);
  return { tables, cols, migrations };
}

async function uniqueIndexes(db, table) {
  const out = [];
  for (const ix of await db.query(`PRAGMA index_list(${q(table)})`)) {
    if (!ix.unique || ix.partial || ix.origin === "pk") continue;
    out.push({ name: ix.name, cols: (await db.query(`PRAGMA index_info(${q(ix.name)})`)).map((c) => c.name) });
  }
  return out;
}

/** Everything that must be true before any plan is meaningful. Returns { checks, blockers, common }. */
export function compareSchemas(src, tgt) {
  const checks = [], blockers = [];
  const add = (status, name, detail) => { checks.push({ status, name, detail }); if (status === "FAIL") blockers.push(`${name}: ${detail}`); };

  const missing = src.migrations.filter((m) => !tgt.migrations.includes(m));
  if (missing.length) add("FAIL", "migrations", `Production has ${missing.length} migration(s) Staging lacks (${missing.join(", ")}); apply them to Staging first`);
  else add("PASS", "migrations", `Staging has all ${src.migrations.length} Production migrations plus ${tgt.migrations.length - src.migrations.length} newer`);

  const unclassified = src.tables.filter((t) => !COPIED.some((c) => c.table === t) && !(t in EXCLUDED) && !SYSTEM.has(t));
  if (unclassified.length) add("FAIL", "classification", `Production table(s) with no copy/exclude decision: ${unclassified.join(", ")}`);
  else add("PASS", "classification", `every Production table is classified (${COPIED.length} copied, ${Object.keys(EXCLUDED).length} excluded)`);

  const common = {}, dropped = {}, stagingOnly = {};
  for (const spec of COPIED) {
    const s = src.cols[spec.table], t = tgt.cols[spec.table];
    if (!s) { add("FAIL", `table:${spec.table}`, "missing in Production"); continue; }
    if (!t) { add("FAIL", `table:${spec.table}`, "missing in Staging"); continue; }
    const tn = new Set(t.map((c) => c.name)), sn = new Set(s.map((c) => c.name));
    common[spec.table] = t.map((c) => c.name).filter((n) => sn.has(n));
    dropped[spec.table] = s.map((c) => c.name).filter((n) => !tn.has(n));
    stagingOnly[spec.table] = t.filter((c) => !sn.has(c.name));
    const unfillable = stagingOnly[spec.table].filter((c) => c.notnull && c.dflt === null && !c.pk).map((c) => c.name);
    if (unfillable.length) add("FAIL", `table:${spec.table}`, `Staging requires column(s) Production does not have and with no default: ${unfillable.join(", ")}`);
    const lost = spec.pk.filter((c) => !common[spec.table].includes(c));
    if (lost.length) add("FAIL", `table:${spec.table}`, `key column(s) not in both: ${lost.join(", ")}`);
  }
  const d = Object.entries(dropped).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.join(", ")}`);
  if (d.length) add("WARN", "columns", `Production-only columns not copied (Staging lacks them): ${d.join("; ")}`);
  const o = Object.entries(stagingOnly).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.map((c) => c.name).join(", ")}`);
  add("PASS", "columns", o.length ? `Staging-only columns keep their Staging values/defaults: ${o.join("; ")}` : "both databases have the same columns for every copied table");
  return { checks, blockers, common };
}

function transform(spec, row) {
  const r = { ...row };
  for (const c of spec.nullify || []) if (c in r) r[c] = null;
  for (const c of spec.userRefs || []) if (c in r && r[c] !== null) r[c] = PLACEHOLDER_USER.id;
  return r;
}

const diffCols = (a, b, cols) => cols.filter((c) => (a[c] ?? null) !== (b[c] ?? null));

/**
 * @param {object} o { source, target, srcSchema, tgtSchema, manifest, common } - manifest = { tables: { [table]: { [key]: rowHash } } } or null on the first run
 * @returns { plan, work } - plan is JSON-safe; work holds the rows to write (values) and is never serialised.
 */
export async function buildPlan({ source, target, srcSchema, tgtSchema, manifest, common }) {
  const base = manifest?.tables || {};
  const tables = [], work = { inserts: [], updates: [], deletes: [], files: [], newBase: {} };
  const skippedOrgs = new Map(); // org id -> reason
  for (const spec of COPIED) {
    const cols = common[spec.table];
    if (!cols) continue;
    const list = cols.map(q).join(", ");
    const [srcRows, tgtRows, uniques] = await Promise.all([
      source.query(`SELECT ${list} FROM ${q(spec.table)}`),
      target.query(`SELECT ${list} FROM ${q(spec.table)}`),
      uniqueIndexes(target, spec.table),
    ]);
    const tgtByKey = new Map(tgtRows.map((r) => [keyOf(spec, r), r]));
    const baseT = base[spec.table] || {};
    const t = { table: spec.table, source: srcRows.length, target: tgtRows.length, insert: [], update: [], overwritable: [], unchanged: 0, stagingEdited: [], conflicts: [], deletionCandidates: [], stagingOnly: 0, skipped: 0 };
    const srcKeys = new Set();
    const newBase = {};
    const incoming = []; // rows that would be written, for the unique check

    for (const raw of srcRows) {
      if (spec.org && skippedOrgs.has(raw[spec.org])) { t.skipped++; continue; }
      const row = transform(spec, raw);
      const key = keyOf(spec, row);
      srcKeys.add(key);
      const srcHash = rowHash(row, cols);
      const cur = tgtByKey.get(key);
      const baseHash = baseT[key];
      if (!cur) { t.insert.push(key); incoming.push({ key, row, kind: "insert", srcHash }); continue; }
      const curHash = rowHash(cur, cols);
      if (curHash === srcHash) { t.unchanged++; newBase[key] = srcHash; continue; }
      const columns = diffCols(cur, row, cols);
      if (baseHash && curHash === baseHash) { t.update.push(key); incoming.push({ key, row, kind: "update", srcHash }); continue; }
      if (baseHash && srcHash === baseHash) { t.stagingEdited.push({ key, columns }); newBase[key] = baseHash; continue; }
      t.conflicts.push({ key, columns, why: baseHash ? "changed in both Production and Staging" : "differs and there is no refresh history for this row" });
      t.overwritable.push(key);
      newBase[key] = baseHash; // unchanged until someone decides
      work.updates.push({ spec, key, row, srcHash, conflict: true, cols });
    }
    // rows copied earlier that Production no longer has
    for (const [key, h] of Object.entries(baseT)) {
      if (srcKeys.has(key)) continue;
      const cur = tgtByKey.get(key);
      if (cur) { t.deletionCandidates.push(key); work.deletes.push({ spec, key, row: cur }); newBase[key] = h; }
    }
    t.stagingOnly = tgtRows.filter((r) => !srcKeys.has(keyOf(spec, r)) && !(keyOf(spec, r) in baseT)).length;

    // Unique-index collisions: against Staging rows that are staying put, and between incoming rows.
    const replaced = new Set(incoming.map((i) => i.key));
    for (const ix of uniques.filter((u) => u.cols.every((c) => cols.includes(c)))) {
      const seen = new Map();
      for (const r of tgtRows) { const k = keyOf(spec, r); if (replaced.has(k) || t.insert.includes(k)) continue; const v = ix.cols.map((c) => r[c]); if (v.some((x) => x === null)) continue; seen.set(JSON.stringify(v), k); }
      for (const i of [...incoming]) {
        const v = ix.cols.map((c) => i.row[c]);
        if (v.some((x) => x === null)) continue;
        const sig = JSON.stringify(v);
        if (seen.has(sig) && seen.get(sig) !== i.key) {
          incoming.splice(incoming.indexOf(i), 1);
          (i.kind === "insert" ? t.insert : t.update).splice((i.kind === "insert" ? t.insert : t.update).indexOf(i.key), 1);
          t.conflicts.push({ key: i.key, columns: ix.cols, why: `unique value already used by another Staging row (${ix.name})` });
          if (spec.table === "organizations") skippedOrgs.set(i.key, "unique");
        } else seen.set(sig, i.key);
      }
    }
    for (const i of incoming) {
      newBase[i.key] = i.srcHash;
      (i.kind === "insert" ? work.inserts : work.updates).push({ spec, key: i.key, row: i.row, srcHash: i.srcHash, cols });
      if (spec.file && i.row[spec.file.key]) work.files.push({ table: spec.table, key: i.key, objectKey: i.row[spec.file.key], sha256: i.row[spec.file.sha], size: i.row[spec.file.size] });
    }
    // an overwrite of a conflict also needs its file
    for (const c of t.conflicts) { const w = work.updates.find((u) => u.spec === spec && u.key === c.key && u.conflict); if (w && spec.file && w.row[spec.file.key]) w.fileRef = { table: spec.table, key: c.key, objectKey: w.row[spec.file.key], sha256: w.row[spec.file.sha], size: w.row[spec.file.size] }; }
    work.newBase[spec.table] = newBase;
    tables.push(t);
  }

  const plan = {
    version: 1,
    tables,
    skippedOrganizations: [...skippedOrgs.keys()],
    files: work.files.map((f) => ({ table: f.table, key: f.key, size: f.size, sha256: f.sha256, objectKey: f.objectKey })),
    excludedTables: Object.keys(EXCLUDED),
  };
  plan.planSha = planSha(plan, work);
  return { plan, work };
}

/** Identifies exactly what a reviewer saw: keys, actions, row hashes, conflicts, deletion candidates and files - not approvals. */
export function planSha(plan, work) {
  const rows = [...work.inserts, ...work.updates].map((w) => [w.spec.table, w.key, w.srcHash, !!w.conflict]).sort();
  const body = { tables: plan.tables.map((t) => [t.table, t.insert, t.update, t.conflicts.map((c) => c.key), t.stagingEdited.map((c) => c.key), t.deletionCandidates]), rows, files: plan.files, skipped: plan.skippedOrganizations };
  return sha256(JSON.stringify(body));
}

/** Plain-text/markdown report: counts and keys only. */
export function renderReport(plan, pre) {
  const L = [];
  L.push("# Production to Staging refresh: report", "");
  if (pre) { L.push("## Preflight", "", "| Status | Check | Detail |", "| --- | --- | --- |"); for (const c of pre.checks) L.push(`| ${c.status} | ${c.name} | ${c.detail} |`); L.push(""); }
  if (plan) {
    L.push("## Plan (no data has been changed)", "", "| Table | Production | Staging | Insert | Update | Unchanged | Staging-edited (kept) | Conflicts | Deletion candidates | Staging-only |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const t of plan.tables) L.push(`| ${t.table} | ${t.source} | ${t.target} | ${t.insert.length} | ${t.update.length} | ${t.unchanged} | ${t.stagingEdited.length} | ${t.conflicts.length} | ${t.deletionCandidates.length} | ${t.stagingOnly} |`);
    L.push("", `Files to copy: ${plan.files.length} (${plan.files.reduce((n, f) => n + (Number(f.size) || 0), 0)} bytes)`, `Skipped organizations: ${plan.skippedOrganizations.length}`, "");
    const conf = plan.tables.flatMap((t) => t.conflicts.map((c) => `- \`${t.table}:${c.key}\` columns ${c.columns.join(", ")}: ${c.why}`));
    L.push("## Conflicts (nothing is changed for these unless approved)", "", ...(conf.length ? conf : ["None."]), "");
    const del = plan.tables.flatMap((t) => t.deletionCandidates.map((k) => `- \`${t.table}:${k}\``));
    L.push("## Deletion candidates (gone from Production; never deleted without approval)", "", ...(del.length ? del : ["None."]), "");
    const ed = plan.tables.flatMap((t) => t.stagingEdited.map((c) => `- \`${t.table}:${c.key}\` columns ${c.columns.join(", ")}`));
    L.push("## Staging-edited rows kept as they are", "", ...(ed.length ? ed : ["None."]), "", `Plan hash: \`${plan.planSha}\``, "");
  }
  return L.join("\n");
}
