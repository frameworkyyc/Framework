/* Framework Admin — Requests: /admin/requests (every client), /admin/requests/settings (per-service defaults), /admin/requests/:client/:request (one request) and
   /admin/clients/:client/requests (one client). The list says what needs attention first. A request page shows the answers, the whole timeline (private notes marked),
   the quote, the proofs and final files, and the moves Framework may make. Every rule is the server's (worker/portal/admin-requests.js); this file only presents and
   submits, and server text is never inserted as HTML. Nothing here deletes a request, an entry, a file or a quote. */

import { h, api, confirmDialog, errorState, fmtDateTime, fmtDate } from "./ui.js";
import { chip } from "./client-dashboard.js";
import { statCard } from "./kit.js";

const SCOPES = [["attention", "Needs attention"], ["open", "Open"], ["closed", "Closed"], ["all", "All"]];
const EMPTY = { attention: ["Nothing needs attention", "Every open request has been looked at."], open: ["No open requests", "Requests that are not completed, declined or cancelled appear here."], closed: ["No closed requests", ""], all: ["No requests yet", "Requests from every client appear here."] };
const STATUS_TONE = { new: "pending", in_review: "ok", quoted: "ok", approved: "ok", in_progress: "ok", client_review: "pending", revision_requested: "pending", completed: "plain", declined: "plain", cancelled: "plain" };
const MOVE_LABEL = { in_review: "Start review", in_progress: "Start work", client_review: "Send to the client for review", completed: "Mark completed", declined: "Decline", cancelled: "Cancel" };
const CONFIRM = {
  declined: ["Decline this request?", "The request closes and the client is told. Explain why in the note."],
  cancelled: ["Cancel this request?", "The request closes. The client can no longer reply on it."],
  completed: ["Mark as completed?", "The request closes and any final files are released to the client."],
  client_review: ["Send for review?", "The client is told a design is ready, and the proofs you uploaded for this round become visible to them."],
};
const ERROR_TEXT = {
  invalid_status: "Choose a status.", not_permitted_move: "That move isn’t possible from the current status.", use_quote_or_approval: "Use Send quote or Record approval for that.", no_proof: "Upload a design proof for the current round first.",
  quote_required: "Record the approval against the sent quote.", quote_not_open: "That quote is no longer open.", invalid_message: "That message is too long (up to 4,000 characters).", message_required: "Write something first.",
  invalid_title: "Give the quote a title.", scope_required: "Describe what the quote includes.", invalid_scope: "The quote’s description is too long (up to 2,000 characters).", invalid_amount: "Enter the amount in dollars, for example 180.00.", invalid_date: "Use a date like 2026-12-31.",
  invalid_count: "Choose 1 to 10 rounds.", invalid_role: "Choose what the file is.", not_allowed: "That isn’t possible for this request.", too_many_files: "This request already has the maximum of 20 reference files.",
  type_not_allowed: "That kind of file isn’t accepted here.", invalid_name: "That file name can’t be used.", content_mismatch: "The file’s contents don’t match its type.", active_content: "The file contains active content, so it can’t be stored.", pdf_encrypted: "Password-protected PDFs can’t be stored.",
  empty_file: "That file is empty.", file_too_large: "That file is too large.", no_file: "Choose a file first.", conflict: "That changed while you were working. The page has been refreshed.", not_found: "That no longer exists. The page has been refreshed.", closed: "That request is closed.",
  invalid_price: "Enter the price in dollars, for example 150.00.", invalid_revisions: "Revision rounds must be 0 to 20.", invalid_turnaround: "That turnaround note is too long (up to 120 characters).",
  writes_disabled: "Changes are switched off on this site, so nothing was changed.", storage_unavailable: "File storage isn’t available on this site. Nothing was uploaded.", storage_write_failed: "The file couldn’t be stored just now.",
  session: "Your admin session has ended. Reload the page to sign in again.", denied: "This account isn’t allowed to make that change.", network: "Can’t reach the server. Check your connection and try again.",
};
const GENERIC = "That didn’t work and nothing was changed. Try again, and reload the page if it keeps happening.";
export const errorText = (err) => ERROR_TEXT[err && err.code] || GENERIC;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : n + " B");
const enc = encodeURIComponent;

export async function render(ctx) {
  const parts = ctx.url.pathname.replace(/\/+$/, "").split("/").filter(Boolean); // admin, requests, [settings | client, request]  OR  admin, clients, id, requests
  if (parts[1] === "clients") return renderClient(decodeURIComponent(parts[2]), ctx);
  if (parts.length === 4) return renderThread(decodeURIComponent(parts[2]), decodeURIComponent(parts[3]), ctx);
  if (parts.length === 3 && parts[2] === "settings") return renderSettings(ctx);
  return renderGlobal(ctx);
}

/* ------------------------------------------------------------------ the global queue */

const reqRow = (r, { client = true } = {}) => h("li", null, h("a", { class: "adm-reqrow", href: `/admin/requests/${enc(r.organization ? r.organization.id : r.orgId)}/${enc(r.id)}`, "data-link": "" },
  h("span", { class: "adm-reqrow__main" }, client && r.organization ? h("span", { class: "adm-reqrow__client", text: r.organization.name }) : null, h("span", { class: "adm-reqrow__title", text: r.title }),
    h("span", { class: "adm-sub", text: `${r.typeLabel} · last activity ${fmtDateTime(r.lastMessageAt)}` })),
  h("span", { class: "adm-reqrow__chips" }, r.reason ? chip("pending", r.reason, "info") : null, chip(STATUS_TONE[r.status] || "plain", r.statusLabel), chip("plain", r.kindLabel)),
  h("span", { class: "adm-reqrow__go", "aria-hidden": "true", text: "→" })));

async function renderGlobal(ctx) {
  const scope = SCOPES.some(([k]) => k === ctx.url.searchParams.get("scope")) ? ctx.url.searchParams.get("scope") : "attention";
  let data;
  try { data = await api("/requests?scope=" + scope); } catch (err) { return { title: "Requests", node: h("div", { class: "adm-page" }, errorState(err, ctx.retry)) }; }
  const head = (sub) => h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, "Framework Admin"), h("h1", { class: "adm-title", tabindex: "-1" }, "Requests"), h("p", { class: "adm-sub" }, sub)), h("div", { class: "adm-actions" }, h("a", { class: "btn btn--secondary adm-small", href: "/admin/requests/settings", "data-link": "" }, "Service settings")));
  if (!data.available) return { title: "Requests", node: h("div", { class: "adm-page" }, head("Deliverables, SEO and Custom Development requests from every client."), h("p", { class: "adm-banner" }, "Requests aren’t available on this deployment yet (its database doesn’t have the request tables).")) };
  const tabs = h("nav", { class: "adm-tabs", "aria-label": "Show" }, h("ul", null, SCOPES.map(([k, label]) => h("li", null, h("a", { class: "adm-tab", href: "/admin/requests" + (k === "attention" ? "" : "?scope=" + k), "data-link": "", "aria-current": k === scope ? "page" : null }, label, k === "attention" ? h("span", { class: "adm-tab__n", text: String(data.totals.attention) }) : k === "open" ? h("span", { class: "adm-tab__n", text: String(data.totals.open) }) : null)))));
  const [et, eb] = EMPTY[scope];
  return { title: "Requests", node: h("div", { class: "adm-page" }, head("Deliverables, SEO and Custom Development requests from every client. Open one to read it, reply, quote, send designs and move it along."),
    h("div", { class: "rk-stats", role: "group", "aria-label": "Summary" }, statCard({ label: "Needs attention", value: String(data.totals.attention), hint: data.totals.attention ? "new, replied to or waiting on Framework" : "all looked at", tone: data.totals.attention ? "warn" : "ok" }), statCard({ label: "Open", value: String(data.totals.open), hint: "not completed, declined or cancelled" })),
    tabs, data.requests.length ? h("ul", { class: "adm-reqlist", "aria-label": "Requests" }, data.requests.map((r) => reqRow(r))) : h("div", { class: "adm-state", role: "status" }, h("h2", { text: et }), eb ? h("p", { text: eb }) : null)) };
}

async function renderClient(orgId, ctx) {
  let data;
  try { data = await api(`/clients/${enc(orgId)}/requests`); } catch (err) { return { title: "Requests", node: h("div", { class: "adm-page" }, errorState(err, ctx.retry)) }; }
  const back = h("a", { class: "adm-back", href: "/admin/clients/" + enc(orgId), "data-link": "" }, "← " + (data.organization ? data.organization.name : "Client"));
  if (!data.available) return { title: "Requests", node: h("div", { class: "adm-page" }, back, h("h1", { class: "adm-title", tabindex: "-1" }, "Requests"), h("p", { class: "adm-banner" }, "Requests aren’t available on this deployment yet.")) };
  return { title: "Requests — " + data.organization.name, node: h("div", { class: "adm-page" }, back, h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, data.organization.name), h("h1", { class: "adm-title", tabindex: "-1" }, "Requests"), h("p", { class: "adm-sub" }, "Everything this client has asked for."))),
    data.requests.length ? h("ul", { class: "adm-reqlist", "aria-label": "Requests" }, data.requests.map((r) => reqRow({ ...r, orgId }, { client: false }))) : h("p", { class: "adm-muted", text: "This client hasn’t made any requests." })) };
}

/* ------------------------------------------------------------------ service settings */

async function renderSettings(ctx) {
  let data;
  try { data = await api("/requests/settings"); } catch (err) { return { title: "Service settings", node: h("div", { class: "adm-page" }, errorState(err, ctx.retry)) }; }
  const back = h("a", { class: "adm-back", href: "/admin/requests", "data-link": "" }, "← Requests");
  if (!data.available) return { title: "Service settings", node: h("div", { class: "adm-page" }, back, h("h1", { class: "adm-title", tabindex: "-1" }, "Service settings"), h("p", { class: "adm-banner" }, "Requests aren’t available on this deployment yet.")) };
  const live = h("p", { class: "adm-msg", role: "status", tabindex: "-1", hidden: true });
  const say = (text, tone) => { live.textContent = text; live.className = "adm-msg is-" + tone; live.hidden = !text; live.focus({ preventScroll: false }); };
  const row = (s) => {
    const enabled = h("input", { type: "checkbox", id: "en-" + s.typeKey, checked: s.enabled ? true : null });
    const rev = s.proofs ? h("input", { class: "input", id: "rv-" + s.typeKey, type: "number", min: "0", max: "20", value: String(s.revisionsIncluded), "aria-label": `${s.label}: revision rounds included` }) : null;
    const mode = h("select", { class: "input", id: "pm-" + s.typeKey, "aria-label": `${s.label}: pricing` }, h("option", { value: "quote", selected: s.pricingMode === "quote" ? true : null, text: "Custom quote" }), h("option", { value: "fixed", selected: s.pricingMode === "fixed" ? true : null, text: "Fixed price" }));
    const price = h("input", { class: "input", id: "pr-" + s.typeKey, type: "text", inputmode: "decimal", value: s.price, placeholder: "150.00", "aria-label": `${s.label}: fixed price in dollars (CAD)` });
    const turn = h("input", { class: "input", id: "tn-" + s.typeKey, type: "text", maxlength: "120", value: s.turnaroundNote, placeholder: "For example about a week", "aria-label": `${s.label}: turnaround note` });
    const save = h("button", { class: "btn btn--secondary adm-small", type: "button", disabled: data.capabilities.writes ? null : true, onclick: async () => {
      save.disabled = true;
      try {
        await api("/requests/settings", { method: "POST", body: { type_key: s.typeKey, enabled: enabled.checked, ...(rev ? { revisions_included: rev.value === "" ? null : Number(rev.value) } : {}), pricing_mode: mode.value, price: mode.value === "fixed" ? price.value.trim() : "", turnaround_note: turn.value.trim() } });
        say(`${s.label} saved.`, "success");
      } catch (e) { say(errorText(e), "error"); }
      save.disabled = !data.capabilities.writes;
    } }, "Save");
    return h("tr", null, h("th", { scope: "row" }, s.label), h("td", null, enabled), h("td", null, rev || h("span", { class: "adm-muted", text: "n/a" })), h("td", null, mode, price), h("td", null, turn), h("td", null, save));
  };
  const groups = [...new Set(data.services.map((s) => s.kindLabel))].map((k) => h("section", { class: "adm-section" }, h("h2", { class: "adm-h2", text: k }),
    h("div", { class: "adm-tablewrap" }, h("table", { class: "adm-table" }, h("thead", null, h("tr", null, ["Service", "Offered", "Revision rounds", "Pricing", "Turnaround", ""].map((t) => h("th", { scope: "col", text: t })))), h("tbody", null, data.services.filter((s) => s.kindLabel === k).map(row))))));
  return { title: "Service settings", node: h("div", { class: "adm-page" }, back, h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, "Framework Admin"), h("h1", { class: "adm-title", tabindex: "-1" }, "Service settings"),
    h("p", { class: "adm-sub" }, "What each service offers its clients. A price shows to clients only when you enter one; otherwise they see “Custom quote”. Design services default to two included revision rounds."))),
    data.capabilities.writes ? null : h("p", { class: "adm-banner" }, "Changes are switched off on this site: you can read the settings but not change them."),
    h("p", { class: "adm-banner" }, data.acceptanceOpen ? "Clients can accept quotes in the portal." : "Accepting a quote in the portal is switched off until Framework’s terms are published. Record an approval yourself once a client has agreed."), live, ...groups) };
}

/* ------------------------------------------------------------------ one request */

async function renderThread(orgId, rid, ctx) {
  const base = `/clients/${enc(orgId)}/requests/${enc(rid)}`;
  let data;
  try { data = await api(base); } catch (err) { return { title: "Request", node: h("div", { class: "adm-page" }, errorState(err, ctx.retry)) }; }
  const back = h("a", { class: "adm-back", href: "/admin/requests", "data-link": "" }, "← All requests");
  if (!data.available) return { title: "Request", node: h("div", { class: "adm-page" }, back, h("p", { class: "adm-banner" }, "Requests aren’t available on this deployment yet.")) };
  const root = h("div", { class: "adm-page adm-rqpage" });
  const live = h("p", { class: "adm-msg", role: "status", tabindex: "-1", hidden: true });
  let busy = false;
  const writes = () => data.capabilities.writes;

  function say(text, tone = "info", focus = true) { live.textContent = text; live.className = "adm-msg is-" + tone; live.setAttribute("role", tone === "error" ? "alert" : "status"); live.hidden = !text; if (text && focus) live.focus({ preventScroll: false }); }
  function lock(on) { root.toggleAttribute("aria-busy", on); root.querySelectorAll("button, input, select, textarea").forEach((el) => { if (on) { el.dataset.was = el.disabled ? "1" : ""; el.disabled = true; } else if (el.dataset.was === "") el.disabled = false; }); }
  async function reload() { try { data = await api(base); draw(); } catch { /* the previous view stays */ } }
  async function perform({ confirm, request, success, onError }) {
    if (busy) return false;
    if (confirm && !(await confirmDialog(confirm))) return false;
    busy = true; lock(true); say("Working…", "info", false);
    let outcome, ok = false;
    try { const res = await request(); outcome = { tone: "success", text: typeof success === "function" ? success(res) : success }; ok = true; } catch (e) { outcome = { tone: "error", text: (onError && onError(e)) || errorText(e) }; }
    busy = false; await reload(); say(outcome.text, outcome.tone); lock(false);
    return ok;
  }
  const post = (suffix, body) => api(`${base}${suffix}`, { method: "POST", body });
  const fileUrl = (f, view) => `/api/admin${base}/files/${enc(f.id)}/download${view ? "?view=1" : ""}`;
  const field = (id, label, control, hint) => h("div", { class: "adm-field" }, h("label", { for: id, text: label }), hint ? h("span", { class: "adm-field__hint", text: hint }) : null, control);

  const r = () => data.request;

  function answers() {
    const rows = r().details.map((d) => h("div", { class: "adm-rq-dl__r" }, h("dt", { text: d.label }), h("dd", { class: "adm-rq-pre", text: d.value })));
    if (r().neededBy) rows.push(h("div", { class: "adm-rq-dl__r" }, h("dt", { text: "Needed by" }), h("dd", { text: fmtDate(r().neededBy + "T12:00:00Z") })));
    const b = r().brand;
    if (b && (b.logos.length || b.colours.length || b.fonts.length)) rows.push(h("div", { class: "adm-rq-dl__r" }, h("dt", { text: "Brand chosen" }), h("dd", null,
      b.logos.length ? h("p", { text: "Logos: " + b.logos.map((l) => l.title).join(", ") }) : null, b.colours.length ? h("p", { text: "Colours: " + b.colours.map((c) => `${c.name || ""} ${c.hex}`.trim()).join(", ") }) : null, b.fonts.length ? h("p", { text: "Fonts: " + b.fonts.map((f) => f.family).join(", ") }) : null)));
    return h("section", { class: "adm-section" }, h("h2", { class: "adm-h2", text: "What the client asked for" }), rows.length ? h("dl", { class: "adm-rq-dl" }, rows) : h("p", { class: "adm-muted", text: "No details." }));
  }

  function statusPanel() {
    const moves = r().moves.filter((m) => m !== "quoted" && m !== "approved");
    if (!moves.length) return h("section", { class: "adm-section" }, h("h2", { class: "adm-h2", text: "Status" }), h("p", { class: "adm-muted", text: `This request is ${r().statusLabel.toLowerCase()}. It can’t move further, but you can still reply or add a note.` }));
    const note = h("textarea", { class: "input", rows: "2", maxlength: "4000", id: "mv-note", "aria-label": "Note to the client with the move (optional)", placeholder: "Note to the client (optional)" });
    return h("section", { class: "adm-section" }, h("h2", { class: "adm-h2", text: "Move it along" }), note,
      h("div", { class: "adm-actions" }, moves.map((m) => h("button", { class: "btn " + (m === "declined" || m === "cancelled" ? "btn--secondary" : "btn--primary") + " adm-small", type: "button", disabled: writes() ? null : true, onclick: () => {
        const c = CONFIRM[m];
        perform({ confirm: c ? { title: c[0], body: c[1], details: [["Request", r().title], ["New status", MOVE_LABEL[m]]], confirmLabel: "Yes, continue" } : null, request: () => post("/status", { status: m, note: note.value.trim() || null }), success: `Moved: ${MOVE_LABEL[m]}.` });
      } }, MOVE_LABEL[m]))));
  }

  function quotesPanel() {
    const open = data.quotes.find((q) => q.status === "sent");
    const canQuote = ["new", "in_review", "quoted"].includes(r().status);
    const list = [...data.quotes].reverse().map((q) => h("li", { class: "adm-rq-quote" }, h("p", null, h("strong", { text: `${q.title} · ${q.amountLabel}` }), " ", chip(q.status === "sent" ? "pending" : q.status === "accepted" ? "ok" : "plain", { sent: "Sent", accepted: "Accepted", declined: "Declined", superseded: "Replaced", withdrawn: "Withdrawn" }[q.status] || q.status)),
      h("p", { class: "adm-rq-pre", text: q.scope }), h("p", { class: "adm-muted", text: `Version ${q.version} · ${fmtDateTime(q.createdAt)}${q.validUntil ? ` · valid until ${fmtDate(q.validUntil + "T12:00:00Z")}` : ""}${q.status === "accepted" ? (q.decidedVia === "staff_record" ? " · agreement recorded by Framework" : ` · accepted in the portal by ${q.acceptedName || "the client"}`) : ""}` }),
      q.status === "sent" ? h("button", { class: "btn btn--secondary adm-small", type: "button", disabled: writes() ? null : true, onclick: () => perform({ confirm: { title: "Withdraw this quote?", body: "The client will no longer see it.", confirmLabel: "Withdraw" }, request: () => post(`/quotes/${enc(q.id)}/withdraw`, {}), success: "Quote withdrawn." }) }, "Withdraw") : null));
    const title = h("input", { class: "input", id: "q-t", type: "text", maxlength: "120", value: r().title }), scope = h("textarea", { class: "input", id: "q-s", rows: "4", maxlength: "2000" });
    const amount = h("input", { class: "input", id: "q-a", type: "text", inputmode: "decimal", placeholder: "180.00" }), until = h("input", { class: "input", id: "q-u", type: "date" });
    const err = h("p", { class: "adm-field__error", role: "alert", hidden: true });
    const form = canQuote ? h("form", { class: "adm-form", novalidate: true }, h("h3", { class: "adm-h3", text: open ? "Send a revised quote" : "Send a quote" }),
      field("q-t", "Title", title), field("q-s", "What is included", scope, "Written so the client knows exactly what they are agreeing to."), field("q-a", "Amount (CAD, in dollars)", amount, "Typed by you. Nothing is calculated and no tax is added."), field("q-u", "Valid until (optional)", until), err,
      h("div", { class: "adm-actions" }, h("button", { class: "btn btn--primary", type: "submit", disabled: writes() ? null : true }, "Send quote"))) : null;
    if (form) form.addEventListener("submit", async (ev) => { ev.preventDefault(); err.hidden = true;
      await perform({ confirm: { title: "Send this quote?", body: "The client is told a quote is ready. Approval is recorded separately.", details: [["Title", title.value], ["Amount", "$" + amount.value + " CAD"]], confirmLabel: "Send quote" }, request: () => post("/quotes", { title: title.value, scope: scope.value, amount: amount.value, valid_until: until.value || null }), success: "Quote sent. The client has been told." }); });
    const approveNote = h("input", { class: "input", id: "ap-n", type: "text", maxlength: "500", placeholder: "How it was agreed, for example “by phone, Nov 12”" });
    const approve = ["quoted", "in_review"].includes(r().status) ? h("div", { class: "adm-form" }, h("h3", { class: "adm-h3", text: "Record approval" }),
      h("p", { class: "adm-muted", text: data.quoteAcceptanceOpen ? "Clients can also accept in the portal. Use this when they agree some other way." : "Clients cannot accept quotes in the portal yet. When they agree some other way, record it here: this is Framework’s record that work may start." }),
      field("ap-n", "Note (optional)", approveNote),
      h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary", type: "button", disabled: writes() ? null : true, onclick: () => perform({ confirm: { title: "Record approval?", body: "Only do this once the client has agreed. The client will see that Framework recorded it.", details: [["Request", r().title], open ? ["Quote", `${open.title} · ${open.amountLabel}`] : ["Quote", "None (no charge or included)"]], confirmLabel: "Yes, record it" }, request: () => post("/approve", { quote_id: open ? open.id : null, note: approveNote.value.trim() }), success: "Approval recorded." }) }, "Record approval"))) : null;
    return h("section", { class: "adm-section" }, h("h2", { class: "adm-h2", text: "Quote and approval" }), list.length ? h("ul", { class: "adm-rq-quotes" }, list) : h("p", { class: "adm-muted", text: "No quote has been sent." }), form, approve);
  }

  function filesPanel() {
    const by = (role) => data.files.filter((f) => f.role === role);
    const li = (f) => h("li", { class: "adm-rq-file" }, f.hasPreview || ["png", "jpg", "webp"].includes(f.format) ? h("a", { href: fileUrl(f, true), target: "_blank", rel: "noopener" }, h("img", { class: "adm-rq-thumb", src: fileUrl(f, true), alt: `Preview of ${f.name}`, loading: "lazy" })) : null,
      h("span", { class: "adm-rq-file__main" }, h("a", { class: "adm-link", href: fileUrl(f, false), download: "" }, `${f.name} (${fmtSize(f.size)})`), h("span", { class: "adm-muted", text: `${f.role === "proof" ? `Proof version ${f.version}, round ${f.round}` : f.role === "final" ? "Final file" : f.uploader === "client" ? "From the client" : "From Framework"} · ${fmtDateTime(f.createdAt)}` })),
      f.role === "proof" && !f.hasPreview && f.format === "pdf" && writes() ? h("label", { class: "adm-small adm-link" }, "Add a preview picture ", h("input", { type: "file", accept: ".png,.jpg,.jpeg,.webp", onchange: async (ev) => { const file = ev.target.files && ev.target.files[0]; if (!file) return; const fd = new FormData(); fd.append("file", file); await perform({ request: () => api(`${base}/files/${enc(f.id)}/preview`, { method: "POST", body: fd }), success: "Preview picture added." }); } })) : null);
    const group = (title, role, note) => by(role).length ? h("div", null, h("h3", { class: "adm-h3", text: title }), note ? h("p", { class: "adm-muted", text: note }) : null, h("ul", { class: "adm-rq-files" }, by(role).map(li))) : null;
    const role = h("select", { class: "input", id: "up-r" }, [["proof", "Design proof (draft until you send it for review)"], ["final", "Final file (released when the request is completed)"], ["attachment", "File the client can see now"]].filter(([k]) => k !== "proof" || r().kind === "deliverable").map(([k, t]) => h("option", { value: k, text: t })));
    const file = h("input", { class: "input", id: "up-f", type: "file" }), note = h("input", { class: "input", id: "up-n", type: "text", maxlength: "500", placeholder: "Optional note" });
    const err = h("p", { class: "adm-field__error", role: "alert", hidden: true });
    const form = h("form", { class: "adm-form", novalidate: true }, h("h3", { class: "adm-h3", text: "Add a file" }), field("up-r", "What is it?", role), field("up-f", "File", file, "Proofs: PNG, JPG, WebP or PDF. Finals: images, PDF, vector, fonts, Office files or a ZIP, up to 50 MB."), field("up-n", "Note (optional)", note), err,
      h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary", type: "submit", disabled: writes() && data.capabilities.storage ? null : true }, "Upload")));
    form.addEventListener("submit", async (ev) => { ev.preventDefault(); err.hidden = true; const f = file.files && file.files[0]; if (!f) { err.textContent = errorText({ code: "no_file" }); err.hidden = false; return; }
      const fd = new FormData(); fd.append("file", f); fd.append("meta", JSON.stringify({ role: role.value, note: note.value.trim() }));
      await perform({ request: () => api(`${base}/files`, { method: "POST", body: fd }), success: role.value === "proof" ? "Proof uploaded. It stays hidden until you send the request for review." : role.value === "final" ? "Final file uploaded. The client gets it when the request is completed." : "File added." }); });
    const grant = r().kind === "deliverable" ? h("div", { class: "adm-form" }, h("h3", { class: "adm-h3", text: "Revision rounds" }), h("p", { class: "adm-muted", text: `${r().revisions.used} used of ${r().revisions.included + r().revisions.paid} (${r().revisions.included} included${r().revisions.paid ? `, ${r().revisions.paid} added` : ""}).` }),
      h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary adm-small", type: "button", disabled: writes() ? null : true, onclick: () => perform({ confirm: { title: "Add a revision round?", body: "Use this when you and the client have agreed to an extra round. Nothing is charged here.", confirmLabel: "Add one round" }, request: () => post("/revisions", { count: 1 }), success: "One extra revision round added." }) }, "Add one extra round"))) : null;
    return h("section", { class: "adm-section" }, h("h2", { class: "adm-h2", text: "Files" }), group("Design proofs", "proof", "A proof is visible to the client only after you send the request for review."), group("Final files", "final", "Released to the client when the request is completed."), group("Client references", "reference"), group("Attachments", "attachment"),
      data.files.length ? null : h("p", { class: "adm-muted", text: "No files yet." }), form, grant);
  }

  function timeline() {
    const label = (ev) => (ev.kind === "quote" ? `Quote sent: ${ev.body}` : ev.kind === "revision" ? "Revision requested" : ev.kind === "approval" ? "Approved" : ev.kind === "proof" ? "Proof uploaded" : ev.kind === "delivery" ? "Final file uploaded" : ev.statusTo ? `Status: ${ev.statusTo.replace(/_/g, " ")}` : "");
    const items = data.events.map((ev) => ev.kind === "message"
      ? h("li", { class: "adm-msgrow" + (ev.authorType === "staff" ? " is-staff" : "") + (ev.visibility === "internal" ? " is-note" : "") }, h("p", null, h("strong", { text: ev.authorName || (ev.authorType === "staff" ? "Framework" : "Client") }), " ", h("span", { class: "adm-muted", text: fmtDateTime(ev.createdAt) }), ev.visibility === "internal" ? chip("pending", "Private note", "info") : null), h("p", { class: "adm-msgrow__body", text: ev.body }))
      : h("li", { class: "adm-msgrow adm-msgrow--status" }, h("p", null, h("strong", { text: label(ev) }), " ", h("span", { class: "adm-muted", text: `${ev.authorName || ""} · ${fmtDateTime(ev.createdAt)}` }), ev.visibility === "internal" ? chip("pending", "Staff only", "info") : null), ev.body && ev.kind !== "quote" ? h("p", { class: "adm-msgrow__body", text: ev.body }) : null));
    const body = h("textarea", { class: "input", rows: "4", maxlength: "4000", id: "rb", required: true }), internal = h("input", { type: "checkbox", id: "ri" });
    const form = h("form", { class: "adm-form", novalidate: true }, field("rb", "Reply to the client", body), h("label", { class: "adm-check" }, internal, " Private note: keep it for staff (the client is not shown it or emailed)"),
      h("div", { class: "adm-actions" }, h("button", { class: "btn btn--primary", type: "submit", disabled: writes() ? null : true }, "Send")));
    form.addEventListener("submit", async (ev) => { ev.preventDefault(); const isNote = internal.checked; await perform({ request: () => post("/reply", { body: body.value, internal: isNote }), success: isNote ? "Private note saved." : "Reply sent. The client will see it in the portal." }); });
    return h("section", { class: "adm-section" }, h("h2", { class: "adm-h2", text: "Timeline" }), h("ol", { class: "adm-msglist", "aria-label": "Timeline" }, items), form);
  }

  function draw() {
    const q = r();
    root.replaceChildren(...[
      back, h("a", { class: "adm-back", href: `/admin/requests?scope=all`, hidden: true }),
      h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, data.organization.name), h("h1", { class: "adm-title", tabindex: "-1" }, q.title),
        h("p", { class: "adm-inv__chips" }, chip(STATUS_TONE[q.status] || "plain", q.statusLabel), chip("plain", q.typeLabel), chip("plain", q.kindLabel), q.revisions.included + q.revisions.paid ? chip("plain", `${q.revisions.used}/${q.revisions.included + q.revisions.paid} revisions used`) : null),
        h("p", { class: "adm-sub" }, h("a", { class: "adm-link", href: `/admin/clients/${enc(data.organization.id)}/requests`, "data-link": "" }, "All requests from this client"), ` · opened ${fmtDateTime(q.createdAt)}`))),
      writes() ? null : h("p", { class: "adm-banner" }, "Changes are switched off on this site: you can read the request, but not change it."),
      live, answers(), statusPanel(), quotesPanel(), filesPanel(), timeline(),
    ].filter((n) => n && !n.hidden));
  }
  draw();
  if (writes() && q0needsLook(data)) { try { await api(`${base}/seen`, { method: "POST", body: {} }); } catch { /* a courtesy */ } }
  return { title: data.request.title, node: root };
}
const q0needsLook = (d) => d.request.needsLook;
