/* Framework Admin — the sales content of one Additional Service (Settings → Additional Services): the problem it solves, what the client gets, why they might need it, the button text, an
   optional demo link, whether it is featured, and its pictures (screenshots, product previews, real examples). Empty text means "use the standard wording". The client sees all of it in the
   expandable service cards under Website. Server text is never inserted as HTML. */
import { h, api, confirmDialog } from "./ui.js";

const ERROR = {
  invalid_category: "The category is too long (60 characters at most).", invalid_tagline: "The headline is too long (160 characters at most).", invalid_problem: "“The problem” is too long (400 characters at most).", invalid_why: "“Why you might need it” is too long (400 characters at most).",
  invalid_cta: "The button text is too long (40 characters at most).", invalid_benefits: "Use up to 8 items, each one line of up to 120 characters.", invalid_featured: "Choose featured or not.",
  invalid_demo_url: "Use a full https:// link with no spaces.", invalid_demo_label: "The link text is too long (60 characters at most).", invalid_alt: "Describe the picture in a few words (up to 160 characters, one line): it is read aloud for people who can’t see it.",
  invalid_caption: "The caption is too long (120 characters at most, one line).", too_many: "This service already has as many pictures as can be kept. Remove one first.",
  content_unavailable: "Sales content can’t be saved on this site yet (a database change is waiting). Nothing was changed.", unavailable: "Pictures can’t be saved on this site yet (a database change is waiting). Nothing was changed.",
  type_not_allowed: "Use a PNG, JPG or WebP picture.", content_mismatch: "The file’s contents don’t match its type. Export the picture again.", image_dimensions: "The picture is empty or far too large.", empty_file: "That file is empty.", file_too_large: "That picture is over 5 MB.", no_file: "Choose a picture first.",
  storage_unavailable: "File storage isn’t available on this site. Nothing was uploaded.", storage_write_failed: "The picture couldn’t be stored just now. Nothing was saved. Try again.",
  writes_disabled: "Changes are switched off on this site, so nothing was changed.", session: "Your admin session has ended. Reload the page to sign in again.", denied: "This account isn’t allowed to make that change.", network: "Can’t reach the server. Check your connection and try again.",
  not_found: "That no longer exists. The page has been refreshed.",
};
const errorText = (err) => ERROR[err && err.code] || "That didn’t work and nothing was changed. Try again, and reload the page if it keeps happening.";
const field = (id, label, input, hint) => h("div", { class: "adm-field" }, h("label", { for: id, text: label }), hint ? h("p", { class: "adm-field__hint", text: hint }) : null, input);
const text = (id, value, props = {}) => h("input", { id, class: "input", type: "text", autocomplete: "off", value: value || "", ...props });
const area = (id, value, rows, max) => { const t = h("textarea", { id, class: "input", rows: String(rows), maxlength: String(max) }); t.value = value || ""; return t; };

/** @param {{ s: object, data: object, editable: boolean, speak: Function, redraw: Function, busyRef: {busy: boolean} }} o */
export function contentEditor({ s, data, editable, speak, redraw, busyRef }) {
  const id = "sc-" + s.key;
  const canContent = editable && data.contentAvailable;
  const tag = text(id + "-tag", s.custom && s.custom.tagline ? s.tagline : "", { maxlength: "160", disabled: canContent ? null : true, placeholder: s.description });
  const problem = area(id + "-prob", s.problem, 3, 400), why = area(id + "-why", s.why, 3, 400);
  const benefits = area(id + "-ben", (s.benefits || []).join("\n"), 6, 1000);
  const category = text(id + "-cat", s.custom && s.custom.category ? s.category : (s.category || ""), { maxlength: "60", disabled: canContent ? null : true, placeholder: "For example Fleet Management Software" });
  const cta = text(id + "-cta", s.ctaLabel, { maxlength: "40" });
  const demoUrl = text(id + "-du", s.demoUrl, { maxlength: "300", inputmode: "url", placeholder: "https://" }), demoLabel = text(id + "-dl", s.demoLabel, { maxlength: "60", placeholder: "See an example" });
  const featured = h("input", { id: id + "-feat", type: "checkbox", checked: s.featured ? true : null });
  for (const el of [problem, why, benefits, cta, demoUrl, demoLabel, featured]) if (!canContent) el.disabled = true;
  const save = h("button", { class: "btn btn--primary adm-small", type: "submit", disabled: canContent ? null : true }, "Save sales content");

  async function run(request, success) {
    if (busyRef.busy) return;
    busyRef.busy = true; let outcome;
    try { await request(); outcome = { tone: "success", text: success }; } catch (err) { outcome = { tone: "error", text: errorText(err) }; }
    busyRef.busy = false;
    await redraw(); speak(outcome.text, outcome.tone);
  }
  const form = h("form", { class: "adm-form adm-services__content", novalidate: true, "aria-label": `Sales content: ${s.name}`, onsubmit: (ev) => {
    ev.preventDefault();
    const lines = benefits.value.split("\n").map((x) => x.trim()).filter(Boolean);
    run(() => api("/additional-services", { method: "POST", body: { key: s.key, category: category.value, tagline: tag.value, problem: problem.value, why: why.value, benefits: lines, cta_label: cta.value, featured: featured.checked, demo_url: demoUrl.value.trim(), demo_label: demoLabel.value } }), `Saved the sales content of ${s.name}. Clients see it straight away.`);
  } },
    h("p", { class: "adm-sub" }, "Written for the client: benefit-led and specific, with no promises about results. Leave a box empty to use the standard wording."),
    !data.contentAvailable ? h("p", { class: "adm-banner" }, "Sales content can’t be saved on this site yet (a database change is waiting). Clients see the standard wording.") : null,
    field(id + "-cat", "Category (optional)", category, "A short label shown above the name."),
    field(id + "-tag", "Headline (optional)", tag, "One line under the name. Empty: the short description above is used."),
    field(id + "-prob", "The problem it solves", problem), field(id + "-ben", "What the client gets (benefits or features)", benefits, "One per line, up to 8."), field(id + "-why", "Why they might need it", why),
    field(id + "-cta", "Button text", cta, "The request itself is unchanged: this only changes the words on the button."),
    field(id + "-du", "Link to a live demo or real example (optional)", demoUrl, "https only. Opens in a new tab."), field(id + "-dl", "Link text (optional)", demoLabel),
    h("div", { class: "adm-field" }, h("label", { class: "adm-choice", for: id + "-feat" }, featured, h("span", { text: "Featured" })), h("p", { class: "adm-field__hint", text: "Featured services are listed first and the first one starts open." })),
    h("div", { class: "adm-actions" }, save));

  // pictures
  const media = s.media || [];
  const canMedia = editable && data.mediaAvailable && data.capabilities.storage;
  const file = h("input", { id: id + "-file", class: "input", type: "file", accept: ".png,.jpg,.jpeg,.webp", disabled: canMedia ? null : true });
  const alt = text(id + "-alt", "", { maxlength: "160", disabled: canMedia ? null : true }), cap = text(id + "-cap", "", { maxlength: "120", disabled: canMedia ? null : true });
  const row = (m) => {
    const k = id + "-m-" + m.id.slice(0, 8);
    const a = text(k + "-a", m.alt, { maxlength: "160" }), c = text(k + "-c", m.caption, { maxlength: "120" });
    return h("li", { class: "adm-services__pic" },
      h("img", { class: "adm-ws__img", src: `/api/admin/additional-services/media/${encodeURIComponent(m.id)}`, alt: m.alt, loading: "lazy" }),
      field(k + "-a", "Alternative text", a), field(k + "-c", "Caption (optional)", c),
      editable ? h("div", { class: "adm-actions" },
        h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => run(() => api(`/additional-services/media/${m.id}/update`, { method: "POST", body: { alt: a.value, caption: c.value } }), "Picture details saved.") }, "Save"),
        h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => run(() => api(`/additional-services/media/${m.id}/move`, { method: "POST", body: { direction: "up" } }), "Moved earlier.") }, "Move earlier"),
        h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => run(() => api(`/additional-services/media/${m.id}/move`, { method: "POST", body: { direction: "down" } }), "Moved later.") }, "Move later"),
        h("button", { class: "btn btn--secondary adm-small adm-actions__danger", type: "button", onclick: async () => { if (await confirmDialog({ title: "Remove this picture?", body: "It is deleted from storage and disappears from the service card.", details: [["Service", s.name]], confirmLabel: "Remove picture" })) run(() => api(`/additional-services/media/${m.id}/delete`, { method: "POST", body: {} }), "Picture removed."); } }, "Remove")) : null);
  };
  const pics = h("div", { class: "adm-services__pics" },
    h("p", { class: "acc__group" }, "Pictures"),
    h("p", { class: "adm-sub" }, "Screenshots, product previews and real examples, shown on the service card. PNG, JPG or WebP up to 5 MB, at most 6 per service. Describe each one: that text is read aloud for people who can’t see it."),
    !data.mediaAvailable ? h("p", { class: "adm-banner" }, "Pictures can’t be added on this site yet (a database change is waiting).") : null,
    media.length ? h("ul", { class: "adm-services__piclist" }, media.map(row)) : h("p", { class: "adm-muted", text: "No pictures yet." }),
    canMedia ? [field(id + "-file", "Add a picture", file), field(id + "-alt", "Alternative text (required)", alt), field(id + "-cap", "Caption (optional)", cap),
      h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => {
        const f = file.files && file.files[0];
        if (!f) { speak(ERROR.no_file, "error"); file.focus(); return; }
        if (f.size > 5 * 1024 * 1024) { speak(ERROR.file_too_large, "error"); return; }
        if (!alt.value.trim()) { speak(ERROR.invalid_alt, "error"); alt.focus(); return; }
        const body = new FormData(); body.append("file", f, f.name); body.append("meta", JSON.stringify({ service_key: s.key, alt: alt.value, caption: cap.value }));
        run(() => api("/additional-services/media", { method: "POST", body }), "Picture added.");
      } }, "Add picture"))] : null);

  return h("details", { class: "adm-acc adm-services__more", id: id + "-more" },
    h("summary", { class: "adm-acc__sum" }, h("span", { class: "adm-acc__title", text: `Sales content and pictures: ${s.name}` })),
    h("div", { class: "adm-acc__body" }, form, pics));
}
