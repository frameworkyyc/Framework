/** Input validation for the portal data layer. The database CHECK constraints are the backstop; these give clean errors first. */

export const ROLES = ["owner", "member"];
export const ORG_STATUSES = ["active", "suspended", "archived"];
export const USER_STATUSES = ["active", "disabled"];
export const PROJECT_STATUSES = ["discovery", "design", "build", "review", "live", "maintenance", "paused", "archived"];
export const ACTOR_TYPES = ["client", "admin", "system"];
export const VISIBILITIES = ["client", "internal"];

const CONTROL = /[\u0000-\u001F\u007F\u2028\u2029]/;

export const normalizeEmail = (raw) => {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || CONTROL.test(email) || /\s/.test(email)) return null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return email;
};

export const validateSlug = (raw) => (typeof raw === "string" && raw.length >= 2 && raw.length <= 48 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw) ? raw : null);

/** Single-line text of 1..max characters (no control characters), trimmed. */
export const validateName = (raw, max = 120) => {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  return v.length >= 1 && v.length <= max && !CONTROL.test(v) ? v : null;
};

/** Optional multi-line text up to max characters; null/undefined/"" mean "none". Returns undefined when invalid. */
export const validateText = (raw, max = 2000) => {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const v = raw.trim();
  return v.length <= max && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v) ? v || null : undefined;
};

/** Optional https URL up to 300 characters, no credentials. Returns null for none, undefined when invalid. */
export const validateHttpsUrl = (raw) => {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || raw.length > 300 || /\s/.test(raw) || CONTROL.test(raw)) return undefined;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
};

export const validateEnum = (raw, allowed) => (allowed.includes(raw) ? raw : null);

export const validateKind = (raw) => (typeof raw === "string" && raw.length >= 1 && raw.length <= 40 && /^[a-z0-9_-]+$/.test(raw) ? raw : null);

export const validateAction = (raw) => (typeof raw === "string" && raw.length >= 1 && raw.length <= 60 && /^[a-z0-9._-]+$/.test(raw) ? raw : null);
