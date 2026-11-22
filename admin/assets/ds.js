/* Framework Admin design system, components (worker/admin/DESIGN-SYSTEM.md). Pure DOM building: every dynamic value is set as text or an attribute, never as markup, and nothing here sets an
   inline style (the Admin CSP forbids it), so sizes and colours come from classes and SVG attributes. Styles: admin/assets/ds.css. */
import { h } from "./ui.js";
import { navIcon } from "./kit.js";

const NS = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}, ...kids) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v)); kids.flat().forEach((k) => k && el.append(k)); return el; };

/* ---------- icons: the kit's line icons plus the ones the new navigation and cards need ---------- */
const MORE_ICONS = {
  websites: "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18", analytics: "M4 20V10M10 20V4M16 20v-7M22 20H2", operations: "M4 7h16M4 12h16M4 17h10",
  search: "M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4", plus: "M12 5v14M5 12h14", edit: "M4 20h4L19 9l-4-4L4 16zM13 7l4 4", close: "M6 6l12 12M18 6L6 18", more: "M5 12h.01M12 12h.01M19 12h.01",
  bell: "M6 17V11a6 6 0 0112 0v6l2 2H4zM10 21h4", link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3A4 4 0 0011 18.7l1-1", server: "M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01",
  billing: "M3 6h18v12H3zM3 10h18M7 15h3", calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4", arrowup: "M12 19V5M6 11l6-6 6 6", arrowdown: "M12 5v14M6 13l6 6 6-6", globe: "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z", key: "M14 10a4 4 0 11-3 6.6L4 21v-3H1v-3l7-7A4 4 0 0114 10zM15 9h.01", plug: "M9 3v6M15 3v6M6 9h12v3a6 6 0 01-12 0zM12 18v3", user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  menu: "M4 7h16M4 12h16M4 17h16", doc: "M6 3h9l4 4v14H6zM14 3v5h5", clock: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2", warn: "M12 4l10 17H2zM12 10v5M12 18h.01",
};
export function icon(name, cls = "") {
  if (MORE_ICONS[name]) {
    const s = svg("svg", { viewBox: "0 0 24 24", class: "rk-ico" + (cls ? " " + cls : ""), "aria-hidden": "true", focusable: "false" }, svg("path", { d: MORE_ICONS[name] }));
    return s;
  }
  const s = navIcon(name); if (cls) s.setAttribute("class", "rk-ico " + cls); return s;
}

/* ---------- status ---------- */
/** A small rounded status label: a dot plus words (never colour alone). tone: ok | warn | bad | info | quiet */
export const pill = (text, tone = "quiet", { title } = {}) => h("span", { class: "ds-pill ds-pill--" + tone, title: title || null }, h("i", { class: "ds-dot", "aria-hidden": "true" }), text);
export const dot = (tone = "quiet") => h("i", { class: "ds-dot ds-dot--" + tone, "aria-hidden": "true" });

/* ---------- layout ---------- */
/** The bento grid: children carry a span class from span(). */
export const grid = (...kids) => h("div", { class: "ds-grid" }, kids.flat().filter(Boolean));
export const span = (node, cols, { rows } = {}) => { node.classList.add("ds-c" + cols); if (rows) node.classList.add("ds-r" + rows); return node; };

/** A card: optional header (title, subtitle, actions), a body, an optional footer. tone: (white) | ink | tone */
export function card({ title, sub, actions, body, foot, tone = "", cls = "", id, label } = {}) {
  const head = title || actions ? h("header", { class: "ds-card__head" }, h("div", { class: "ds-card__titles" }, title ? h("h2", { class: "ds-card__title", id: id ? id + "-h" : null, text: title }) : null, sub ? h("p", { class: "ds-card__sub", text: sub }) : null), actions ? h("div", { class: "ds-card__actions" }, actions) : null) : null;
  return h("section", { class: "ds-card" + (tone ? " ds-card--" + tone : "") + (cls ? " " + cls : ""), id: id || null, "aria-labelledby": title && id ? id + "-h" : null, "aria-label": !title && label ? label : null }, head, body ? h("div", { class: "ds-card__body" }, body) : null, foot ? h("footer", { class: "ds-card__foot" }, foot) : null);
}

/** A card that opens and closes (native <details>), for secondary content. */
export function expander({ title, meta, open, body, id }) {
  return h("details", { class: "ds-card ds-expander", id: id || null, open: open ? true : null }, h("summary", { class: "ds-expander__sum" }, h("span", { class: "ds-expander__title", text: title }), meta ? h("span", { class: "ds-expander__meta" }, meta) : null, h("i", { class: "ds-chev", "aria-hidden": "true" })), h("div", { class: "ds-expander__body" }, body));
}

/** A compact figure: label, value, optional change and sparkline. tone sets the dot; href makes the whole card a link. */
export function kpi({ label, value, unit, note, delta, tone, spark, href }) {
  const inner = [h("span", { class: "ds-kpi__label" }, tone ? dot(tone) : null, label), h("strong", { class: "ds-kpi__value" }, value, unit ? h("span", { class: "ds-kpi__unit", text: unit }) : null), note ? h("span", { class: "ds-kpi__note", text: note }) : null, delta || null, spark || null];
  return href ? h("a", { class: "ds-card ds-kpi ds-kpi--link", href, "data-link": "" }, inner) : h("div", { class: "ds-card ds-kpi" }, inner);
}
export const delta = (pctChange) => (pctChange === null || pctChange === undefined || !Number.isFinite(pctChange) ? null : h("span", { class: "ds-delta ds-delta--" + (pctChange > 0 ? "up" : pctChange < 0 ? "down" : "flat") }, icon(pctChange >= 0 ? "arrowup" : "arrowdown"), `${Math.abs(Math.round(pctChange))}%`, h("span", { class: "rk-sr", text: pctChange > 0 ? " up" : pctChange < 0 ? " down" : " no change" })));

/** A row of label and value (and an optional edit button), for facts inside a card. */
export const fact = (label, value, { edit } = {}) => h("div", { class: "ds-fact" }, h("dt", { text: label }), h("dd", null, value === null || value === undefined || value === "" ? h("span", { class: "ds-muted", text: "Not set" }) : value), edit ? h("button", { class: "ds-iconbtn", type: "button", "aria-label": `Edit ${label}`, onclick: edit }, icon("edit")) : null);
export const facts = (rows) => h("dl", { class: "ds-facts" }, rows.filter(Boolean));

/* ---------- navigation ---------- */
/** Tabs as links (a route each) or buttons (onSelect). items: [{ id, label, href?, count?, tone? }] */
export function tabs({ items, current, label = "Sections", onSelect }) {
  return h("nav", { class: "ds-tabs", "aria-label": label }, h("ul", null, items.map((t) => h("li", null, (t.href ? h("a", { href: t.href, "data-link": "", class: "ds-tab", "aria-current": t.id === current ? "page" : null }, t.label, t.count !== undefined && t.count !== null ? h("span", { class: "ds-tab__n", text: String(t.count) }) : null)
    : h("button", { type: "button", class: "ds-tab", "aria-current": t.id === current ? "page" : null, onclick: () => onSelect && onSelect(t.id) }, t.label, t.count !== undefined && t.count !== null ? h("span", { class: "ds-tab__n", text: String(t.count) }) : null))))));
}
/** A small group of mutually exclusive choices (filters). */
export function segmented({ options, value, label, onChange }) {
  const wrap = h("div", { class: "ds-seg", role: "group", "aria-label": label || null });
  const draw = (v) => wrap.replaceChildren(...options.map((o) => h("button", { type: "button", class: "ds-seg__btn", "aria-pressed": o.id === v ? "true" : "false", onclick: () => { draw(o.id); onChange(o.id); } }, o.label, o.count !== undefined ? h("span", { class: "ds-seg__n", text: String(o.count) }) : null)));
  draw(value); return wrap;
}
export const crumbs = (items) => h("nav", { class: "ds-crumbs", "aria-label": "Breadcrumb" }, h("ol", null, items.map(([label, href], i) => h("li", null, href && i < items.length - 1 ? h("a", { href, "data-link": "" }, label) : h("span", { "aria-current": i === items.length - 1 ? "page" : null, text: label })))));
/** The top of a page: title, a one-line description, and actions at the end. */
export const pageHead = ({ title, sub, actions, kicker, back }) => h("header", { class: "ds-pagehead" }, h("div", { class: "ds-pagehead__text" }, back ? h("a", { class: "ds-back", href: back[1], "data-link": "" }, icon("back"), back[0]) : null, kicker ? h("p", { class: "ds-kicker", text: kicker }) : null, h("h1", { class: "ds-title", tabindex: "-1", text: title }), sub ? h("p", { class: "ds-sub", text: sub }) : null), actions ? h("div", { class: "ds-pagehead__actions" }, actions) : null);

/* ---------- controls ---------- */
export const button = (label, { onClick, tone = "", icon: ic, type = "button", disabled, href, title, label: aria } = {}) => {
  const cls = "ds-btn" + (tone ? " ds-btn--" + tone : "");
  const kids = [ic ? icon(ic) : null, label ? h("span", { text: label }) : null];
  return href ? h("a", { class: cls, href, "data-link": "", title: title || null }, kids) : h("button", { class: cls, type, onclick: onClick, disabled: disabled ? true : null, "aria-label": aria || null, title: title || null }, kids);
};
export const switchInput = ({ id, label, checked, hint }) => { const input = h("input", { type: "checkbox", id, class: "ds-switch__input", checked: checked ? true : null }); return { input, node: h("div", { class: "ds-field" }, h("label", { class: "ds-switch", for: id }, input, h("span", { class: "ds-switch__track", "aria-hidden": "true" }), h("span", { class: "ds-switch__label", text: label })), hint ? h("p", { class: "ds-hint", text: hint }) : null) }; };
export const field = (id, label, input, hint) => h("div", { class: "ds-field" }, h("label", { for: id, text: label }), hint ? h("p", { class: "ds-hint", id: id + "-h", text: hint }) : null, input);

/* ---------- feedback ---------- */
export function skeleton(lines = 3) { return h("div", { class: "ds-skel", role: "status", "aria-busy": "true", "aria-label": "Loading" }, Array.from({ length: lines }, (_, i) => h("i", { class: "ds-skel__line ds-skel__line--" + (i % 3) })), h("span", { class: "rk-sr", text: "Loading" })); }
export const pageSkeleton = () => h("div", { class: "ds-page" }, h("div", { class: "ds-grid" }, [4, 4, 4, 8, 4].map((c) => span(h("div", { class: "ds-card" }, skeleton(3)), c))));
export const empty = ({ title, body, action, ic = "check" }) => h("div", { class: "ds-empty" }, icon(ic), h("p", { class: "ds-empty__t", text: title }), body ? h("p", { class: "ds-empty__b", text: body }) : null, action || null);

let toastHost;
/** A short message that clears itself; announced politely (errors assertively). */
export function toast(message, tone = "ok") {
  if (!toastHost) { toastHost = h("div", { class: "ds-toasts", "aria-live": "polite" }); document.body.append(toastHost); }
  const t = h("p", { class: "ds-toast ds-toast--" + tone, role: tone === "bad" ? "alert" : "status" }, dot(tone), h("span", { text: message }));
  toastHost.append(t); window.setTimeout(() => t.classList.add("is-in"), 10); window.setTimeout(() => { t.classList.remove("is-in"); window.setTimeout(() => t.remove(), 250); }, tone === "bad" ? 7000 : 3500);
  return t;
}

/** A panel that slides in from the right for editing one thing in context. Returns { close, body }. */
export function drawer({ title, sub, body, onClose, wide }) {
  const dlg = h("dialog", { class: "ds-drawer" + (wide ? " ds-drawer--wide" : ""), "aria-labelledby": "ds-drawer-h" });
  const close = () => dlg.close();
  dlg.append(h("header", { class: "ds-drawer__head" }, h("div", null, h("h2", { id: "ds-drawer-h", text: title }), sub ? h("p", { class: "ds-card__sub", text: sub }) : null), h("button", { class: "ds-iconbtn", type: "button", "aria-label": "Close", onclick: close }, icon("close"))), h("div", { class: "ds-drawer__body" }, body));
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
  dlg.addEventListener("close", () => { dlg.classList.remove("is-in"); dlg.remove(); if (onClose) onClose(); });
  document.body.append(dlg); dlg.showModal(); window.requestAnimationFrame(() => dlg.classList.add("is-in"));
  return { close, node: dlg };
}

/* ---------- charts (our own SVG; real data only) ---------- */
/** A tiny trend line. values: numbers. Decorative: the caller names the figure in text. */
export function sparkline(values, { w = 120, hgt = 36, label } = {}) {
  const v = values.filter((n) => Number.isFinite(n)); if (v.length < 2) return null;
  const max = Math.max(...v), min = Math.min(...v), rng = max - min || 1, step = w / (v.length - 1);
  const pts = v.map((n, i) => `${(i * step).toFixed(1)},${(hgt - 3 - ((n - min) / rng) * (hgt - 6)).toFixed(1)}`);
  return svg("svg", { class: "ds-spark", viewBox: `0 0 ${w} ${hgt}`, preserveAspectRatio: "none", role: label ? "img" : null, "aria-label": label || null, "aria-hidden": label ? null : "true", focusable: "false" }, svg("polyline", { points: pts.join(" "), fill: "none", "stroke-width": "1.8", "stroke-linejoin": "round", "stroke-linecap": "round" }));
}
/** An interactive bar chart: hover or arrow-key a bar to read it, with a table alternative. data: [{ label, value }]. */
export function barChart({ data, label, unit = "", height = 160, format = (n) => n.toLocaleString("en-CA") }) {
  const W = Math.max(60, data.length * 14), max = Math.max(1, ...data.map((d) => d.value));
  const read = h("p", { class: "ds-chart__read", "aria-live": "polite", text: `${data.length} points. Move over or arrow through the bars to read them.` });
  const g = svg("g");
  const bars = data.map((d, i) => { const bh = d.value > 0 ? Math.max(2, Math.round((d.value / max) * (height - 8))) : 1; return svg("rect", { class: "ds-chart__bar", x: i * 14 + 2, y: height - bh, width: 10, height: bh, rx: 3, tabindex: i === 0 ? 0 : -1, role: "img", "aria-label": `${d.label}: ${format(d.value)} ${unit}`.trim(), "data-i": i }); });
  const show = (i) => { bars.forEach((b, j) => b.classList.toggle("is-on", j === i)); read.textContent = `${data[i].label}: ${format(data[i].value)} ${unit}`.trim(); };
  bars.forEach((b, i) => { b.addEventListener("mouseenter", () => show(i)); b.addEventListener("focus", () => show(i)); b.addEventListener("keydown", (e) => { const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? data.length - 1 : null; if (n === null || n < 0 || n >= data.length) return; e.preventDefault(); bars[i].tabIndex = -1; bars[n].tabIndex = 0; bars[n].focus(); }); g.append(b); });
  const chart = svg("svg", { class: "ds-chart", viewBox: `0 0 ${W} ${height}`, preserveAspectRatio: "none", role: "group", "aria-label": label }, g);
  const table = h("details", { class: "ds-chart__table" }, h("summary", { text: "View as a table" }), h("table", null, h("thead", null, h("tr", null, h("th", { scope: "col", text: "Day" }), h("th", { scope: "col", text: unit || "Value" }))), h("tbody", null, data.map((d) => h("tr", null, h("th", { scope: "row", text: d.label }), h("td", { text: format(d.value) }))))));
  return h("figure", { class: "ds-chartbox" }, chart, read, table);
}

/* ---------- a list that becomes stacked records on a phone ---------- */
export function dataList({ columns, rows, label, onRow }) {
  return h("div", { class: "ds-dl", role: "table", "aria-label": label || null },
    h("div", { class: "ds-dl__head", role: "row" }, columns.map((c) => h("span", { role: "columnheader", class: "ds-dl__h" + (c.cls ? " " + c.cls : ""), text: c.label }))),
    rows.map((r) => { const el = r.href ? h("a", { class: "ds-dl__row", role: "row", href: r.href, "data-link": "" }) : h("div", { class: "ds-dl__row", role: "row" }); columns.forEach((c) => el.append(h("span", { role: "cell", class: "ds-dl__c" + (c.cls ? " " + c.cls : ""), "data-label": c.label }, c.render(r)))); if (onRow) el.addEventListener("click", () => onRow(r)); return el; }));
}
