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
  // Branding (files): everyone in the organization may see and download the published brand and upload their own materials; only owners may delete a shared
  // upload or ask for a quote. Official deliverables and publication belong to Framework Admin alone: there is deliberately no client action for them.
  "branding.view": Object.freeze(["owner", "member"]),
  "branding.upload": Object.freeze(["owner", "member"]),
  "branding.delete_upload": Object.freeze(["owner"]),
  "branding.request": Object.freeze(["owner"]),
  // Brand Discovery (only where PORTAL_DISCOVERY is on): everyone in the organization may fill in and send the assessment Framework assigned to it. Choosing is not ordering anything.
  "discovery.respond": Object.freeze(["owner", "member"]),
  // Website (only where PORTAL_WEBSITE is on): everyone in the organization may see the websites Framework has published for it. Framework Admin alone creates and edits them.
  "website.view": Object.freeze(["owner", "member"]),
  // Asking about an Additional Service (a request, never an order): owners only, like a Branding quote request. Change and support requests use support.view and support.submit.
  "website.request": Object.freeze(["owner"]),
  // Client Services: everyone may open the hub, read the contact details, and send and follow support or change requests (a request never authorizes paid work).
  // Invoices carry financial information: owners only, and read-only (Framework Admin enters, publishes and archives them).
  "services.view": Object.freeze(["owner", "member"]),
  "support.view": Object.freeze(["owner", "member"]),
  "support.submit": Object.freeze(["owner", "member"]),
  "invoices.view": Object.freeze(["owner"]),
  // Requests (Deliverables, SEO, Custom Development, My Requests; only where PORTAL_REQUESTS is on). Anyone in the organization may follow requests, ask for work,
  // reply, upload references and review a design proof (approve it or ask for a revision round). Accepting a quote authorizes paid work, so it is owners only,
  // and it additionally stays closed until Framework's terms exist (requests/quote-gate.js). Only the owner may cancel someone else's request; the repository
  // lets a member cancel their own.
  "requests.view": Object.freeze(["owner", "member"]),
  "requests.submit": Object.freeze(["owner", "member"]),
  "requests.approve_proof": Object.freeze(["owner", "member"]),
  "requests.accept_quote": Object.freeze(["owner"]),
  "seo.keywords": Object.freeze(["owner"]),
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
