/* Framework Admin — the review workspace of one website, inside the website's card on /admin/clients/:id/website. Admin sets the Staging address, publishes updates for the client to
   review (marked "needs approval" or "informational"), assigns the client tasks (a photo, a logo, a service description), and sees what the client decided or answered, including every
   rejection's revision notes. A draft is invisible to the client until "Show to the client" is on. Server text is never inserted as HTML. */
import { h, api } from "./ui.js";
import { badge } from "./kit.js";

const ENV = { staging: "Staging", production: "Production" };
const KIND = { approval: "Needs the client’s approval", info: "Informational" };
const CTA = { respond: "A written answer", review: "A review of Staging", upload: "Files (opens a request form)", none: "Nothing to do (for information)" };
const TASK_STATUS = { open: "Needed", done: "Done", cancelled: "Cancelled" };
const UPDATE_TONE = { awaiting_review: "pending", approved: "ok", rejected: "bad", info: "" };
const ERROR = {
  invalid_title: "Give it a title (up to 120 characters, one line).", invalid_detail: "That description is too long (600 characters at most).", invalid_url: "Use a full https:// address with no spaces, or leave it empty.",
  invalid_date: "Use a real date.", invalid_environment: "Choose Staging or Production.", invalid_kind: "Choose whether it needs approval or is informational.", invalid_cta: "Choose what the client does.",
  invalid_status: "Choose a status.", invalid_input: "Check the details and try again.", too_many: "There are as many of these as can be kept here. Archive an older one first.",
  unavailable: "The review workspace isn’t available on this site yet (a database change is waiting), so nothing was changed.", not_found: "That no longer exists. The panel has been refreshed.",
  writes_disabled: "Changes are switched off on this site, so nothing was changed.", session: "Your admin session has ended. Reload the page to sign in again.", denied: "This account isn’t allowed to make that change.",
};
const errorText = (err) => ERROR[err && err.code] || "That didn’t work and nothing was changed. Try again, and reload the page if it keeps happening.";
const field = (id, label, input, hint) => h("div", { class: "adm-field" }, h("label", { for: id, text: label }), hint ? h("p", { class: "adm-field__hint", text: hint }) : null, input);
const select = (id, options, value) => h("select", { id, class: "input" }, Object.entries(options).map(([v, t]) => h("option", { value: v, selected: v === value ? true : null }, t)));
const text = (id, value, props = {}) => h("input", { id, class: "input", type: "text", autocomplete: "off", value: value || "", ...props });
const area = (id, value, max) => { const t = h("textarea", { id, class: "input adm-brand__textarea", rows: "3", maxlength: String(max) }); t.value = value || ""; return t; };
const orNull = (v) => { const t = String(v).trim(); return t === "" ? null : t; };
const day = (iso) => (iso ? String(iso).slice(0, 10) : "");

/** @param {{ base: string, site: {id: string, name: string}, canWrite: () => boolean, say: Function }} o  base is "/clients/:org/websites". */
export function workspacePanel({ base, site, canWrite, say, hideStaging = false }) {
  const root = h("div", { class: "adm-ws__block adm-seo" });
  const url = `${base}/${encodeURIComponent(site.id)}/workspace`;
  const pre = "wk-" + site.id.slice(0, 8);
  let data = null, busy = false;
  const opened = new Set();
  const fold = (key, title, meta, ...children) => h("details", { class: "adm-acc adm-acc--quiet", id: pre + "-" + key, open: opened.has(key) ? true : null, ontoggle: (ev) => { if (ev.target.open) opened.add(key); else opened.delete(key); } },
    h("summary", { class: "adm-acc__sum" }, h("span", { class: "adm-acc__title", text: title }), h("span", { class: "adm-acc__meta", text: meta || "" })), h("div", { class: "adm-acc__body" }, children));

  async function act(request, success) {
    if (busy) return;
    busy = true; say("Working…", "info", { focus: false });
    try { await request(); say(success, "success"); } catch (err) { say(errorText(err), "error"); }
    busy = false;
    await load();
  }
  async function load() {
    try { data = await api(url); } catch (err) { root.replaceChildren(h("p", { class: "acc__group" }, "Review workspace"), h("p", { class: "adm-muted", text: errorText(err) })); return; }
    draw();
  }
  const save = (label, fn) => (canWrite() ? h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: fn }, label)) : null);
  const button = (label, fn, extra = "") => (canWrite() ? h("button", { class: "btn btn--secondary adm-small" + extra, type: "button", onclick: fn }, label) : null);
  const check = (id, label, on) => { const c = h("input", { type: "checkbox", id, checked: on ? true : null }); return { input: c, row: h("div", { class: "adm-field" }, h("label", { class: "adm-choice", for: id }, c, h("span", { text: label }))) }; };

  function stagingBlock() {
    const staging = text(pre + "-stg", data.stagingUrl, { maxlength: "300", inputmode: "url", placeholder: "https://staging.example.ca" });
    return h("div", { class: "adm-ws__block" }, field(pre + "-stg", "Staging address", staging, "Where the client reviews changes before they go live. https only. Leave empty if there is no staging version yet."),
      save("Save staging address", () => act(() => api(`${url}/staging`, { method: "POST", body: { staging_url: orNull(staging.value) } }), "Staging address saved.")));
  }

  function updateRow(u) {
    const id = pre + "-u-" + u.id.slice(0, 8);
    const title = text(id + "-t", u.title, { maxlength: "120" }), detail = area(id + "-d", u.detail, 600), env = select(id + "-e", ENV, u.environment), kind = select(id + "-k", KIND, u.kind);
    const pub = check(id + "-pub", "Show to the client", u.published);
    const decision = u.kind === "approval" && (u.status === "approved" || u.status === "rejected")
      ? h("div", { class: "adm-field" }, badge(u.status === "approved" ? "Approved by the client" : "Rejected by the client", UPDATE_TONE[u.status]), h("p", { class: "adm-muted", text: `${u.decidedBy || "The client"} · ${day(u.decidedAt)}` }),
        u.decisionNote ? h("p", null, h("strong", { text: "Revision notes: " }), u.decisionNote) : null)
      : h("div", { class: "adm-field" }, badge(u.status === "awaiting_review" ? (u.published ? "Awaiting the client’s review" : "Draft: not shown to the client") : "Informational", u.status === "awaiting_review" && u.published ? "pending" : ""));
    return h("li", { class: "adm-seo__row" }, decision, field(id + "-t", "Title", title), field(id + "-d", "What changed", detail), field(id + "-e", "Environment", env), field(id + "-k", "Type", kind), pub.row,
      canWrite() ? h("div", { class: "adm-actions" },
        button("Save", () => act(() => api(`${url}/updates/${u.id}/update`, { method: "POST", body: { title: title.value.trim(), detail: orNull(detail.value), environment: env.value, kind: kind.value, published: pub.input.checked } }), "Update saved.")),
        u.kind === "approval" && (u.status === "approved" || u.status === "rejected") ? button("Ask the client to review again", () => act(() => api(`${url}/updates/${u.id}/review`, { method: "POST", body: {} }), "The client is asked to review it again. The earlier decision stays on record.")) : null,
        button("Archive", () => act(() => api(`${url}/updates/${u.id}/archive`, { method: "POST", body: {} }), "Archived."), " adm-actions__danger"),
      ) : null);
  }
  function updatesSection() {
    const id = pre + "-new-u";
    const title = text(id + "-t", "", { maxlength: "120" }), detail = area(id + "-d", "", 600), env = select(id + "-e", ENV, "staging"), kind = select(id + "-k", KIND, "approval"), pub = check(id + "-pub", "Show to the client now", false);
    const waiting = data.updates.filter((u) => u.status === "awaiting_review" && u.published).length, rejected = data.updates.filter((u) => u.status === "rejected").length;
    const meta = [data.updates.length ? String(data.updates.length) : "None yet", waiting ? `${waiting} awaiting` : "", rejected ? `${rejected} rejected` : ""].filter(Boolean).join(" · ");
    return fold("updates", "Website updates", meta,
      h("p", { class: "adm-muted", text: "What you changed, for the client to look at. “Needs approval” shows Approve and Reject; a rejection always carries their notes." }),
      data.updates.length ? h("ul", { class: "adm-seo__list" }, data.updates.map(updateRow)) : h("p", { class: "adm-muted", text: "None yet." }),
      canWrite() ? [h("p", { class: "adm-field__hint", text: "Add an update:" }), field(id + "-t", "Title", title), field(id + "-d", "What changed", detail), field(id + "-e", "Environment", env), field(id + "-k", "Type", kind), pub.row,
        save("Add update", () => { if (!title.value.trim()) { say(ERROR.invalid_title, "error"); title.focus(); return; } act(() => api(`${url}/updates`, { method: "POST", body: { title: title.value.trim(), detail: orNull(detail.value), environment: env.value, kind: kind.value, published: pub.input.checked } }), pub.input.checked ? "Update added and shown to the client." : "Update added as a draft."); })] : null);
  }

  function taskRow(t) {
    const id = pre + "-t-" + t.id.slice(0, 8);
    const title = text(id + "-t", t.title, { maxlength: "120" }), detail = area(id + "-d", t.detail, 600), cta = select(id + "-c", CTA, t.cta), due = h("input", { id: id + "-due", class: "input", type: "date", value: t.dueDate || "" });
    const st = select(id + "-s", t.status === "submitted" ? { submitted: "Answered by the client", ...TASK_STATUS } : TASK_STATUS, t.status), pub = check(id + "-pub", "Show to the client", t.published);
    const answer = t.status === "submitted" ? h("div", { class: "adm-field" }, badge("The client answered", "pending"), h("p", { class: "adm-muted", text: `${t.respondedBy || "The client"} · ${day(t.respondedAt)}` }), h("p", null, h("strong", { text: "Their answer: " }), t.responseText || ""),
      h("p", { class: "adm-field__hint", text: "Mark it Done when you have what you need, or set it to Needed to ask again." })) : null;
    return h("li", { class: "adm-seo__row" }, answer, field(id + "-t", "What is needed", title), field(id + "-d", "Explanation", detail), field(id + "-c", "What the client does", cta), field(id + "-due", "Due date (optional)", due), field(id + "-s", "Status", st), pub.row,
      canWrite() ? h("div", { class: "adm-actions" },
        button("Save", () => act(() => api(`${url}/tasks/${t.id}/update`, { method: "POST", body: { title: title.value.trim(), detail: orNull(detail.value), cta: cta.value, due_date: due.value || null, ...(st.value !== t.status ? { status: st.value } : {}), published: pub.input.checked } }), "Task saved.")),
        button("Archive", () => act(() => api(`${url}/tasks/${t.id}/archive`, { method: "POST", body: {} }), "Archived."), " adm-actions__danger"),
      ) : null);
  }
  function tasksSection() {
    const id = pre + "-new-t";
    const title = text(id + "-t", "", { maxlength: "120" }), detail = area(id + "-d", "", 600), cta = select(id + "-c", CTA, "respond"), due = h("input", { id: id + "-due", class: "input", type: "date" }), pub = check(id + "-pub", "Show to the client now", true);
    const answered = data.tasks.filter((t) => t.status === "submitted").length, open = data.tasks.filter((t) => t.status === "open" && t.published).length;
    const meta = [data.tasks.length ? String(data.tasks.length) : "None yet", answered ? `${answered} answered` : "", open ? `${open} waiting on the client` : ""].filter(Boolean).join(" · ");
    return fold("tasks", "Needed from the client", meta,
      h("p", { class: "adm-muted", text: "What you need from them: a photo, a logo, a service description, an approval of copy. Files arrive through the website request form; a written answer arrives here." }),
      data.tasks.length ? h("ul", { class: "adm-seo__list" }, data.tasks.map(taskRow)) : h("p", { class: "adm-muted", text: "None yet." }),
      canWrite() ? [h("p", { class: "adm-field__hint", text: "Ask the client for something:" }), field(id + "-t", "What is needed", title), field(id + "-d", "Explanation", detail), field(id + "-c", "What the client does", cta), field(id + "-due", "Due date (optional)", due), pub.row,
        save("Add task", () => { if (!title.value.trim()) { say(ERROR.invalid_title, "error"); title.focus(); return; } act(() => api(`${url}/tasks`, { method: "POST", body: { title: title.value.trim(), detail: orNull(detail.value), cta: cta.value, due_date: due.value || null, published: pub.input.checked } }), pub.input.checked ? "Task added and shown to the client." : "Task added as a draft."); })] : null);
  }

  function draw() {
    if (!data.available) { root.replaceChildren(h("p", { class: "acc__group" }, "Review workspace"), h("p", { class: "adm-muted", text: "The review workspace isn’t available on this site yet (a database change is waiting for approval)." })); return; }
    root.replaceChildren(h("p", { class: "acc__group" }, "Review workspace"),
      h("p", { class: "adm-muted", text: "Shown to the client under Website, in the order: Staging and Main, updates and what you need, then their own change requests. Drafts stay invisible until you show them." }),
      ...(hideStaging ? [] : [stagingBlock()]), updatesSection(), tasksSection());
  }

  root.append(h("p", { class: "acc__group" }, "Review workspace"), h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: (ev) => { ev.currentTarget.remove(); load(); } }, "Open review workspace"));
  return root;
}
