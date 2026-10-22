/**
 * The greeting on the portal's home pages, in ONE place so every page words it the same way. Pure: no request, database or environment access.
 *
 * "Welcome back" is a claim about the past, so it is used only when there is reliable evidence of an earlier visit or of the person's own work
 * (see repo/visits.js). An active session alone is never evidence. A name is used only when it is usable (a real first name, never an email prefix).
 *
 *   name + returning -> "Welcome back, Ann."      name only  -> "Welcome, Ann."
 *   returning only   -> "Welcome back."           neither    -> "Welcome to your portal."
 */

/** The first word of a person's name when it looks like a name, otherwise "". Never derived from an email address. */
export function usableFirstName(name) {
  const first = String(name == null ? "" : name).trim().split(/\s+/)[0] || "";
  return first.length <= 40 && /\p{L}/u.test(first) && !/[@<>]/.test(first) ? first : "";
}

/** @returns {string} plain text: escape it where it is placed in HTML */
export function welcomeText({ name = "", returning = false } = {}) {
  const first = usableFirstName(name);
  if (returning) return first ? `Welcome back, ${first}.` : "Welcome back.";
  return first ? `Welcome, ${first}.` : "Welcome to your portal.";
}

/** The greeting for a view-model: the demonstration (a fictional client with history) counts as returning; a signed-in client only with evidence. */
export const welcomeFor = (vm) => welcomeText({ name: vm.user && vm.user.name, returning: vm.mode === "demo" || Boolean(vm.returning) });
