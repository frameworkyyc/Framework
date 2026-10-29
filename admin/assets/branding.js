/* Framework Admin — Clients: Branding for one client (/admin/clients/:id/branding).
   Framework staff upload and organize the official brand files, set colours and typography, choose what is published, and review what the client submitted
   and any service requests. This file only presents and submits: who may do what, the file checks, and what a client can see are all decided by the server
   (worker/portal/admin-branding.js). Server text is never inserted as HTML; friendly copy is shown for known codes only. */

import { h, api, confirmDialog, errorState, fmtDate, fmtDateTime } from "./ui.js";
import { disclosure, chip, plural, goTo } from "./client-dashboard.js";
import { buildBrandFileName, extensionOf } from "./brand-names.js";
import { LOGO_VARIATIONS } from "./logo-variations.js";
import { BRAND_SECTIONS, SECTION_FILE_KEYS, TYPE_SLOT_DEFS, sectionOf } from "./brand-sections.js";

const KIND_LABEL = { logo: "Logos", guideline: "Guidelines", document: "Documents", font: "Fonts", package: "Packages", other: "Other files" };
const KIND_ONE = { logo: "Logo", guideline: "Guideline", document: "Document", font: "Font", package: "Package", other: "Other file" };
const LOGO_ROLE = { primary: "Primary", secondary: "Secondary", simplified: "Simplified", icon: "Sub-mark" }; // the four logo cards on the client's Branding page (icon is stored as the Sub-mark)
const LOGO_VARIATION_ROLES = ["primary", "secondary", "simplified", "icon"];
const ORIENTATION = { horizontal: "Horizontal", vertical: "Vertical", square: "Square" };
const TONE = { light: "For light backgrounds", dark: "For dark backgrounds", colour: "Full colour", mono: "One colour" };
const CATEGORY = { logo: "Logo", fonts: "Fonts", colours: "Colour palette", guidelines: "Brand guidelines", stationery: "Business cards and stationery", signature: "Email signature", other: "Other" };
const COLOUR_ROLE = { primary: "Primary", secondary: "Secondary", accent: "Accent", neutral: "Neutral" };
const TYPE_ROLE = { logo: "Logo", heading: "Headings", subheading: "Subheadings", body: "Body text", other: "Other" };
const REQUEST_STATUS = { new: "New", contacted: "Contacted", closed: "Closed", declined: "Declined" };
const SECTION = Object.fromEntries(BRAND_SECTIONS.map((d) => [d.key, d]));
const SECTION_OPTIONS = Object.fromEntries(SECTION_FILE_KEYS.map((k) => [k, `${SECTION[k].no} ${SECTION[k].title}`])); // where an "other" file can be shown on the client's page
const LOGO_ACCEPT = ".svg,.png,.jpg,.jpeg,.webp,.pdf,.ai,.eps";
const IMAGE_ORDER = ["svg", "png", "webp", "jpg", "jpeg"]; // formats a browser can show as a picture, best first
const KIND_ADD = Object.fromEntries(Object.entries(KIND_ONE).filter(([k]) => k !== "logo")); // logos are added from the four logo cards
const ACCEPT = ".png,.jpg,.jpeg,.webp,.svg,.pdf,.ai,.eps,.ttf,.otf,.woff,.woff2,.txt,.docx,.xlsx,.pptx,.zip";

const ERROR_TEXT = {
  type_not_allowed: "That file type isn’t accepted. Use PNG, JPG, WebP, SVG, PDF, AI, EPS, a font file, TXT, DOCX, XLSX, PPTX or ZIP.",
  invalid_name: "That file name can’t be used. It needs a normal extension (not .exe, .html, .docm and similar) and no odd characters.",
  content_mismatch: "The file’s contents don’t match its type. Export it again in the right format.",
  active_content: "The file contains active content (scripts, macros, embedded programs or external links), so it can’t be stored.",
  image_dimensions: "The image is empty or far too large.",
  pdf_encrypted: "Encrypted PDFs can’t be stored. Export a copy without a password.",
  empty_file: "That file is empty.",
  file_too_large: "That file is over the size limit.",
  no_file: "Choose a file first.",
  archive_unsafe_entry: "The ZIP contains something unsafe (programs, scripts, other archives or odd paths).",
  archive_encrypted: "Encrypted ZIPs can’t be stored.",
  archive_unsupported: "That ZIP uses a format that isn’t supported. Create it again as a standard ZIP.",
  archive_entries: "The ZIP has too many (or no) files in it.",
  archive_too_large: "The ZIP expands to an unreasonable size.",
  font_license_required: "A font can only be made downloadable if you record its licence.",
  invalid_brand_name: "Use a brand name with at least one letter or number (up to 60 characters), or leave it empty to use the organization’s name.",
  invalid_colours: "Check the colours: each needs a name, a role and a HEX value like #1A2B3C (up to 16).",
  invalid_typography: "Check the typefaces: each needs a role and a family; weights are 100 to 900 in steps of 100; a source link must start with https://",
  invalid_title: "Enter a name for the file.", invalid_description: "Enter a name for the file (letters and numbers).", incomplete_logo_details: "Choose the logo type and shape first.",
  duplicate_name: "A file with that name already exists for this client. Change a detail, or replace the existing file instead.",
  invalid_section: "That section can’t be used for this file.", invalid_note: "That note is too long.", invalid_input: "Check the details and try again.", invalid_kit: "The kit couldn’t be saved: check the details.",
  invalid_status: "Choose a status.", not_found: "That item no longer exists. The page has been refreshed.", conflict: "That file changed while you were working. The page has been refreshed.",
  writes_disabled: "Changes are switched off on this site, so nothing was changed.",
  storage_unavailable: "File storage isn’t available on this site. Nothing was uploaded.",
  storage_write_failed: "The file couldn’t be stored just now. Nothing was saved. Try again.", storage_read_failed: "The file couldn’t be read from storage just now.", storage_delete_failed: "The stored file couldn’t be removed just now.",
  session: "Your admin session has ended. Reload the page to sign in again.", denied: "This account isn’t allowed to make that change.", network: "Can’t reach the server. Check your connection and try again.",
};
const GENERIC = "That didn’t work and nothing was changed. Try again, and reload the page if it keeps happening.";
export const errorText = (err) => ERROR_TEXT[err && err.code] || GENERIC;

const fmtSize = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : n + " B");
const HEX = /^#[0-9A-Fa-f]{6}$/;
const SVG_NS = "http://www.w3.org/2000/svg";

/** A decorative colour swatch drawn as SVG (the fill is an attribute, so the Admin's strict style policy is respected). */
function swatch(hex) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 28 28"); svg.setAttribute("width", "28"); svg.setAttribute("height", "28"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false"); svg.setAttribute("class", "adm-swatch");
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", "1"); rect.setAttribute("y", "1"); rect.setAttribute("width", "26"); rect.setAttribute("height", "26"); rect.setAttribute("rx", "4");
  rect.setAttribute("fill", HEX.test(hex) ? hex : "none");
  svg.append(rect);
  svg.update = (v) => rect.setAttribute("fill", HEX.test(v) ? v : "none");
  return svg;
}

const labelled = (id, label, input, hint) => h("div", { class: "adm-field" }, h("label", { for: id, text: label }), hint ? h("p", { class: "adm-field__hint", text: hint }) : null, input);
const select = (id, options, value, { blank } = {}) => {
  const el = h("select", { id, class: "input" }, blank ? h("option", { value: "" }, blank) : null, Object.entries(options).map(([v, t]) => h("option", { value: v, selected: v === value ? true : null }, t)));
  return el;
};
const check = (id, label, checked) => {
  const input = h("input", { type: "checkbox", id, checked: checked ? true : null });
  return { input, node: h("label", { class: "adm-choice", for: id }, input, h("span", { text: label })) };
};
const button = (label, props = {}) => h("button", { class: "btn btn--secondary adm-small", type: "button", ...props }, label);

export async function render(orgId, ctx) {
  let data;
  try { data = await api("/clients/" + encodeURIComponent(orgId) + "/branding"); } catch (err) { return { title: "Branding", node: h("div", { class: "adm-page" }, errorState(err, ctx.retry)) }; }
  const base = "/clients/" + encodeURIComponent(orgId) + "/branding";
  const root = h("div", { class: "adm-page adm-brandpage" });
  const live = h("p", { class: "adm-msg", role: "status", tabindex: "-1", hidden: true });
  const opened = new Set();
  let busy = false;
  let first = true;
  const memory = { kind: "guideline", role: "", orient: "", transparent: false, description: "" }; // the add form keeps its details between uploads, so the next format of the same variant is quick

  const toggled = (id) => (ev) => { if (ev.target.open) opened.add(id); else opened.delete(id); if (id === "br-uploads" && ev.target.open) markSeen(); };
  const section = (id, title, meta, children) => disclosure({ id, title, meta, open: opened.has(id), onToggle: toggled(id), children });

  function say(text, tone = "info", { focus = true } = {}) {
    live.textContent = text; live.className = "adm-msg is-" + tone; live.setAttribute("role", tone === "error" || tone === "warning" ? "alert" : "status"); live.hidden = !text;
    if (text && focus) live.focus({ preventScroll: false });
  }
  function lock(on) {
    root.toggleAttribute("aria-busy", on);
    root.querySelectorAll("button, input, select, textarea").forEach((el) => {
      if (on) { el.dataset.wasDisabled = el.disabled ? "1" : ""; el.disabled = true; } else if (el.dataset.wasDisabled === "") el.disabled = false;
    });
  }
  async function reload() { try { data = await api(base); draw(); } catch { /* the previous view stays; the message says what happened */ } }

  /** One change: confirm (when asked), lock the page against double submits, call the API, say what happened in plain words, then show the server's real state. */
  async function perform({ confirm, request, success, onError }) {
    if (busy) return false;
    if (confirm && !(await confirmDialog(confirm))) return false;
    busy = true; lock(true); say("Working…", "info", { focus: false });
    let outcome, ok = false;
    try { const res = await request(); outcome = { tone: "success", text: typeof success === "function" ? success(res) : success }; ok = true; } catch (err) { outcome = { tone: "error", text: (onError && onError(err)) || errorText(err) }; }
    busy = false;
    await reload();
    say(outcome.text, outcome.tone); lock(false);
    return ok;
  }
  async function markSeen() {
    if (!data.uploads.some((u) => !u.seen) || !data.capabilities.writes) return;
    try { await api(base + "/uploads/seen", { method: "POST", body: {} }); data.uploads.forEach((u) => { u.seen = true; }); } catch { /* seen-marking is a courtesy; the list is unaffected */ }
  }

  /** What generated file names start with: the kit's brand name when set, otherwise the organization's own name. */
  const brandCompany = () => (data.kit && data.kit.brandName) || data.organization.name;
  const caps = () => data.capabilities;
  const canWrite = () => caps().writes;
  const canUpload = () => caps().writes && caps().storage;
  const assetLink = (a) => `/api/admin/clients/${encodeURIComponent(orgId)}/branding/assets/${encodeURIComponent(a.id)}/download`;
  const uploadLink = (u) => `/api/admin/clients/${encodeURIComponent(orgId)}/branding/uploads/${encodeURIComponent(u.id)}/download`;

  /* ---------------------------------------------------------- deliverables */

  /**
   * The details of a deliverable, shared by "add a file" and "edit a file". There is no title or variant name to type for a logo: the file name is generated from
   * the company and these details (the same module the server uses) and previewed live. Other files take a short name. getExt() is the file's extension.
   */
  function assetFields(prefix, a = null, getExt = () => "", { fixedRole = null, fixedKind = null, fixedSection = null } = {}) {
    const editing = Boolean(a);
    const fixed = Boolean(fixedRole || fixedKind || fixedSection); // a logo card fixes the kind (logo) and the logo type; a font or section button fixes the kind (and the section)
    const kind = editing || fixed ? null : select(prefix + "-kind", KIND_ADD, memory.kind);
    const kindNow = () => (editing ? a.kind : fixedRole ? "logo" : fixedKind ? fixedKind : fixedSection ? "other" : kind.value);
    const sectionSel = select(prefix + "-section", SECTION_OPTIONS, a ? sectionOf(a) || "" : fixedSection || "", { blank: "None (listed under Documents and other files)" });
    const description = h("input", { id: prefix + "-title", class: "input", type: "text", maxlength: "120", value: editing ? (a.kind !== "logo" ? a.title : "") : memory.description, autocomplete: "off" });
    const role = select(prefix + "-role", LOGO_ROLE, a ? a.logoRole || "" : fixedRole || memory.role, { blank: "Choose…" });
    const orient = select(prefix + "-orient", ORIENTATION, a ? a.orientation || "" : memory.orient, { blank: "Choose…" });
    const transparent = check(prefix + "-transparent", "Transparent background", a ? a.transparent : memory.transparent);
    const usage = h("input", { id: prefix + "-usage", class: "input", type: "text", maxlength: "300", value: a && a.usageNote || "", autocomplete: "off" });
    const downloadable = check(prefix + "-dl", "Clients may download this font file", a && a.downloadable);
    const licence = h("input", { id: prefix + "-lic", class: "input", type: "text", maxlength: "300", value: a && a.licenseNote || "", autocomplete: "off" });
    const logoBox = h("div", { class: "adm-brand__grid" }, fixedRole ? null : labelled(prefix + "-role", "Logo type", role, "Which of the four logo cards on the client’s Branding page this file belongs to. Add each format (SVG, PNG, PDF…) as its own file with the same type."), labelled(prefix + "-orient", "Shape", orient), transparent.node);
    const sectionBox = labelled(prefix + "-section", "Show in section", sectionSel, "Which numbered section of the client’s Branding page shows this file. Leave it on None to keep it under Documents and other files.");
    const descriptionBox = labelled(prefix + "-title", "Name", description, "Used in the file name, for example “Brand guidelines” or “Switzer Regular”.");
    const fontBox = h("div", { class: "adm-brand__stack" }, downloadable.node, labelled(prefix + "-lic", "Licence note (required to allow downloads)", licence, "For example: Open Font Licence 1.1, or the licence you hold."));
    const previewName = h("code", { class: "adm-brand__previewname" }), previewNote = h("span", { class: "adm-brand__previewnote" });
    const preview = h("div", { class: "adm-brand__preview", "aria-live": "polite" }, h("span", { class: "adm-brand__previewlabel", text: "File name" }), previewName, previewNote);
    const adopt = editing ? check(prefix + "-adopt", "Rename this file to the standard name", false) : null;
    const standardOf = () => buildBrandFileName({ company: brandCompany(), slug: data.organization.slug, kind: a.kind, logo: { role: a.logoRole, orientation: a.orientation, tone: a.tone, transparent: a.transparent }, description: a.title, ext: a.format });
    const legacy = editing && (() => { const st = standardOf(); return st.ok && st.name.toLowerCase() !== a.originalName.toLowerCase(); })();
    const taken = new Set(data.assets.filter((x) => !a || x.id !== a.id).map((x) => x.originalName.toLowerCase()));
    const naming = () => ({ company: brandCompany(), slug: data.organization.slug, kind: kindNow(), logo: { role: role.value, orientation: orient.value, tone: a ? a.tone : null, transparent: transparent.input.checked }, description: description.value, ext: getExt() || (a ? a.format : "") });
    const changed = () => (!editing ? true : adopt.input.checked || (kindNow() === "logo" ? (role.value || null) !== a.logoRole || (orient.value || null) !== a.orientation || transparent.input.checked !== a.transparent : description.value.trim() !== a.title));
    let state = { ok: false, message: "" };
    const refresh = () => {
      const k = kindNow();
      if (!editing) Object.assign(memory, { kind: k, role: role.value, orient: orient.value, transparent: transparent.input.checked, description: description.value });
      logoBox.hidden = k !== "logo"; descriptionBox.hidden = k === "logo"; fontBox.hidden = k !== "font"; sectionBox.hidden = k !== "other" || Boolean(fixedSection); if (adopt) adopt.node.hidden = !legacy;
      if (!changed()) { previewName.textContent = a.originalName; previewNote.textContent = "Unchanged."; preview.className = "adm-brand__preview"; state = { ok: true, message: "", unchanged: true }; return; }
      const built = buildBrandFileName(naming());
      if (!built.ok) {
        previewName.textContent = "…";
        previewNote.textContent = built.error === "incomplete_logo_details" ? `Choose the ${built.missing.join(", ").replace(/, ([^,]*)$/, " and $1")} to see the file name.` : "Enter a name to see the file name.";
        preview.className = "adm-brand__preview is-pending"; state = { ok: false, message: ERROR_TEXT[built.error] }; return;
      }
      const shown = built.name.endsWith(".") || !getExt() && !a ? built.stem + ".…" : built.name;
      previewName.textContent = shown;
      if (taken.has(built.name.toLowerCase())) { previewNote.textContent = "A file with this name already exists. Change a detail, or replace the existing file instead."; preview.className = "adm-brand__preview is-taken"; state = { ok: false, message: ERROR_TEXT.duplicate_name }; return; }
      previewNote.textContent = getExt() || a ? "Clients download the file with this name." : "The file type is added when you choose a file.";
      preview.className = "adm-brand__preview is-ok"; state = { ok: true, message: "" };
    };
    if (adopt) adopt.input.addEventListener("change", refresh);
    for (const el of [role, orient, description]) { el.addEventListener("change", refresh); el.addEventListener("input", refresh); }
    transparent.input.addEventListener("change", refresh);
    if (kind) kind.addEventListener("change", refresh);
    refresh();
    const node = h("div", { class: "adm-brand__fields" }, editing ? h("p", { class: "adm-brand__meta" }, `Type: ${KIND_ONE[a.kind]}. It can’t be changed after upload.`) : fixed ? null : labelled(prefix + "-kind", "Type", kind), logoBox, descriptionBox, sectionBox, adopt ? adopt.node : null, preview, labelled(prefix + "-usage", "Usage note (optional)", usage, "Shown to the client, for example “Use on white or light backgrounds”."), fontBox);
    /** What the server accepts. A logo sends only its details; any other file sends its name. The file name itself is never sent: the server generates it. */
    const read = () => {
      const k = kindNow(), out = { usage_note: usage.value.trim() || null };
      if (!editing) out.kind = k;
      if (adopt && adopt.input.checked) out.standard_name = true;
      if (k === "logo") { if (!editing || changed()) Object.assign(out, { logo_role: role.value || null, orientation: orient.value || null, transparent: transparent.input.checked }); } // no tone is sent: an older file keeps the one it has
      else if (!editing || changed()) out.title = description.value.trim();
      if (k === "other") out.section = sectionSel.value || null;
      if (k === "font") Object.assign(out, { downloadable: downloadable.input.checked, license_note: licence.value.trim() || null });
      return out;
    };
    return { node, read, refresh, ready: () => (state.ok ? { ok: true } : { ok: false, message: state.message || ERROR_TEXT.incomplete_logo_details }), kind };
  }

  function addForm() {
    const fileInput = h("input", { id: "br-new-file", class: "input", type: "file", accept: ACCEPT });
    const fields = assetFields("br-new", null, () => extensionOf((fileInput.files && fileInput.files[0] && fileInput.files[0].name) || ""));
    const errorEl = h("p", { class: "adm-field__error", id: "br-new-err", role: "alert", hidden: true });
    fileInput.addEventListener("change", () => fields.refresh());
    const form = h("form", { class: "adm-form adm-brand__form", novalidate: true, "aria-label": "Add a file", onsubmit: (ev) => {
      ev.preventDefault();
      errorEl.hidden = true;
      const f = fileInput.files && fileInput.files[0];
      const fail = (t) => { errorEl.textContent = t; errorEl.hidden = false; };
      if (!f) return fail(ERROR_TEXT.no_file);
      if (f.size > data.limits.adminMaxFileBytes) return fail(`That file is ${fmtSize(f.size)}. The limit is ${fmtSize(data.limits.adminMaxFileBytes)}.`);
      const ready = fields.ready();
      if (!ready.ok) return fail(ready.message);
      const meta = fields.read();
      const body = new FormData(); body.append("file", f, f.name); body.append("meta", JSON.stringify(meta));
      perform({ request: () => api(base + "/assets", { method: "POST", body }), success: (res) => `${res.name} was added as a draft. Publish it when it’s ready for the client.`, onError: (err) => { fail(errorText(err)); return errorText(err); } });
    } },
      labelled("br-new-file", "File", fileInput, `Up to ${fmtSize(data.limits.adminMaxFileBytes)}. It’s added as a draft: the client sees nothing until you publish it.`),
      fields.node, errorEl,
      h("div", { class: "adm-actions" }, h("button", { class: "btn btn--primary", type: "submit" }, "Add file")));
    return form;
  }

  function assetRecord(a, { thumb = false } = {}) {
    const editor = h("div", { class: "adm-brand__edit", hidden: true });
    const chips = [chip(a.published ? "ok" : "plain", a.published ? "Published" : "Draft", a.published ? "complete" : null)];
    if (a.kind === "logo") for (const t of [LOGO_ROLE[a.logoRole], ORIENTATION[a.orientation], TONE[a.tone], a.transparent ? "Transparent" : null]) if (t) chips.push(chip("plain", t));
    if (sectionOf(a)) chips.push(chip("plain", SECTION_OPTIONS[sectionOf(a)]));
    if (a.kind === "font") chips.push(a.downloadable ? chip("ok", "Download allowed") : chip("warn", "View only", "warn"));
    const replaceInput = h("input", { type: "file", class: "visually-hidden", accept: ACCEPT, "aria-label": `Replace file for ${a.originalName}`, tabindex: "-1", onchange: () => {
      const f = replaceInput.files && replaceInput.files[0]; if (!f) return;
      replaceInput.value = "";
      if (f.size > data.limits.adminMaxFileBytes) { say(`That file is ${fmtSize(f.size)}. The limit is ${fmtSize(data.limits.adminMaxFileBytes)}.`, "error"); return; }
      const body = new FormData(); body.append("file", f, f.name);
      perform({ confirm: { title: "Replace this file?", body: "The new file takes the old one’s place, keeping its settings and publication. Its file name keeps the same start and takes the new file’s type. The old file is deleted.", details: [["File", a.originalName], ["New file", f.name], ["Size", fmtSize(f.size)]], confirmLabel: "Replace file" },
        request: () => api(`${base}/assets/${encodeURIComponent(a.id)}/replace`, { method: "POST", body }), success: (res) => `${res.name} was replaced.` });
    } });
    const actions = [];
    if (canWrite()) {
      actions.push(button(a.published ? "Unpublish" : "Publish", { "aria-label": `${a.published ? "Unpublish" : "Publish"} ${a.originalName}`, onclick: () => perform({
        confirm: a.published ? { title: "Unpublish this file?", body: "The client will no longer see or be able to download it.", details: [["File", a.originalName]], confirmLabel: "Unpublish" } : null,
        request: () => api(`${base}/assets/${encodeURIComponent(a.id)}/update`, { method: "POST", body: { published: !a.published } }),
        success: a.published ? `${a.originalName} is no longer published.` : data.kit && data.kit.status === "published" ? `${a.originalName} is published and visible to the client.` : `${a.originalName} is marked published. The client sees it once the kit is published.` }) }));
    }
    actions.push(h("a", { class: "btn btn--secondary adm-small", href: assetLink(a), "aria-label": `Download ${a.originalName}`, download: "" }, "Download"));
    if (canWrite()) {
      actions.push(button("Edit", { "aria-label": `Edit ${a.originalName}`, "aria-expanded": "false", onclick: (ev) => { editor.hidden = !editor.hidden; ev.currentTarget.setAttribute("aria-expanded", String(!editor.hidden)); if (!editor.hidden) editor.querySelector("input, select")?.focus(); } }));
      if (canUpload()) actions.push(button("Replace file", { "aria-label": `Replace file for ${a.originalName}`, onclick: () => replaceInput.click() }));
      actions.push(button("Delete", { "aria-label": `Delete ${a.originalName}`, onclick: () => perform({
        confirm: { title: "Delete this file?", body: "It is removed from the client’s Branding page if it was published, and the stored file is deleted. This can’t be undone.", details: [["File", a.originalName]], confirmLabel: "Delete file" },
        request: () => api(`${base}/assets/${encodeURIComponent(a.id)}/delete`, { method: "POST", body: {} }), success: `${a.originalName} was deleted.` }) }));
      const fields = assetFields("br-ed-" + a.id.slice(0, 8), a);
      const sort = h("input", { id: "br-ed-sort-" + a.id.slice(0, 8), class: "input", type: "number", min: "0", max: "10000", value: String(a.sortOrder), inputmode: "numeric" });
      editor.append(h("form", { class: "adm-form adm-brand__form", novalidate: true, "aria-label": "Edit " + a.originalName, onsubmit: (ev) => {
        ev.preventDefault();
        const ready = fields.ready();
        if (!ready.ok) { say(ready.message, "error"); return; }
        const body = { ...fields.read(), sort_order: Number(sort.value) || 0 };
        perform({ request: () => api(`${base}/assets/${encodeURIComponent(a.id)}/update`, { method: "POST", body }), success: (res) => `${res.name || a.originalName} was updated.` });
      } }, fields.node, labelled("br-ed-sort-" + a.id.slice(0, 8), "Order (lower numbers first)", sort), h("div", { class: "adm-actions" }, h("button", { class: "btn btn--primary adm-small", type: "submit" }, "Save changes"), button("Cancel", { onclick: () => { editor.hidden = true; } }))));
    }
    return h("li", { class: "adm-brand__item" },
      h("div", { class: "adm-brand__main" }, thumb && IMAGE_ORDER.includes(a.format) ? h("img", { class: "adm-brand__thumb", src: previewLink(a), alt: "", width: "96", height: "64", loading: "lazy", decoding: "async" }) : null, h("p", { class: "adm-brand__name", text: a.title }), h("p", { class: "adm-brand__file" }, h("code", { text: a.originalName })), h("p", { class: "adm-brand__chips" }, chips),
        h("p", { class: "adm-brand__meta" }, `${a.format.toUpperCase()} · ${fmtSize(a.size)} · added ${fmtDate(a.createdAt)}`, a.usageNote ? h("span", { class: "adm-brand__note", text: a.usageNote }) : null)),
      h("div", { class: "adm-row-actions" }, actions, replaceInput), editor);
  }

  /** The optional brand name that file names start with. Saving it never renames an existing file. */
  function brandNameBox() {
    const input = h("input", { id: "br-brand-name", class: "input", type: "text", maxlength: "60", value: (data.kit && data.kit.brandName) || "", autocomplete: "off", placeholder: data.organization.name });
    const example = h("p", { class: "adm-field__hint", id: "br-brand-name-example", "aria-live": "polite" });
    const err = h("p", { class: "adm-field__error", role: "alert", hidden: true });
    const sample = () => {
      const company = input.value.trim() || data.organization.name;
      const b = buildBrandFileName({ company, slug: data.organization.slug, kind: "logo", logo: { role: "primary", orientation: "square" }, ext: "png" });
      example.textContent = `New files will be named like ${b.name}. ${input.value.trim() ? "" : "(No brand name set: the organization’s name is used.) "}Files already uploaded keep their names.`;
    };
    input.addEventListener("input", sample); sample();
    return h("form", { class: "adm-form adm-brand__form adm-brand__brandname", novalidate: true, "aria-label": "Brand name for file names", onsubmit: (ev) => {
      ev.preventDefault(); err.hidden = true;
      const value = input.value.trim();
      perform({ request: () => api(base + "/kit", { method: "PUT", body: { brand_name: value || null } }), success: value ? `Brand name saved. New files will start with “${value}”; existing files keep their names.` : "Brand name cleared. New files will start with the organization’s name; existing files keep their names.", onError: (e) => { err.textContent = errorText(e); err.hidden = false; return errorText(e); } });
    } },
      labelled("br-brand-name", "Brand name (optional)", input, `Used at the start of generated file names instead of “${data.organization.name}”. Leave empty to use the organization’s name.`),
      example, err,
      h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary adm-small", type: "submit" }, "Save brand name")));
  }

  /* ---------------------------------------------------------- the four logo cards */

  const previewLink = (a) => assetLink(a) + "?preview=1";
  const byPreview = (x, y) => Number(y.published) - Number(x.published) || (IMAGE_ORDER.indexOf(x.format) + 1 || 99) - (IMAGE_ORDER.indexOf(y.format) + 1 || 99) || x.originalName.localeCompare(y.originalName);

  /**
   * The add-a-file workflow in a dialog, opened from a button that already knows what the file is: a logo card (the logo type is set), a section (the file is shown in
   * that section) or the Typography font button. `opts` = { title, intro, fixed: assetFields options, accept, focusId, added(name) }.
   */
  function openUpload(opts) {
    const fileInput = h("input", { id: "br-up-file", class: "input", type: "file", accept: opts.accept });
    const fields = assetFields("br-up", null, () => extensionOf((fileInput.files && fileInput.files[0] && fileInput.files[0].name) || ""), opts.fixed);
    const errorEl = h("p", { class: "adm-field__error", role: "alert", hidden: true });
    fileInput.addEventListener("change", () => fields.refresh());
    const submit = h("button", { class: "btn btn--primary", type: "submit" }, opts.submit || "Upload");
    const dialog = h("dialog", { class: "adm-dialog adm-lvdialog", "aria-labelledby": "br-up-heading" },
      h("form", { class: "adm-form adm-brand__form", novalidate: true, onsubmit: async (ev) => {
        ev.preventDefault(); errorEl.hidden = true;
        const fail = (t) => { errorEl.textContent = t; errorEl.hidden = false; };
        const f = fileInput.files && fileInput.files[0];
        if (!f) return fail(ERROR_TEXT.no_file);
        if (f.size > data.limits.adminMaxFileBytes) return fail(`That file is ${fmtSize(f.size)}. The limit is ${fmtSize(data.limits.adminMaxFileBytes)}.`);
        const ready = fields.ready();
        if (!ready.ok) return fail(ready.message);
        const body = new FormData(); body.append("file", f, f.name); body.append("meta", JSON.stringify(fields.read()));
        submit.disabled = true;
        const done = await perform({ request: () => api(base + "/assets", { method: "POST", body }), success: (res) => opts.added(res.name), onError: (err) => { fail(errorText(err)); return errorText(err); } });
        if (done) dialog.close(); else submit.disabled = false;
      } },
        h("h2", { id: "br-up-heading", text: opts.title }),
        h("p", { text: opts.intro }),
        labelled("br-up-file", "File", fileInput, `${opts.accepts || "Up to"} ${fmtSize(data.limits.adminMaxFileBytes)}. It’s added as a draft: the client sees nothing until you publish it.`),
        fields.node, errorEl,
        h("div", { class: "adm-dialog__actions" }, h("button", { class: "btn btn--secondary", type: "button", onclick: () => dialog.close() }, "Cancel"), submit)));
    dialog.addEventListener("close", () => { dialog.remove(); document.getElementById(opts.focusId)?.focus(); });
    document.body.append(dialog);
    dialog.showModal();
  }
  const openLogoUpload = (def) => openUpload({ title: `${def.no} · ${def.title}`, intro: "Add a logo file to this card. Add the other formats (SVG, PNG, PDF…) the same way.", fixed: { fixedRole: def.role }, accept: LOGO_ACCEPT, accepts: "SVG, PNG, JPG, WebP, PDF or EPS, up to", submit: "Upload logo", focusId: "br-lv-up-" + def.key, added: (name) => `${name} was added to ${def.title} as a draft. Publish it when it’s ready for the client.` });
  const openSectionUpload = (def) => openUpload({ title: `${def.no} · ${def.title}`, intro: "Add a file to this section. It is shown on the client’s Branding page once published.", fixed: { fixedSection: def.key }, accept: ACCEPT, submit: "Upload file", focusId: "br-sec-up-" + def.key, added: (name) => `${name} was added to ${def.title} as a draft. Publish it when it’s ready for the client.` });
  const openFontUpload = () => openUpload({ title: "02 · Typography: add a font file", intro: "Add a font file. The client can download it only if you record its licence.", fixed: { fixedKind: "font" }, accept: ".ttf,.otf,.woff,.woff2", submit: "Upload font", focusId: "br-font-up", added: (name) => `${name} was added as a draft. Publish it when it’s ready for the client.` });

  const filesId = (def) => "br-lv-files-" + def.key;

  /** One of the four cards, laid out like the client's Branding page, with the upload and file-management controls for Admin. */
  function logoCard(def, files) {
    const has = files.length > 0;
    const shown = files.find((a) => IMAGE_ORDER.includes(a.format));
    const live = files.filter((a) => a.published).length;
    const formats = [...new Set(files.map((a) => a.format.toUpperCase()))];
    const picture = !has
      ? h("img", { src: def.example, alt: def.alt, width: "1920", height: "1080", loading: "lazy", decoding: "async" })
      : shown ? h("img", { src: previewLink(shown), alt: `${def.title}: ${shown.originalName}`, loading: "lazy", decoding: "async" }) : h("span", { class: "adm-muted adm-small", text: "No preview for this format" });
    const stageClass = "adm-lv__stage" + (has && shown ? " adm-lv__stage--logo" + (shown.tone === "dark" ? " adm-lv__stage--dark" : "") : "") + (has && !shown ? " adm-lv__stage--file" : "");
    const stage = canUpload()
      ? h("button", { class: stageClass, type: "button", tabindex: "-1", "aria-label": `Upload a logo to ${def.title}`, onclick: () => openLogoUpload(def) }, picture) // the whole picture is a click target; the button below is the keyboard route
      : h("div", { class: stageClass }, picture);
    const status = !has ? "Not added yet" : live ? `${live} published${files.length - live ? `, ${files.length - live} draft` : ""}` : "Draft only. The client still sees the example.";
    return h("li", { class: "adm-lv", id: "br-lv-" + def.key },
      stage,
      h("div", { class: "adm-lv__body" },
        h("p", { class: "adm-lv__no", "aria-hidden": "true", text: def.no }),
        h("h3", { class: "adm-lv__title", text: def.title }),
        h("p", { class: "adm-lv__status", text: status }),
        h("p", { class: "adm-lv__desc", text: def.desc }),
        h("p", { class: "adm-lv__meta" }, has ? formats.join(" · ") : "Example: Framework"),
        canUpload() ? h("div", { class: "adm-lv__actions" }, h("button", { class: "btn btn--secondary adm-small", type: "button", id: "br-lv-up-" + def.key, "aria-label": `${has ? "Add a format to" : "Upload a logo to"} ${def.title}`, onclick: () => openLogoUpload(def) }, has ? "Add format" : "Upload logo")) : null,
        has ? h("button", { class: "adm-lv__manage", type: "button", "aria-label": `Manage ${plural(files.length, "file")} in ${def.title}`, onclick: () => { opened.add(filesId(def)); goTo(filesId(def)); } }, `Manage files (${files.length})`) : null));
  }

  /** The four permanent logo cards, plus any older logo files that have no logo type yet (never guessed into a card). */
  function logoCards() {
    const logos = data.assets.filter((a) => a.kind === "logo").sort(byPreview);
    const loose = logos.filter((a) => !LOGO_VARIATION_ROLES.includes(a.logoRole));
    return h("div", { class: "adm-lvwrap" },
      h("p", { class: "adm-sub", text: "These four cards are what the client sees. A card without a published logo shows Framework’s own logo as an example." }),
      h("ul", { class: "adm-lv-grid", "aria-label": "Logo categories" }, LOGO_VARIATIONS.map((def) => logoCard(def, logos.filter((a) => a.logoRole === def.role)))),
      // the files of each card (view, download, publish, edit, replace, delete) open full width below the cards, where their forms have room
      LOGO_VARIATIONS.map((def) => ({ def, files: logos.filter((a) => a.logoRole === def.role) })).filter((x) => x.files.length).map(({ def, files }) => disclosure({ id: filesId(def), title: `${def.no} · ${def.title}: files`, meta: plural(files.length, "file"), className: "adm-acc--sub", open: opened.has(filesId(def)), onToggle: toggled(filesId(def)),
        children: h("ul", { class: "adm-brand__list", "aria-label": `${def.title} files` }, files.map(assetRecord)) })),
      loose.length ? h("div", { class: "adm-brand__group" },
        h("p", { class: "adm-brand__h3", text: `Other logo files (${loose.length})` }),
        h("p", { class: "adm-sub", text: "Older logo files with no logo type. The client sees them under “Other logo files”. Use Edit and choose a logo type to place one on a card." }),
        h("ul", { class: "adm-brand__list", "aria-label": "Other logo files" }, loose.map(assetRecord))) : null);
  }

  /* ---------------------------------------------------------- the nine numbered sections */

  const numbered = (def) => [h("span", { class: "adm-bk-no", text: def.no }), def.title];
  const sectionIntro = (def) => h("p", { class: "adm-sub", text: def.desc });
  const statusChip = (n, one) => (n ? chip("plain", plural(n, one)) : chip("plain", "Not added yet"));

  /** 01 Logo: the four logo cards (upload, formats, files). */
  function logoSection() {
    const logos = data.assets.filter((a) => a.kind === "logo");
    const filled = LOGO_VARIATION_ROLES.filter((r) => logos.some((a) => a.logoRole === r)).length;
    return section("br-s-logo", numbered(SECTION.logo), filled ? chip("plain", `${filled} of 4 variations`) : chip("plain", "Not added yet"), [sectionIntro(SECTION.logo), logoCards()]);
  }

  /** 04 Tagline: the approved primary tagline, optional alternates and usage guidelines, as plain text (no file needed). Saving an empty form removes the tagline. */
  function taglineSection() {
    const saved = (data.kit && data.kit.sections && data.kit.sections.tagline) || {};
    const available = caps().sections !== false;
    const rows = [...(saved.alternates || [])];
    const primary = h("input", { id: "br-tag-primary", class: "input", type: "text", maxlength: "120", value: saved.primary || "", autocomplete: "off" });
    const guide = h("textarea", { id: "br-tag-guide", class: "input adm-brand__textarea", maxlength: "600", rows: "4" }, saved.guidelines || "");
    const list = h("ul", { class: "adm-brand__list adm-brand__list--tight", "aria-label": "Alternate taglines" });
    const err = h("p", { class: "adm-field__error", role: "alert", hidden: true });
    const addBtn = button("Add alternate tagline", { onclick: () => { if (rows.length >= 6) return; rows.push(""); draw(); list.querySelector("li:last-child input")?.focus(); } });
    const draw = () => {
      list.replaceChildren(...rows.map((v, i) => {
        const input = h("input", { id: `br-tag-alt-${i}`, class: "input", type: "text", maxlength: "120", value: v, autocomplete: "off", oninput: () => { rows[i] = input.value; } });
        return h("li", { class: "adm-brand__row" }, h("div", { class: "adm-brand__rowhead" }, h("span", { class: "adm-brand__rowtitle", text: `Alternate tagline ${i + 1}` }), button("Remove", { "aria-label": `Remove alternate tagline ${i + 1}`, onclick: () => { rows.splice(i, 1); draw(); } })), labelled(`br-tag-alt-${i}`, "Tagline", input));
      }));
      addBtn.disabled = rows.length >= 6;
    };
    draw();
    const save = (tagline, success) => perform({ request: () => api(base + "/kit", { method: "PUT", body: { sections: { tagline } } }), success, onError: (e) => (e.code === "sections_unavailable" ? "Tagline storage isn’t available on this site yet, so nothing was saved." : e.code === "invalid_sections" ? "Check the tagline: each one needs to be a single line of up to 120 characters, with at most six alternates, and the guidelines up to 600 characters." : null) });
    const body = [
      sectionIntro(SECTION.tagline),
      !available ? h("p", { class: "adm-banner" }, "Tagline storage isn’t available on this site yet (its database change hasn’t been applied). The client sees the Framework example until it is.") : null,
      h("form", { class: "adm-form adm-brand__form", novalidate: true, "aria-label": "Tagline", onsubmit: (ev) => {
        ev.preventDefault(); err.hidden = true;
        const alternates = rows.map((x) => x.trim()).filter(Boolean);
        const tagline = { primary: primary.value.trim() || null, alternates, guidelines: guide.value.trim() || null };
        if ([primary.value, ...alternates].some((x) => x.length > 120) || guide.value.length > 600) { err.textContent = "A tagline can be up to 120 characters and the guidelines up to 600."; err.hidden = false; return; }
        save(tagline, tagline.primary || alternates.length || tagline.guidelines ? "Tagline saved. The client sees it once the kit is published." : "Tagline removed.");
      } },
        labelled("br-tag-primary", "Primary tagline", primary, "The main approved tagline: one line, up to 120 characters."),
        h("fieldset", { class: "adm-field" }, h("legend", { text: "Alternate tagline" + "s (optional)" }), h("p", { class: "adm-field__hint", text: "Supporting or alternate lines, up to six." }), list, h("div", { class: "adm-actions" }, addBtn)),
        labelled("br-tag-guide", "Usage guidelines (optional)", guide, "Where and how to use the tagline, up to 600 characters. A blank line starts a new paragraph."),
        err,
        canWrite() ? h("div", { class: "adm-actions" }, h("button", { class: "btn btn--primary adm-small", type: "submit", disabled: available ? null : true }, "Save tagline"), saved.primary || (saved.alternates || []).length || saved.guidelines ? button("Remove tagline", { onclick: () => save(null, "Tagline removed."), disabled: available ? null : true }) : null) : null),
    ];
    const summary = saved.primary ? chip("plain", (saved.alternates || []).length ? `Primary + ${plural(saved.alternates.length, "alternate")}` : "Primary added") : (saved.alternates || []).length || saved.guidelines ? chip("plain", "Incomplete") : chip("plain", "Not added yet");
    return section("br-s-tagline", numbered(SECTION.tagline), summary, body);
  }

  /** 05 to 09 (except the tagline): files placed in the section, with upload and the usual management. */
  function fileSection(def) {
    const files = data.assets.filter((a) => sectionOf(a) === def.key);
    const live = files.filter((a) => a.published).length;
    const body = [
      sectionIntro(def),
      canUpload() ? h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary adm-small", type: "button", id: "br-sec-up-" + def.key, "aria-label": `Upload a file to ${def.title}`, onclick: () => openSectionUpload(def) }, files.length ? "Add file" : "Upload file")) : null,
      files.length ? h("ul", { class: "adm-brand__list", "aria-label": `${def.title} files` }, files.map((a) => assetRecord(a, { thumb: true }))) : h("p", { class: "adm-muted" }, "Nothing here yet. The client sees “Not added yet”."),
    ];
    return section("br-s-" + def.key, numbered(def), files.length ? [chip("plain", plural(files.length, "file")), live ? chip("ok", `${live} published`, "complete") : chip("plain", "None published")] : chip("plain", "Not added yet"), body);
  }

  /** Files that are not part of the nine sections: guidelines, documents, packages and older "other" files (never moved by guesswork), the add-a-file form and the brand name used in file names. */
  function otherFilesSection() {
    const rest = data.assets.filter((a) => a.kind !== "logo" && a.kind !== "font" && !sectionOf(a));
    const groups = ["guideline", "document", "package", "other"].map((k) => [k, rest.filter((a) => a.kind === k)]).filter(([, list]) => list.length);
    const body = [
      h("p", { class: "adm-sub" }, "Guidelines, documents, packages and other files that aren’t part of the nine sections. The client sees them under “Documents and other files”. Use Edit → Show in section to place an older file in a section."),
      canWrite() ? brandNameBox() : null,
      canUpload() ? disclosure({ id: "br-add", title: "Add a file (guidelines, documents, packages…)", className: "adm-acc--sub", open: opened.has("br-add"), onToggle: toggled("br-add"), children: addForm() }) : null,
      groups.map(([k, list]) => h("div", { class: "adm-brand__group" }, h("p", { class: "adm-brand__h3", text: `${KIND_LABEL[k]} (${list.length})` }), h("ul", { class: "adm-brand__list", "aria-label": KIND_LABEL[k] }, list.map((a) => assetRecord(a))))),
      groups.length ? null : h("p", { class: "adm-muted" }, "No other files yet."),
    ];
    return section("br-assets", "Documents and other files", statusChip(rest.length, "file"), body);
  }

  /* ---------------------------------------------------------- colours and typography */

  function coloursSection() {
    const rows = data.kit ? data.kit.colours.map((c) => ({ ...c })) : [];
    const list = h("ul", { class: "adm-brand__list adm-brand__list--tight" });
    const err = h("p", { class: "adm-field__error", role: "alert", hidden: true });
    const draw = () => {
      list.replaceChildren(...rows.map((c, i) => {
        const sw = swatch(c.hex);
        const name = h("input", { id: `br-c-name-${i}`, class: "input", type: "text", maxlength: "40", value: c.name || "", autocomplete: "off", oninput: () => { c.name = name.value; } });
        const role = select(`br-c-role-${i}`, COLOUR_ROLE, c.role || "primary"); role.addEventListener("change", () => { c.role = role.value; });
        const hex = h("input", { id: `br-c-hex-${i}`, class: "input", type: "text", maxlength: "7", value: c.hex || "#", autocomplete: "off", spellcheck: "false", oninput: () => { c.hex = hex.value.trim(); sw.update(c.hex); } });
        const note = h("input", { id: `br-c-note-${i}`, class: "input", type: "text", maxlength: "120", value: c.note || "", autocomplete: "off", oninput: () => { c.note = note.value; } });
        return h("li", { class: "adm-brand__row" }, h("div", { class: "adm-brand__rowhead" }, sw, h("span", { class: "adm-brand__rowtitle", text: `Colour ${i + 1}` }), button("Remove", { "aria-label": `Remove colour ${i + 1}`, onclick: () => { rows.splice(i, 1); draw(); } })),
          h("div", { class: "adm-brand__grid" }, labelled(`br-c-name-${i}`, "Name", name), labelled(`br-c-role-${i}`, "Role", role), labelled(`br-c-hex-${i}`, "HEX", hex), labelled(`br-c-note-${i}`, "Usage note (optional)", note)));
      }));
    };
    draw();
    const body = [
      h("p", { class: "adm-sub" }, "Primary, secondary and accent colours. Clients see the HEX values with a copy button once the kit is published."),
      list, err,
      canWrite() ? h("div", { class: "adm-actions" },
        button("Add colour", { onclick: () => { if (rows.length >= 16) return; rows.push({ name: "", role: rows.length ? "secondary" : "primary", hex: "#", note: "" }); draw(); list.querySelector("li:last-child input")?.focus(); } }),
        h("button", { class: "btn btn--primary adm-small", type: "button", onclick: () => {
          err.hidden = true;
          const colours = rows.map((c) => ({ name: (c.name || "").trim(), role: c.role || "primary", hex: (c.hex || "").trim(), note: (c.note || "").trim() || null }));
          if (colours.some((c) => !c.name || !HEX.test(c.hex))) { err.textContent = ERROR_TEXT.invalid_colours; err.hidden = false; return; }
          perform({ request: () => api(base + "/kit", { method: "PUT", body: { colours } }), success: "Colours saved." });
        } }, "Save colours")) : null,
    ];
    return section("br-s-colours", numbered(SECTION.colours), data.kit && data.kit.colours.length ? chip("plain", plural(data.kit.colours.length, "colour")) : chip("plain", "Not added yet"), [sectionIntro(SECTION.colours), ...body]);
  }

  const SLOT_ROLE = { primary: "heading", secondary: "body", accent: "other" }; // the older "used for" value kept alongside a slot, so nothing that reads it breaks
  const slotName = (k) => (TYPE_SLOT_DEFS.find((d) => d.key === k) || {}).title || "";

  /** 02 Typography: the three typeface slots (Primary, Secondary, Accent), each with family, weights, styles, usage and its font files; older typefaces without a slot stay listed and can be given one. */
  function typographySection() {
    const fonts = data.assets.filter((a) => a.kind === "font");
    const fontIds = new Set(fonts.map((a) => a.id));
    const rows = data.kit ? data.kit.typography.map((t) => ({ ...t, slot: t.slot || "", styles: t.styles || [], file_ids: (t.file_ids || []).filter((id) => fontIds.has(id)), weightsText: (t.weights || []).join(", ") })) : [];
    const list = h("ul", { class: "adm-brand__list adm-brand__list--tight" });
    const err = h("p", { class: "adm-field__error", role: "alert", hidden: true });
    const actions = h("div", { class: "adm-actions" });
    const draw = () => {
      list.replaceChildren(...rows.map((t, i) => {
        const title = h("span", { class: "adm-brand__rowtitle", text: t.slot ? slotName(t.slot) : `Other typeface ${i + 1}` });
        const slot = select(`br-t-slot-${i}`, Object.fromEntries(TYPE_SLOT_DEFS.map((d) => [d.key, d.title + (d.optional ? " (optional)" : "")])), t.slot, { blank: "Other (not one of the three)" });
        const role = select(`br-t-role-${i}`, TYPE_ROLE, t.role || "heading"); role.addEventListener("change", () => { t.role = role.value; });
        const roleBox = labelled(`br-t-role-${i}`, "Used for", role); roleBox.hidden = Boolean(t.slot);
        slot.addEventListener("change", () => { t.slot = slot.value; roleBox.hidden = Boolean(t.slot); title.textContent = t.slot ? slotName(t.slot) : `Other typeface ${i + 1}`; });
        const family = h("input", { id: `br-t-fam-${i}`, class: "input", type: "text", maxlength: "80", value: t.family || "", autocomplete: "off", oninput: () => { t.family = family.value; } });
        const weights = h("input", { id: `br-t-w-${i}`, class: "input", type: "text", maxlength: "60", value: t.weightsText || "", autocomplete: "off", inputmode: "numeric", oninput: () => { t.weightsText = weights.value; } });
        const styles = h("div", { class: "adm-brand__stack" }, ["normal", "italic"].map((k) => { const c = check(`br-t-st-${k}-${i}`, k === "normal" ? "Normal" : "Italic", t.styles.includes(k)); c.input.addEventListener("change", () => { t.styles = c.input.checked ? [...new Set([...t.styles, k])] : t.styles.filter((x) => x !== k); }); return c.node; }));
        const usage = h("input", { id: `br-t-use-${i}`, class: "input", type: "text", maxlength: "300", value: t.usage || "", autocomplete: "off", oninput: () => { t.usage = usage.value; } });
        const source = h("input", { id: `br-t-src-${i}`, class: "input", type: "url", maxlength: "300", value: t.source_url || "", autocomplete: "off", spellcheck: "false", oninput: () => { t.source_url = source.value; } });
        const files = fonts.length ? h("div", { class: "adm-brand__stack" }, fonts.slice(0, 40).map((a) => { const c = check(`br-t-f-${i}-${a.id.slice(0, 8)}`, `${a.title} (${a.format.toUpperCase()})${a.downloadable ? "" : " — view only, not used for the specimen"}`, t.file_ids.includes(a.id)); c.input.addEventListener("change", () => { t.file_ids = c.input.checked ? [...new Set([...t.file_ids, a.id])].slice(0, 6) : t.file_ids.filter((x) => x !== a.id); }); return c.node; })) : h("p", { class: "adm-muted" }, "No font files uploaded yet. Add one below.");
        return h("li", { class: "adm-brand__row" }, h("div", { class: "adm-brand__rowhead" }, title, button("Remove", { "aria-label": `Remove ${t.slot ? slotName(t.slot) : "typeface " + (i + 1)}`, onclick: () => { rows.splice(i, 1); draw(); } })),
          h("div", { class: "adm-brand__grid" }, labelled(`br-t-slot-${i}`, "Role", slot, "Primary: headings and titles. Secondary: body text. Accent: occasional decorative use. One family may fill several roles."), roleBox, labelled(`br-t-fam-${i}`, "Font family", family), labelled(`br-t-w-${i}`, "Approved weights", weights, "For example 400, 600, 700"), h("fieldset", { class: "adm-field" }, h("legend", { text: "Approved styles" }), styles), labelled(`br-t-use-${i}`, "Short usage description", usage), labelled(`br-t-src-${i}`, "Where to get it (optional link)", source, "Must start with https://"),
            h("fieldset", { class: "adm-field" }, h("legend", { text: "Font files" }), h("p", { class: "adm-field__hint", text: "The client sees a specimen in the real font, and can download the file, only when its licence allows downloads. With none selected, files whose name contains the family are used." }), files)));
      }));
      actions.replaceChildren(...[...TYPE_SLOT_DEFS.filter((d) => !rows.some((r) => r.slot === d.key)).map((d) => button(`Add ${d.title}`, { onclick: () => { if (rows.length >= 12) return; rows.push({ role: SLOT_ROLE[d.key], slot: d.key, family: "", weightsText: "", styles: [], usage: "", source_url: "", file_ids: [] }); draw(); list.querySelector("li:last-child input")?.focus(); } })),
        button("Add other typeface", { onclick: () => { if (rows.length >= 12) return; rows.push({ role: "other", slot: "", family: "", weightsText: "", styles: [], usage: "", source_url: "", file_ids: [] }); draw(); list.querySelector("li:last-child input")?.focus(); } }),
        h("button", { class: "btn btn--primary adm-small", type: "button", onclick: () => {
          err.hidden = true;
          const typography = rows.map((t) => ({ role: t.slot ? SLOT_ROLE[t.slot] : t.role || "other", slot: t.slot || null, family: (t.family || "").trim(), weights: String(t.weightsText || "").split(/[\s,]+/).filter(Boolean).map(Number), styles: t.styles, usage: (t.usage || "").trim() || null, source_url: (t.source_url || "").trim() || null, file_ids: t.file_ids }));
          if (typography.some((t) => !t.family || t.weights.some((w) => !Number.isInteger(w)))) { err.textContent = ERROR_TEXT.invalid_typography; err.hidden = false; return; }
          perform({ request: () => api(base + "/kit", { method: "PUT", body: { typography } }), success: "Typography saved. The client sees it once the kit is published." });
        } }, "Save typography")].filter(Boolean));
    };
    draw();
    const body = [
      sectionIntro(SECTION.typography),
      h("p", { class: "adm-sub" }, "Assign each approved typeface to a role. Nothing is invented: a role you leave empty shows as “Not added yet” (the Accent role as optional). Older typefaces with no role stay listed for the client under “Other typefaces”."),
      list, err, canWrite() ? actions : null,
    ];
    const fontBlock = h("div", { class: "adm-brand__group" }, h("p", { class: "adm-brand__h3", text: `Font files (${fonts.length})` }),
      canUpload() ? h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary adm-small", type: "button", id: "br-font-up", onclick: openFontUpload }, "Add font file")) : null,
      fonts.length ? h("ul", { class: "adm-brand__list", "aria-label": "Font files" }, fonts.map((a) => assetRecord(a))) : h("p", { class: "adm-muted" }, "No font files yet."));
    return section("br-s-typography", numbered(SECTION.typography), data.kit && data.kit.typography.length ? chip("plain", plural(data.kit.typography.length, "typeface")) : fonts.length ? chip("plain", plural(fonts.length, "font file")) : chip("plain", "Not added yet"), [...body, fontBlock]);
  }

  /* ---------------------------------------------------------- client submissions */

  function uploadRecord(u) {
    const who = u.uploader.name ? `${u.uploader.name} (${u.uploader.email})` : u.uploader.email;
    const actions = [];
    if (!u.held) actions.push(h("a", { class: "btn btn--secondary adm-small", href: uploadLink(u), "aria-label": `Download ${u.name}`, download: "" }, "Download"));
    if (canWrite()) {
      actions.push(button(u.held ? "Release" : "Hold", { "aria-label": `${u.held ? "Release" : "Hold"} ${u.name}`, onclick: () => perform({
        confirm: u.held ? null : { title: "Hold this file?", body: "Nobody, including you, can download it until you release it. Use this if something about it looks wrong.", details: [["File", u.name]], confirmLabel: "Hold file" },
        request: () => api(`${base}/uploads/${encodeURIComponent(u.id)}/${u.held ? "release" : "hold"}`, { method: "POST", body: {} }), success: u.held ? `${u.name} was released.` : `${u.name} is on hold.` }) }));
      actions.push(button("Delete", { "aria-label": `Delete ${u.name}`, onclick: () => perform({
        confirm: { title: "Delete this client file?", body: "The client loses access to it and the stored file is deleted. This can’t be undone.", details: [["File", u.name], ["Uploaded by", who]], confirmLabel: "Delete file" },
        request: () => api(`${base}/uploads/${encodeURIComponent(u.id)}/delete`, { method: "POST", body: {} }), success: `${u.name} was deleted.` }) }));
    }
    return h("li", { class: "adm-brand__item" },
      h("div", { class: "adm-brand__main" }, h("p", { class: "adm-brand__name", text: u.name }),
        h("p", { class: "adm-brand__chips" }, !u.seen ? chip("pending", "New", "info") : null, u.held ? chip("warn", "On hold", "warn") : null, chip("plain", CATEGORY[u.category] || u.category), u.fontRightsAck ? chip("plain", "Font rights confirmed") : null),
        h("p", { class: "adm-brand__meta" }, `${u.format.toUpperCase()} · ${fmtSize(u.size)} · ${fmtDateTime(u.createdAt)} · ${who}`)),
      h("div", { class: "adm-row-actions" }, actions));
  }

  function uploadsSection() {
    const fresh = data.uploads.filter((u) => !u.seen).length;
    const body = [
      h("p", { class: "adm-sub" }, "Files this client’s team has uploaded. They are never shown to anyone outside the organization and Framework, and are stored privately. Open them on an up-to-date computer; treat ZIPs and Office files with extra care."),
      data.uploads.length ? h("ul", { class: "adm-brand__list" }, data.uploads.map(uploadRecord)) : h("p", { class: "adm-muted" }, "The client hasn’t uploaded anything yet."),
    ];
    return section("br-uploads", "Client uploads", [fresh ? chip("pending", `${fresh} new`, "info") : null, chip("plain", plural(data.uploads.length, "file"))], body);
  }

  /* ---------------------------------------------------------- service requests */

  function requestRecord(r) {
    const status = select("br-rq-s-" + r.id.slice(0, 8), REQUEST_STATUS, r.status);
    const note = h("textarea", { id: "br-rq-n-" + r.id.slice(0, 8), class: "input adm-brand__textarea", maxlength: "1000", rows: "2" }, r.adminNote || "");
    return h("li", { class: "adm-brand__item" },
      h("div", { class: "adm-brand__main" }, h("p", { class: "adm-brand__name", text: r.service }), h("p", { class: "adm-brand__chips" }, chip(r.status === "new" ? "pending" : r.status === "contacted" ? "warn" : "plain", REQUEST_STATUS[r.status])),
        h("p", { class: "adm-brand__meta", text: `Requested ${fmtDateTime(r.createdAt)}` }), r.priceShown ? h("p", { class: "adm-brand__meta", text: `Price shown to the client: ${r.priceShown.label} (an estimate, not a quote)` }) : null, r.note ? h("p", { class: "adm-brand__quote" }, h("span", { class: "adm-muted", text: "Client note: " }), r.note) : null),
      canWrite() ? h("form", { class: "adm-form adm-brand__form adm-brand__form--tight", novalidate: true, "aria-label": "Update request for " + r.service, onsubmit: (ev) => {
        ev.preventDefault();
        perform({ request: () => api(`${base}/requests/${encodeURIComponent(r.id)}/update`, { method: "POST", body: { status: status.value, admin_note: note.value.trim() || null } }), success: `Request for ${r.service} updated.`, onError: (err) => (err.code === "already_open" ? "That would duplicate another open request for the same service." : null) });
      } }, labelled("br-rq-s-" + r.id.slice(0, 8), "Status", status), labelled("br-rq-n-" + r.id.slice(0, 8), "Internal note (never shown to the client)", note), h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary adm-small", type: "submit" }, "Save request"))) : null);
  }

  function requestsSection() {
    const open = data.requests.filter((r) => r.status === "new" || r.status === "contacted").length;
    const body = [
      h("p", { class: "adm-sub" }, "Design requests and “Request a quote” submissions from the client’s Owners. A request shows the starting price the client saw when there was one. It is an estimate, not a quote, and there is no checkout or payment: follow up with the client directly and record where it stands."),
      data.requests.length ? h("ul", { class: "adm-brand__list" }, data.requests.map(requestRecord)) : h("p", { class: "adm-muted" }, "No service requests yet."),
    ];
    return section("br-requests", "Service requests", [open ? chip("pending", `${open} open`, "info") : null, chip("plain", plural(data.requests.length, "request"))], body);
  }

  /* ---------------------------------------------------------- storage */

  /* Backup of the files bucket to a second private bucket: counts and step names only; real client files are never shown. */
  function backupBlock() {
    const out = h("p", { class: "adm-sub", role: "status" });
    const say = (t) => { out.textContent = t; };
    const STEP = { bindings: "both buckets are connected", write: "a test file was written", new_unique_name: "its name is new and unique", copy: "it was copied to the backup bucket", backup_has_same_name: "the backup holds it under the same name", backup_bytes_match: "the backup copy matches byte for byte", loss_simulated: "its main copy was deleted to simulate a loss", restore: "it was restored from the backup", restored_bytes_match: "the restored file matches byte for byte", cleanup: "the test file was cleaned up" };
    const run = (label, request, describe) => button(label, { onclick: async (ev) => {
      const btn = ev.currentTarget; btn.disabled = true; say("Working…");
      try { say(describe(await request())); } catch (e) { say(e && e.code === "backup_unavailable" ? "File backup isn’t set up on this site." : "That didn’t work and nothing was changed. Please try again."); }
      btn.disabled = false;
    } });
    const counts = (r) => `${r.copied} copied, ${r.failed} failed, ${r.remaining} still to do (${r.checked} files checked).`;
    return h("div", { class: "adm-backup" },
      h("h2", { class: "adm-approved__h", text: "Backup" }),
      h("p", { class: "adm-sub", text: "New files are copied to a second private bucket (copy only: nothing is ever deleted there). Restoring copies back only files that are missing, and never overwrites one that exists." }),
      h("div", { class: "adm-actions" },
        run("Backup status", () => api("/branding/backup"), (r) => (r.configured ? `Files: ${r.primary}. Backup: ${r.backup}. Not yet backed up: ${r.missingFromBackup + r.changed}. Only in the backup: ${r.missingFromPrimary}.` + (r.retention ? ` Deleted files kept for 90 days: ${r.retention.waiting} waiting, ${r.retention.due} due for removal (${r.retention.enabled ? "automatic removal is on" : "automatic removal is off"}).` : "") : "File backup isn’t set up on this site.")),
        canWrite() ? run("Run backup check", () => api("/branding/backup-check", { method: "POST", body: {} }), (r) => (r.ok ? "Backup works: " + r.steps.map((x) => STEP[x.name] || x.name).join("; ") + "." : "Backup check failed at: " + r.steps.filter((x) => !x.ok).map((x) => STEP[x.name] || x.name).join(", ") + ".")) : null,
        canWrite() ? run("Back up now", () => api("/branding/backup-run", { method: "POST", body: {} }), (r) => (r.ok ? "Done: " : "Finished with problems: ") + counts(r)) : null,
        canWrite() ? button("Restore missing files…", { onclick: async (ev) => {
          const btn = ev.currentTarget; // read before any await: the event's target is cleared afterwards
          if (!(await confirmDialog({ title: "Restore missing files?", body: "This copies back, from the backup, only files that are missing from the main bucket and still in use. Files that exist are never overwritten, and files that were deleted are not restored.", confirmLabel: "Restore" }))) return;
          btn.disabled = true; say("Working…");
          try { const r = await api("/branding/backup-restore", { method: "POST", body: { confirm: "RESTORE" } }); say((r.ok ? "Done: " : "Finished with problems: ") + counts(r)); } catch { say("That didn’t work and nothing was changed. Please try again."); }
          btn.disabled = false;
        } }) : null),
      out);
  }

  function storageSection() {
    const result = h("p", { class: "adm-sub", role: "status" });
    const limits = data.limits, use = data.usage;
    const body = [
      h("p", { class: "adm-sub" }, `This client’s uploads use ${plural(use.files, "file")} of ${limits.maxFiles} and ${fmtSize(use.bytes)} of ${fmtSize(limits.quotaBytes)}. Client files up to ${fmtSize(limits.maxFileBytes)} each; your own up to ${fmtSize(limits.adminMaxFileBytes)}.`),
      h("progress", { class: "adm-meter", max: limits.quotaBytes, value: Math.min(use.bytes, limits.quotaBytes), "aria-label": "Client upload space used" }),
      canWrite() ? h("div", { class: "adm-actions" }, button("Run storage check", { onclick: async (ev) => {
        const b = ev.currentTarget; b.disabled = true; result.textContent = "Checking…";
        try { const r = await api("/branding/storage-check", { method: "POST", body: {} }); result.textContent = r.ok ? "Storage works: a test file was written, read back, kept private from other organizations, and deleted." : "Storage check failed at: " + r.steps.filter((s) => !s.ok).map((s) => s.name).join(", ") + "."; } catch (err) { result.textContent = errorText(err); }
        b.disabled = false;
      } })) : null,
      result,
      backupBlock(),
    ];
    return disclosure({ id: "br-storage", title: "Storage", className: "adm-acc--quiet", open: opened.has("br-storage"), onToggle: toggled("br-storage"), meta: caps().storage ? "Private" : "Not available", children: body });
  }

  /* ---------------------------------------------------------- page */

  function draw() {
    const kit = data.kit, publishedKit = kit && kit.status === "published";
    const assetsPublished = data.assets.filter((a) => a.published).length;
    const newUploads = data.uploads.filter((u) => !u.seen).length;
    const openRequests = data.requests.filter((r) => r.status === "new" || r.status === "contacted").length;
    if (first) {
      first = false;
      // every section and list starts collapsed (the new-uploads and open-requests counts stay in their headings); only a click, or a "Manage files" jump, opens one
    }
    const publish = !canWrite() ? null : h("button", { class: publishedKit ? "btn btn--secondary adm-small" : "btn btn--primary adm-small", type: "button", onclick: () => perform({
      confirm: publishedKit
        ? { title: "Unpublish the brand kit?", body: "The client will see nothing on their Branding page's deliverables until you publish it again.", details: [["Client", data.organization.name]], confirmLabel: "Unpublish kit" }
        : { title: "Publish the brand kit?", body: "The client can see and download every item marked published, plus the colours and typography below.", details: [["Client", data.organization.name], ["Published files", `${assetsPublished} of ${data.assets.length}`]], confirmLabel: "Publish kit" },
      request: async () => { if (!kit) await api(base + "/kit", { method: "PUT", body: { colours: [], typography: [] } }); return api(`${base}/kit/${publishedKit ? "unpublish" : "publish"}`, { method: "POST", body: {} }); },
      success: publishedKit ? "The brand kit is unpublished." : "The brand kit is published. The client can now see the items marked published.",
    }) }, publishedKit ? "Unpublish kit" : "Publish kit");
    const tiles = h("div", { class: "adm-tiles adm-tiles--four" },
      h("div", { class: "adm-tile adm-tile--compact" }, h("p", { class: "adm-tile__label" }, "Brand kit"), h("p", { class: "adm-tile__big adm-tile__big--sm" }, publishedKit ? "Published" : "Draft"), h("p", { class: "adm-tile__note", text: publishedKit ? `Since ${fmtDate(kit.publishedAt)}` : "Clients can’t see it yet" })),
      h("div", { class: "adm-tile adm-tile--compact" }, h("p", { class: "adm-tile__label" }, "Files"), h("p", { class: "adm-tile__big adm-tile__big--sm" }, `${assetsPublished}/${data.assets.length}`), h("p", { class: "adm-tile__note", text: "published" })),
      h("div", { class: "adm-tile adm-tile--compact" }, h("p", { class: "adm-tile__label" }, "Client uploads"), h("p", { class: "adm-tile__big adm-tile__big--sm" }, String(data.uploads.length)), h("p", { class: "adm-tile__note", text: newUploads ? `${newUploads} new` : "none new" })),
      h("div", { class: "adm-tile adm-tile--compact" }, h("p", { class: "adm-tile__label" }, "Requests"), h("p", { class: "adm-tile__big adm-tile__big--sm" }, String(openRequests)), h("p", { class: "adm-tile__note", text: "open" })));
    root.replaceChildren(...[
      h("a", { class: "adm-back", href: "/admin/clients/" + encodeURIComponent(orgId), "data-link": "" }, "← " + data.organization.name),
      h("div", { class: "adm-idhead" }, h("div", { class: "adm-idhead__text" }, h("span", { class: "eyebrow" }, "Client"), h("h1", { class: "adm-title", tabindex: "-1" }, "Branding"), h("p", { class: "adm-sub" }, `${data.organization.name}. Clients only see items you publish, and only while the kit is published.`)), h("div", { class: "adm-actions" }, publish)),
      live, tiles,
      !canWrite() ? h("p", { class: "adm-banner" }, "Changes are switched off on this site: you can look at files, but not add, publish or delete them.") : !caps().storage ? h("p", { class: "adm-banner" }, "File storage isn’t available on this site, so files can’t be added or replaced. Colours and typography can still be set.") : null,
      logoSection(), typographySection(), coloursSection(), taglineSection(), ...["imagery", "layout", "textures", "iconography", "style"].map((k) => fileSection(SECTION[k])),
      otherFilesSection(), uploadsSection(), requestsSection(), storageSection(),
    ].filter(Boolean));
  }

  if (!data.available) return { title: "Branding", node: h("div", { class: "adm-page" }, h("a", { class: "adm-back", href: "/admin/clients/" + encodeURIComponent(orgId), "data-link": "" }, "← Client"), h("p", { class: "adm-banner" }, "Branding isn’t available on this deployment yet (its database migration hasn’t been applied).")) };
  draw();
  return { title: "Branding — " + data.organization.name, node: root };
}
