/**
 * Portal feedback: tenant-owned messages from signed-in clients. Every write takes the organization id (from the membership lookup) and the user id
 * (from the session); neither comes from the form. All input is validated here; `page` must be one of the fixed section keys below.
 */
import { newId, isoTime, requireOrgId, requireUserId, ok, fail } from "./common.js";
import { PROFILE_STEPS } from "../profile-schema.js";

export const FEEDBACK_KINDS = Object.freeze([["problem", "Problem"], ["suggestion", "Suggestion"], ["other", "Other"]]);
export const MAX_MESSAGE = 2000;
export const HOURLY_LIMIT = 10; // per person: a gentle cap on top of the per-network limiter

/** Where feedback can be about. Keys are stored; labels are shown. */
export const FEEDBACK_PAGES = Object.freeze([
  ["home", "Home"], ["profile", "Business Profile"],
  ...PROFILE_STEPS.map((s) => [`profile-${s.id}`, `Business Profile: ${s.title}`]),
  ["branding", "Branding"], ["website", "Website"], ["marketing", "Marketing"], ["content", "Content & Photography"], ["files", "Files & Deliverables"],
  ["progress", "Progress"], ["projects", "Projects"], ["activity", "Activity"], ["documents", "Documents"], ["account", "Account"], ["team", "Team"],
]);
const PAGE_KEYS = new Set(FEEDBACK_PAGES.map(([k]) => k));
export const pageLabel = (key) => (FEEDBACK_PAGES.find(([k]) => k === key) || [null, null])[1];
export const validPageKey = (v) => (typeof v === "string" && PAGE_KEYS.has(v) ? v : null);

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** @returns {{values:{kind,message,page}, errors:Record<string,string>}} */
export function validateFeedback(input) {
  const b = input && typeof input === "object" ? input : {};
  const errors = {};
  const kind = typeof b.kind === "string" ? b.kind : "";
  if (!FEEDBACK_KINDS.some(([k]) => k === kind)) errors.kind = "Choose what kind of feedback this is.";
  const raw = typeof b.message === "string" ? b.message.replace(/\r\n?/g, "\n") : "";
  const message = raw.trim();
  if (!message) errors.message = "Write a message so we know what to look at.";
  else if (message.length > MAX_MESSAGE) errors.message = `Please keep your message under ${MAX_MESSAGE} characters.`;
  else if (CONTROL.test(message)) errors.message = "Please use plain text.";
  let page = "";
  if (b.page !== undefined && b.page !== null && b.page !== "") {
    if (validPageKey(b.page)) page = b.page;
    else errors.page = "Choose a page from the list, or leave it blank.";
  }
  return { values: { kind, message: raw.slice(0, MAX_MESSAGE + 1), page }, errors };
}

/**
 * Store one message. @returns ok() | fail("invalid", {errors, values}) | fail("too_many")
 * The audit entry records that feedback was sent, never what it said.
 */
export async function submitPortalFeedback(db, organizationId, userId, input, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  requireUserId(userId);
  const { values, errors } = validateFeedback(input);
  if (Object.keys(errors).length) return fail("invalid", { errors, values });
  const since = isoTime(new Date(now.getTime() - 3600000));
  const recent = await db.prepare("SELECT count(*) AS n FROM portal_feedback WHERE organization_id = ? AND user_id = ? AND created_at > ?").bind(organizationId, userId, since).first();
  if (recent && recent.n >= HOURLY_LIMIT) return fail("too_many");
  const id = newId();
  const t = isoTime(now);
  await db.batch([
    db.prepare("INSERT INTO portal_feedback (id, organization_id, user_id, kind, message, page, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, organizationId, userId, values.kind, values.message.trim(), values.page || null, t),
    db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) VALUES (?, ?, 'client', ?, 'feedback.submitted', 'feedback', ?, ?, 'internal', ?)").bind(newId(), organizationId, userId, id, JSON.stringify({ kind: values.kind }), t),
  ]);
  return ok({ id });
}
