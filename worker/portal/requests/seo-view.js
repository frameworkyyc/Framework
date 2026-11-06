/**
 * The SEO dashboard: what a client sees first on /seo. Pure string building from stored, published data; nothing is estimated, imported or invented here.
 *   1. Search performance per website: clicks, impressions and average position from the published figures (typed by Framework today, imported from Google Search Console later;
 *      each figure says which), the change from the previous period, and a trend chart. With no figures, a setup state that says what is missing and what connects it.
 *   2. Keyword rankings: the searches the client tracks (a keyword and a place), the latest verified result for each, the change since the check before, and a small trend.
 *   3. Connections: what is and is not connected, in words.
 * Search Console's "average position" is an average over every search, place and device where the site appeared. It is NOT the rank for one search in one place; the page says so.
 */
import { e } from "../ui.js";

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
/** A calendar day (YYYY-MM-DD) with its year: periods can span years, so the year is always shown. */
const day = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const num = (n) => (Number.isFinite(n) ? new Intl.NumberFormat("en-CA").format(n) : "");
const SOURCE = Object.freeze({ search_console: "Google Search Console", manual: "Entered by Framework" });

/* ---------------------------------------------------------------- calculations (pure, exported for tests) */

/** The change between two values of a figure. lowerIsBetter: average position. @returns { tone: "up"|"down"|"flat"|"none", good: boolean|null, text } */
export function change(curr, prev, { lowerIsBetter = false, unit = "" } = {}) {
  if (!Number.isFinite(curr) || !Number.isFinite(prev)) return { tone: "none", good: null, text: "No earlier period to compare" };
  if (lowerIsBetter) {
    const d = Math.round((prev - curr) * 10) / 10;
    if (Math.abs(d) < 0.1) return { tone: "flat", good: null, text: "No change" };
    return d > 0 ? { tone: "up", good: true, text: `Improved by ${Math.abs(d)} ${Math.abs(d) === 1 ? "position" : "positions"}` } : { tone: "down", good: false, text: `Dropped by ${Math.abs(d)} ${Math.abs(d) === 1 ? "position" : "positions"}` };
  }
  if (prev === 0) return curr === 0 ? { tone: "flat", good: null, text: "No change" } : { tone: "up", good: true, text: `Up from none${unit}` };
  const pct = Math.round(((curr - prev) / prev) * 100);
  if (pct === 0) return { tone: "flat", good: null, text: "No change" };
  return pct > 0 ? { tone: "up", good: true, text: `Up ${pct}%` } : { tone: "down", good: false, text: `Down ${Math.abs(pct)}%` };
}

/** The published figures for one source, oldest first, so a chart reads left to right. Mixed sources are never joined into one line: the newest source with figures is used. */
export function series(metrics) {
  const list = (metrics || []).filter((m) => m && m.periodStart);
  if (!list.length) return { source: null, points: [] };
  const newest = [...list].sort((a, b) => (a.periodEnd < b.periodEnd ? 1 : -1))[0];
  const points = list.filter((m) => m.source === newest.source).sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1));
  return { source: newest.source, points };
}

/** A small line or bar chart as an SVG (no script, no inline style): w x h box, values oldest to newest. invert: a smaller value draws higher (positions). */
export function chart(values, { w = 320, h = 96, bars = false, invert = false, label = "Trend" } = {}) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return "";
  const pad = { l: 6, r: 6, t: 8, b: 8 }, iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const y = (x) => { const t = (x - lo) / span; return pad.t + (invert ? t : 1 - t) * ih; };
  const step = iw / (v.length - 1);
  const x = (i) => pad.l + i * step;
  const f = (n) => Math.round(n * 10) / 10;
  let body;
  if (bars) {
    const bw = Math.max(4, Math.min(28, (iw / v.length) * 0.6));
    body = v.map((val, i) => { const top = pad.t + (1 - (val - Math.min(0, lo)) / (hi - Math.min(0, lo) || 1)) * ih; return `<rect class="sd-bar${i === v.length - 1 ? " sd-bar--now" : ""}" x="${f(pad.l + (iw / v.length) * (i + 0.5) - bw / 2)}" y="${f(top)}" width="${f(bw)}" height="${f(Math.max(1, pad.t + ih - top))}"/>`; }).join("");
  } else {
    body = `<polyline class="sd-line" fill="none" points="${v.map((val, i) => `${f(x(i))},${f(y(val))}`).join(" ")}"/>${v.map((val, i) => `<circle class="sd-dot${i === v.length - 1 ? " sd-dot--now" : ""}" cx="${f(x(i))}" cy="${f(y(val))}" r="${i === v.length - 1 ? 4 : 2.5}"/>`).join("")}`;
  }
  return `<svg class="sd-chart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${e(label)}: ${v.map((n) => num(n)).join(", ")}"><line class="sd-base" x1="${pad.l}" y1="${h - pad.b + 2}" x2="${w - pad.r}" y2="${h - pad.b + 2}"/>${body}</svg>`;
}

const arrow = (c) => (c.tone === "up" ? "▲" : c.tone === "down" ? "▼" : c.tone === "flat" ? "■" : "");
const deltaLine = (c) => `<span class="sd-delta sd-delta--${c.good === true ? "good" : c.good === false ? "bad" : "flat"}">${arrow(c) ? `<span aria-hidden="true">${arrow(c)}</span> ` : ""}${e(c.text)}</span>`;

/* ---------------------------------------------------------------- performance */

function kpi(label, value, c, note) {
  return `<li class="sd-kpi"><span class="sd-kpi__l">${e(label)}</span><span class="sd-kpi__v">${e(value)}</span>${deltaLine(c)}${note ? `<span class="sd-kpi__n">${e(note)}</span>` : ""}</li>`;
}

function performance(vm, site, seo, requestHref) {
  const { source, points } = series(seo && seo.metrics);
  const head = `<h3 class="sd-site">${e(site.name)}</h3>`;
  if (!points.length) {
    return `<section class="sd-card" aria-labelledby="sd-${e(site.id)}">${head.replace("<h3", `<h3 id="sd-${e(site.id)}"`)}<div class="sd-setup"><p class="sd-setup__t">Search figures are not connected yet</p><p class="muted">When they are, this is where you will see how many people found your site on Google, how often it appeared, and where it showed up, with the change from one period to the next.</p><ol class="sd-steps"><li>Framework connects Google Search Console for this website. You may be asked to confirm you own the site.</li><li>Figures appear here for each period, with a trend.</li></ol><p><a class="btn btn--primary" href="${e(requestHref)}">Ask Framework to set up search reporting</a></p><p class="muted small">Nothing is estimated while this is not connected.</p></div></section>`;
  }
  const cur = points[points.length - 1], prev = points.length > 1 ? points[points.length - 2] : null;
  const tiles = [
    cur.clicks != null ? kpi("Clicks", num(cur.clicks), prev ? change(cur.clicks, prev.clicks) : change(NaN, NaN), "People who clicked through to your site") : "",
    cur.impressions != null ? kpi("Impressions", num(cur.impressions), prev ? change(cur.impressions, prev.impressions) : change(NaN, NaN), "Times your site appeared in results") : "",
    cur.position != null ? kpi("Average position", String(cur.position), prev ? change(cur.position, prev.position, { lowerIsBetter: true }) : change(NaN, NaN), "Lower is better. Averaged over all searches") : "",
  ].join("");
  const charts = [
    ["Clicks", points.map((p) => p.clicks), { bars: true }],
    ["Impressions", points.map((p) => p.impressions), { bars: true }],
    ["Average position (higher on the chart is better)", points.map((p) => p.position), { invert: true }],
  ].map(([t, vals, o]) => (vals.filter((x) => x != null).length >= 2 ? `<figure class="sd-fig"><figcaption class="sd-fig__t">${e(t)}</figcaption>${chart(vals.map((x) => (x == null ? NaN : x)), { ...o, label: t })}<span class="sd-fig__r muted small">${e(day(points[0].periodStart))} to ${e(day(cur.periodEnd))}</span></figure>` : "")).join("");
  const period = `${day(cur.periodStart)} to ${day(cur.periodEnd)}`;
  return `<section class="sd-card" aria-labelledby="sd-${e(site.id)}"><div class="sd-card__head"><h3 class="sd-site" id="sd-${e(site.id)}">${e(site.name)}</h3><p class="sd-src"><span class="sd-tag${source === "search_console" ? " sd-tag--live" : ""}">${e(SOURCE[source] || source)}</span> <span class="muted small">Latest period: ${e(period)}${points.length === 1 ? ". The first period: trends appear after the next one." : ""}</span></p></div>
<ul class="sd-kpis">${tiles}</ul>${charts ? `<div class="sd-figs">${charts}</div>` : ""}${cur.note ? `<p class="muted small">${e(cur.note)}</p>` : ""}</section>`;
}

/* ---------------------------------------------------------------- keyword rankings */

const KEYWORD_ERRORS = { invalid_keyword: "Enter a keyword of 2 to 80 characters.", invalid_location: "Enter a place of 2 to 80 characters, or leave it empty.", too_many: "You are tracking as many keywords as can be kept. Remove one first.", duplicate: "You are already tracking that keyword for that place.", not_found: "That website or keyword could not be found.", forbidden: "Only an owner of your organization can change the tracked keywords.", unavailable: "Keyword tracking is not available yet." };
export const keywordErrorText = (code) => KEYWORD_ERRORS[code] || "That couldn't be done. Please try again.";

function rankCell(k) {
  const [last, before] = k.checks;
  if (!last) return { state: `<span class="status status--idle">Not checked yet</span>`, rank: "", delta: "", trend: "" };
  const rank = last.position == null ? `<span class="sd-rank sd-rank--none">Not in the results checked</span>` : `<span class="sd-rank">#${e(String(last.position))}</span>`;
  let delta = "";
  if (before && last.position != null && before.position != null) delta = deltaLine(change(last.position, before.position, { lowerIsBetter: true }));
  else if (before && last.position != null && before.position == null) delta = `<span class="sd-delta sd-delta--good"><span aria-hidden="true">▲</span> Now ranking</span>`;
  else if (before && last.position == null && before.position != null) delta = `<span class="sd-delta sd-delta--bad"><span aria-hidden="true">▼</span> No longer in the results checked</span>`;
  const pts = [...k.checks].reverse().map((c) => (c.position == null ? NaN : c.position));
  const trend = pts.filter(Number.isFinite).length >= 2 ? chart(pts.map((p) => (Number.isNaN(p) ? 100 : p)), { w: 120, h: 36, invert: true, label: `Rank history for ${k.keyword}` }) : "";
  return { state: `<span class="muted small">Checked ${e(day(last.checkedOn))}${last.source === "provider" ? " automatically" : " by Framework"}</span>`, rank, delta, trend };
}

function keywordRows(vm, k, canManage, csrf) {
  const c = rankCell(k);
  const rm = canManage ? `<form method="post" action="${e(`${vm.base}/seo/keywords/${k.id}/remove`)}" class="sd-rm"><input type="hidden" name="csrf" value="${e(csrf)}"><button class="btn btn--small" type="submit">Stop tracking<span class="visually-hidden"> ${e(k.keyword)}</span></button></form>` : "";
  return `<li class="sd-kw"><div class="sd-kw__who"><strong class="sd-kw__k">${e(k.keyword)}</strong><span class="sd-kw__loc">${k.location ? e(k.location) : "Anywhere"}</span></div><div class="sd-kw__rank">${c.rank}${c.delta}</div><div class="sd-kw__trend">${c.trend}</div><div class="sd-kw__state">${c.state}</div>${rm}</li>`;
}

function keywordsSection(vm, sites, kd, canManage, csrf, flash, error, values) {
  if (!kd || kd.available === false) return `<section class="rq-block" aria-labelledby="sd-kw-h"><h2 class="h3" id="sd-kw-h">Keyword rankings</h2><p class="muted">Keyword tracking is being set up and will appear here. Rankings are never estimated.</p></section>`;
  const banner = error ? `<p class="form-banner form-banner--error" role="alert" tabindex="-1" data-error-summary>${e(keywordErrorText(error))}</p>` : flash === "kw-added" ? `<p class="form-banner" role="status">Keyword added. Framework will check it and record the result here.</p>` : flash === "kw-removed" ? `<p class="form-banner" role="status">Keyword removed.</p>` : "";
  const bySite = sites.map((s) => ({ s, list: kd.keywords.filter((k) => k.websiteId === s.id) }));
  const lists = bySite.filter((x) => x.list.length).map((x) => `${sites.length > 1 ? `<h3 class="sd-site">${e(x.s.name)}</h3>` : ""}<ul class="sd-kws" aria-label="${e(`Tracked keywords for ${x.s.name}`)}">${x.list.map((k) => keywordRows(vm, k, canManage, csrf)).join("")}</ul>`).join("");
  const form = !sites.length ? "" : canManage
    ? `<form class="sd-add" method="post" action="${e(`${vm.base}/seo/keywords`)}" novalidate><input type="hidden" name="csrf" value="${e(csrf)}"><h3 class="sd-add__t">Track a keyword</h3><div class="sd-add__row"><div class="field"><label for="sd-k">Keyword</label><input id="sd-k" name="keyword" type="text" maxlength="80" value="${e(values.keyword || "")}" placeholder="Fences &amp; decks" required></div><div class="field"><label for="sd-l">Place <span class="field__opt">Optional</span></label><input id="sd-l" name="location" type="text" maxlength="80" value="${e(values.location || "")}" placeholder="Calgary, Alberta"></div>${sites.length > 1 ? `<div class="field"><label for="sd-w">Website</label><select id="sd-w" name="website">${sites.map((s) => `<option value="${e(s.id)}"${values.website === s.id ? " selected" : ""}>${e(s.name)}</option>`).join("")}</select></div>` : `<input type="hidden" name="website" value="${e(sites[0].id)}">`}<button class="btn btn--primary" type="submit">Track keyword</button></div><p class="muted small">Track up to 20 keywords. Framework looks up each one for the place you give and records the result here. Until then it shows "Not checked yet".</p></form>`
    : `<p class="muted small">Only an owner of your organization can add or remove tracked keywords.</p>`;
  const empty = lists ? "" : `<p class="muted">You are not tracking any keywords yet. Add the searches you want to be found for, such as "Fences &amp; decks" in "Calgary, Alberta".</p>`;
  return `<section class="rq-block" aria-labelledby="sd-kw-h"><h2 class="h3" id="sd-kw-h">Keyword rankings</h2>${banner}${empty}${lists}${form}<p class="muted small sd-honest">A ranking here is a result Framework checked for that keyword and place on the date shown. It is different from the average position above, which combines every search and place.</p></section>`;
}

/* ---------------------------------------------------------------- the whole dashboard */

/** d: { sites: [{id, name}], seoOf: Map(siteId -> published SEO or undefined), keywords: { available, keywords }, canManage, csrf, flash, error, values } */
export function seoDashboard(vm, d) {
  const requestHref = `${vm.base}/requests/new?type=monthly_seo`;
  const perf = d.sites.length ? d.sites.map((s) => performance(vm, s, d.seoOf.get(s.id), requestHref)).join("") : `<div class="sd-setup"><p class="sd-setup__t">No website is listed for your organization yet</p><p class="muted">Search figures and keyword rankings are shown for each website. Ask Framework to add yours.</p></div>`;
  const all = d.sites.flatMap((s) => (d.seoOf.get(s.id) ? d.seoOf.get(s.id).metrics : []));
  const gsc = all.some((m) => m.source === "search_console"), typed = all.length > 0;
  const kws = d.keywords && d.keywords.available ? d.keywords.keywords : [];
  const providerRanks = kws.some((k) => k.checks.some((c) => c.source === "provider")), checkedRanks = kws.some((k) => k.checks.length);
  const conns = [
    ["Google Search Console", gsc ? "Connected" : typed ? "Figures entered by Framework" : "Not connected", gsc ? "Your figures are imported from Google." : "A connection will let Framework show your real search figures here automatically."],
    ["Keyword rank tracking", providerRanks ? "Automatic" : checkedRanks ? "Checked by Framework" : "Not tracked", providerRanks ? "Rankings are checked automatically." : "Rankings are looked up by Framework for the place you choose. Automatic daily tracking is planned, not available yet."],
    ["Google Business Profile", "Not set up", "Ask for Local SEO and Google Business Profile below and Framework will check what you have."],
  ];
  return `<section class="sd" aria-labelledby="sd-h"><h2 class="h3" id="sd-h">Search performance</h2>${perf}<p class="muted small sd-honest">Average position comes from Google Search Console. It averages every search where your site appeared, in every place and on every device, so it is not your ranking for one particular search.</p></section>
${keywordsSection(vm, d.sites, d.keywords, d.canManage, d.csrf, d.flash, d.error, d.values || {})}
<section class="rq-block" aria-labelledby="sd-conn"><h2 class="h3" id="sd-conn">Connections</h2><ul class="rq-ready">${conns.map(([t, s, w]) => `<li><span class="rq-ready__t">${e(t)}</span><span class="status status--${s === "Connected" || s === "Automatic" ? "live" : s === "Not connected" || s === "Not tracked" || s === "Not set up" ? "idle" : "active"}">${e(s)}</span><span class="muted small">${e(w)}</span></li>`).join("")}</ul></section>`;
}
