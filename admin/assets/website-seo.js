/* Framework Admin — SEO & Search Visibility of one website, inside the website's card on /admin/clients/:id/website. Admin keeps the status and summary, a checklist,
   recommendations, written reports (with an optional https link) and the search visibility figures; the client sees only what is published. Figures are typed here: nothing
   is fetched from Google (a future Search Console import would fill the same figures). Server text is never inserted as HTML. */
import { h, api } from "./ui.js";

const SEO_STATUS = { not_started: "Not started", in_progress: "In progress", optimised: "Optimised", monitoring: "Monitoring" };
const ITEM_STATUS = { todo: "To do", in_progress: "In progress", done: "Done" };
const PRIORITY = { "": "No priority", high: "High", medium: "Medium", low: "Low" };
const ERROR = {
  invalid_title: "Give it a title (up to 120 characters, one line).", invalid_detail: "That detail is too long (500 characters at most).", invalid_summary: "That summary is too long (1000 characters at most).",
  invalid_link: "Use a full https:// link with no spaces.", invalid_date: "Use real dates, with the end on or after the start.", invalid_number: "Use whole numbers (and a position between 1 and 1000).",
  invalid_note: "That note is too long (300 characters at most) or has odd characters.", invalid_period: "That period label is too long (40 characters at most).", invalid_input: "Check the details and try again.",
  duplicate_period: "Figures for that exact period already exist. Edit them instead.", too_many: "There are as many of these as can be kept here. Remove one first.",
  unavailable: "SEO details aren’t available on this site yet (a database change is waiting), so nothing was changed.", not_found: "That no longer exists. The panel has been refreshed.",
  writes_disabled: "Changes are switched off on this site, so nothing was changed.", session: "Your admin session has ended. Reload the page to sign in again.", denied: "This account isn’t allowed to make that change.", network: "Can’t reach the server. Check your connection and try again.",
};
const errorText = (err) => ERROR[err && err.code] || "That didn’t work and nothing was changed. Try again, and reload the page if it keeps happening.";
const field = (id, label, input, hint) => h("div", { class: "adm-field" }, h("label", { for: id, text: label }), hint ? h("p", { class: "adm-field__hint", text: hint }) : null, input);
const select = (id, options, value) => h("select", { id, class: "input" }, Object.entries(options).map(([v, t]) => h("option", { value: v, selected: v === (value || "") ? true : null }, t)));
const text = (id, value, props = {}) => h("input", { id, class: "input", type: "text", autocomplete: "off", value: value || "", ...props });
const area = (id, value, max) => { const t = h("textarea", { id, class: "input adm-brand__textarea", rows: "3", maxlength: String(max) }); t.value = value || ""; return t; };
const num = (id, value) => h("input", { id, class: "input", type: "text", inputmode: "decimal", autocomplete: "off", value: value == null ? "" : String(value) });
const orNull = (v) => { const t = String(v).trim(); return t === "" ? null : t; };

/** @param {{ base: string, site: {id: string, name: string}, canWrite: () => boolean, say: Function }} o  base is "/clients/:org/websites". */
export function seoPanel({ base, site, canWrite, say }) {
  const root = h("div", { class: "adm-ws__block adm-seo" });
  const url = `${base}/${encodeURIComponent(site.id)}/seo`;
  const pre = "seo-" + site.id.slice(0, 8);
  let data = null, busy = false;
  const opened = new Set(); // which sections are open survives a redraw after a save
  const fold = (key, title, meta, ...children) => h("details", { class: "adm-acc adm-acc--quiet", id: pre + "-" + key, open: opened.has(key) ? true : null, ontoggle: (ev) => { if (ev.target.open) opened.add(key); else opened.delete(key); } }, h("summary", { class: "adm-acc__sum" }, h("span", { class: "adm-acc__title", text: title }), meta ? h("span", { class: "adm-acc__meta", text: meta }) : null), h("div", { class: "adm-acc__body" }, ...children));

  async function act(request, success) {
    if (busy) return;
    busy = true; say("Working…", "info", { focus: false });
    try { await request(); say(success, "success"); } catch (err) { say(errorText(err), "error"); }
    busy = false;
    await load();
  }
  async function load() {
    try { data = await api(url); } catch (err) { root.replaceChildren(h("p", { class: "acc__group" }, "SEO & Search Visibility"), h("p", { class: "adm-muted", text: errorText(err) })); return; }
    draw();
  }
  const save = (label, fn) => (canWrite() ? h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: fn }, label)) : null);
  const remove = (what, fn) => (canWrite() ? h("button", { class: "btn btn--secondary adm-small adm-actions__danger", type: "button", onclick: fn }, `Remove ${what}`) : null);

  function head() {
    const status = select(pre + "-st", SEO_STATUS, data.status), summary = area(pre + "-sum", data.summary, 1000);
    const pub = h("input", { type: "checkbox", id: pre + "-pub", checked: data.published ? true : null });
    return h("div", { class: "adm-ws__block" },
      field(pre + "-st", "SEO status", status), field(pre + "-sum", "Summary for the client", summary, "A few plain sentences: what has been done and what is happening next."),
      h("div", { class: "adm-field" }, h("label", { class: "adm-choice", for: pre + "-pub" }, pub, h("span", { text: "Show SEO & Search Visibility to the client" })), h("p", { class: "adm-field__hint", text: "Until this is on, the client sees nothing here. Items, reports and figures marked as drafts below also stay hidden." })),
      save("Save status", () => act(() => api(url, { method: "POST", body: { status: status.value, summary: orNull(summary.value), published: pub.checked } }), "SEO status saved.")));
  }

  function itemRow(it) {
    const id = pre + "-i-" + it.id.slice(0, 8);
    const title = text(id + "-t", it.title, { maxlength: "120" }), detail = text(id + "-d", it.detail, { maxlength: "500" }), st = select(id + "-s", ITEM_STATUS, it.status);
    const pr = it.kind === "recommendation" ? select(id + "-p", PRIORITY, it.priority || "") : null;
    return h("li", { class: "adm-seo__row" }, field(id + "-t", "Title", title), field(id + "-d", "Detail", detail), field(id + "-s", "Status", st), pr ? field(id + "-p", "Priority", pr) : null,
      canWrite() ? h("div", { class: "adm-actions" },
        h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => act(() => api(`${url}/items/${it.id}/update`, { method: "POST", body: { title: title.value.trim(), detail: orNull(detail.value), status: st.value, ...(pr ? { priority: pr.value || null } : {}) } }), "Saved.") }, "Save"),
        remove("item", () => act(() => api(`${url}/items/${it.id}/delete`, { method: "POST", body: {} }), "Removed.")),
      ) : null);
  }
  function itemSection(kind, heading, rows) {
    const id = pre + "-new-" + kind;
    const title = text(id + "-t", "", { maxlength: "120" }), detail = text(id + "-d", "", { maxlength: "500" });
    const pr = kind === "recommendation" ? select(id + "-p", PRIORITY, "") : null;
    return fold(kind, heading, rows.length ? String(rows.length) : "None yet",
      rows.length ? h("ul", { class: "adm-seo__list" }, rows.map(itemRow)) : h("p", { class: "adm-muted", text: "None yet." }),
      canWrite() ? [field(id + "-t", "Add " + (kind === "checklist" ? "a checklist item" : "a recommendation"), title), field(id + "-d", "Detail (optional)", detail), pr ? field(id + "-p", "Priority", pr) : null,
        save("Add", () => { if (!title.value.trim()) { say(ERROR.invalid_title, "error"); title.focus(); return; } act(() => api(`${url}/items`, { method: "POST", body: { kind, title: title.value.trim(), detail: orNull(detail.value), ...(pr && pr.value ? { priority: pr.value } : {}) } }), "Added."); })] : null);
  }

  function reportRow(r) {
    const id = pre + "-r-" + r.id.slice(0, 8);
    const title = text(id + "-t", r.title, { maxlength: "120" }), period = text(id + "-p", r.period, { maxlength: "40" }), summary = area(id + "-s", r.summary, 1000), link = text(id + "-l", r.link, { maxlength: "300", inputmode: "url", placeholder: "https://" });
    const pub = h("input", { type: "checkbox", id: id + "-pub", checked: r.published ? true : null });
    return h("li", { class: "adm-seo__row" }, field(id + "-t", "Title", title), field(id + "-p", "Period", period, "For example “October 2026”."), field(id + "-s", "Summary", summary), field(id + "-l", "Link to the full report (optional)", link, "A shared document or report. https only."),
      h("div", { class: "adm-field" }, h("label", { class: "adm-choice", for: id + "-pub" }, pub, h("span", { text: "Show to the client" }))),
      canWrite() ? h("div", { class: "adm-actions" },
        h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => act(() => api(`${url}/reports/${r.id}/update`, { method: "POST", body: { title: title.value.trim(), period: orNull(period.value), summary: orNull(summary.value), link: orNull(link.value), published: pub.checked } }), "Saved.") }, "Save"),
        remove("report", () => act(() => api(`${url}/reports/${r.id}/delete`, { method: "POST", body: {} }), "Removed.")),
      ) : null);
  }
  function reportsSection() {
    const id = pre + "-new-r";
    const title = text(id + "-t", "", { maxlength: "120" }), period = text(id + "-p", "", { maxlength: "40" }), summary = area(id + "-s", "", 1000), link = text(id + "-l", "", { maxlength: "300", inputmode: "url", placeholder: "https://" });
    return fold("reports", "Reports", data.reports.length ? String(data.reports.length) : "None yet",
      data.reports.length ? h("ul", { class: "adm-seo__list" }, data.reports.map(reportRow)) : h("p", { class: "adm-muted", text: "None yet." }),
      canWrite() ? [field(id + "-t", "Add a report", title), field(id + "-p", "Period", period), field(id + "-s", "Summary", summary), field(id + "-l", "Link (optional)", link),
        save("Add report", () => { if (!title.value.trim()) { say(ERROR.invalid_title, "error"); title.focus(); return; } act(() => api(`${url}/reports`, { method: "POST", body: { title: title.value.trim(), period: orNull(period.value), summary: orNull(summary.value), link: orNull(link.value) } }), "Report added. It is a draft until you show it to the client."); })] : null);
  }

  function metricFields(id, m) {
    return { start: h("input", { id: id + "-a", class: "input", type: "date", value: (m && m.periodStart) || "" }), end: h("input", { id: id + "-b", class: "input", type: "date", value: (m && m.periodEnd) || "" }), imp: num(id + "-i", m && m.impressions), clk: num(id + "-c", m && m.clicks), pos: num(id + "-p", m && m.position), idx: num(id + "-x", m && m.indexedPages), note: text(id + "-n", m && m.note, { maxlength: "300" }) };
  }
  const metricBody = (f, extra = {}) => ({ period_start: f.start.value, period_end: f.end.value, impressions: orNull(f.imp.value), clicks: orNull(f.clk.value), position: orNull(f.pos.value), indexed_pages: orNull(f.idx.value), note: orNull(f.note.value), ...extra });
  const metricInputs = (id, f) => [field(id + "-a", "From", f.start), field(id + "-b", "To", f.end), field(id + "-i", "Impressions", f.imp), field(id + "-c", "Clicks", f.clk), field(id + "-p", "Average position", f.pos), field(id + "-x", "Pages in search", f.idx), field(id + "-n", "Note (optional)", f.note)];
  function metricRow(m) {
    const id = pre + "-m-" + m.id.slice(0, 8), f = metricFields(id, m);
    const pub = h("input", { type: "checkbox", id: id + "-pub", checked: m.published ? true : null });
    return h("li", { class: "adm-seo__row" }, ...metricInputs(id, f), h("div", { class: "adm-field" }, h("label", { class: "adm-choice", for: id + "-pub" }, pub, h("span", { text: "Show to the client" }))),
      canWrite() ? h("div", { class: "adm-actions" },
        h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => act(() => api(`${url}/metrics/${m.id}/update`, { method: "POST", body: metricBody(f, { published: pub.checked }) }), "Saved.") }, "Save"),
        remove("figures", () => act(() => api(`${url}/metrics/${m.id}/delete`, { method: "POST", body: {} }), "Removed.")),
      ) : null);
  }
  function metricsSection() {
    const id = pre + "-new-m", f = metricFields(id, null);
    return fold("metrics", "Search visibility figures", data.metrics.length ? String(data.metrics.length) : "None yet",
      h("p", { class: "adm-muted", text: "Typed in by hand from your own reports. The client is told they are entered by Framework and are not a live feed." }),
      data.metrics.length ? h("ul", { class: "adm-seo__list" }, data.metrics.map(metricRow)) : h("p", { class: "adm-muted", text: "None yet." }),
      canWrite() ? [h("p", { class: "adm-field__hint", text: "Add figures for a period (fill in what you have):" }), ...metricInputs(id, f),
        save("Add figures", () => act(() => api(`${url}/metrics`, { method: "POST", body: metricBody(f) }), "Figures added. They are a draft until you show them to the client."))] : null);
  }

  function draw() {
    if (!data.available) { root.replaceChildren(h("p", { class: "acc__group" }, "SEO & Search Visibility"), h("p", { class: "adm-muted", text: "SEO details aren’t available on this site yet (a database change is waiting)." })); return; }
    root.replaceChildren(h("p", { class: "acc__group" }, "SEO & Search Visibility"),
      h("p", { class: "adm-muted", text: "Shown to the client under Website, only once you turn it on below. Nothing is fetched from Google: you enter the information." }),
      head(), itemSection("checklist", "Checklist", data.checklist), itemSection("recommendation", "Recommendations", data.recommendations), metricsSection(), reportsSection());
  }

  root.append(h("p", { class: "acc__group" }, "SEO & Search Visibility"), h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: (ev) => { ev.currentTarget.remove(); load(); } }, "Open SEO details"));
  return root;
}
