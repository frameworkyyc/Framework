/**
 * The Worker's scheduled (Cron Trigger) work, for Production: it runs even when nobody opens the website.
 *   1. Client Services emails: the same sweep Admin page loads and the client Home already run (processNotifications): atomic claim per notice, no duplicate
 *      emails, retries at 1, 4, 9 and 16 minutes, at most 5 attempts. Only when PORTAL_SERVICES is exactly "1" and the portal database is bound.
 *   2. File backup: copies new client files to the second private bucket (file-backup.js). Only when both PORTAL_FILES and PORTAL_FILES_BACKUP are bound.
 * Each task is independent (one failing never stops the other), nothing here throws, and only counts and outcome words are logged (no addresses, keys or names).
 * The schedule itself lives in wrangler.jsonc (`triggers.crons`); Previews (Staging) are never invoked by it.
 */
import { processNotifications } from "./service-notifications.js";
import { backupFiles } from "./file-backup.js";
import { backupPurge, purgeEnabled } from "./backup-purge.js";
import { logEvent } from "./log.js";

export async function runScheduled(env, { now = new Date(), fetch: fetchImpl, log = logEvent } = {}) {
  const out = { notifications: null, backup: null, purge: null };
  if (env && env.PORTAL_SERVICES === "1" && env.PORTAL_DB) {
    try {
      const r = await processNotifications(env, { db: env.PORTAL_DB, now, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
      out.notifications = { sent: r.sent, failed: r.failed, retry: r.retry, skipped: r.skipped, pending: r.pending, configured: r.configured };
      log({ evt: "cron.notify", outcome: r.configured === false ? "not_configured" : "ok", count: r.sent });
    } catch {
      out.notifications = { error: true };
      log({ evt: "cron.notify", outcome: "error" });
    }
  }
  if (env && env.PORTAL_FILES && env.PORTAL_FILES_BACKUP) {
    const r = await backupFiles({ primary: env.PORTAL_FILES, backup: env.PORTAL_FILES_BACKUP });
    out.backup = r;
    log({ evt: "cron.backup", outcome: r.ok ? (r.remaining ? "partial" : "ok") : "error", count: r.copied });
    // 3. Remove the backup copies of files deleted at least 90 days ago. OFF unless PORTAL_BACKUP_PURGE is exactly "1"; skipped on a run that still had files to copy
    // (keeps a run well inside the platform's subrequest limit); never throws.
    if (purgeEnabled(env) && env.PORTAL_DB && r.ok && !r.copied) {
      try {
        const p = await backupPurge({ db: env.PORTAL_DB, primary: env.PORTAL_FILES, backup: env.PORTAL_FILES_BACKUP, now, dryRun: false });
        out.purge = p;
        log({ evt: "cron.purge", outcome: p.ok ? (p.remaining ? "partial" : "ok") : "error", count: p.deleted });
      } catch {
        out.purge = { error: true };
        log({ evt: "cron.purge", outcome: "error" });
      }
    }
  }
  return out;
}
