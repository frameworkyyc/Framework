/**
 * Deletion-aware handling of the backup bucket (PORTAL_FILES_BACKUP), added for the privacy promise "the backup copy of a deleted file is removed within 90 days".
 *
 * Two safeguards, both decided from the DATABASE, never from object age or name alone:
 *   backupPurge       removes a backup copy only when ALL of these hold: the object is in the backup but NOT in the main bucket; every database row that points to its key is a
 *                     tombstone (deleted_at set) and the newest one is at least `graceDays` (90) old; and the key is not in the reserved test corner. Anything else is kept:
 *                     a key a live row points to (protected: it is how a lost file is recovered), a key no row points to (unreferenced: left for a human), a young tombstone (waiting).
 *                     It fails closed: if the database cannot be read, nothing is deleted. It is a DRY RUN unless the caller passes dryRun: false, and the Worker only does that when
 *                     the owner has switched PORTAL_BACKUP_PURGE to "1" (off by default). Bounded per run; counts only, never a key or a name.
 *   restorableKeys    the filter "Restore missing files" uses: a missing file is copied back only if a LIVE row still points to it, so a file that was deliberately deleted is
 *                     never brought back (and neither is an object nothing refers to).
 * Invoice files and request attachments have no delete: any row pointing to their key counts as live.
 * file-backup.js stays copy-only (its own test pins that it has no delete call); the only delete is here.
 */
import { RESERVED_PREFIX } from "./file-backup.js";

export const PURGE_GRACE_DAYS = 90;
export const PURGE_LIMIT = 10;
const DAY = 86400000;
const CHUNK = 20; // 4 tables x 20 keys = 80 bound values, under D1's 100 limit
const PAGE = 1000;
const LOOKUP = "SELECT storage_key, deleted_at FROM brand_assets WHERE storage_key IN (%) UNION ALL SELECT storage_key, deleted_at FROM brand_uploads WHERE storage_key IN (%) UNION ALL SELECT storage_key, NULL FROM invoices WHERE storage_key IN (%) UNION ALL SELECT storage_key, NULL FROM support_attachments WHERE storage_key IN (%)";

export const purgeEnabled = (env) => Boolean(env) && env.PORTAL_BACKUP_PURGE === "1";

async function listKeys(bucket) {
  const out = new Set();
  let cursor;
  do {
    const page = await bucket.list({ limit: PAGE, cursor });
    for (const o of page.objects) if (!o.key.startsWith(RESERVED_PREFIX)) out.add(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** Map key -> array of deleted_at values (null = a live row) from every table that can point at a stored file. Throws if the database cannot answer. */
async function rowsFor(db, keys) {
  const found = new Map();
  for (let i = 0; i < keys.length; i += CHUNK) {
    const part = keys.slice(i, i + CHUNK);
    const marks = part.map(() => "?").join(",");
    const res = await db.prepare(LOOKUP.replaceAll("%", marks)).bind(...part, ...part, ...part, ...part).all();
    for (const r of res.results) { if (!found.has(r.storage_key)) found.set(r.storage_key, []); found.get(r.storage_key).push(r.deleted_at ?? null); }
  }
  return found;
}

/** Which of `keys` a LIVE row still points to. Used as the restore filter. Throws if the database cannot answer (the caller then restores nothing). */
export async function restorableKeys(db, keys) {
  const rows = await rowsFor(db, keys);
  return new Set(keys.filter((k) => (rows.get(k) || []).some((d) => d === null)));
}

/** @returns {Promise<{ok:boolean, dryRun:boolean, skipped?:string, orphans:number, eligible:number, deleted:number, waiting:number, protected:number, unreferenced:number, failed:number, remaining:number}>} */
export async function backupPurge({ db, primary, backup, now = new Date(), graceDays = PURGE_GRACE_DAYS, limit = PURGE_LIMIT, dryRun = true } = {}) {
  const r = { ok: true, dryRun: dryRun !== false, orphans: 0, eligible: 0, deleted: 0, waiting: 0, protected: 0, unreferenced: 0, failed: 0, remaining: 0 };
  if (!db || !primary || !backup) return { ...r, skipped: "not_configured" };
  if (primary === backup) return { ...r, ok: false, skipped: "same_bucket" };
  if (!(graceDays >= 1)) return { ...r, ok: false, skipped: "invalid_grace" };
  try {
    const cutoff = new Date(now.getTime() - graceDays * DAY).toISOString();
    const [inPrimary, inBackup] = [await listKeys(primary), await listKeys(backup)];
    const orphans = [...inBackup].filter((k) => !inPrimary.has(k)).sort();
    r.orphans = orphans.length;
    const rows = await rowsFor(db, orphans);
    const eligible = [];
    for (const key of orphans) {
      const marks = rows.get(key);
      if (!marks || !marks.length) r.unreferenced++;
      else if (marks.some((d) => d === null)) r.protected++;
      else if (marks.reduce((a, b) => (a > b ? a : b)) <= cutoff) eligible.push(key);
      else r.waiting++;
    }
    r.eligible = eligible.length;
    if (r.dryRun) { r.remaining = eligible.length; return r; }
    for (const key of eligible) {
      if (r.deleted + r.failed >= limit) break;
      try { await backup.delete(key); r.deleted++; } catch { r.failed++; }
    }
    r.remaining = eligible.length - r.deleted - r.failed;
    if (r.failed) r.ok = false;
  } catch {
    return { ...r, ok: false, deleted: r.deleted, skipped: "database_unreadable" }; // fail closed: an unreadable database never leads to a deletion
  }
  return r;
}
