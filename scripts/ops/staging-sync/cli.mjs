#!/usr/bin/env node
/**
 * Production -> Staging data refresh.   node scripts/ops/staging-sync/cli.mjs <preflight|dry-run|apply> [options]
 *   preflight            identities, migrations, schema, classification (reads schema only)
 *   dry-run              preflight + the full plan; writes plan.json and report.md; changes nothing
 *   apply                needs --plan-sha (from the reviewed dry run), --bookmark, --backup-key, optional --overwrite / --approve-deletions
 *   fetch-manifest / store-manifest / store-backup   (workflow helpers, Staging backup bucket only)
 * Options: --manifest <file> (previous refresh record; absent = first refresh)  --out <dir>  --check-files (read each Production file and compare its SHA-256)
 *          --overwrite table:key,...  --approve-deletions table:key,...  --manifest-out <file>
 * Credentials (environment): PRODUCTION_READ_TOKEN (read only), STAGING_WRITE_TOKEN. Behind a proxy that injects credentials both may be unset.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { SOURCE, TARGET, MANIFEST_KEY } from "./config.mjs";
import { productionDb, stagingDb, productionFiles, stagingBucket } from "./clients.mjs";
import { buildPlan, compareSchemas, readSchema, renderReport, sha256 } from "./plan.mjs";
import { applyPlan } from "./apply.mjs";

export function parseArgs(argv) {
  const [mode, ...rest] = argv; const o = { mode, flags: {} };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
    const k = a.slice(2);
    if (k === "check-files") o.flags[k] = true; else o.flags[k] = rest[++i];
  }
  return o;
}
const list = (s) => new Set(String(s || "").split(",").map((x) => x.trim()).filter(Boolean));

export async function preflight(source, target) {
  const checks = [];
  const add = (status, name, detail) => checks.push({ status, name, detail });
  const [si, ti] = [await source.info(), await target.info()];
  if (si.name !== SOURCE.name || si.uuid !== SOURCE.id) add("FAIL", "source", "the source is not the Production portal database"); else add("PASS", "source", `${SOURCE.name} (read only)`);
  if (ti.name !== TARGET.name || ti.uuid !== TARGET.id) add("FAIL", "target", "the target is not the Staging portal database"); else add("PASS", "target", `${TARGET.name}`);
  const [srcSchema, tgtSchema] = [await readSchema(source), await readSchema(target)];
  const cmp = compareSchemas(srcSchema, tgtSchema);
  checks.push(...cmp.checks);
  const blockers = checks.filter((c) => c.status === "FAIL").map((c) => `${c.name}: ${c.detail}`);
  return { checks, blockers, srcSchema, tgtSchema, common: cmp.common };
}

/** Private-bucket helpers for the workflow: the refresh record and the pre-apply backup live ONLY in the Staging backup bucket (never a GitHub artifact). */
async function bucketJob(mode, flags, env, io) {
  const backup = stagingBucket("backup", { token: env.STAGING_WRITE_TOKEN });
  if (mode === "fetch-manifest") {
    const b = await backup.get(MANIFEST_KEY);
    if (b) writeFileSync(flags.file, b);
    io.log(b ? "previous refresh record found" : "no previous refresh record: this is a first refresh, so every difference is reported as a conflict");
    return 0;
  }
  if (mode === "store-manifest") { await backup.put(MANIFEST_KEY, readFileSync(flags.file), "application/json"); io.log("refresh record stored"); return 0; }
  if (!/^staging-sync\/backups\/[A-Za-z0-9._-]{8,100}$/.test(flags["backup-key"] || "")) throw new Error("backup key must be staging-sync/backups/<name>");
  await backup.put(flags["backup-key"], readFileSync(flags.file), "application/sql");
  io.log("backup stored in the private Staging backup bucket");
  return 0;
}

export async function main(argv, env = process.env, io = { log: console.log }) {
  const { mode, flags } = parseArgs(argv);
  if (["fetch-manifest", "store-manifest", "store-backup"].includes(mode)) return bucketJob(mode, flags, env, io);
  if (!["preflight", "dry-run", "apply"].includes(mode)) throw new Error("mode must be preflight, dry-run, apply, fetch-manifest, store-manifest or store-backup");
  const source = productionDb({ token: env.PRODUCTION_READ_TOKEN });
  const target = stagingDb({ token: env.STAGING_WRITE_TOKEN });
  const out = flags.out || "staging-sync-out";
  mkdirSync(out, { recursive: true });
  const pre = await preflight(source, target);
  if (mode === "preflight" || pre.blockers.length) {
    writeFileSync(`${out}/report.md`, renderReport(null, pre));
    io.log(renderReport(null, pre));
    return pre.blockers.length ? 1 : 0;
  }
  const manifest = flags.manifest && existsSync(flags.manifest) ? JSON.parse(readFileSync(flags.manifest, "utf8")) : null;
  if (mode === "dry-run") {
    const { plan, work } = await buildPlan({ source, target, srcSchema: pre.srcSchema, tgtSchema: pre.tgtSchema, manifest, common: pre.common });
    if (flags["check-files"]) {
      const files = productionFiles({ token: env.PRODUCTION_READ_TOKEN });
      const bad = [];
      for (const f of work.files) { const b = await files.get(f.objectKey); if (!b) bad.push(`${f.table}:${f.key} missing`); else if (f.sha256 && sha256(b) !== f.sha256) bad.push(`${f.table}:${f.key} checksum differs`); }
      pre.checks.push({ status: bad.length ? "WARN" : "PASS", name: "files", detail: bad.length ? `${bad.length} problem(s): ${bad.join(", ")}` : `${work.files.length} Production file(s) readable and match their recorded SHA-256` });
    } else pre.checks.push({ status: "WARN", name: "files", detail: "not checked (run with --check-files in the workflow, which has the file-read credential)" });
    writeFileSync(`${out}/plan.json`, JSON.stringify(plan, null, 2));
    writeFileSync(`${out}/report.md`, renderReport(plan, pre));
    io.log(renderReport(plan, pre));
    return 0;
  }
  // apply
  if (!flags["plan-sha"]) throw new Error("--plan-sha is required");
  const result = await applyPlan({
    source, target,
    files: { src: productionFiles({ token: env.PRODUCTION_READ_TOKEN }), dst: stagingBucket("files", { token: env.STAGING_WRITE_TOKEN }) },
    backup: stagingBucket("backup", { token: env.STAGING_WRITE_TOKEN }),
    manifest, overwrite: list(flags.overwrite), approveDeletions: list(flags["approve-deletions"]),
    expectedSha: flags["plan-sha"], bookmark: flags.bookmark, backupKey: flags["backup-key"],
  });
  if (flags["manifest-out"]) writeFileSync(flags["manifest-out"], JSON.stringify(result.manifest));
  io.log(JSON.stringify({ ok: result.ok, problems: result.problems, summary: result.summary, files: result.files, planSha: result.planSha, manifestKey: MANIFEST_KEY }, null, 2));
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error("FAILED:", String(e.message).slice(0, 500)); process.exit(1); });
}
