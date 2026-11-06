/* Framework Admin — review kit: small, reusable pieces for reading a submitted assessment at a glance (stat cards, badges, meters, picture tiles, folds, attention lists).
   Nothing here knows about Brand Discovery specifically: a future Website or Marketing assessment passes its own data to the same pieces. Server text is only ever set as
   text. Bars use native <progress> and colours are SVG fill attributes, so nothing here needs an inline-style allowance; the one piece of markup involved,
   a generated SVG sketch, comes from our own drawing code and is shown as an image, never inserted into the page. */
import { h } from "./ui.js";

const HEX = /^#[0-9A-Fa-f]{6}$/;

/** A small pill. tone: ok | warn | bad | pending | (none) */
export const badge = (text, tone = "", extra = "") => h("span", { class: "adm-chip" + (tone ? " adm-chip--" + tone : "") + (extra ? " " + extra : ""), text });

/** One headline number or word with a caption; meter (0 to 1) draws a thin bar under it. */
export function statCard({ label, value, hint, meter, tone = "" }) {
  const bar = typeof meter === "number" ? h("progress", { class: "rk-meter", max: "100", value: String(Math.round(Math.max(0, Math.min(1, meter)) * 100)), "aria-label": `${label}: ${Math.round(meter * 100)} percent` }) : null;
  return h("div", { class: "rk-stat" + (tone ? " rk-stat--" + tone : "") }, h("span", { class: "rk-stat__label", text: label }), h("strong", { class: "rk-stat__value", text: value }), bar, hint ? h("span", { class: "rk-stat__hint", text: hint }) : null);
}

/** A titled card. */
export const card = (title, body, { id, aside, wide } = {}) => h("section", { class: "rk-card" + (wide ? " rk-card--wide" : ""), "aria-labelledby": id || null }, h("div", { class: "rk-card__head" }, h("h2", { class: "rk-card__title", id: id || null, text: title }), aside || null), body);

/** A collapsible block with a header row (title, a short meta line, badges). */
export function fold({ title, number, meta, badges, open, body, id }) {
  return h("details", { class: "rk-fold", id: id || null, open: open ? true : null },
    h("summary", { class: "rk-fold__sum" }, number ? h("span", { class: "rk-fold__no", text: number }) : null, h("span", { class: "rk-fold__title", text: title }), meta ? h("span", { class: "rk-fold__meta", text: meta }) : null, badges ? h("span", { class: "rk-fold__badges" }, badges) : null),
    h("div", { class: "rk-fold__body" }, body));
}

/** Expand or collapse every fold inside a container. */
export const foldControls = (container) => h("div", { class: "rk-folds-ctl" },
  h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => container.querySelectorAll("details.rk-fold").forEach((d) => { d.open = true; }) }, "Expand all"),
  h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => container.querySelectorAll("details.rk-fold").forEach((d) => { d.open = false; }) }, "Collapse all"));

/** A bar list: [{ label, count }] drawn relative to the biggest. */
export function barList(rows, { max: given } = {}) {
  const max = given || Math.max(1, ...rows.map((r) => r.count));
  return h("ul", { class: "rk-bars" }, rows.map((r) => h("li", null, h("span", { class: "rk-bars__label", text: r.label }), h("progress", { class: "rk-bars__track", max: String(max), value: String(r.count), "aria-label": `${r.label}: ${r.count}` }), h("span", { class: "rk-bars__n", text: String(r.count) }))));
}

/** A generated sketch (our own SVG) shown as an image: an <img> runs no script and takes no styling from the page. */
function sketch(svg) {
  if (typeof svg !== "string" || !svg.startsWith("<svg ") || /<script|<foreignObject|\son\w+=/i.test(svg)) return null;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace(/&(?!amp;|lt;|gt;|quot;|#)/g, "&amp;")); // a label like "Airy & minimal" is valid HTML but not valid XML
}

/** The picture for one choice: a photo, a colour strip, a lettering sample, a sketch, or a plain word card. */
export function visual(t, label) {
  if (t && t.type === "photo") return h("img", { class: "rk-vis rk-vis--photo" + (String(t.src).includes("/discovery-logos/") ? " rk-vis--logo" : ""), src: t.src, alt: "", loading: "lazy", width: "160", height: "100" });
  if (t && t.type === "colours") {
    const cols = (t.colours || []).filter((x) => HEX.test(x));
    const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "rk-vis rk-vis--colours"); svg.setAttribute("viewBox", `0 0 ${Math.max(1, cols.length)} 1`); svg.setAttribute("preserveAspectRatio", "none"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", `${label} colours`);
    cols.forEach((c, i) => { const r = document.createElementNS(NS, "rect"); r.setAttribute("x", String(i)); r.setAttribute("width", "1.01"); r.setAttribute("height", "1"); r.setAttribute("fill", c); svg.append(r); });
    return svg;
  }
  if (t && t.type === "font") return h("span", { class: "rk-vis rk-vis--font rk-font--" + String(t.font).replace(/[^a-z-]/g, ""), "aria-hidden": "true" }, h("span", { class: "rk-vis__aa", text: "Aa" }), h("span", { class: "rk-vis__sample", text: "Your Brand" }));
  const src = t && t.type === "sketch" ? sketch(t.svg) : null;
  return src ? h("img", { class: "rk-vis rk-vis--sketch", src, alt: "", width: "160", height: "100" }) : null;
}

/** One choice as a tile (picture over label) or, with no picture, as a pill. kind: like | dislike */
export function choice(pick, kind) {
  const v = visual(pick.thumb, pick.label);
  const mark = h("span", { class: "rk-choice__mark", "aria-hidden": "true", text: kind === "like" ? "✓" : "✕" });
  const sr = h("span", { class: "rk-sr", text: kind === "like" ? "Liked: " : "Not for me: " });
  if (!v) return h("li", { class: "rk-pill rk-pill--" + kind }, sr, mark, h("span", { text: pick.label }));
  return h("li", { class: "rk-tile rk-tile--" + kind }, h("span", { class: "rk-tile__pic" }, v, mark), h("span", { class: "rk-tile__label" }, sr, pick.label), pick.note && pick.thumb.type !== "colours" ? h("span", { class: "rk-tile__note", text: pick.note }) : null);
}

/** Likes then not-for-me, each as its own labelled group. Empty groups are left out. */
export function choiceGroups({ likes = [], dislikes = [] }) {
  const group = (picks, kind, title) => picks.length ? h("div", { class: "rk-group rk-group--" + kind }, h("h4", { class: "rk-group__title", text: title }), h("ul", { class: "rk-choices" }, picks.map((p) => choice(p, kind)))) : null;
  return [group(likes, "like", "Likes"), group(dislikes, "dislike", "Not for me")].filter(Boolean);
}

/** A short list of things to look at: [{ tone, title, detail?, where? }]. The first `limit` show; the rest sit behind one button-like summary. */
export function attentionList(rows, { limit = 4, empty = "Nothing here." } = {}) {
  if (!rows.length) return h("p", { class: "adm-muted", text: empty });
  const one = (r) => r.detail
    ? h("li", { class: "rk-attn" }, h("details", null, h("summary", null, badge(r.badge, r.tone), h("span", { class: "rk-attn__title", text: r.title }), r.where ? h("span", { class: "rk-attn__where", text: r.where }) : null), h("p", { class: "rk-attn__detail", text: r.detail })))
    : h("li", { class: "rk-attn" }, h("div", { class: "rk-attn__row" }, badge(r.badge, r.tone), h("span", { class: "rk-attn__title", text: r.title }), r.where ? h("span", { class: "rk-attn__where", text: r.where }) : null));
  const first = rows.slice(0, limit), rest = rows.slice(limit);
  return h("div", null, h("ul", { class: "rk-attns" }, first.map(one)), rest.length ? h("details", { class: "rk-more" }, h("summary", { text: `Show ${rest.length} more` }), h("ul", { class: "rk-attns" }, rest.map(one))) : null);
}

/** A calm "nothing here" block: an icon, a short title, one line of help and, optionally, the one action that fixes it. */
export function emptyState({ title, body, action }) {
  return h("div", { class: "rk-empty" }, navIcon("check"), h("p", { class: "rk-empty__title", text: title }), body ? h("p", { class: "rk-empty__body", text: body }) : null, action || null);
}

/** A whole card that is a link: an icon, a title and one line. Used for hubs (Settings) where each entry opens a page. */
export const linkCard = ({ href, title, body, icon, cls = "" }) => h("a", { class: "rk-linkcard" + (cls ? " " + cls : ""), href, "data-link": "" }, icon ? h("span", { class: "rk-linkcard__ico" }, navIcon(icon)) : null, h("span", { class: "rk-linkcard__text" }, h("strong", { text: title }), body ? h("span", { text: body }) : null), navIcon("chevron"));

const ICONS = {
  overview: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z", feedback: "M4 5h16v11H9l-5 4z", support: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8z",
  assessments: "M8 4h8v3H8zM6 5H5v16h14V5h-1M9 12h6M9 16h4", discovery: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z",
  clients: "M9 11a3 3 0 100-6 3 3 0 000 6zM3 20v-1a5 5 0 0110 0v1M17 11a3 3 0 000-6M21 20v-1a5 5 0 00-4-4.9", "approved-emails": "M3 6h18v12H3zM3 7l9 6 9-6",
  "additional-services": "M4 4h16v16H4zM12 8v8M8 12h8", "service-pricing": "M3 12V3h9l9 9-9 9zM8 8h.01", settings: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4",
  requests: "M5 4h14v16H5zM9 9h6M9 13h6M9 17h3",
  check: "M12 3a9 9 0 100 18 9 9 0 000-18zM8 12.4l2.7 2.7L16 9.8", chevron: "M9 6l6 6-6 6",
};
/** A 20px line icon by name (the module ids, plus check and chevron). Decorative: it is hidden from screen readers. */
export function navIcon(name) {
  const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("class", "rk-ico"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  const path = document.createElementNS(NS, "path"); path.setAttribute("d", ICONS[name] || ICONS.check); svg.append(path);
  return svg;
}

/** A boxed "find" field that filters what is already on the page. It changes nothing on the server. */
export const searchBox = ({ label, placeholder, onInput }) => h("input", { class: "input adm-search__input rk-find", type: "search", placeholder: placeholder || label, "aria-label": label, autocomplete: "off", oninput: (ev) => onInput(ev.target.value.trim().toLowerCase()) });
