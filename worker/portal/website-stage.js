/**
 * Where a website stands, in the client's words: ONE place that turns the stored `status` (existing | in_development | live, migration 0011) and the optional `phase` (migration 0015) into
 * the label shown on the portal Home card, the Website page and in Admin. Pure functions: no database, no DOM.
 *
 *   in_development                 -> In development
 *   in_development + awaiting_feedback  -> Awaiting client feedback
 *   in_development + awaiting_approval  -> Awaiting approval
 *   live                           -> Live
 *   live + maintenance             -> Maintenance
 *   existing                       -> Existing website
 * A pairing that makes no sense (an awaiting phase on a live website, maintenance on one in development) is never stored (PHASES_FOR) and, if it ever were, reads as the plain status.
 * Progress is a different question and has its own rule: only a website being built has a progress bar, computed from its real milestones (milestoneProgress). A live website says Live.
 */

export const STAGES = Object.freeze({
  existing: Object.freeze({ label: "Existing website", tone: "idle", building: false }),
  in_development: Object.freeze({ label: "In development", tone: "active", building: true }),
  awaiting_feedback: Object.freeze({ label: "Awaiting client feedback", tone: "attention", building: true }),
  awaiting_approval: Object.freeze({ label: "Awaiting approval", tone: "attention", building: true }),
  live: Object.freeze({ label: "Live", tone: "live", building: false }),
  maintenance: Object.freeze({ label: "Maintenance", tone: "live", building: false }),
});

/** Which phases each status may carry (an absent phase is always allowed). */
export const PHASES_FOR = Object.freeze({ existing: [], in_development: ["awaiting_feedback", "awaiting_approval"], live: ["maintenance"] });
export const PHASES = Object.freeze(["awaiting_feedback", "awaiting_approval", "maintenance"]);

/** The stage key of a website-like { status, phase }. */
export function stageKeyOf(site) {
  const status = site && site.status;
  if (!Object.hasOwn(PHASES_FOR, status)) return "existing";
  const phase = site.phase;
  return phase && PHASES_FOR[status].includes(phase) ? phase : status;
}
export const stageOf = (site) => { const key = stageKeyOf(site); return { key, ...STAGES[key] }; };

/** Is this (status, phase) pair one the Worker will store? */
export const validPairing = (status, phase) => Object.hasOwn(PHASES_FOR, status) && (phase === null || phase === undefined || PHASES_FOR[status].includes(phase));

/**
 * Progress of a website being built, from its REAL milestones: complete milestones over all of them. No milestones = no bar (nothing is invented). Only an in-development website has one:
 * a live, maintained or existing website shows its status word instead of a permanent 100%.
 * @param {{status: string}} site
 * @param {Array<{status: string}>} milestones
 * @returns {{ show: boolean, percent?: number, done?: number, total?: number, next?: string|null }}
 */
export function milestoneProgress(site, milestones) {
  if (!site || site.status !== "in_development" || !Array.isArray(milestones) || milestones.length === 0) return { show: false };
  const total = milestones.length, done = milestones.filter((m) => m.status === "done").length;
  const next = milestones.find((m) => m.status !== "done");
  return { show: true, percent: Math.round((done / total) * 100), done, total, next: next ? next.title : null };
}
