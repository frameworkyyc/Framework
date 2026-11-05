/* Framework Admin — Discovery assessments: /admin/discovery (assign and track), /admin/discovery/content (edit the questions, options and reference pictures),
   /admin/discovery/<client>/<assessment> (links, what the recipient answered, files, and the creative brief). Server text is never inserted as HTML. A secret link is
   shown once, when it is made, and never again (only its hash is stored). */
import { h, api, fmtDateTime, errorState, confirmDialog } from "./ui.js";
import { badge, statCard, card, fold, foldControls, barList, choiceGroups, attentionList } from "./review-kit.js";

const STATUS = { not_started: ["Not started", "pending"], in_progress: ["In progress", "warn"], submitted: ["Submitted", "ok"], reviewed: ["Reviewed", "ok"] };
const statusChip = (s) => h("span", { class: "adm-chip adm-chip--" + (STATUS[s] || ["", "pending"])[1], text: (STATUS[s] || [s])[0] });
const ERROR = {
  invalid_kind: "Choose a type of assessment.", invalid_title: "Give it a title.", invalid_days: "Choose how long the link lasts (1 to 90 days).", invalid_label: "That wording isn’t valid.", invalid_option: "That option doesn’t exist.", invalid_item: "That question doesn’t exist.",
  invalid_enabled: "Choose shown or hidden.", invalid_sort_order: "That order isn’t valid.", nothing_to_change: "Nothing to change.", not_found: "That no longer exists. The page has been refreshed.", not_submitted: "Only a submitted assessment can be reviewed or reopened.",
  closed: "It has already been sent, so it can’t be changed that way.", too_many: "That is the most that can be added.", type_not_allowed: "Use a PNG, JPG or WebP picture.", file_too_large: "That picture is too large (5 MB at most).", content_mismatch: "That file doesn’t look like its file type.",
  empty_file: "That file is empty.", no_file: "Choose a picture first.", unavailable: "That isn’t available on this site yet (a database update has not been applied here).", writes_disabled: "Changes are switched off on this site, so nothing was changed.",
  invalid_date: "Choose a real date that is not in the future.", not_due: "That is no longer due, so nothing was deleted.", confirm_required: "Confirmation is needed.", storage_delete_failed: "A file could not be deleted, so nothing was changed. Try again.",
  session: "Your admin session has ended. Reload the page to sign in again.", denied: "This account isn’t allowed to do that.",
};
const errorText = (err) => ERROR[err && err.code] || "That didn’t work and nothing was changed. Try again, and reload the page if it keeps happening.";
const orgHref = (org) => "/admin/clients/" + encodeURIComponent(org);
const detailHref = (org, id) => `/admin/discovery/${encodeURIComponent(org)}/${encodeURIComponent(id)}`;

function shell(root, { title, sub, back }) {
  const live = h("p", { class: "adm-msg", role: "status", tabindex: "-1", hidden: true });
  const say = (text, tone = "info") => { live.textContent = text; live.className = "adm-msg is-" + tone; live.setAttribute("role", tone === "error" ? "alert" : "status"); live.hidden = !text; if (text && tone === "error") live.focus(); };
  return { say, head: [back || null, h("div", { class: "adm-idhead" }, h("div", { class: "adm-idhead__text" }, h("span", { class: "eyebrow" }, "Discovery"), h("h1", { class: "adm-title", tabindex: "-1" }, title), sub ? h("p", { class: "adm-sub" }, sub) : null)), live] };
}

export async function render(ctx) {
  const path = ctx.url.pathname.replace(/\/+$/, "");
  if (path === "/admin/discovery/content") return contentPage(ctx);
  const m = path.match(/^\/admin\/discovery\/([^/]+)\/([^/]+)$/);
  if (m) return detailPage(decodeURIComponent(m[1]), decodeURIComponent(m[2]), ctx);
  return listPage(ctx);
}

/* ------------------------------------------------------------------ list + assign */

async function listPage(ctx) {
  let data, clients;
  let ret = null;
  try { [data, clients, ret] = await Promise.all([api("/discovery"), api("/clients"), api("/discovery/retention").catch(() => null)]); } catch (err) { return { title: "Discovery", node: h("div", { class: "adm-page" }, errorState(err, ctx.retry)) }; }
  const root = h("div", { class: "adm-page adm-dsc" });
  const writes = Boolean(data.capabilities && data.capabilities.writes);
  const s = shell(root, { title: "Brand Discovery", sub: h("span", null, "Visual assessments that help a client or prospect show what they like. Recipients need no account: send them a secure link, or they can complete it in their Client Portal Branding area. Answers never change a brand kit. ", h("a", { class: "adm-link", href: "/admin/discovery/content", "data-link": "" }, "Edit the questions and pictures")) });
  const org = h("select", { id: "dsc-org", class: "input" }, h("option", { value: "" }, "Choose a client"), clients.clients.filter((c) => c.status === "active").map((c) => h("option", { value: c.id, selected: new URLSearchParams(location.search).get("org") === c.id ? true : null, text: c.name })));
  const kind = h("select", { id: "dsc-kind", class: "input" }, (data.kinds || []).map((k) => h("option", { value: k.kind, text: k.label })));
  const title = h("input", { id: "dsc-title", class: "input", type: "text", maxlength: "120", value: "Brand Discovery", autocomplete: "off" });
  const who = h("input", { id: "dsc-who", class: "input", type: "text", maxlength: "120", autocomplete: "off", placeholder: "Optional: who will fill it in" });
  const form = h("form", { class: "adm-dsc__new", novalidate: true, onsubmit: async (ev) => {
    ev.preventDefault();
    if (!org.value) { s.say("Choose a client first.", "error"); return; }
    try { const r = await api("/clients/" + encodeURIComponent(org.value) + "/discovery", { method: "POST", body: { kind: kind.value, title: title.value, recipient_name: who.value || undefined } }); ctx.navigate ? ctx.navigate(detailHref(org.value, r.id)) : (location.href = detailHref(org.value, r.id)); } catch (err) { s.say(errorText(err), "error"); }
  } },
    h("h2", { class: "adm-h2" }, "Assign a new assessment"),
    h("div", { class: "adm-dsc__fields" },
      h("div", { class: "adm-field" }, h("label", { for: "dsc-org", text: "Client" }), org), h("div", { class: "adm-field" }, h("label", { for: "dsc-kind", text: "Type" }), kind),
      h("div", { class: "adm-field" }, h("label", { for: "dsc-title", text: "Title" }), title), h("div", { class: "adm-field" }, h("label", { for: "dsc-who", text: "Recipient" }), who)),
    h("p", { class: "adm-field__hint", text: "A prospect needs a client record first (Clients, New client); that keeps their answers and files private to them." }),
    h("div", { class: "adm-actions" }, h("button", { class: "btn btn--primary", type: "submit", disabled: writes ? null : true }, "Create assessment")));
  const filter = h("select", { id: "dsc-filter", class: "input adm-dsc__filter", "aria-label": "Show", onchange: draw }, h("option", { value: "" }, "All statuses"), Object.entries(STATUS).map(([v, [t]]) => h("option", { value: v, text: t })));
  const list = h("div", { class: "adm-dsc__list" });
  function draw() {
    const rows = data.assessments.filter((a) => !filter.value || a.status === filter.value);
    list.replaceChildren(rows.length ? h("table", { class: "adm-table" }, h("thead", null, h("tr", null, ["Client", "Assessment", "Status", "Answered", "Files", "Links", "Created"].map((t) => h("th", { scope: "col", text: t })))),
      h("tbody", null, rows.map((a) => h("tr", null,
        h("td", null, h("a", { class: "adm-link", href: orgHref(a.organizationId), "data-link": "" }, a.organizationName)),
        h("td", null, h("a", { class: "adm-link", href: detailHref(a.organizationId, a.id), "data-link": "" }, a.title), a.recipientName ? h("div", { class: "adm-muted", text: a.recipientName }) : null),
        h("td", null, statusChip(a.status)), h("td", { text: String(a.answered) }), h("td", { text: String(a.uploads) }), h("td", { text: String(a.activeLinks) }), h("td", { text: fmtDateTime(a.createdAt) }))))) : h("p", { class: "adm-sub", text: data.assessments.length ? "Nothing with that status." : "No assessments yet. Assign one above." }));
  }
  draw();
  root.replaceChildren(...[...s.head, !data.available ? h("p", { class: "adm-banner" }, "Discovery needs a database update that hasn’t been applied here yet. Nothing is lost: it will appear here once it is.") : null,
    !data.capabilities.enabled ? h("p", { class: "adm-banner" }, "Discovery is switched off for clients on this site (PORTAL_DISCOVERY). You can prepare assessments, but links and the Branding card stay inactive until it is on.") : null,
    !writes ? h("p", { class: "adm-banner" }, "Changes are switched off on this site: you can look, but not change.") : null,
    data.available ? form : null, h("div", { class: "adm-dsc__bar" }, h("h2", { class: "adm-h2" }, "Assessments"), filter), list, retentionPanel(ret, clients, writes, s)].filter(Boolean));
  return { title: "Discovery", node: root };
}


/* ------------------------------------------------------------------ retention (90 days after a client relationship ends) */

function retentionPanel(ret, clients, writes, s) {
  if (!ret) return null;
  const body = h("div");
  const org = h("select", { id: "ret-org", class: "input" }, h("option", { value: "" }, "Choose a client"), clients.clients.map((c) => h("option", { value: c.id, text: c.name })));
  const date = h("input", { id: "ret-date", class: "input", type: "date", max: new Date().toISOString().slice(0, 10) });
  async function save(orgId, ended) {
    try { await api("/clients/" + encodeURIComponent(orgId) + "/relationship", { method: "POST", body: { ended_on: ended } }); s.say(ended ? "End date saved." : "End date cleared.", "ok"); await redraw(); } catch (err) { s.say(errorText(err), "error"); }
  }
  async function check() {
    try { const r = await api("/discovery/retention/run", { method: "POST", body: { confirm: "RETENTION", dry_run: true } }); s.say(r.due ? `Dry run: ${r.due} assessment${r.due === 1 ? "" : "s"} would be deleted. Nothing was deleted.` : "Dry run: nothing is due. Nothing was deleted.", "ok"); } catch (err) { s.say(errorText(err), "error"); }
  }
  async function redraw() {
    let d; try { d = await api("/discovery/retention"); } catch (err) { body.replaceChildren(errorState(err, redraw)); return; }
    body.replaceChildren(...[
      h("p", { class: "adm-sub", text: `Brand Discovery answers and files are kept while the client relationship continues and for ${d.days} days after the end date you record here. Automatic deletion is ${d.capabilities.retentionEnabled ? "ON" : "OFF"} on this site${d.capabilities.retentionEnabled ? "" : ": nothing is deleted automatically; you can still see what would be due and delete an assessment by hand"}.` }),
      !d.available ? h("p", { class: "adm-banner", text: "Recording an end date needs a database update that hasn’t been applied here yet." }) : null,
      d.available ? h("form", { class: "adm-dsc__fields", novalidate: true, onsubmit: (ev) => { ev.preventDefault(); if (!org.value || !date.value) { s.say("Choose a client and a date.", "error"); return; } save(org.value, date.value); } },
        h("div", { class: "adm-field" }, h("label", { for: "ret-org", text: "Client" }), org), h("div", { class: "adm-field" }, h("label", { for: "ret-date", text: "Relationship ended on" }), date),
        h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary", type: "submit", disabled: writes ? null : true }, "Record end date"))) : null,
      d.relationships.length ? h("table", { class: "adm-table" }, h("thead", null, h("tr", null, ["Client", "Ended on", "Assessments", "Due for deletion", ""].map((t) => h("th", { scope: "col", text: t })))),
        h("tbody", null, d.relationships.map((r) => {
          const due = d.due.filter((x) => x.organizationId === r.organizationId).length;
          return h("tr", null, h("td", { text: r.organizationName }), h("td", { text: r.endedOn }), h("td", { text: String(r.assessments) }), h("td", { text: due ? `${due} now` : r.assessments ? "Not yet" : "Nothing kept" }),
            h("td", null, h("button", { class: "btn btn--secondary", type: "button", disabled: writes ? null : true, onclick: async () => { if (await confirmDialog({ title: "Clear the end date?", body: "The relationship is treated as continuing, so nothing will be due for deletion.", confirmLabel: "Clear" })) save(r.organizationId, null); } }, "Clear")));
        }))) : h("p", { class: "adm-sub", text: "No client has an end date recorded, so nothing is due." }),
      d.available ? h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary", type: "button", disabled: writes ? null : true, onclick: check }, "Check what would be deleted")) : null].filter(Boolean));
  }
  redraw();
  return h("section", { class: "adm-dsc__retention", "aria-labelledby": "ret-h" }, h("h2", { class: "adm-h2", id: "ret-h" }, "Retention and deletion"), body);
}

/* ------------------------------------------------------------------ one assessment */

async function detailPage(orgId, id, ctx) {
  const base = `/clients/${encodeURIComponent(orgId)}/discovery/${encodeURIComponent(id)}`;
  let data;
  try { data = await api(base); } catch (err) { return { title: "Discovery", node: h("div", { class: "adm-page" }, errorState(err, ctx.retry)) }; }
  const root = h("div", { class: "adm-page adm-dsc" });
  let fresh = null; // a link just created: shown once
  const s = shell(root, { title: data.assessment.title, sub: h("span", null, h("a", { class: "adm-link", href: orgHref(orgId), "data-link": "" }, data.organization.name), data.assessment.recipientName ? ` · for ${data.assessment.recipientName}` : "", " · ", statusChip(data.assessment.status)), back: h("a", { class: "adm-back", href: "/admin/discovery", "data-link": "" }, "← All assessments") });
  const writes = () => Boolean(data.capabilities && data.capabilities.writes);
  async function act(path, body, ok) {
    try { const r = await api(base + path, { method: "POST", body: body || {} }); if (r && r.url) fresh = r; data = await api(base); draw(); s.say(ok, "success"); }
    catch (err) { try { data = await api(base); } catch { /* keep what we have */ } draw(); s.say(errorText(err), "error"); }
  }
  const a = () => data.assessment;
  function linksPanel() {
    const label = h("input", { id: "dl-label", class: "input", type: "text", maxlength: "80", placeholder: "Optional: who it is for", autocomplete: "off" });
    const days = h("select", { id: "dl-days", class: "input" }, [[7, "7 days"], [14, "14 days"], [30, "30 days"], [60, "60 days"], [90, "90 days"]].map(([v, t]) => h("option", { value: v, selected: v === 14 ? true : null, text: t })));
    const open = a().status === "not_started" || a().status === "in_progress";
    const copyBtn = (url) => h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: async (ev) => { try { await navigator.clipboard.writeText(url); ev.target.textContent = "Copied"; } catch { ev.target.parentNode.querySelector("input").select(); ev.target.textContent = "Press Ctrl+C"; } } }, "Copy link");
    return h("section", { class: "adm-dsc__panel", "aria-labelledby": "dl-h" }, h("h2", { class: "adm-h2", id: "dl-h" }, "Secure links"),
      h("p", { class: "adm-sub" }, "A link opens only this assessment and needs no account. It expires and can be revoked. The address is shown once, when you make it."),
      fresh ? h("div", { class: "adm-dsc__fresh", role: "status" }, h("p", { class: "adm-req__label", text: `Link created (expires ${fmtDateTime(fresh.expiresAt)}). Copy it now: it will not be shown again.` }), h("div", { class: "adm-dsc__copy" }, h("input", { class: "input", type: "text", readonly: true, value: fresh.url, "aria-label": "Secure link", onfocus: (ev) => ev.target.select() }), copyBtn(fresh.url))) : null,
      open && writes() ? h("form", { class: "adm-dsc__newlink", onsubmit: (ev) => { ev.preventDefault(); act("/links", { label: label.value || undefined, days: Number(days.value) }, "Link created."); } },
        h("div", { class: "adm-field" }, h("label", { for: "dl-label", text: "Label" }), label), h("div", { class: "adm-field" }, h("label", { for: "dl-days", text: "Expires after" }), days), h("button", { class: "btn btn--secondary", type: "submit" }, "Create link")) : null,
      data.links.length ? h("ul", { class: "adm-dsc__links" }, data.links.map((l) => h("li", null, h("span", null, h("strong", { text: l.label || "Link" }), ` · created ${fmtDateTime(l.createdAt)} · `, h("span", { class: "adm-chip adm-chip--" + (l.state === "active" ? "ok" : "pending"), text: l.state === "active" ? "Active" : l.state === "expired" ? "Expired" : "Revoked" }), l.state === "active" ? ` · expires ${fmtDateTime(l.expiresAt)}` : "", l.useCount ? ` · opened ${l.useCount} time${l.useCount === 1 ? "" : "s"}` : ""),
        l.state === "active" && writes() ? h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: async () => { if (await confirmDialog({ title: "Revoke this link?", body: "Anyone using it will no longer be able to open the assessment.", confirmLabel: "Revoke link" })) act(`/links/${encodeURIComponent(l.id)}/revoke`, {}, "Link revoked."); } }, "Revoke") : null))) : h("p", { class: "adm-muted", text: "No links yet." }));
  }
  const SECTION_STATUS = { answered: ["Answered", "ok"], partial: ["Partly answered", "warn"], not_sure: ["Not sure", "pending"], unanswered: ["Not answered", ""], not_included: ["Not included", ""] };
  function overview() {
    const b = data.brief, st = a().status, when = a().reviewedAt ? `Reviewed ${fmtDateTime(a().reviewedAt)}` : a().submittedAt ? `Submitted ${fmtDateTime(a().submittedAt)}` : a().startedAt ? `Started ${fmtDateTime(a().startedAt)}` : `Created ${fmtDateTime(a().createdAt)}`;
    const cards = h("div", { class: "rk-stats" },
      statCard({ label: "Status", value: (STATUS[st] || [st])[0], hint: when, tone: st === "submitted" ? "ok" : st === "in_progress" ? "warn" : "" }),
      statCard({ label: "Branding sections", value: `${b.summary.sectionsAnswered} of ${b.summary.sectionsTotal}`, hint: "answered", meter: b.summary.sectionsTotal ? b.summary.sectionsAnswered / b.summary.sectionsTotal : 0 }),
      statCard({ label: "Questions answered", value: String(data.answered), hint: a().recipientName ? `by ${a().recipientName}` : null }),
      statCard({ label: "Inspiration files", value: String(data.uploads.length), hint: data.uploads.length ? "from the client" : "none added" }));
    const tags = (list, tone) => list.length ? h("div", { class: "rk-tags" }, list.map((w) => badge(w, tone))) : h("p", { class: "adm-muted", text: "Not chosen." });
    const direction = card("Strongest preferences", b.themes.length ? barList(b.themes.map((t) => ({ label: t.label, count: t.count }))) : h("p", { class: "adm-muted", text: "No preferences chosen yet." }), { id: "rk-dir" });
    const voice = card("Personality and tone", h("div", null, h("h3", { class: "rk-sub", text: "Brand personality" }), tags(b.summary.personality, "ok"), h("h3", { class: "rk-sub", text: "Tone of voice" }), tags(b.summary.tone, "pending")), { id: "rk-voice" });
    return [cards, h("div", { class: "rk-two" }, direction, voice), a().overallComment ? h("blockquote", { class: "rk-quote" }, h("span", { class: "rk-quote__label", text: "In their words" }), a().overallComment) : null];
  }
  function attention() {
    const b = data.brief;
    const conflicts = b.conflicts.map((c) => ({ badge: c.type === "contradiction" ? "Contradiction" : c.severity === "strong" ? "Strong tension" : "Tension", tone: c.severity === "strong" ? "warn" : "pending", title: c.title, detail: c.detail, where: c.sections.join(", ") }));
    const clarify = b.clarify.map((c) => ({ badge: c.section, tone: "", title: c.reason }));
    return card("Worth a conversation", h("div", { class: "rk-two rk-two--flush" },
      h("div", null, h("h3", { class: "rk-sub" }, "Conflicting preferences ", badge(String(conflicts.length), conflicts.length ? "warn" : "")), attentionList(conflicts, { limit: 3, empty: "None found." })),
      h("div", null, h("h3", { class: "rk-sub" }, "To clarify with the client ", badge(String(clarify.length), clarify.length ? "pending" : "")), attentionList(clarify, { limit: 4, empty: "Nothing outstanding." }))), { id: "rk-attn", wide: true });
  }
  function selections() {
    const b = data.brief;
    const wrap = h("div", { class: "rk-folds" });
    const itemView = (it) => {
      const state = it.state === "not_sure" ? badge("Not sure", "pending") : it.state === "surprise" ? badge("Surprise me", "pending") : null;
      const groups = it.state === "surprise" ? choiceGroups({ dislikes: it.dislikes }) : choiceGroups({ likes: it.likes, dislikes: it.dislikes });
      return h("div", { class: "rk-item" }, h("h3", { class: "rk-item__q" }, it.prompt, state ? [" ", state] : null), ...groups,
        it.comment ? h("blockquote", { class: "rk-note", text: it.comment }) : null,
        it.state === "none" ? h("p", { class: "adm-muted", text: "No answer." }) : null);
    };
    b.sections.forEach((x) => {
      const [t, tone] = SECTION_STATUS[x.status] || ["", ""];
      const likes = x.likes.length, dislikes = x.dislikes.length;
      wrap.append(fold({ number: x.number, title: x.label, open: false, meta: [likes ? `${likes} liked` : "", dislikes ? `${dislikes} not for me` : ""].filter(Boolean).join(" · "), badges: badge(t, tone), body: x.items.length ? x.items.map(itemView) : h("p", { class: "adm-muted", text: "Not part of this assessment." }) }));
    });
    return h("section", { class: "rk-selections", "aria-labelledby": "rk-sel" }, h("div", { class: "rk-card__head" }, h("h2", { class: "rk-card__title", id: "rk-sel", text: "What they chose" }), foldControls(wrap)),
      h("p", { class: "adm-sub", text: "Pictures are the ones the client saw. A tick is a like; a cross is “not for me”. Open a section for the detail." }), wrap);
  }
  function management() {
    return h("details", { class: "rk-manage" }, h("summary", { class: "rk-manage__sum" }, h("span", { class: "rk-card__title", text: "Manage this assessment" }), h("span", { class: "rk-fold__meta", text: "Secure links, review, reopen, archive, delete" })),
      h("div", { class: "rk-manage__body" }, linksPanel(), actionsPanel(),
        h("section", { class: "adm-dsc__panel" }, h("h2", { class: "adm-h2" }, "Plain-text version"), h("p", { class: "adm-sub" }, "The same brief as text, to paste into a document or message. It is a summary of preferences and never changes a brand kit, an asset or a requirement."),
          h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary", type: "button", onclick: async (ev) => { try { await navigator.clipboard.writeText(data.markdown); ev.target.textContent = "Brief copied"; } catch { ev.target.textContent = "Copy not available: select the text below"; } } }, "Copy brief as text")),
          h("details", { class: "adm-dsc__raw" }, h("summary", { text: "Show the text" }), h("pre", { class: "adm-dsc__pre", text: data.markdown })))));
  }
  function filesPanel() {
    return h("section", { class: "adm-dsc__panel", "aria-labelledby": "df-h" }, h("h2", { class: "adm-h2", id: "df-h" }, "Inspiration files"),
      data.uploads.length ? h("ul", { class: "adm-dsc__links" }, data.uploads.map((u) => h("li", null, h("span", null, h("strong", { text: u.name }), ` · ${Math.max(1, Math.round(u.size / 1024))} KB · ${fmtDateTime(u.createdAt)}`), h("a", { class: "btn btn--secondary adm-small", href: `/api/admin${base}/files/${encodeURIComponent(u.id)}`, download: "" }, "Download")))) : h("p", { class: "adm-muted", text: "None added." }),
      h("p", { class: "adm-field__hint", text: "Files are the recipient’s own and are downloaded, never opened in the browser." }));
  }
  function actionsPanel() {
    if (!writes()) return null;
    const rename = h("input", { id: "da-title", class: "input", type: "text", maxlength: "120", value: a().title });
    const note = h("textarea", { id: "da-note", class: "input", rows: "2", maxlength: "2000", placeholder: "Optional note for the team" }, a().reviewNote || "");
    const st = a().status;
    return h("section", { class: "adm-dsc__panel", "aria-labelledby": "da-h" }, h("h2", { class: "adm-h2", id: "da-h" }, "Manage"),
      h("div", { class: "adm-field" }, h("label", { for: "da-title", text: "Title" }), rename),
      h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary", type: "button", onclick: () => act("/update", { title: rename.value }, "Title saved.") }, "Save title")),
      st === "submitted" || st === "reviewed" ? h("div", { class: "adm-field" }, h("label", { for: "da-note", text: "Review note" }), note) : null,
      h("div", { class: "adm-actions" },
        st === "submitted" ? h("button", { class: "btn btn--primary", type: "button", onclick: () => act("/review", { note: note.value }, "Marked as reviewed.") }, "Mark as reviewed") : null,
        st === "submitted" || st === "reviewed" ? h("button", { class: "btn btn--secondary", type: "button", onclick: async () => { if (await confirmDialog({ title: "Reopen for the recipient?", body: "They will be able to change their answers and send them again.", confirmLabel: "Reopen" })) act("/reopen", {}, "Reopened."); } }, "Reopen") : null,
        h("button", { class: "btn btn--secondary adm-actions__danger", type: "button", onclick: async () => { if (await confirmDialog({ title: "Archive this assessment?", body: "It is hidden from the client and its links stop working. The record is kept.", confirmLabel: "Archive" })) { try { await api(base + "/archive", { method: "POST", body: {} }); location.assign("/admin/discovery"); } catch (err) { s.say(errorText(err), "error"); } } } }, "Archive"),
        h("button", { class: "btn btn--secondary adm-actions__danger", type: "button", onclick: async () => { if (await confirmDialog({ title: "Delete this assessment permanently?", body: "Its answers, links and files are deleted for good, including the backup copies of the files. This is for a deletion request or the end of the retention period, and it cannot be undone.", confirmLabel: "Delete permanently" })) { try { await api(base + "/delete", { method: "POST", body: { confirm: "DELETE" } }); location.assign("/admin/discovery"); } catch (err) { s.say(errorText(err), "error"); } } } }, "Delete permanently")));
  }
  function draw() {
    const open = management_open();
    const mg = management(); if (open) mg.open = true;
    root.replaceChildren(...[...s.head, !writes() ? h("p", { class: "adm-banner" }, "Changes are switched off on this site: you can look, but not change.") : null,
      ...overview(), attention(), selections(), filesPanel(), mg].filter(Boolean));
  }
  const management_open = () => Boolean(root.querySelector("details.rk-manage[open]")) || Boolean(fresh);
  draw();
  return { title: data.assessment.title, node: root };
}

/* ------------------------------------------------------------------ the questions and options editor */

async function contentPage(ctx) {
  let data;
  const load = () => api("/discovery/content?kind=brand");
  try { data = await load(); } catch (err) { return { title: "Discovery content", node: h("div", { class: "adm-page" }, errorState(err, ctx.retry)) }; }
  const root = h("div", { class: "adm-page adm-dsc" });
  const s = shell(root, { title: "Questions and pictures", sub: "Reword, hide, reorder and add options, and attach a real picture to any option. Changes apply to every assessment, including ones in progress. Nothing you change here alters answers already given.", back: h("a", { class: "adm-back", href: "/admin/discovery", "data-link": "" }, "← All assessments") });
  const writes = () => Boolean(data.capabilities && data.capabilities.writes);
  let busy = false;
  async function act(body, ok) {
    if (busy) return; busy = true;
    try { await api("/discovery/content", { method: "POST", body: { kind: data.kind, ...body } }); data = await load(); draw(); s.say(ok, "success"); }
    catch (err) { try { data = await load(); draw(); } catch { /* keep */ } s.say(errorText(err), "error"); }
    busy = false;
  }
  async function upload(q, o, file, alt) {
    if (!file) { s.say(ERROR.no_file, "error"); return; }
    const body = new FormData(); body.append("file", file, file.name); body.append("meta", JSON.stringify({ kind: data.kind, item: q.key, option: o.key, alt: alt || o.label }));
    try { await api("/discovery/content/image", { method: "POST", body }); data = await load(); draw(); s.say("Picture saved.", "success"); } catch (err) { s.say(errorText(err), "error"); }
  }
  function option(q, o, i, all) {
    const k = `dc-${q.key}-${o.key}`.replace(/[^a-z0-9-]/gi, "-");
    const label = h("input", { id: k + "-l", class: "input", type: "text", maxlength: "60", value: o.label, disabled: writes() ? null : true });
    const detail = h("input", { id: k + "-d", class: "input", type: "text", maxlength: "140", value: o.detail, placeholder: q.visual === "tagline" ? "Example tagline" : "Short description", disabled: writes() ? null : true });
    const on = h("input", { id: k + "-on", type: "checkbox", checked: o.enabled ? true : null, disabled: writes() ? null : true });
    const file = h("input", { id: k + "-f", class: "adm-dsc__file", type: "file", accept: ".png,.jpg,.jpeg,.webp", "aria-label": `Picture for ${o.label}` });
    return h("li", { class: "adm-dsc__opt" + (o.enabled ? "" : " is-off") },
      h("div", { class: "adm-dsc__thumb" }, o.hasImage ? h("img", { src: `/api/admin/discovery/media/${o.imageId}`, alt: o.imageAlt || o.label, width: "96", height: "60" }) : h("span", { class: "adm-muted", text: q.visual === "word" || q.visual === "font" || q.visual === "tagline" ? "Text card" : "Sketch" })),
      h("div", { class: "adm-dsc__optform" },
        h("div", { class: "adm-dsc__optrow" }, h("div", { class: "adm-field" }, h("label", { for: k + "-l", text: o.custom ? "Label (added by you)" : "Label" }), label), h("div", { class: "adm-field" }, h("label", { for: k + "-d", text: q.visual === "tagline" ? "Example" : "Description" }), detail)),
        h("div", { class: "adm-actions" },
          h("label", { class: "adm-choice", for: k + "-on" }, on, h("span", { text: "Shown" })),
          writes() ? [
            h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => act({ item: q.key, option: o.key, label: label.value, description: detail.value, enabled: on.checked }, `${label.value} saved.`) }, "Save"),
            h("button", { class: "btn btn--secondary adm-small", type: "button", disabled: i === 0 ? true : null, "aria-label": `Move ${o.label} up`, onclick: () => act({ item: q.key, option: o.key, move: "up" }, "Moved.") }, "Up"),
            h("button", { class: "btn btn--secondary adm-small", type: "button", disabled: i === all.length - 1 ? true : null, "aria-label": `Move ${o.label} down`, onclick: () => act({ item: q.key, option: o.key, move: "down" }, "Moved.") }, "Down"),
            o.edited ? h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => act({ item: q.key, option: o.key, reset: true }, o.custom ? "Option removed." : "Back to the standard wording.") }, o.custom ? "Remove option" : "Reset") : null] : null),
        writes() ? h("details", { class: "adm-dsc__picdet" }, h("summary", { text: o.hasImage ? "Picture: replace or remove" : "Picture: add a real one" }), h("div", { class: "adm-dsc__pic" }, h("label", { for: k + "-f", text: "PNG, JPG or WebP, 5 MB at most" }), file,
          h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => upload(q, o, file.files[0], label.value) }, "Upload"),
          o.hasImage ? h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: async () => { try { await api(`/discovery/content/${encodeURIComponent(o.contentId)}/image/delete`, { method: "POST", body: {} }); data = await load(); draw(); s.say("Picture removed.", "success"); } catch (err) { s.say(errorText(err), "error"); } } }, "Remove picture") : null)) : null));
  }
  function question(q) {
    const k = "dq-" + q.key.replace(/[^a-z0-9-]/gi, "-");
    const prompt = h("input", { id: k + "-p", class: "input", type: "text", maxlength: "120", value: q.prompt, disabled: writes() ? null : true });
    const help = h("input", { id: k + "-h", class: "input", type: "text", maxlength: "240", value: q.help, disabled: writes() ? null : true });
    const on = h("input", { id: k + "-on", type: "checkbox", checked: q.enabled ? true : null, disabled: writes() ? null : true });
    const addLabel = h("input", { id: k + "-al", class: "input", type: "text", maxlength: "60", placeholder: "New option", disabled: writes() ? null : true });
    const addDesc = h("input", { id: k + "-ad", class: "input", type: "text", maxlength: "140", placeholder: "Optional description", disabled: writes() ? null : true });
    return h("details", { class: "adm-dsc__q", id: k }, h("summary", null, h("span", { class: "adm-dsc__no", text: q.sectionLabel.slice(0, 2) }), h("strong", { text: q.prompt }), " ", h("span", { class: "adm-muted", text: `${q.sectionLabel.slice(3)} · ${q.options.filter((o) => o.enabled).length} of ${q.options.length} shown${q.enabled ? "" : " · question hidden"}` })),
      h("div", { class: "adm-dsc__qform" },
        h("div", { class: "adm-field" }, h("label", { for: k + "-p", text: "Question" }), prompt), h("div", { class: "adm-field" }, h("label", { for: k + "-h", text: "Help text" }), help),
        h("div", { class: "adm-field" }, h("label", { class: "adm-choice", for: k + "-on" }, on, h("span", { text: "Show this question" }))),
        writes() ? h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => act({ item: q.key, label: prompt.value, description: help.value, enabled: on.checked }, "Question saved.") }, "Save question"),
          q.edited ? h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => act({ item: q.key, reset: true }, "Back to the standard wording.") }, "Reset question") : null) : null),
      h("ul", { class: "adm-dsc__opts" }, q.options.map((o, i, all) => option(q, o, i, all))),
      writes() ? h("form", { class: "adm-dsc__add", onsubmit: (ev) => { ev.preventDefault(); if (addLabel.value.trim()) act({ item: q.key, add: { label: addLabel.value, description: addDesc.value || undefined } }, "Option added."); } },
        h("h3", { class: "adm-h3" }, "Add an option"), h("div", { class: "adm-dsc__fields" }, h("div", { class: "adm-field" }, h("label", { for: k + "-al", text: "Label" }), addLabel), h("div", { class: "adm-field" }, h("label", { for: k + "-ad", text: "Description" }), addDesc)),
        h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary adm-small", type: "submit" }, "Add option"))) : null);
  }
  function draw() {
    const open = new Set([...root.querySelectorAll("details.adm-dsc__q[open]")].map((d) => d.id));
    root.replaceChildren(...[...s.head, !data.available ? h("p", { class: "adm-banner" }, "Discovery needs a database update that hasn’t been applied here yet.") : null, !writes() ? h("p", { class: "adm-banner" }, "Changes are switched off on this site: you can look, but not change.") : null,
      h("p", { class: "adm-sub" }, "Built-in options draw a sketch. Text cards (words, fonts, taglines) have no picture to attach."), ...data.questions.map((q) => { const d = question(q); if (open.has(d.id)) d.open = true; return d; })].filter(Boolean));
  }
  draw();
  return { title: "Discovery content", node: root };
}
