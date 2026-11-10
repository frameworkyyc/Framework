/* Framework Admin — Leads: small shared pieces (status words, chips, links, error wording, tabs). Server text is only ever set as text. */

import { h } from "./ui.js";
import { badge, navIcon } from "./kit.js";

export const STATUSES = Object.freeze([["new", "New"], ["approved", "Approved"], ["ready", "Ready to send"], ["contacted", "Contacted"], ["replied", "Replied"], ["won", "Won"], ["dismissed", "Dismissed"]]);
export const statusWord = (s) => (STATUSES.find(([id]) => id === s) || [s, s || ""])[1];
const TONE = { new: "pending", approved: "pending", ready: "warn", contacted: "ok", replied: "ok", won: "ok", dismissed: "" };
export const statusChip = (lead) => badge(lead.opted_out ? "Opted out" : statusWord(lead.status), lead.opted_out ? "bad" : TONE[lead.status] || "");

/** The list filter the person last chose, so Back from a lead returns to the same list. */
export const view = { status: null, q: "", outreach: "" };

/** Outreach: how a lead was contacted by hand and where it stands (Admin -> Leads, migration 0026). The lifecycle status above is the approval; this is separate. */
export const METHODS = Object.freeze([["text", "Text"], ["email", "Email"], ["phone", "Phone"], ["facebook", "Facebook"], ["other", "Other"]]);
export const OUTREACH = Object.freeze([["contacted", "Contacted"], ["replied", "Replied"], ["interested", "Interested"], ["not_interested", "Not interested"], ["follow_up", "Follow-up needed"]]);
const OUTREACH_TONE = { contacted: "ok", replied: "ok", interested: "ok", not_interested: "", follow_up: "warn" };
/** A calendar day (YYYY-MM-DD) as words, with no time zone shift: "Nov 13, 2026". */
export const dayWord = (day) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || "")); return m ? new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12))) : String(day || ""); };
/** The Contacted indicator: the status, and how it was contacted. `full` adds nothing visual but keeps one place to change it. */
export const outreachChip = (o) => (o ? badge(o.method_word && o.status === "contacted" ? `Contacted · ${o.method_word}` : o.status_word, OUTREACH_TONE[o.status] || "") : null);

export const SITE_WORDS = { none: "No website", social_only: "Facebook page only", offline: "Website is offline", broken: "Reported offline, not confirmed", unverified: "Not verified (may be protected)", online: "Website is online", outdated: "Outdated website", ok: "Website looks fine" };
/** Chip tone per website status: only a confirmed offline site is a warning; "not verified" and "not confirmed" are neutral, never alarming. */
export const SITE_TONE = { none: "warn", offline: "warn", broken: "pending", unverified: "pending", online: "ok" };

/** Only http(s) addresses are ever made into links. */
export const safeUrl = (u) => (typeof u === "string" && /^https?:\/\/[^\s]+$/i.test(u) ? u : null);
export const shortUrl = (u) => String(u || "").replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
export const extLink = (href, text, cls = "adm-link") => (safeUrl(href) ? h("a", { class: cls + " ld-ico", href, target: "_blank", rel: "noopener noreferrer" }, h("span", { text }), navIcon("external")) : null);

export const stars = (rating, reviews) => (typeof rating === "number" && rating > 0 ? `${rating.toFixed(1)} stars` + (reviews ? ` · ${reviews} reviews` : "") : "");

/** A line icon from the Admin kit followed by text: the one way Leads shows a symbol (no emoji or symbol characters). */
export const iconLabel = (name, text) => h("span", { class: "ld-ico" }, navIcon(name), h("span", { text }));

/** The SEO Opportunity badge for a list row or header: the score and its level. An unassessed lead says so rather than showing a number. */
const LEVEL = { high: ["High", "ok"], medium: ["Medium", "pending"], low: ["Low", ""] };
export const opportunityChip = (lead) => {
  const score = lead.seo_score !== undefined ? lead.seo_score : lead.seo && lead.seo.score;
  const level = lead.seo_level || (lead.seo && lead.seo.level);
  if (score === null || score === undefined) return lead.seo_level === null || lead.seo === null ? null : badge("Not scored yet", "");
  const [word, tone] = LEVEL[level] || ["", ""];
  return badge(`SEO opportunity ${score}/100${word ? ", " + word.toLowerCase() : ""}`, tone);
};
/**
 * The business name without the city when the city is already shown beside it ("Vallarta Fence Calgary" in Calgary -> "Vallarta Fence").
 * Only a whole-word city at the END (with any dash, comma, bracket or "in" joining it) is removed; a leading city is part of the brand and stays, and never the whole name.
 */
export function shortName(name, city) {
  const n = String(name || "").trim(), c = String(city || "").trim();
  if (!n || !c) return n;
  const esc = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const out = n.replace(new RegExp(`\\s*(?:[-\u2013\u2014|,:(]|\\bin\\b)?\\s*\\(?\\b${esc}\\b\\)?\\s*$`, "i"), "").trim();
  return out.length >= 2 ? out : n;
}
export const words = (t) => (String(t || "").trim().match(/\S+/g) || []).length;

const CODES = {
  pricing_in_first_email: "The first email mentions pricing, a price word or “free”. Take it out; first emails must not include it.",
  not_set_up: "Leads isn’t set up yet: migration 0022 has not been applied.",
  writes_disabled: "Changes are switched off on this site.",
  network: "Can’t reach the server. Nothing was changed.",
  session: "Your session has ended. Reload the page to sign in again.",
  denied: "This account isn’t allowed to do that.",
  not_found: "That lead or message no longer exists.",
  already_contacted: "This lead was already marked as contacted. Reload to see it.",
  lead_dismissed: "A dismissed lead can’t be marked as contacted. Reopen it first.",
  opted_out: "This business opted out, so it can’t be contacted.",
  not_contacted: "Mark the lead as contacted first.",
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
  if (code === "not_set_up" && err && err.data && err.data.migration === "0026_outreach_tracking.sql") return "Outreach tracking isn’t set up yet: migration 0026 is waiting for approval.";
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
