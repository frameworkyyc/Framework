/* Framework Admin: the building blocks of a website's workspace that are more than a form: the downloadable website files, the per-environment screenshot picture and editor, the development milestones and the live-preview check.
   Ported from the old per-client Websites page with the same API calls and the same rules; only the look changed (design-system buttons and cards). `ctx` is { base, data, canWrite, perform, say }:
   `perform` runs one change (confirmation, a lock against double submits, a message, then a refresh). Server text is never inserted as HTML. */
import { h, api, confirmDialog } from "./ui.js";
import { card, button, field, empty, pill, toast } from "./ds.js";

const orNull = (v) => { const t = String(v).trim(); return t === "" ? null : t; };
const STATUS = { existing: "Existing website", in_development: "In development", live: "Live" };
const PHASE = { "": "None", awaiting_feedback: "Awaiting client feedback (in development)", awaiting_approval: "Awaiting approval (in development)", maintenance: "Maintenance (live)" };
const STAGE_LABEL = { existing: "Existing website", in_development: "In development", awaiting_feedback: "Awaiting client feedback", awaiting_approval: "Awaiting approval", live: "Live", maintenance: "Maintenance" };
const MILE_STATUS = { todo: "To do", in_progress: "In progress", done: "Done" };
const ORIGIN = { framework: "Built by Framework", client: "Built by the client or another company" };
const PARTY = { framework: "Framework", client: "The client", unknown: "Not sure" };
const MAX_SHOT = 5 * 1024 * 1024;
const MAX_PACKAGE = 25 * 1024 * 1024;

const ERROR_TEXT = {
  invalid_name: "Give the website a name (up to 80 characters).",
  invalid_url: "Enter a web address like example.ca or https://example.ca (no spaces, no password in the address).",
  invalid_phase: "That phase doesn’t fit where the website stands: Awaiting client feedback and Awaiting approval are for a website in development, Maintenance for a live one.", phase_unavailable: "Phases aren’t available on this site yet (a database change is waiting), so the phase was not saved.",
  invalid_title: "Give the milestone a title (up to 120 characters, one line).", invalid_detail: "That detail is too long (500 characters at most).", invalid_direction: "Choose up or down.",
  invalid_origin: "Choose who built the website.", invalid_status: "Choose where the website stands.", invalid_date: "Use a real date.", invalid_party: "Choose who owns it.",
  invalid_text: "That text is too long or has odd characters.", invalid_input: "Check the details and try again.",
  invalid_combination: "An existing or live website needs a web address, and a website in development is built by Framework.",
  too_many: "This client has as many websites as can be kept here. Archive one first.",
  not_found: "That website no longer exists. The page has been refreshed.", conflict: "That changed while you were working. The page has been refreshed.",
  archive_encrypted: "That ZIP is password-protected, so it can’t be checked. Upload one without a password.", archive_unsupported: "That ZIP uses a format that can’t be checked. Save it again as a standard ZIP.",
  archive_unsafe_entry: "That ZIP contains a file type that isn’t allowed (such as a program or installer) or an unsafe path.", archive_entries: "That ZIP has no files, or far too many.", archive_too_large: "That ZIP expands to far more than it should.",
  unavailable: "That isn’t available on this site yet (a database change is waiting), so nothing was changed.", invalid_state: "Choose how this service should be treated for this client.",
  type_not_allowed: "Use a PNG, JPG or WebP picture (a ZIP for the website files).", content_mismatch: "The file’s contents don’t match its type. Export the picture again.", invalid_name_file: "That file name can’t be used.",
  image_dimensions: "The picture is empty or far too large.", empty_file: "That file is empty.", file_too_large: "That picture is over 5 MB.", no_file: "Choose a picture first.",
  writes_disabled: "Changes are switched off on this site, so nothing was changed.", storage_unavailable: "File storage isn’t available on this site. Nothing was uploaded.",
  storage_write_failed: "The picture couldn’t be stored just now. Nothing was saved. Try again.", storage_read_failed: "The picture couldn’t be read just now.",
  session: "Your admin session has ended. Reload the page to sign in again.", denied: "This account isn’t allowed to make that change.", network: "Can’t reach the server. Check your connection and try again.",
};
const GENERIC = "That didn’t work and nothing was changed. Try again, and reload the page if it keeps happening.";
const errorText = (err) => ERROR_TEXT[err && err.code] || GENERIC;
const fmtSize = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");


export { STATUS, PHASE, STAGE_LABEL, MILE_STATUS, ORIGIN, PARTY, ERROR_TEXT, errorText, fmtSize, orNull };

const selectEl = (id, options, value) => h("select", { id, class: "input" }, Object.entries(options).map(([v, t]) => h("option", { value: v, selected: v === value ? true : null }, t)));
const textEl = (id, value, props = {}) => h("input", { id, class: "input", type: "text", autocomplete: "off", value: value || "", ...props });
const dateEl = (id, value) => h("input", { id, class: "input", type: "date", value: value || "" });
export { selectEl as select, textEl as text, dateEl as date };

/** The website files: one ZIP per website. A new file starts unpublished; publishing is a separate step, and only a published file is offered to the client. */
export function filesCard(site, { base, data, canWrite, perform, say }) {
  if (!data.packagesAvailable) return card({ title: "Website files", sub: "Downloads for clients aren’t available on this site yet (a database change is waiting for approval)." });
  const pkg = site.package, sid = encodeURIComponent(site.id);
  const input = h("input", { id: "ws-pkg-" + site.id.slice(0, 8), class: "input", type: "file", accept: ".zip,application/zip" });
  const can = canWrite() && data.capabilities.storage;
  return card({ title: "Website files", sub: pkg ? `${pkg.name} · ${fmtSize(pkg.size)} · ${pkg.published ? "Published: the client can download it" : "Not published: the client cannot see it"}` : "No file yet. The client sees a disabled Download button until a ZIP is uploaded and published.",
    body: can ? [field(input.id, pkg ? "Replace the file" : "Upload the website files", input, `A ZIP up to ${MAX_PACKAGE / 1024 / 1024} MB. It is checked, never opened or run. A new file starts unpublished.`)] : null,
    foot: can ? [
      button(pkg ? "Replace file" : "Upload file", { tone: "solid", onClick: () => {
        const f = input.files && input.files[0];
        if (!f) { say(ERROR_TEXT.no_file.replace("picture", "ZIP file"), "error"); input.focus(); return; }
        if (f.size > MAX_PACKAGE) { say("That ZIP is over 25 MB.", "error"); return; }
        const body = new FormData(); body.append("file", f, f.name);
        perform({ request: () => api(`${base}/${sid}/package`, { method: "POST", body }), success: pkg ? "File replaced. It is not published yet." : "File saved. It is not published yet." });
      } }),
      pkg ? button(pkg.published ? "Withdraw download" : "Publish download", { onClick: () => perform(pkg.published
        ? { confirm: { title: "Withdraw this download?", body: "The client will no longer be able to download it.", details: [["Website", site.name], ["File", pkg.name]], confirmLabel: "Withdraw" }, request: () => api(`${base}/${sid}/package/publish`, { method: "POST", body: { published: false } }), success: "Download withdrawn." }
        : { confirm: { title: "Publish this download?", body: "The client will be able to download this file from their Website page.", details: [["Website", site.name], ["File", pkg.name], ["Size", fmtSize(pkg.size)]], confirmLabel: "Publish" }, request: () => api(`${base}/${sid}/package/publish`, { method: "POST", body: { published: true } }), success: "Download published." }) }) : null,
      pkg ? button("Remove file", { tone: "danger", onClick: () => perform({ confirm: { title: "Remove the website files?", body: "The file is deleted from storage and the client can no longer download it.", details: [["Website", site.name], ["File", pkg.name]], confirmLabel: "Remove file" }, request: () => api(`${base}/${sid}/package/remove`, { method: "POST", body: {} }), success: "File removed." }) }) : null,
    ] : null });
}

/* ---- the picture of each environment (Production and Staging), shown on its environment card and edited in that card's Edit panel ---- */
const SHOT = { production: { key: "screenshot", path: "screenshot", label: "Production" }, staging: { key: "stagingScreenshot", path: "screenshot/staging", label: "Staging" } };

/** The picture on an environment card: the uploaded screenshot, else a neutral panel that says there is none (never an invented image). */
export function shotPicture(site, env, base) {
  const m = SHOT[env], rec = site[m.key];
  if (!rec) return h("div", { class: "ds-eshot ds-eshot--none" }, h("span", { text: "No screenshot yet" }));
  const src = `/api/admin${base}/${encodeURIComponent(site.id)}/${m.path}?v=${encodeURIComponent(site.updatedAt || "")}`;
  return h("div", { class: "ds-eshot" }, h("img", { src, alt: `Screenshot of the ${m.label} site of ${site.name}`, loading: "lazy" }));
}

/** The upload, replace and remove control inside an environment's Edit panel. PNG, JPG or WebP up to 5 MB, uploaded by hand (a Staging site is often password protected, so nothing is captured automatically).
    `done` runs after a change was saved (it closes the panel and refreshes the page). */
export function shotEditor(site, env, { base, data, canWrite, done }) {
  const m = SHOT[env], sid = encodeURIComponent(site.id), rec = site[m.key];
  const id = `shot-${env}-${site.id.slice(0, 8)}`;
  const input = h("input", { id, class: "input", type: "file", accept: ".png,.jpg,.jpeg,.webp" });
  const msg = h("p", { class: "ds-hint", role: "status" });
  const can = canWrite() && data.capabilities.storage && (env !== "staging" || data.capabilities.stagingScreenshots);
  let busy = false;
  const run = async (request, success) => {
    if (busy) return; busy = true; msg.textContent = "";
    try { await request(); toast(success); done(); } catch (err) { msg.textContent = errorText(err); }
    busy = false;
  };
  const notice = env === "staging" && !data.capabilities.stagingScreenshots ? "Staging screenshots need a small database update that has not been applied yet, so they can’t be added here for now."
    : !data.capabilities.storage ? "File storage isn’t available on this site." : !canWrite() ? "Changes are switched off on this site." : null;
  return h("section", { class: "ds-shotedit", "aria-label": `${m.label} screenshot` },
    h("h3", { class: "ds-sub2", text: "Screenshot" }),
    shotPicture(site, env, base),
    rec ? h("p", { class: "ds-hint", text: `${rec.name} · ${fmtSize(rec.size)}` }) : null,
    can ? field(id, rec ? "Replace the screenshot" : "Add a screenshot", input, env === "staging" ? "PNG, JPG or WebP, up to 5 MB. Upload it yourself: the Staging site may be password protected." : "PNG, JPG or WebP, up to 5 MB.") : h("p", { class: "ds-hint", text: notice || "" }),
    msg,
    can ? h("div", { class: "ds-actions" },
      button(rec ? "Replace screenshot" : "Upload screenshot", { onClick: () => {
        const f = input.files && input.files[0];
        if (!f) { msg.textContent = ERROR_TEXT.no_file; input.focus(); return; }
        if (f.size > MAX_SHOT) { msg.textContent = ERROR_TEXT.file_too_large; return; }
        const body = new FormData(); body.append("file", f, f.name);
        run(() => api(`${base}/${sid}/${m.path}`, { method: "POST", body }), `${m.label} screenshot saved.`);
      } }),
      rec ? button("Remove", { tone: "danger", onClick: async () => {
        if (!(await confirmDialog({ title: `Remove the ${m.label} screenshot?`, body: "The picture is deleted from storage. The address is not changed.", details: [["Website", site.name]], confirmLabel: "Remove screenshot" }))) return;
        run(() => api(`${base}/${sid}/${m.path}/remove`, { method: "POST", body: {} }), `${m.label} screenshot removed.`);
      } }) : null) : null);
}

/** The development milestones: the progress bar clients see is computed from these. Only a website in development has a bar. */
export function milestonesCard(site, { base, canWrite, perform, say }) {
  const list = site.milestones || [];
  const prog = site.progress && site.progress.show ? `${site.progress.percent}% complete (${site.progress.done} of ${site.progress.total} milestones done)` : site.status === "in_development" ? "No milestones yet, so the client sees no progress bar." : "Only a website in development shows a progress bar.";
  const mBase = `${base}/${encodeURIComponent(site.id)}/milestones`;
  const row = (m) => {
    const k = "ms-" + m.id.slice(0, 8);
    const title = textEl(k + "-t", m.title, { maxlength: "120" }), detail = textEl(k + "-d", m.detail, { maxlength: "500" }), st = selectEl(k + "-s", MILE_STATUS, m.status), due = dateEl(k + "-due", m.dueDate);
    return h("li", { class: "ds-ms" }, field(k + "-t", "Milestone", title), field(k + "-d", "Detail (optional)", detail), h("div", { class: "ds-two" }, field(k + "-s", "Status", st), field(k + "-due", "Due (optional)", due)),
      canWrite() ? h("div", { class: "ds-actions" },
        button("Save", { onClick: () => perform({ request: () => api(`${mBase}/${m.id}/update`, { method: "POST", body: { title: title.value.trim(), detail: orNull(detail.value), status: st.value, due_date: orNull(due.value) } }), success: "Milestone saved." }) }),
        button("Up", { label: `Move ${m.title} up`, onClick: () => perform({ request: () => api(`${mBase}/${m.id}/move`, { method: "POST", body: { direction: "up" } }), success: "Moved up." }) }),
        button("Down", { label: `Move ${m.title} down`, onClick: () => perform({ request: () => api(`${mBase}/${m.id}/move`, { method: "POST", body: { direction: "down" } }), success: "Moved down." }) }),
        button("Remove", { tone: "danger", onClick: () => perform({ confirm: { title: "Remove this milestone?", body: "It disappears from the client’s progress, and the progress bar is recalculated.", details: [["Website", site.name], ["Milestone", m.title]], confirmLabel: "Remove milestone" }, request: () => api(`${mBase}/${m.id}/delete`, { method: "POST", body: {} }), success: "Milestone removed." }) })) : null);
  };
  const k = "ms-new-" + site.id.slice(0, 8);
  const nt = textEl(k + "-t", "", { maxlength: "120" }), nd = textEl(k + "-d", "", { maxlength: "500" }), ns = selectEl(k + "-s", MILE_STATUS, "todo"), nu = dateEl(k + "-due", "");
  return card({ title: "Milestones and progress", sub: prog,
    body: [list.length ? h("ol", { class: "ds-ms__list" }, list.map(row)) : empty({ title: "No milestones", body: "Add the steps of the build; the client sees the progress.", ic: "check" }),
      canWrite() ? h("div", { class: "ds-ms ds-ms--new" }, field(k + "-t", "Add a milestone", nt, "For example “Design approved” or “Content loaded”."), field(k + "-d", "Detail (optional)", nd), h("div", { class: "ds-two" }, field(k + "-s", "Status", ns), field(k + "-due", "Due (optional)", nu)),
        h("div", { class: "ds-actions" }, button("Add milestone", { tone: "solid", onClick: () => { if (!nt.value.trim()) { say(ERROR_TEXT.invalid_title, "error"); nt.focus(); return; } perform({ request: () => api(mBase, { method: "POST", body: { title: nt.value.trim(), detail: orNull(nd.value), status: ns.value, due_date: orNull(nu.value) } }), success: "Milestone added." }); } }))) : null] });
}

const PREVIEW_WHY = {
  blocked: "The website tells browsers not to show it inside another page, so clients see the screenshot (if there is one) or a Visit website card.",
  status: "The website did not answer the portal’s check with a normal page. If the status below is not 200, the portal’s own check could not reach it.",
  redirect: "The website redirects somewhere the portal’s check will not follow (not https, or not a public website name).",
  not_html: "The address does not return a web page.", unreachable: "The portal’s check could not reach the website (it timed out or the connection failed).",
  address_not_checkable: "Only public https addresses are checked; this one is not.", unavailable: "The check is not available on this deployment.",
};
/** What the portal's live-preview check sees for this website (read-only; plain words, never page content). */
export function previewCard(site, { base }) {
  if (!site.url || site.status === "in_development") return null;
  const out = h("div", { class: "ds-card__body" });
  const run = async (btn) => {
    btn.disabled = true; out.replaceChildren(h("p", { class: "ds-muted", text: "Checking…" }));
    try {
      const r = await api(`${base}/${encodeURIComponent(site.id)}/preview-check`);
      const facts = [];
      if (r.hops && r.hops.length) facts.push("Checked: " + r.hops.map((x) => `${x.host} → ${x.status === null ? "no answer" : x.status}`).join(", then "));
      if (r.error) facts.push("Error: " + r.error);
      if (r.contentType) facts.push("Type: " + r.contentType);
      facts.push("X-Frame-Options: " + (r.xFrameOptions || "none"));
      facts.push("CSP frame-ancestors: " + (r.frameAncestors && r.frameAncestors.length ? r.frameAncestors.join(" | ") : "none"));
      out.replaceChildren(pill(r.embeddable ? "Live preview available" : "Live preview not available", r.embeddable ? "ok" : "warn"), h("p", { class: "ds-sub2", text: r.embeddable ? "This website allows the portal to show it, so clients see it live." : PREVIEW_WHY[r.reason] || "Live preview is not available for this website." }), h("ul", { class: "ds-muted ds-list" }, facts.map((t) => h("li", { text: t }))));
    } catch { out.replaceChildren(h("p", { class: "ds-muted", text: "The check could not be run. Reload the page and try again." })); }
    btn.disabled = false;
  };
  const btn = button("Check live preview", { onClick: (e) => run(e.currentTarget) });
  return card({ title: "Live preview check", sub: "Clients see the website live when it allows being shown inside the portal; otherwise the screenshot, or a plain card.", body: out, foot: btn });
}
