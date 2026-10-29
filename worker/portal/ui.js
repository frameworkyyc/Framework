/**
 * Portal UI kit: the page shell (top bar, navigation, footer), the status vocabulary and date formatting. Pure string building, no
 * request, database or environment access. Every dynamic value is escaped with `e` here or by the caller; pages carry no script and no
 * inline style (the portal CSP forbids both), so all presentation is in /assets/css/portal.css.
 */
import { securityHeaders } from "./http.js";
import { escapeHtml as e, MARK, head, footer, footerWithFeedback } from "./frame.js";

/* ------------------------------------------------------------------ dates (Alberta time) */

const TZ = "America/Edmonton";
const F = (o) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, ...o });
const F_DAY = F({ month: "short", day: "numeric" });
const F_DAY_YEAR = F({ month: "short", day: "numeric", year: "numeric" });
const F_LONG = F({ weekday: "long", month: "long", day: "numeric" });
const F_TIME = F({ hour: "numeric", minute: "2-digit" });
const F_KEY = F({ year: "numeric", month: "2-digit", day: "2-digit" });

const toDate = (iso) => {
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};
export const dayKey = (iso) => { const d = toDate(iso); return d ? F_KEY.format(d) : ""; };
export const fmtDay = (iso, now = new Date()) => {
  const d = toDate(iso);
  if (!d) return "";
  return F_KEY.format(d).slice(0, 4) === F_KEY.format(now).slice(0, 4) ? F_DAY.format(d) : F_DAY_YEAR.format(d);
};
export const fmtTime = (iso) => { const d = toDate(iso); return d ? F_TIME.format(d).replace(/\s/g, " ").toLowerCase() : ""; };

/** "Today", "Yesterday", "Tomorrow", otherwise a weekday-and-date heading. */
export function dayHeading(iso, now = new Date()) {
  const d = toDate(iso);
  if (!d) return "";
  const diff = Math.round((Date.parse(dayKey(d) + "T12:00:00Z") - Date.parse(dayKey(now) + "T12:00:00Z")) / 86400000);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  return F_LONG.format(d);
}

/** Friendly relative time for the past ("2 hours ago", "3 days ago") and the near future ("in 3 days"), otherwise a date. */
export function relative(iso, now = new Date()) {
  const d = toDate(iso);
  if (!d) return "";
  const mins = Math.round((now.getTime() - d.getTime()) / 60000);
  if (mins < 0) {
    const days = Math.round((Date.parse(dayKey(d) + "T12:00:00Z") - Date.parse(dayKey(now) + "T12:00:00Z")) / 86400000);
    if (days === 0) return "today";
    if (days === 1) return "tomorrow";
    if (days <= 14) return `in ${days} days`;
    return fmtDay(d, now);
  }
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round((Date.parse(dayKey(now) + "T12:00:00Z") - Date.parse(dayKey(d) + "T12:00:00Z")) / 86400000);
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return fmtDay(d, now);
}

/* ------------------------------------------------------------------ vocabulary */

export const humanize = (s) => String(s || "").replace(/[._-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
export const safeHttps = (u) => (typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);

/** The five stages of a project, in order. Statuses outside it (maintenance, paused, archived) have no position on the track. */
export const STAGES = Object.freeze(["discovery", "design", "build", "review", "live"]);
const STATUS = {
  discovery: ["Discovery", "idle"], design: ["Design", "active"], build: ["Build", "active"], review: ["In review", "active"], live: ["Live", "live"],
  maintenance: ["Maintenance", "live"], paused: ["Paused", "paused"], archived: ["Archived", "idle"],
};
export const statusLabel = (s) => (STATUS[s] ? STATUS[s][0] : humanize(s));
export const status = (s, label) => `<span class="status status--${e(STATUS[s] ? STATUS[s][1] : "idle")}">${e(label || statusLabel(s))}</span>`;

/** Stage track: done / current / upcoming. A project outside the track (paused, archived) shows its own status instead. */
export function stageTrack(s) {
  const i = STAGES.indexOf(s);
  if (i < 0) return `<p>${status(s)}</p>`;
  return `<ol class="stages" aria-label="Project stage: ${e(statusLabel(s))}">${STAGES.map((st, n) => `<li class="${n < i ? "is-done" : n === i ? "is-current" : ""}"${n === i ? ' aria-current="step"' : ""}>${e(statusLabel(st))}</li>`).join("")}</ol>`;
}

export const meter = (pct, label = "Progress") => {
  const n = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  return `<div class="meter-row"><progress class="meter" max="100" value="${n}" aria-label="${e(label)}: ${n} percent">${n}%</progress><span class="num">${n}%</span></div>`;
};

/** A section/feature that has no backend yet, shown honestly in the live portal. */
export const notConnected = (title, text) => `<div class="empty"><strong>${e(title)}</strong>${e(text)}<div class="not-connected"><span class="tag">Not connected yet</span></div></div>`;
/**
 * The error summary of a form that was refused: a heading and one link per invalid field, each pointing at that field's id. It is focusable
 * (tabindex -1) and carries data-error-summary so /assets/js/portal-profile.js can move keyboard focus to it (which also scrolls it into view
 * on a phone). Without script it is still the first thing in the form and announced as an alert. items: [{ id, label, message }].
 */
export const errorSummary = (items, intro = "") => `<div class="error-summary" role="alert" tabindex="-1" data-error-summary aria-labelledby="error-summary-title"><h2 id="error-summary-title" class="error-summary__title">${intro ? e(intro) : items.length === 1 ? "There is a problem" : `There are ${items.length} problems`}</h2><ul>${items.map((i) => `<li><a href="#${e(i.id)}">${i.label ? `${e(i.label)}: ` : ""}${e(i.message)}</a></li>`).join("")}</ul></div>`;
/**
 * The notice shown when a save was refused because the section changed after the form was opened. Same focusable summary as errorSummary (so the focus
 * script moves keyboard focus here and scrolls it into view), with a plain explanation and one link per answer whose saved value now differs from what
 * the person typed. items: [{ id, label, saved }]; reloadHref discards the person's input and shows the latest answers.
 */
export const conflictSummary = (items, reloadHref) => `<div class="error-summary" role="alert" tabindex="-1" data-error-summary aria-labelledby="error-summary-title"><h2 id="error-summary-title" class="error-summary__title">This section changed while you were editing. Nothing was saved.</h2><p>Someone else, or another window or device, saved changes to this section after you opened it. Your answers are still in the form below. Review what is saved now${items.length ? ", listed here" : ""}, then choose Save changes to replace it with your answers, or reload to start from what is saved.</p>${items.length ? `<ul>${items.map((i) => `<li><a href="#${e(i.id)}">${e(i.label)}: ${i.saved ? `currently saved as “${e(i.saved.length > 160 ? i.saved.slice(0, 160) + "…" : i.saved)}”` : "currently empty"}</a></li>`).join("")}</ul>` : ""}<p><a class="text-link" href="${e(reloadHref)}">Reload the latest saved answers (discard my changes)</a></p></div>`;
export const empty = (title, text) => `<div class="empty"><strong>${e(title)}</strong>${e(text)}</div>`;

/* ------------------------------------------------------------------ shell */

export const NAV = Object.freeze([
  { key: "dashboard", label: "Dashboard", path: "" },
  { key: "projects", label: "Projects", path: "/projects" },
  { key: "activity", label: "Activity", path: "/activity" },
  { key: "documents", label: "Documents", path: "/documents" },
  { key: "account", label: "Account", path: "/account" },
]);

/**
 * The signed-in application page.
 * @param nav     {base, active, items?} base = "/portal/o/<slug>" or "/portal/demo"; items = extra nav entries [{key,label,path}] for owners
 * @param who     {org, user}  shown in the bar
 * @param actions HTML for the right side of the bar (sign-out form, or the demo exit link) - already escaped by the caller
 * @param banner  HTML shown above the bar (the demo banner) - already escaped by the caller
 */
export function appPage({ status: code = 200, title, bodyHtml, nav, who, actions = "", banner = "", headers = {}, cookies = [], script = null, styles = [], feedbackHref = null, frameSrc = [] }) {
  const items = nav.list || [...NAV, ...(nav.items || [])];
  const links = items.map((n) => `<li><a href="${e(nav.base + n.path)}"${n.key === nav.active ? ' aria-current="page"' : ""}>${e(n.label)}</a></li>`).join("");
  const html = `<!DOCTYPE html>
<html lang="en-CA"><head>${head(title, { script, styles })}</head>
<body><a class="skip-link" href="#main">Skip to content</a>${banner}
<header class="bar"><div class="wrap bar__in"><a class="brand" href="${e(nav.base)}" aria-label="Framework client portal home">${MARK}<span class="brand__word">Framework</span></a>
<nav class="primary" aria-label="Portal"><ul>${links}</ul></nav>
<div class="who"><span class="who__org">${e(who.org)}</span><span class="who__user">${e(who.user)}</span><div class="who__act">${actions}</div></div></div></header>
<main id="main" class="wrap page" tabindex="-1">${bodyHtml}</main>${feedbackHref ? footerWithFeedback(feedbackHref) : footer}</body></html>`;
  return new Response(html, { status: code, headers: securityHeaders({ ...headers, "Content-Type": "text/html; charset=utf-8", "Set-Cookie": cookies }, { scripts: !!script, frameSrc }) });
}

export { e };
