/* Framework Admin — Leads: small shared pieces (status words, chips, links, error wording, tabs). Server text is only ever set as text. */

import { h } from "./ui.js";
import { badge } from "./kit.js";

export const STATUSES = Object.freeze([["new", "New"], ["approved", "Approved"], ["ready", "Ready to send"], ["contacted", "Contacted"], ["replied", "Replied"], ["won", "Won"], ["dismissed", "Dismissed"]]);
export const statusWord = (s) => (STATUSES.find(([id]) => id === s) || [s, s || ""])[1];
const TONE = { new: "pending", approved: "pending", ready: "warn", contacted: "ok", replied: "ok", won: "ok", dismissed: "" };
export const statusChip = (lead) => badge(lead.opted_out ? "Opted out" : statusWord(lead.status), lead.opted_out ? "bad" : TONE[lead.status] || "");

/** The list filter the person last chose, so Back from a lead returns to the same list. */
export const view = { status: null, q: "" };

export const SITE_WORDS = { none: "No website", social_only: "Facebook page only", offline: "Website is offline", broken: "Reported offline, not confirmed", unverified: "Not verified (may be protected)", online: "Website is online", outdated: "Outdated website", ok: "Website looks fine" };
/** Chip tone per website status: only a confirmed offline site is a warning; "not verified" and "not confirmed" are neutral, never alarming. */
export const SITE_TONE = { none: "warn", offline: "warn", broken: "pending", unverified: "pending", online: "ok" };

/** Only http(s) addresses are ever made into links. */
export const safeUrl = (u) => (typeof u === "string" && /^https?:\/\/[^\s]+$/i.test(u) ? u : null);
export const shortUrl = (u) => String(u || "").replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
export const extLink = (href, text, cls = "adm-link") => (safeUrl(href) ? h("a", { class: cls, href, target: "_blank", rel: "noopener noreferrer", text }) : null);

export const stars = (rating, reviews) => (typeof rating === "number" && rating > 0 ? `${rating.toFixed(1)}★` + (reviews ? ` · ${reviews} reviews` : "") : "");
export const words = (t) => (String(t || "").trim().match(/\S+/g) || []).length;

const CODES = {
  pricing_in_first_email: "The first email mentions pricing, a price word or “free”. Take it out; first emails must not include it.",
  not_set_up: "Leads isn’t set up yet: migration 0022 has not been applied.",
  writes_disabled: "Changes are switched off on this site.",
  network: "Can’t reach the server. Nothing was changed.",
  session: "Your session has ended. Reload the page to sign in again.",
  denied: "This account isn’t allowed to do that.",
  not_found: "That lead or message no longer exists.",
  no_eligible_email: "There is no email address you can send to yet.",
  hash_mismatch: "The email changed after you reviewed it. Review it again.",
  not_approved: "The email isn’t approved.",
  sending_off: "Sending is turned off.",
  sending_disabled: "Sending is turned off.",
  suppressed: "That address has opted out or bounced.",
  already_sent: "Already sent.",
  quota: "Too many in one go.",
  unavailable: "The database is unavailable just now.",
};
/** Plain wording for a failure code from the API (never raw server text). */
export function errText(err) {
  const code = (err && (err.code || (err.data && err.data.error))) || "error";
  return CODES[code] || `That didn’t complete (${String(code).replace(/_/g, " ")}). Nothing was changed.`;
}
export const codeText = (code) => (code ? CODES[code] || String(code).replace(/_/g, " ") : "Failed");

/** Leads | Activity tabs. */
export const leadsTabs = (active) => h("nav", { class: "adm-tabs", "aria-label": "Leads" },
  h("ul", null, [["leads", "Leads", "/admin/leads"], ["activity", "Activity", "/admin/leads/activity"]].map(([id, label, href]) => h("li", null, h("a", { class: "adm-tab", href, "data-link": "", "aria-current": id === active ? "page" : null, text: label })))));

export async function copyText(text, btn, label = "Copy link", fallback) {
  try { await navigator.clipboard.writeText(text); btn.textContent = "Copied"; window.setTimeout(() => { btn.textContent = label; }, 2000); }
  catch { if (fallback) { fallback.hidden = false; fallback.value = text; fallback.focus(); fallback.select(); } }
}
