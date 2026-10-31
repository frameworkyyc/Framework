/* Framework Admin — a client's Websites: /admin/clients/:id/website. Framework staff keep each website of a client here (several per client): the address, where it stands (existing,
   in development or live), who built it, whether Framework manages it (a separate yes/no), the launch date, domain and hosting facts (information only, never passwords), notes,
   and an optional screenshot. "No website" is simply a client with none added. Clients see published websites in the Website section of the Client Portal (where it is switched on), as a live preview when the website allows it, else this screenshot or a plain card.
   Server text is never inserted as HTML. */

import { h, api, confirmDialog, errorState, fmtDate } from "./ui.js";
import { chip } from "./client-dashboard.js";
import { seoPanel } from "./website-seo.js";

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

const field = (id, label, input, hint) => h("div", { class: "adm-field" }, h("label", { for: id, text: label }), hint ? h("p", { class: "adm-field__hint", text: hint }) : null, input);
const select = (id, options, value) => h("select", { id, class: "input" }, Object.entries(options).map(([v, t]) => h("option", { value: v, selected: v === value ? true : null }, t)));
const text = (id, value, props = {}) => h("input", { id, class: "input", type: "text", autocomplete: "off", value: value || "", ...props });
const date = (id, value) => h("input", { id, class: "input", type: "date", value: value || "" });
const check = (id, label, checked, hint) => { const input = h("input", { type: "checkbox", id, checked: checked ? true : null }); return { input, node: h("div", { class: "adm-field" }, h("label", { class: "adm-choice", for: id }, input, h("span", { text: label })), hint ? h("p", { class: "adm-field__hint", text: hint }) : null) }; };
const orNull = (v) => { const t = String(v).trim(); return t === "" ? null : t; };

export async function render(orgId, ctx) {
  const base = "/clients/" + encodeURIComponent(orgId) + "/websites";
  let data;
  try { data = await api(base); } catch (err) { return { title: "Websites", node: h("div", { class: "adm-page" }, errorState(err, ctx.retry)) }; }
  const back = h("a", { class: "adm-back", href: "/admin/clients/" + encodeURIComponent(orgId), "data-link": "" }, "← " + (data.organization ? data.organization.name : "Client"));
  if (!data.available) return { title: "Websites", node: h("div", { class: "adm-page" }, back, h("div", { class: "adm-idhead" }, h("div", { class: "adm-idhead__text" }, h("span", { class: "eyebrow" }, "Client"), h("h1", { class: "adm-title", tabindex: "-1" }, "Websites"))), h("p", { class: "adm-banner" }, "Websites aren’t available on this site yet (its database migration hasn’t been applied).")) };

  let svcState = null;
  const svcBase = "/clients/" + encodeURIComponent(orgId) + "/additional-services";
  try { svcState = await api(svcBase); } catch { svcState = null; }
  const root = h("div", { class: "adm-page adm-websites" });
  const live = h("p", { class: "adm-msg", role: "status", tabindex: "-1", hidden: true });
  const opened = new Set();
  let busy = false;
  const canWrite = () => Boolean(data.capabilities && data.capabilities.writes);

  function say(message, tone = "info", { focus = true } = {}) {
    live.textContent = message; live.className = "adm-msg is-" + tone; live.setAttribute("role", tone === "error" ? "alert" : "status"); live.hidden = !message;
    if (message && focus) live.focus({ preventScroll: false });
  }
  async function reload() { try { data = await api(base); draw(); } catch { /* the previous view stays; the message says what happened */ } }
  /** One change: lock against double submits, call the API, say what happened in plain words, then show the server's real state. */
  async function perform({ confirm, request, success }) {
    if (busy) return false;
    if (confirm && !(await confirmDialog(confirm))) return false;
    busy = true; root.setAttribute("aria-busy", "true"); say("Working…", "info", { focus: false });
    let outcome, ok = false;
    try { await request(); outcome = { tone: "success", text: success }; ok = true; } catch (err) { outcome = { tone: "error", text: errorText(err) }; }
    busy = false; root.removeAttribute("aria-busy");
    await reload();
    say(outcome.text, outcome.tone);
    return ok;
  }

  /** The details form: used to add a website (site = null) and to edit one. */
  function siteForm(site) {
    const id = site ? "ws-" + site.id.slice(0, 8) : "ws-new";
    const name = text(id + "-name", site && site.name, { maxlength: "80", required: true });
    const url = text(id + "-url", site && site.url, { maxlength: "300", inputmode: "url", spellcheck: "false", autocapitalize: "none", placeholder: "example.ca" });
    const origin = select(id + "-origin", ORIGIN, site ? site.origin : "framework");
    const status = select(id + "-status", STATUS, site ? site.status : "in_development");
    const phase = select(id + "-phase", PHASE, (site && site.phase) || "");
    const managed = check(id + "-managed", "Framework manages this website", site && site.managedByFramework, "Separate from where it stands: whether Framework looks after its updates, hosting or maintenance.");
    const launch = date(id + "-launch", site && site.launchDate);
    const published = check(id + "-published", "Ready to show the client", site && site.published, "Clients can’t see websites yet: the Website section is switched off. This only prepares it.");
    const dReg = text(id + "-dreg", site && site.domain.registrar, { maxlength: "120" }), dOwn = select(id + "-down", PARTY, site ? site.domain.owner : "unknown"), dRen = date(id + "-dren", site && site.domain.renewal);
    const hProv = text(id + "-hprov", site && site.hosting.provider, { maxlength: "120" }), hOwn = select(id + "-hown", PARTY, site ? site.hosting.owner : "unknown"), hRen = date(id + "-hren", site && site.hosting.renewal);
    const notes = h("textarea", { id: id + "-notes", class: "input adm-brand__textarea", rows: "3", maxlength: "1000" }, (site && site.managementNotes) || "");
    const body = () => ({
      ...(data.phaseAvailable ? { phase: phase.value || null } : {}),
      name: name.value.trim(), url: orNull(url.value), origin: origin.value, status: status.value, managed_by_framework: managed.input.checked, launch_date: orNull(launch.value), published: published.input.checked,
      domain_registrar: orNull(dReg.value), domain_owner: dOwn.value, domain_renewal: orNull(dRen.value), hosting_provider: orNull(hProv.value), hosting_owner: hOwn.value, hosting_renewal: orNull(hRen.value), management_notes: orNull(notes.value),
    });
    return h("form", { class: "adm-form adm-brand__form", novalidate: true, "aria-label": site ? "Details of " + site.name : "Add a website", onsubmit: (ev) => {
      ev.preventDefault();
      if (!name.value.trim()) { say(ERROR_TEXT.invalid_name, "error"); name.setAttribute("aria-invalid", "true"); name.focus(); return; }
      name.removeAttribute("aria-invalid");
      perform(site
        ? { request: () => api(`${base}/${encodeURIComponent(site.id)}/update`, { method: "POST", body: body() }), success: `${name.value.trim()} saved.` }
        : { request: () => api(base, { method: "POST", body: body() }), success: `${name.value.trim()} added.` });
    } },
      field(id + "-name", "Name", name, "For example “Main website” or “Online shop”."),
      field(id + "-url", "Web address", url, "Leave it empty only while the website is still being built."),
      field(id + "-origin", "Who built it", origin), field(id + "-status", "Where it stands", status),
      data.phaseAvailable ? field(id + "-phase", "Stage (optional)", phase, "Refines where it stands for the client: Awaiting client feedback or Awaiting approval while in development, Maintenance once live. Changing where it stands clears a stage that no longer fits.") : null, managed.node,
      field(id + "-launch", "Launch date", launch, "Optional."), published.node,
      h("p", { class: "acc__group" }, "Domain"),
      field(id + "-dreg", "Registrar", dReg, "Where the domain name is registered."), field(id + "-down", "Who owns the domain", dOwn), field(id + "-dren", "Renews on", dRen),
      h("p", { class: "acc__group" }, "Hosting"),
      field(id + "-hprov", "Hosting provider", hProv), field(id + "-hown", "Who owns the hosting", hOwn), field(id + "-hren", "Renews on", hRen),
      field(id + "-notes", "How it is managed", notes, "Plain notes for the team. Never put passwords or logins here."),
      canWrite() ? h("div", { class: "adm-actions" }, h("button", { class: "btn btn--primary adm-small", type: "submit" }, site ? "Save website" : "Add website")) : null);
  }

  /** What the portal's live-preview check sees for this website, from the Worker (read-only; answers plain words, never page content). */
  const previews = new Map();
  const PREVIEW_WHY = {
    blocked: "The website tells browsers not to show it inside another page, so clients see the screenshot (if there is one) or a Visit website card.",
    status: "The website did not answer the portal’s check with a normal page. If the status below is not 200, the portal’s own check could not reach it.",
    redirect: "The website redirects somewhere the portal’s check will not follow (not https, or not a public website name).",
    not_html: "The address does not return a web page.", unreachable: "The portal’s check could not reach the website (it timed out or the connection failed).",
    address_not_checkable: "Only public https addresses are checked; this one is not.", unavailable: "The check is not available on this deployment.",
  };
  function previewBlock(site) {
    if (!site.url || site.status === "in_development") return null;
    const r = previews.get(site.id);
    const lines = [];
    if (r && r.pending) lines.push(h("p", { class: "adm-muted", text: "Checking…" }));
    else if (r && r.failed) lines.push(h("p", { class: "adm-muted", text: "The check could not be run. Reload the page and try again." }));
    else if (r) {
      lines.push(h("p", { class: "adm-brand__meta", text: r.embeddable ? "Live preview is available: this website allows the portal to show it, so clients see it live." : PREVIEW_WHY[r.reason] || "Live preview is not available for this website." }));
      const facts = [];
      if (r.hops && r.hops.length) facts.push("Checked: " + r.hops.map((x) => `${x.host} → ${x.status === null ? "no answer" : x.status}`).join(", then "));
      if (r.error) facts.push("Error: " + r.error);
      if (r.contentType) facts.push("Type: " + r.contentType);
      facts.push("X-Frame-Options: " + (r.xFrameOptions || "none"));
      facts.push("CSP frame-ancestors: " + (r.frameAncestors && r.frameAncestors.length ? r.frameAncestors.join(" | ") : "none"));
      lines.push(h("ul", { class: "adm-muted" }, facts.map((t) => h("li", { text: t }))));
    }
    return h("div", { class: "adm-ws__block adm-ws__preview" },
      h("p", { class: "acc__group" }, "Live preview"),
      h("p", { class: "adm-muted", text: "Clients see this website live when it allows being shown inside the portal. Otherwise they see the screenshot below, or a plain card with a Visit website button." }),
      h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: async () => {
        previews.set(site.id, { pending: true }); draw();
        try { previews.set(site.id, await api(`${base}/${encodeURIComponent(site.id)}/preview-check`)); } catch { previews.set(site.id, { failed: true }); }
        draw();
      } }, r && !r.pending ? "Check again" : "Check live preview"), ...lines);
  }

  /** The development milestones: the progress bar clients see is computed from these (complete milestones over all of them). Only a website in development has a bar. */
  function milestonesBlock(site) {
    const list = site.milestones || [];
    const prog = site.progress && site.progress.show ? `${site.progress.percent}% complete (${site.progress.done} of ${site.progress.total} milestones done)` : site.status === "in_development" ? "No milestones yet, so the client sees no progress bar." : "Only a website in development shows a progress bar; a live website just says Live.";
    const mBase = `${base}/${encodeURIComponent(site.id)}/milestones`;
    const row = (m) => {
      const k = "ms-" + m.id.slice(0, 8);
      const title = text(k + "-t", m.title, { maxlength: "120" }), detail = text(k + "-d", m.detail, { maxlength: "500" }), st = select(k + "-s", MILE_STATUS, m.status), due = date(k + "-due", m.dueDate);
      return h("li", { class: "adm-ms" }, field(k + "-t", "Milestone", title), field(k + "-d", "Detail (optional)", detail), field(k + "-s", "Status", st), field(k + "-due", "Due (optional)", due),
        canWrite() ? h("div", { class: "adm-actions" },
          h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => perform({ request: () => api(`${mBase}/${m.id}/update`, { method: "POST", body: { title: title.value.trim(), detail: orNull(detail.value), status: st.value, due_date: orNull(due.value) } }), success: "Milestone saved." }) }, "Save"),
          h("button", { class: "btn btn--secondary adm-small", type: "button", "aria-label": `Move ${m.title} up`, onclick: () => perform({ request: () => api(`${mBase}/${m.id}/move`, { method: "POST", body: { direction: "up" } }), success: "Moved up." }) }, "Move up"),
          h("button", { class: "btn btn--secondary adm-small", type: "button", "aria-label": `Move ${m.title} down`, onclick: () => perform({ request: () => api(`${mBase}/${m.id}/move`, { method: "POST", body: { direction: "down" } }), success: "Moved down." }) }, "Move down"),
          h("button", { class: "btn btn--secondary adm-small adm-actions__danger", type: "button", onclick: () => perform({ confirm: { title: "Remove this milestone?", body: "It disappears from the client’s progress, and the progress bar is recalculated.", details: [["Website", site.name], ["Milestone", m.title]], confirmLabel: "Remove milestone" }, request: () => api(`${mBase}/${m.id}/delete`, { method: "POST", body: {} }), success: "Milestone removed." }) }, "Remove")) : null);
    };
    const k = "ms-new-" + site.id.slice(0, 8);
    const nt = text(k + "-t", "", { maxlength: "120" }), nd = text(k + "-d", "", { maxlength: "500" }), ns = select(k + "-s", MILE_STATUS, "todo"), nu = date(k + "-due", "");
    return h("div", { class: "adm-ws__block adm-ws__miles" }, h("p", { class: "acc__group" }, "Milestones and progress"), h("p", { class: "adm-brand__meta", text: prog }),
      list.length ? h("ol", { class: "adm-ms__list" }, list.map(row)) : null,
      canWrite() ? [field(k + "-t", "Add a milestone", nt, "For example “Design approved” or “Content loaded”."), field(k + "-d", "Detail (optional)", nd), field(k + "-s", "Status", ns), field(k + "-due", "Due (optional)", nu),
        h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => { if (!nt.value.trim()) { say(ERROR_TEXT.invalid_title, "error"); nt.focus(); return; } perform({ request: () => api(mBase, { method: "POST", body: { title: nt.value.trim(), detail: orNull(nd.value), status: ns.value, due_date: orNull(nu.value) } }), success: "Milestone added." }); } }, "Add milestone"))] : null);
  }

  /** The downloadable website files: one ZIP per website. A new file starts unpublished; publishing is a separate step, and only a published file is offered to the client. */
  function packageBlock(site) {
    if (!data.packagesAvailable) return h("div", { class: "adm-ws__block adm-ws__pkg" }, h("p", { class: "acc__group" }, "Website files"), h("p", { class: "adm-muted", text: "Downloads for clients aren’t available on this site yet (a database change is waiting for approval)." }));
    const pkg = site.package;
    const input = h("input", { id: "ws-pkg-" + site.id.slice(0, 8), class: "input", type: "file", accept: ".zip,application/zip" });
    return h("div", { class: "adm-ws__block adm-ws__pkg" },
      h("p", { class: "acc__group" }, "Website files"),
      pkg ? h("p", { class: "adm-brand__meta", text: `${pkg.name} · ${fmtSize(pkg.size)} · ${pkg.published ? "Published: the client can download it" : "Not published: the client cannot see it"}` }) : h("p", { class: "adm-muted", text: "No file yet. The client sees a disabled Download button until you upload and publish a ZIP." }),
      canWrite() && data.capabilities.storage ? [
        field(input.id, pkg ? "Replace the file" : "Upload the website files", input, `A ZIP up to ${MAX_PACKAGE / 1024 / 1024} MB. It is checked, never opened or run. A new file starts unpublished.`),
        h("div", { class: "adm-actions" },
          h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => {
            const f = input.files && input.files[0];
            if (!f) { say(ERROR_TEXT.no_file.replace("picture", "ZIP file"), "error"); input.focus(); return; }
            if (f.size > MAX_PACKAGE) { say("That ZIP is over 25 MB.", "error"); return; }
            const body = new FormData(); body.append("file", f, f.name);
            perform({ request: () => api(`${base}/${encodeURIComponent(site.id)}/package`, { method: "POST", body }), success: pkg ? "File replaced. It is not published yet." : "File saved. It is not published yet." });
          } }, pkg ? "Replace file" : "Upload file"),
          pkg ? h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => perform(pkg.published
            ? { confirm: { title: "Withdraw this download?", body: "The client will no longer be able to download it.", details: [["Website", site.name], ["File", pkg.name]], confirmLabel: "Withdraw" }, request: () => api(`${base}/${encodeURIComponent(site.id)}/package/publish`, { method: "POST", body: { published: false } }), success: "Download withdrawn." }
            : { confirm: { title: "Publish this download?", body: "The client will be able to download this file from their Website page.", details: [["Website", site.name], ["File", pkg.name], ["Size", fmtSize(pkg.size)]], confirmLabel: "Publish" }, request: () => api(`${base}/${encodeURIComponent(site.id)}/package/publish`, { method: "POST", body: { published: true } }), success: "Download published." }) }, pkg.published ? "Withdraw download" : "Publish download") : null,
          pkg ? h("button", { class: "btn btn--secondary adm-small adm-actions__danger", type: "button", onclick: () => perform({ confirm: { title: "Remove the website files?", body: "The file is deleted from storage and the client can no longer download it.", details: [["Website", site.name], ["File", pkg.name]], confirmLabel: "Remove file" }, request: () => api(`${base}/${encodeURIComponent(site.id)}/package/remove`, { method: "POST", body: {} }), success: "File removed." }) }, "Remove file") : null),
      ] : null);
  }

  /** The screenshot: a preview, and a picture to set, replace or remove. */
  function screenshotBlock(site) {
    const input = h("input", { id: "ws-shot-" + site.id.slice(0, 8), class: "input", type: "file", accept: ".png,.jpg,.jpeg,.webp" });
    const url = `/api/admin${base}/${encodeURIComponent(site.id)}/screenshot?v=${encodeURIComponent(site.updatedAt || "")}`;
    return h("div", { class: "adm-ws__block adm-ws__shot" },
      h("p", { class: "acc__group" }, "Screenshot"),
      site.screenshot ? h("img", { class: "adm-ws__img", src: url, alt: `Screenshot of ${site.name}`, loading: "lazy" }) : h("p", { class: "adm-muted" }, "No screenshot yet. It is optional: clients see a live preview of the website when it allows one, and this picture only when it does not."),
      site.screenshot ? h("p", { class: "adm-brand__meta", text: `${site.screenshot.name} · ${fmtSize(site.screenshot.size)}` }) : null,
      canWrite() && data.capabilities.storage ? [
        field(input.id, site.screenshot ? "Replace the screenshot" : "Add a screenshot", input, "PNG, JPG or WebP, up to 5 MB. Shown only when the website cannot be previewed live."),
        h("div", { class: "adm-actions" },
          h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => {
            const f = input.files && input.files[0];
            if (!f) { say(ERROR_TEXT.no_file, "error"); input.focus(); return; }
            if (f.size > MAX_SHOT) { say(ERROR_TEXT.file_too_large, "error"); return; }
            const body = new FormData(); body.append("file", f, f.name);
            perform({ request: () => api(`${base}/${encodeURIComponent(site.id)}/screenshot`, { method: "POST", body }), success: "Screenshot saved." });
          } }, site.screenshot ? "Replace screenshot" : "Add screenshot"),
          site.screenshot ? h("button", { class: "btn btn--secondary adm-small adm-actions__danger", type: "button", onclick: () => perform({ confirm: { title: "Remove the screenshot?", body: "The picture is deleted from storage.", details: [["Website", site.name]], confirmLabel: "Remove screenshot" }, request: () => api(`${base}/${encodeURIComponent(site.id)}/screenshot/remove`, { method: "POST", body: {} }), success: "Screenshot removed." }) }, "Remove screenshot") : null)
      ] : null);
  }

  function siteCard(site) {
    const archived = Boolean(site.archivedAt);
    const chips = [chip(site.status === "live" ? "ok" : site.status === "in_development" ? "pending" : "plain", STAGE_LABEL[site.stage] || STATUS[site.status], site.status === "live" ? "complete" : site.status === "in_development" ? "info" : undefined),
      site.managedByFramework ? chip("plain", "Managed by Framework") : chip("plain", "Not managed by Framework"), site.published && !archived ? chip("plain", "Ready to show the client") : null, archived ? chip("warn", "Archived", "warn") : null];
    const summary = [site.url ? h("a", { class: "adm-link", href: site.url, target: "_blank", rel: "noopener noreferrer" }, site.url.replace(/^https?:\/\//, "").replace(/\/$/, "")) : h("span", { class: "adm-muted", text: "No web address yet" }),
      site.launchDate ? h("span", { class: "adm-brand__meta", text: ` · Launch ${fmtDate(site.launchDate + "T00:00:00Z")}` }) : null];
    const actions = canWrite() ? h("div", { class: "adm-actions adm-ws__foot" },
      archived
        ? h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => perform({ request: () => api(`${base}/${encodeURIComponent(site.id)}/restore`, { method: "POST", body: {} }), success: `${site.name} restored.` }) }, "Restore")
        : h("button", { class: "btn btn--secondary adm-small adm-actions__danger", type: "button", onclick: () => perform({ confirm: { title: "Archive this website?", body: "It is hidden from the lists. Nothing is deleted, and you can restore it later.", details: [["Website", site.name]], confirmLabel: "Archive website" }, request: () => api(`${base}/${encodeURIComponent(site.id)}/archive`, { method: "POST", body: {} }), success: `${site.name} archived.` }) }, "Archive")) : null;
    const key = "ws-" + site.id;
    return h("details", { class: "adm-acc adm-ws", id: key, open: opened.has(key) ? true : null, ontoggle: (ev) => { if (ev.target.open) opened.add(key); else opened.delete(key); } },
      h("summary", { class: "adm-acc__sum" }, h("span", { class: "adm-acc__title", text: site.name }), h("span", { class: "adm-acc__meta" }, chips)),
      h("div", { class: "adm-acc__body" }, h("p", null, summary), archived ? null : siteForm(site), archived ? null : milestonesBlock(site), archived ? null : seoPanel({ base, site, canWrite, say }), archived ? null : previewBlock(site), archived ? null : packageBlock(site), archived ? null : screenshotBlock(site), actions));
  }

  const SVC_STATE = { automatic: "Automatic (offer it, unless they already have it)", owned: "Already has it (don’t promote it)", hidden: "Don’t show it to this client" };
  /** What Admin knows about this client and each Additional Service: it is left out of their catalogue when they already have it or it should not be shown. Services are also left out automatically when Framework is already doing the work (for example a published SEO plan). */
  function servicesStateBlock() {
    if (!svcState || !svcState.available) return null;
    const rows = svcState.services.map((sv) => {
      const k = "ss-" + sv.key;
      const sel = select(k, SVC_STATE, sv.state || "automatic"), note = text(k + "-n", sv.note, { maxlength: "300", placeholder: "Optional note for the team" });
      return h("li", { class: "adm-ms" }, h("p", { class: "adm-req__label", text: sv.name }), field(k, "For this client", sel), field(k + "-n", "Note", note),
        canWrite() ? h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: async () => {
          if (busy) return; busy = true; let outcome;
          try { svcState = await api(svcBase, { method: "POST", body: { key: sv.key, state: sel.value, note: sel.value === "automatic" ? "" : note.value } }); outcome = { tone: "success", text: `${sv.name}: saved for ${svcState.organization.name}.` }; } catch (err) { outcome = { tone: "error", text: errorText(err) }; }
          busy = false; draw(); say(outcome.text, outcome.tone);
        } }, "Save")) : null);
    });
    return h("details", { class: "adm-acc adm-acc--quiet", id: "ws-svcstate", open: opened.has("ws-svcstate") ? true : null, ontoggle: (ev) => { if (ev.target.open) opened.add("ws-svcstate"); else opened.delete("ws-svcstate"); } },
      h("summary", { class: "adm-acc__sum" }, h("span", { class: "adm-acc__title", text: "Additional services for this client" })),
      h("div", { class: "adm-acc__body" }, h("p", { class: "adm-sub" }, "The catalogue on this client’s Website page is the same for everyone. Use this to leave a service out for this client because they already have it, or because it shouldn’t be shown to them. Edit the catalogue itself in ", h("a", { class: "adm-link", href: "/admin/settings/additional-services", "data-link": "" }, "Settings → Additional Services"), "."), h("ul", { class: "adm-ms__list" }, rows)));
  }

  function draw() {
    const active = data.websites.filter((s) => !s.archivedAt), archived = data.websites.filter((s) => s.archivedAt);
    const adding = canWrite() && active.length < data.limits.maxWebsites
      ? h("details", { class: "adm-acc", id: "ws-add", open: opened.has("ws-add") ? true : null, ontoggle: (ev) => { if (ev.target.open) opened.add("ws-add"); else opened.delete("ws-add"); } },
        h("summary", { class: "adm-acc__sum" }, h("span", { class: "adm-acc__title", text: "Add a website" })), h("div", { class: "adm-acc__body" }, siteForm(null))) : null;
    root.replaceChildren(...[
      back,
      h("div", { class: "adm-idhead" }, h("div", { class: "adm-idhead__text" }, h("span", { class: "eyebrow" }, "Client"), h("h1", { class: "adm-title", tabindex: "-1" }, "Websites"),
        h("p", { class: "adm-sub" }, `${data.organization.name}. Each website of this client, where it stands and who manages it. Clients see the published ones in the Website section of their portal.`),
        h("p", { class: "adm-sub adm-ws__services" }, "The “Additional services” offered on this client’s Website page are the same for every client: ", h("a", { class: "adm-link", href: "/admin/settings/additional-services", "data-link": "" }, "manage Additional Services"), " (names, descriptions, order, shown or hidden) or ", h("a", { class: "adm-link", href: "/admin/settings/service-pricing#sp-h-addon", "data-link": "" }, "set their prices in Service Pricing"), "."))),
      !canWrite() ? h("p", { class: "adm-banner" }, "Changes are switched off on this site: you can look at the websites, but not change them.") : !data.capabilities.storage ? h("p", { class: "adm-banner" }, "File storage isn’t available on this site, so screenshots can’t be added.") : null,
      live,
      active.length ? h("div", { class: "adm-ws__list" }, active.map(siteCard)) : h("p", { class: "adm-muted" }, "No website yet. A client with no website simply has none listed here: add one when they have one, or when Framework starts building it."),
      adding,
      servicesStateBlock(),
      archived.length ? h("details", { class: "adm-acc adm-acc--quiet", id: "ws-archived", open: opened.has("ws-archived") ? true : null, ontoggle: (ev) => { if (ev.target.open) opened.add("ws-archived"); else opened.delete("ws-archived"); } },
        h("summary", { class: "adm-acc__sum" }, h("span", { class: "adm-acc__title", text: "Archived websites" }), h("span", { class: "adm-acc__meta" }, chip("plain", String(archived.length)))), h("div", { class: "adm-acc__body" }, archived.map(siteCard))) : null,
    ].filter(Boolean));
  }

  draw();
  return { title: "Websites — " + data.organization.name, node: root };
}
