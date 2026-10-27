/**
 * Backup of the private client-file bucket (PORTAL_FILES) to a second private bucket (PORTAL_FILES_BACKUP), run by the Worker's scheduled handler.
 *
 *  - COPY ONLY. Nothing is ever deleted or overwritten in either bucket by this code: an object missing from the backup, or present with a different size or
 *    etag, is (re)copied from the primary; objects only in the backup are left alone, so a deletion in the primary can never remove the backup copy.
 *  - Keys are copied unchanged (`org/<organization id>/<area>/<uuid>`: no client text in any key) together with their content type and metadata. The backup
 *    bucket must be private, with no public access and no custom domain, exactly like the primary.
 *  - Bounded: at most `limit` copies per run (R2 operations count against the Worker's subrequest limit), so a large backlog is worked off over several runs.
 *  - Never throws and never logs a key or a name: it returns counts only.
 *  - With no backup binding it does nothing (Staging has none), and it refuses to run if the two bindings are the same bucket.
 * Restoring (restoreFiles) is the same copy in the other direction and only ever FILLS GAPS: an object missing from the primary is copied back from the backup; an object that
 * exists in the primary is never touched, even if it differs (the primary is the live truth). Keys are unchanged, so the database rows keep working.
 * backupStatus counts both sides. All three are used by Admin -> Branding -> Storage (admin-branding.js) and the first two by the scheduled handler.
 */

const PAGE = 1000;
/** The Admin storage/backup checks' own corner (organization id all zeros): never a real client's, so a normal backup, status or restore ignores it. */
export const RESERVED_PREFIX = "org/00000000-0000-4000-8000-000000000000/";

async function listAll(bucket, prefix = "") {
  const out = new Map();
  let cursor;
  do {
    const page = await bucket.list({ limit: PAGE, cursor, ...(prefix ? { prefix } : {}) });
    for (const o of page.objects) if (prefix.startsWith(RESERVED_PREFIX) || !o.key.startsWith(RESERVED_PREFIX)) out.set(o.key, { size: o.size, etag: o.etag || null });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

const differs = (a, b) => a.size !== b.size || Boolean(a.etag && b.etag && a.etag !== b.etag);

/** Copies objects from `from` to `to`: those missing in `to` and, when `overwriteDifferent`, those that differ. Bounded, counts only, never deletes, never throws. */
async function copyAcross({ from, to, limit, prefix, overwriteDifferent }) {
  const result = { ok: true, checked: 0, copied: 0, failed: 0, remaining: 0 };
  try {
    const [src, dst] = [await listAll(from, prefix), await listAll(to, prefix)];
    result.checked = src.size;
    const todo = [...src].filter(([key, o]) => { const b = dst.get(key); return !b || (overwriteDifferent && differs(o, b)); }).map(([key]) => key).sort();
    for (const key of todo) {
      if (result.copied + result.failed >= limit) { result.remaining = todo.length - result.copied - result.failed; break; }
      try {
        const obj = await from.get(key);
        if (!obj) continue; // deleted since the listing: nothing to copy
        const put = await to.put(key, obj.body, { httpMetadata: obj.httpMetadata, customMetadata: obj.customMetadata });
        if (put && typeof put.size === "number" && put.size !== obj.size) throw new Error("size");
        result.copied++;
      } catch {
        result.failed++;
      }
    }
    if (result.failed) result.ok = false;
  } catch {
    result.ok = false;
    result.failed++;
  }
  return result;
}

/** Primary -> backup: new objects, and changed ones are copied again. @returns {Promise<{ok: boolean, skipped?: string, checked: number, copied: number, failed: number, remaining: number}>} */
export async function backupFiles({ primary, backup, limit = 20, prefix = "" } = {}) {
  const none = { ok: true, checked: 0, copied: 0, failed: 0, remaining: 0 };
  if (!primary) return { ...none, skipped: "no_primary" };
  if (!backup) return { ...none, skipped: "no_backup" };
  if (primary === backup) return { ...none, ok: false, skipped: "same_bucket" };
  return copyAcross({ from: primary, to: backup, limit, prefix, overwriteDifferent: true });
}

/** Backup -> primary: ONLY objects missing from the primary. An object that exists in the primary is never overwritten. */
export async function restoreFiles({ primary, backup, limit = 20, prefix = "" } = {}) {
  const none = { ok: true, checked: 0, copied: 0, failed: 0, remaining: 0 };
  if (!primary) return { ...none, skipped: "no_primary" };
  if (!backup) return { ...none, skipped: "no_backup" };
  if (primary === backup) return { ...none, ok: false, skipped: "same_bucket" };
  return copyAcross({ from: backup, to: primary, limit, prefix, overwriteDifferent: false });
}

/** Counts only: how many objects each side holds and what is missing where. */
export async function backupStatus({ primary, backup, prefix = "" } = {}) {
  if (!primary || !backup || primary === backup) return { ok: false, configured: false };
  try {
    const [p, b] = [await listAll(primary, prefix), await listAll(backup, prefix)];
    let missingFromBackup = 0, changed = 0, missingFromPrimary = 0;
    for (const [k, o] of p) { const x = b.get(k); if (!x) missingFromBackup++; else if (differs(o, x)) changed++; }
    for (const k of b.keys()) if (!p.has(k)) missingFromPrimary++;
    return { ok: true, configured: true, primary: p.size, backup: b.size, missingFromBackup, changed, missingFromPrimary };
  } catch {
    return { ok: false, configured: true };
  }
}
