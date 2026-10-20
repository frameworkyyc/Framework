/**
 * The ONE place portal roles are interpreted (Stage 2A). Authentication alone grants nothing: a request reaches an
 * organization only through an active membership (tenant guard, next stage), and every action is then checked here.
 * Unknown roles, unknown actions and anything that is not an exact string all DENY.
 */
import { ROLES } from "./repo/validate.js";

/** Actions that exist in Stage 2. A new capability is added here on purpose, with its roles, in the same change that implements it. */
const GRANTS = Object.freeze({
  "org.view": Object.freeze(["owner", "member"]),
  "projects.view": Object.freeze(["owner", "member"]),
  "activity.view": Object.freeze(["owner", "member"]),
  "documents.view": Object.freeze(["owner", "member"]),
  "account.view": Object.freeze(["owner", "member"]),
  "members.view": Object.freeze(["owner"]),
  // Business Profile: any active member of the organization may read and edit its answers; the six workspace pages are visible to the same roles.
  "profile.view": Object.freeze(["owner", "member"]),
  "profile.edit": Object.freeze(["owner", "member"]),
  "workspace.view": Object.freeze(["owner", "member"]),
  "feedback.submit": Object.freeze(["owner", "member"]),
});

export const ACTIONS = Object.freeze(Object.keys(GRANTS));
export { ROLES };

export class PortalForbidden extends Error {
  constructor(action) {
    super("forbidden");
    this.name = "PortalForbidden";
    this.code = "forbidden";
    this.action = action;
  }
}

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export function can(role, action) {
  if (typeof role !== "string" || typeof action !== "string") return false;
  if (!own(GRANTS, action)) return false; // also rejects "__proto__", "constructor", "toString", ...
  return GRANTS[action].includes(role);
}

/** Throws PortalForbidden unless the role may perform the action. */
export function requirePermission(role, action) {
  if (!can(role, action)) throw new PortalForbidden(action);
  return true;
}

export const permissionsFor = (role) => ACTIONS.filter((a) => can(role, a));
