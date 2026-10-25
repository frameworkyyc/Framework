/**
 * Upload limits. Defaults are the approved initial release (25 MB per file, 50 files and 250 MB per organization); each can be changed by a plain
 * environment variable without a code change. A value that is missing, not a whole number or outside the hard ceiling falls back to the default, so a typo
 * can never remove a limit. The ceilings are what the Worker can safely buffer (see BRANDING-FILES.md).
 */
const MB = 1024 * 1024;

export const DEFAULT_LIMITS = Object.freeze({ maxFileBytes: 25 * MB, maxFiles: 50, quotaBytes: 250 * MB });
export const HARD_CEILING = Object.freeze({ maxFileBytes: 50 * MB, maxFiles: 500, quotaBytes: 2048 * MB });
/** Framework staff may deliver larger files (print-ready packs); clients are held to the client limit. */
export const ADMIN_MAX_FILE_BYTES = 50 * MB;

const read = (raw, fallback, ceiling) => {
  if (typeof raw !== "string" || !/^[1-9]\d{0,12}$/.test(raw.trim())) return fallback;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n <= ceiling ? n : fallback;
};

export function limitsFromEnv(env = {}) {
  return Object.freeze({
    maxFileBytes: read(env.PORTAL_FILES_MAX_FILE_BYTES, DEFAULT_LIMITS.maxFileBytes, HARD_CEILING.maxFileBytes),
    maxFiles: read(env.PORTAL_FILES_MAX_FILES, DEFAULT_LIMITS.maxFiles, HARD_CEILING.maxFiles),
    quotaBytes: read(env.PORTAL_FILES_QUOTA_BYTES, DEFAULT_LIMITS.quotaBytes, HARD_CEILING.quotaBytes),
  });
}
