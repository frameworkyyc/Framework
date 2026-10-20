/**
 * Dashboard module status: ONE place that turns a module's saved data into the progress and required-action indicators shown on the portal Home.
 *
 * Contract (the same for every module, so a future module only adds a calculator below and is presented identically):
 *   { state: "ready", percent: 0..100, done, total, requiredRemaining, actionRequired, complete }
 *   { state: "unavailable" }                       the data could not be read: shown as "Progress unavailable", never as 0%, never with the red indicator
 * No status at all (a module with no calculator, or an inactive "Coming soon" module) means nothing is shown: progress and required actions are never invented.
 *
 * Business Profile uses profileProgress() from profile-schema.js, the SAME function the Profile pages and Framework Admin use. Nothing here recalculates a
 * percentage. "Action required" means REQUIRED information is still missing (the schema's `required` flag): missing optional answers never raise it.
 * Note for reviewers: the existing rule counts a step with no required questions (Online presence) as done only once something is saved in it, so a profile can
 * sit at 86% with nothing required outstanding. That is reported as it is: 86% complete, no red indicator, "Optional details remain".
 */
import { profileProgress } from "./profile-schema.js";

const validPercent = (n) => Number.isInteger(n) && n >= 0 && n <= 100;

/** Calculators keyed by module key. Input is that module's data for ONE organization (already organization-scoped by the caller). */
export const MODULE_STATUS = Object.freeze({
  profile(saved) {
    if (!saved || typeof saved !== "object") return { state: "unavailable" };
    const prog = profileProgress(saved);
    if (!validPercent(prog.percent)) return { state: "unavailable" };
    const requiredRemaining = prog.steps.reduce((n, s) => n + s.missingRequired.length, 0);
    return { state: "ready", percent: prog.percent, done: prog.done, total: prog.total, requiredRemaining, actionRequired: requiredRemaining > 0, complete: prog.percent === 100 };
  },
});

/**
 * @param liveKeys the modules that are live (guided-data.js LIVE_AREAS)
 * @param data { [moduleKey]: that module's data for this organization, or null/undefined when it could not be read }
 * @returns {{ [moduleKey]: status }} only for live modules that have a calculator
 */
export function moduleStatuses(liveKeys, data = {}) {
  const out = {};
  for (const key of liveKeys || []) {
    const calc = Object.prototype.hasOwnProperty.call(MODULE_STATUS, key) ? MODULE_STATUS[key] : null;
    if (calc) out[key] = calc(data[key]);
  }
  return out;
}
