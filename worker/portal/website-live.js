/**
 * The client's Website page (Phase 2; only where PORTAL_WEBSITE is on). Rendered only from what the tenant guard already scoped to the member's OWN organization:
 * the websites Framework published for it (repo/client-websites.js: never management notes or storage details). No website at all is an empty state, not a record.
 * Like every portal page there is no inline style and no inline script; the screenshot is a plain image from an authorised route of this site.
 */
import { e } from "./ui.js";
import { crumb } from "./guided.js";
import { CONTACT_EMAIL } from "./services-live.js";

const href = (vm, p) => `${vm.base}${p}`;
const isWebUrl = (u) => typeof u === "string" && /^https?:\/\/[^\s"'<>]+$/.test(u);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A stored YYYY-MM-DD as "Oct 29, 2026" (a plain date: no time zone shifts it). */
const day = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ""); return m ? `${MONTHS[Number(m[2]) - 1] || ""} ${Number(m[3])}, ${m[1]}` : ""; };
const shortUrl = (u) => String(u).replace(/^https?:\/\//, "").replace(/\/$/, "");

export const STATUS_LABEL = Object.freeze({ existing: "Existing website", in_development: "In development", live: "Live" });
const STATUS_CLASS = { existing: "idle", in_development: "active", live: "live" };
const PARTY = { framework: "Framework", client: "You", unknown: "Not recorded" };

const statusChip = (s) => `<span class="status status--${STATUS_CLASS[s.status] || "idle"}">${e(STATUS_LABEL[s.status] || "Website")}</span>`;
const managedChip = (s) => `<span class="ws__managed">${s.managedByFramework ? "Managed by Framework" : "Not managed by Framework"}</span>`;
const link = (s, label) => (isWebUrl(s.url) ? `<a class="text-link" href="${e(s.url)}" target="_blank" rel="noopener noreferrer">${label || e(shortUrl(s.url))}<span class="visually-hidden"> (opens in a new tab)</span></a>` : "");

/** What this website's state means for the client, in plain words. */
function statement(s) {
  if (s.status === "in_development") return "Framework is building this website. You will see its progress here as the work moves forward.";
  if (s.status === "live") return s.managedByFramework ? "This website is live, and Framework looks after it for you." : "This website is live. Framework does not manage it; you or your own provider do. If you would like help with it, just ask.";
  return s.managedByFramework ? "This is your current website, and Framework looks after it for you." : "This is your current website. Framework does not manage it, and it is listed here so everything about your online presence is in one place.";
}

function facts(s) {
  const row = (label, value) => (value ? `<div><dt>${e(label)}</dt><dd>${value}</dd></div>` : "");
  const party = (p) => (p && p !== "unknown" ? `${e(PARTY[p])}` : "");
  const domain = [s.domain.registrar && e(s.domain.registrar), s.domain.owner !== "unknown" ? `owned by ${party(s.domain.owner)}` : ""].filter(Boolean).join(" · ");
  const hosting = [s.hosting.provider && e(s.hosting.provider), s.hosting.owner !== "unknown" ? `owned by ${party(s.hosting.owner)}` : ""].filter(Boolean).join(" · ");
  const rows = [
    row("Address", link(s)),
    row("Launched", e(day(s.launchDate))),
    row("Domain", domain),
    row("Domain renews", e(day(s.domain.renewal))),
    row("Hosting", hosting),
    row("Hosting renews", e(day(s.hosting.renewal))),
  ].join("");
  return rows ? `<dl class="contact ws__facts">${rows}</dl>` : "";
}

const shot = (vm, s) => (s.hasScreenshot ? `<img class="ws__shot" src="${e(href(vm, `/website/${s.id}/screenshot`))}" alt="${e(`Screenshot of ${s.name}`)}" loading="lazy" decoding="async">` : "");

function detailBody(vm, s) {
  return `<div class="ws__badges">${statusChip(s)}${managedChip(s)}</div>
<p class="lead ws__lead">${e(statement(s))}</p>
${shot(vm, s)}${facts(s)}`;
}

/** The empty state: no website has been added for this organization. */
function emptyState() {
  const subject = encodeURIComponent("Website enquiry");
  return `<section class="ws__empty" aria-labelledby="ws-empty-h"><h2 class="h2" id="ws-empty-h">No website yet</h2>
<p class="lead">There is no website listed for your business here. If you are thinking about a new site, or have one you would like to bring under Framework, we would be glad to talk it through.</p>
<p><a class="btn btn--primary" href="mailto:${e(CONTACT_EMAIL)}?subject=${subject}">Talk to us about a website</a></p></section>`;
}

function card(vm, s) {
  return `<li><a class="hub" href="${e(href(vm, `/website/${s.id}`))}"><span class="hub__top"><span class="hub__title">${e(s.name)}</span><span class="hub__arrow tile__arrow" aria-hidden="true">→</span></span>${s.url ? `<span class="hub__desc">${e(shortUrl(s.url))}</span>` : ""}<span class="hub__status"><span class="ws__badges">${statusChip(s)}${managedChip(s)}</span></span></a></li>`;
}

/** /website: nothing yet (empty state), one website (shown in full), or several (a list; each opens its own page). */
export function websiteOverview(vm, sites) {
  const head = `<header class="page-head page-head--compact">${crumb(vm, [["Website"]])}<h1 class="h1 h1--section">Website</h1></header>`;
  if (!sites.length) return `${head}${emptyState()}`;
  if (sites.length === 1) return `${head}<h2 class="h2 ws__name">${e(sites[0].name)}</h2>${detailBody(vm, sites[0])}`;
  return `${head}<p class="lead">${e(`${sites.length} websites are listed for your business.`)}</p><ul class="hubs ws__list">${sites.map((s) => card(vm, s)).join("")}</ul>`;
}

/** /website/:id — one website in full (also reachable when it is the only one). */
export function websiteDetail(vm, s) {
  return `<header class="page-head page-head--compact">${crumb(vm, [["Website", "/website"], [s.name]])}<h1 class="h1 h1--section">${e(s.name)}</h1></header>${detailBody(vm, s)}
<p class="ws__back"><a class="text-link" href="${e(href(vm, "/website"))}"><span aria-hidden="true">←</span> Back to Website</a></p>`;
}
