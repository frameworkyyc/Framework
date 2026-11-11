/**
 * The client's Analytics page for one website (/website/:id/analytics). Server-rendered from `loadAnalytics` (service.js); no inline style and no inline script (the portal CSP forbids both).
 * Two sources, kept apart and always named: Cloudflare Web Analytics (traffic) and Google Search Console (search performance). Their figures are measured differently and are never added
 * or merged. A source that is not connected shows what is missing and what to do, never a number. Charts are SVG with a plain table underneath; /assets/js/portal-analytics.js only adds
 * the hover and arrow-key read-out.
 */
import { e } from "../ui.js";
import { crumb } from "../guided.js";
import { CONTACT_EMAIL } from "../services-live.js";
import { change } from "../requests/seo-view.js";
import { RANGES } from "./ranges.js";

const href = (vm, p) => `${vm.base}${p}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (d, year = true) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ""); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}${year ? `, ${m[1]}` : ""}` : ""; };
const n = (v) => (Number.isFinite(v) ? new Intl.NumberFormat("en-CA").format(v) : "");
const pct = (v) => (Number.isFinite(v) ? `${new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 }).format(v * 100)}%` : "–");
const plural = (v, one, many = `${one}s`) => `${n(v)} ${v === 1 ? one : many}`;
const stamp = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleString("en-CA", { timeZone: "America/Edmonton", dateStyle: "medium", timeStyle: "short" }) : ""; };

const arrow = (c) => (c.tone === "up" ? "▲" : c.tone === "down" ? "▼" : c.tone === "flat" ? "■" : "");
const delta = (c) => `<span class="sd-delta sd-delta--${c.good === true ? "good" : c.good === false ? "bad" : "flat"}">${arrow(c) ? `<span aria-hidden="true">${arrow(c)}</span> ` : ""}${e(c.text)}</span>`;
const tile = (label, value, c, note) => `<li class="sd-kpi"><span class="sd-kpi__l">${e(label)}</span><span class="sd-kpi__v">${e(value)}</span>${delta(c)}${note ? `<span class="sd-kpi__n">${e(note)}</span>` : ""}</li>`;
const ctrChange = (cur, prev) => {
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return { tone: "none", good: null, text: "No earlier period to compare" };
  const d = Math.round((cur - prev) * 1000) / 10;
  if (Math.abs(d) < 0.1) return { tone: "flat", good: null, text: "No change" };
  return d > 0 ? { tone: "up", good: true, text: `Up ${Math.abs(d)} points` } : { tone: "down", good: false, text: `Down ${Math.abs(d)} points` };
};

/** A line chart of daily figures: SVG (one or two series on one scale) with invisible per-day bands carrying the read-out text. */
export function trendChart({ id, title, dates, series }) {
  const w = 640, h = 180, pad = { l: 8, r: 8, t: 12, b: 10 }, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const len = dates.length;
  if (len < 2) return "";
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i) => pad.l + (iw * i) / (len - 1), y = (v) => pad.t + ih - (v / max) * ih, f = (v) => Math.round(v * 10) / 10;
  const lines = series.map((s, k) => `<polyline class="an-line an-line--${k}" fill="none" points="${s.values.map((v, i) => `${f(x(i))},${f(y(v))}`).join(" ")}"/>`).join("");
  const band = iw / (len - 1);
  const hits = dates.map((d, i) => `<rect class="an-hit" x="${f(x(i) - band / 2)}" y="0" width="${f(band)}" height="${h}" data-x="${f(x(i))}" data-t="${e(`${day(d)}: ${series.map((s) => `${n(s.values[i])} ${s.unit(s.values[i])}`).join(", ")}`)}"/>`).join("");
  const legend = series.length > 1 ? `<ul class="an-legend">${series.map((s, k) => `<li><span class="an-key an-key--${k}" aria-hidden="true"></span>${e(s.label)}</li>`).join("")}</ul>` : "";
  const rows = dates.map((d, i) => `<tr><th scope="row">${e(day(d))}</th>${series.map((s) => `<td>${e(s.format ? s.format(s.values[i]) : n(s.values[i]))}</td>`).join("")}</tr>`).join("");
  return `<figure class="an-fig"><figcaption class="sd-fig__t">${e(title)}</figcaption>${legend}
<div class="an-chart" id="${e(id)}" tabindex="0" role="group" aria-label="${e(`${title}: daily figures, ${day(dates[0])} to ${day(dates[len - 1])}. Use the left and right arrow keys to read each day.`)}" aria-describedby="${e(id)}-read">
<svg class="an-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" focusable="false"><line class="sd-base" x1="${pad.l}" y1="${h - pad.b}" x2="${w - pad.r}" y2="${h - pad.b}"/>${lines}<line class="an-cursor" x1="0" y1="${pad.t}" x2="0" y2="${h - pad.b}"/>${hits}</svg></div>
<p class="an-read small" id="${e(id)}-read" role="status" aria-live="polite">Peak day: ${e(`${n(max)} ${series[0].unit(max)}`)}. Hover or use the arrow keys to read a day.</p>
<p class="an-axis muted small"><span>${e(day(dates[0]))}</span><span>${e(day(dates[len - 1]))}</span></p>
<details class="an-table"><summary>View these figures as a table</summary><div class="seo-table" role="region" aria-label="${e(`${title}, daily figures`)}" tabindex="0"><table><thead><tr><th scope="col">Day</th>${series.map((s) => `<th scope="col">${e(s.label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></details></figure>`;
}

const share = (value, total) => (total > 0 ? Math.max(0, Math.min(1, value / total)) : 0);
const bar = (p) => `<svg class="an-share" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect class="an-share__bg" width="100" height="6"/><rect class="an-share__fg" width="${Math.round(p * 1000) / 10}" height="6"/></svg>`;
const barList = (label, rows) => (rows.length ? `<ul class="an-bars" aria-label="${e(label)}">${rows.map((r) => `<li class="an-bars__row"><span class="an-bars__l">${e(r.label)}</span>${bar(r.share)}<span class="an-bars__v">${e(r.value)}</span></li>`).join("")}</ul>` : `<p class="muted">Nothing was recorded for this period.</p>`);

const mail = (site, what) => `mailto:${e(CONTACT_EMAIL)}?subject=${encodeURIComponent(`${what} for ${site.name}`)}`;
const ERROR_TEXT = {
  unauthorized: "Framework’s access to this source needs attention, so the figures can’t be loaded right now.",
  property_not_found: "The Search Console property recorded for this website wasn’t found. Framework needs to check it.",
  rate_limited: "The source is busy right now. Please try again in a few minutes.",
};
const errorText = (code) => ERROR_TEXT[code] || "The figures couldn’t be loaded just now. Nothing has been changed; please try again later.";

function setup(site, title, lead, ask) {
  return `<div class="sd-setup"><p class="sd-setup__t">${e(title)}</p><p class="muted">${e(lead)}</p>${ask ? `<p><a class="btn" href="${mail(site, ask)}">Ask Framework to set this up</a></p>` : ""}</div>`;
}
const staleNote = (src) => (src.state === "stale" ? `<p class="form-banner" role="status">${e(errorText(src.code))} Showing the figures read on ${e(stamp(src.fetchedAt))}.</p>` : "");

/* ------------------------------------------------------------------ Cloudflare Web Analytics */

function traffic(vm, site, src, range) {
  const head = (extra = "") => `<h2 class="h2" id="an-cf-h">Website traffic</h2><p class="sd-src"><span class="sd-tag sd-tag--live">Cloudflare Web Analytics</span>${extra}</p>`;
  if (src.state === "not_enabled") return `<section class="sd-card an-card" aria-labelledby="an-cf-h">${head()}${setup(site, "Traffic figures aren’t connected yet", "Framework hasn’t switched on website traffic reporting yet. It will appear here, with visits, page views, where visitors come from and which pages they read.", "Traffic reporting")}</section>`;
  if (src.state === "not_connected") return `<section class="sd-card an-card" aria-labelledby="an-cf-h">${head()}${setup(site, "Traffic isn’t set up for this website yet", `Cloudflare Web Analytics isn’t connected to ${site.name}. It is a privacy-friendly counter that doesn’t use cookies. Framework adds it to your website and links it here.`, "Traffic reporting")}</section>`;
  if (src.state === "error") return `<section class="sd-card an-card" aria-labelledby="an-cf-h">${head()}<p class="form-banner form-banner--error" role="status">${e(errorText(src.code))}</p></section>`;
  const d = src.data, cur = d.totals, prev = d.previous;
  const period = `${day(d.period.from)} to ${day(d.period.to)}`, before = `${day(d.period.previousFrom, false)} to ${day(d.period.previousTo)}`;
  const tiles = [
    tile("Visits", n(cur.visits), change(cur.visits, prev.visits), "Visits to your website. A person who comes back later counts again"),
    tile("Page views", n(cur.pageViews), change(cur.pageViews, prev.pageViews), "Pages loaded, including repeat views"),
  ].join("");
  const dates = d.series.map((s) => s.date);
  const chart = trendChart({ id: `an-cf-chart-${range}`, title: "Visits and page views per day", dates, series: [{ label: "Visits", values: d.series.map((s) => s.visits), unit: (v) => (v === 1 ? "visit" : "visits") }, { label: "Page views", values: d.series.map((s) => s.pageViews), unit: (v) => (v === 1 ? "page view" : "page views") }] });
  const sources = barList("Traffic sources", d.sources.map((r) => ({ label: r.host || "Direct, or no referrer", share: share(r.visits, cur.visits), value: `${plural(r.visits, "visit")} · ${pct(share(r.visits, cur.visits))}` })));
  const pages = d.pages.length ? `<div class="seo-table" role="region" aria-label="Most visited pages" tabindex="0"><table><thead><tr><th scope="col">Page</th><th scope="col">Page views</th><th scope="col">Visits</th></tr></thead><tbody>${d.pages.map((r) => `<tr><th scope="row" class="an-path">${e(r.path)}</th><td>${e(n(r.pageViews))}</td><td>${e(n(r.visits))}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Nothing was recorded for this period.</p>`;
  const totalViews = d.devices.reduce((a, r) => a + r.pageViews, 0);
  const devices = barList("Device types", d.devices.map((r) => ({ label: r.device, share: share(r.pageViews, totalViews), value: `${pct(share(r.pageViews, totalViews))} of page views` })));
  const quiet = cur.pageViews === 0 ? `<p class="muted">No visits were recorded in this period. If the website has just been connected, figures start from the day the counter was added.</p>` : "";
  return `<section class="sd-card an-card" aria-labelledby="an-cf-h">${head(` <span class="muted small">${e(period)}, compared with ${e(before)}</span>`)}${staleNote(src)}
<ul class="sd-kpis sd-kpis--two">${tiles}</ul>${quiet}${chart}
<div class="an-cols"><div><h3 class="an-h">Traffic sources</h3><p class="muted small">Where visits came from, as reported by the visitor’s browser.</p>${sources}</div><div><h3 class="an-h">Mobile and desktop</h3><p class="muted small">Share of page views by device.</p>${devices}</div></div>
<h3 class="an-h">Most visited pages</h3>${pages}
<p class="muted small an-foot">Source: Cloudflare Web Analytics. It counts visits and page views, not individual people. Bot traffic is excluded. Updated ${e(stamp(src.fetchedAt))}; figures run through ${e(day(d.period.to))}.</p></section>`;
}

/* ------------------------------------------------------------------ Google Search Console */

function search(vm, site, src, range) {
  const head = (extra = "") => `<h2 class="h2" id="an-gsc-h">Search performance</h2><p class="sd-src"><span class="sd-tag sd-tag--live">Google Search Console</span>${extra}</p>`;
  if (src.state === "not_enabled") return `<section class="sd-card an-card" aria-labelledby="an-gsc-h">${head()}${setup(site, "Search figures aren’t connected yet", "Framework hasn’t switched on Google Search Console reporting yet. It will show how many people found your website on Google, and where it appears in results.", "Search reporting")}</section>`;
  if (src.state === "not_connected") return `<section class="sd-card an-card" aria-labelledby="an-gsc-h">${head()}${setup(site, "Search figures aren’t set up for this website yet", `Google Search Console isn’t connected to ${site.name}. Framework needs your website verified in Search Console and a read-only user added; we’ll walk you through it.`, "Search reporting")}</section>`;
  if (src.state === "error") return `<section class="sd-card an-card" aria-labelledby="an-gsc-h">${head()}<p class="form-banner form-banner--error" role="status">${e(errorText(src.code))}</p></section>`;
  const d = src.data, cur = d.totals, prev = d.previous;
  const period = `${day(d.period.from)} to ${day(d.period.to)}`, before = `${day(d.period.previousFrom, false)} to ${day(d.period.previousTo)}`;
  const tiles = [
    tile("Clicks", n(cur.clicks), change(cur.clicks, prev.clicks), "People who clicked through to your website"),
    tile("Impressions", n(cur.impressions), change(cur.impressions, prev.impressions), "Times your website appeared in search results"),
    tile("Click-through rate", pct(cur.ctr), ctrChange(cur.ctr, prev.ctr), "Clicks divided by impressions"),
    tile("Average position", cur.position == null ? "–" : String(cur.position), change(cur.position, prev.position, { lowerIsBetter: true }), "Lower is better. Averaged over all searches"),
  ].join("");
  const dates = d.series.map((s) => s.date);
  const one = (key, title, label, unit) => trendChart({ id: `an-gsc-${key}-${range}`, title, dates, series: [{ label, values: d.series.map((s) => s[key]), unit }] });
  const charts = `<div class="an-cols">${one("clicks", "Clicks per day", "Clicks", (v) => (v === 1 ? "click" : "clicks"))}${one("impressions", "Impressions per day", "Impressions", (v) => (v === 1 ? "impression" : "impressions"))}</div>`;
  const quiet = cur.impressions === 0 ? `<p class="muted">Google reported no impressions for this period.</p>` : "";
  return `<section class="sd-card an-card" aria-labelledby="an-gsc-h">${head(` <span class="muted small">${e(period)}, compared with ${e(before)}</span>`)}${staleNote(src)}
<ul class="sd-kpis sd-kpis--four">${tiles}</ul>${quiet}${charts}
<p class="muted small an-foot">Source: Google Search Console. These are Google’s own figures, about two days behind, so the newest day shown is ${e(day(d.period.to))}. Average position is an average across every search, place and device where your website appeared; it is not your rank for one search. Updated ${e(stamp(src.fetchedAt))}.</p></section>`;
}

/** The page body. `model` is loadAnalytics' answer: { range, sources }. */
export function analyticsPage(vm, site, model) {
  const tabs = `<nav class="an-ranges" aria-label="Time period"><ul>${RANGES.map((r) => `<li><a class="an-range" href="${e(href(vm, `/website/${site.id}/analytics?range=${r}`))}"${r === model.range ? ' aria-current="page"' : ""}>Last ${r} days</a></li>`).join("")}</ul></nav>`;
  return `<header class="page-head page-head--compact">${crumb(vm, [["Website", "/website"], [site.name, `/website/${site.id}`], ["Analytics"]])}<h1 class="h1 h1--section">Analytics</h1><p class="lead">How ${e(site.name)} is performing. Traffic comes from Cloudflare Web Analytics and search performance from Google Search Console. They measure different things, so they are shown separately and never added together.</p></header>
${tabs}${traffic(vm, site, model.sources.cloudflare, model.range)}${search(vm, site, model.sources.search_console, model.range)}
<p class="ws__back"><a class="text-link" href="${e(href(vm, `/website/${site.id}`))}"><span aria-hidden="true">←</span> Back to ${e(site.name)}</a></p>`;
}

/** The entry on the website's own page: one line and a link. */
export function analyticsTeaser(vm, site) {
  return `<section class="ws-sec" aria-labelledby="ws-an-h"><h2 class="h2" id="ws-an-h">Analytics</h2><p class="ws-sec__lead">See how this website is performing: visits, page views, where visitors come from, your most visited pages, mobile and desktop, and how you appear in Google search.</p><p><a class="btn" href="${e(href(vm, `/website/${site.id}/analytics`))}">View analytics<span class="visually-hidden"> for ${e(site.name)}</span></a></p></section>`;
}
