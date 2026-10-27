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
 * Restoring is deliberately manual (copy objects back with the Cloudflare dashboard, rclone or wrangler); see worker/portal/PRODUCTION-ROLLOUT-PLAN.md.
 */

const PAGE = 1000;

async function listAll(bucket) {
  const out = new Map();
  let cursor;
  do {
    const page = await bucket.list({ limit: PAGE, cursor });
    for (const o of page.objects) out.set(o.key, { size: o.size, etag: o.etag || null });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** @returns {Promise<{ok: boolean, skipped?: string, checked: number, copied: number, failed: number, remaining: number}>} */
export async function backupFiles({ primary, backup, limit = 20 } = {}) {
  const result = { ok: true, checked: 0, copied: 0, failed: 0, remaining: 0 };
  if (!primary) return { ...result, skipped: "no_primary" };
  if (!backup) return { ...result, skipped: "no_backup" };
  if (primary === backup) return { ...result, ok: false, skipped: "same_bucket" };
  try {
    const [from, to] = [await listAll(primary), await listAll(backup)];
    result.checked = from.size;
    const todo = [...from].filter(([key, o]) => { const b = to.get(key); return !b || b.size !== o.size || (o.etag && b.etag && o.etag !== b.etag); }).map(([key]) => key).sort();
    for (const key of todo) {
      if (result.copied + result.failed >= limit) { result.remaining = todo.length - result.copied - result.failed; break; }
      try {
        const src = await primary.get(key);
        if (!src) continue; // deleted since the listing: nothing to back up
        const put = await backup.put(key, src.body, { httpMetadata: src.httpMetadata, customMetadata: src.customMetadata });
        if (put && typeof put.size === "number" && put.size !== src.size) throw new Error("size");
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
