/* Framework Admin — Additional Services for ONE client: /admin/clients/:id/additional-services. The catalogue itself (names, content, pictures, prices) is the same for every client and is edited in
   Settings; here Admin decides how it is presented to THIS client: the order (their own, else the global one), a Recommended label, and whether a service is shown, hidden, or left out because the
   client already has it. Services the client already has, or that Framework is already doing for them, are never promoted, whatever is set here. Server text is never inserted as HTML. */
import { h, api, errorState } from "./ui.js";

const STATE = { automatic: "Shown", hidden: "Hidden from this client", owned: "Already has it (not promoted)" };
const ERROR = {
  invalid_state: "Choose how this service should be treated for this client.", invalid_note: "That note is too long (300 characters at most, one line).", invalid_service: "That isn’t one of the services.", invalid_direction: "Choose up or down.",
  invalid_recommended: "Choose Recommended or not.", invalid_order: "That order isn’t valid.", invalid_input: "Nothing to change.", unavailable: "That isn’t available on this site yet (a database change is waiting), so nothing was changed.",
  writes_disabled: "Changes are switched off on this site, so nothing was changed.", session: "Your admin session has ended. Reload the page to sign in again.", denied: "This account isn’t allowed to make that change.", network: "Can’t reach the server. Check your connection and try again.",
  not_found: "That no longer exists. The page has been refreshed.",
};
const errorText = (err) => ERROR[err && err.code] || "That didn’t work and nothing was changed. Try again, and reload the page if it keeps happening.";

export async function render(orgId, ctx) {
  const base = "/clients/" + encodeURIComponent(orgId) + "/additional-services";
  let data;
  try { data = await api(base); } catch (err) { return { title: "Additional Services", node: h("div", { class: "adm-page" }, errorState(err, ctx.retry)) }; }
  const back = h("a", { class: "adm-back", href: "/admin/clients/" + encodeURIComponent(orgId), "data-link": "" }, "← " + (data.organization ? data.organization.name : "Client"));
  const root = h("div", { class: "adm-page adm-clsvc" });
  const live = h("p", { class: "adm-msg", role: "status", tabindex: "-1", hidden: true });
  let busy = false;
  const canWrite = () => Boolean(data.capabilities && data.capabilities.writes);
  const say = (text, tone = "info") => { live.textContent = text; live.className = "adm-msg is-" + tone; live.setAttribute("role", tone === "error" ? "alert" : "status"); live.hidden = !text; if (text) live.focus({ preventScroll: false }); };

  async function act(body, success) {
    if (busy) return;
    busy = true; root.setAttribute("aria-busy", "true"); let outcome;
    try { data = await api(base, { method: "POST", body }); outcome = { tone: "success", text: success }; } catch (err) { outcome = { tone: "error", text: errorText(err) }; try { data = await api(base); } catch { /* the old view stays */ } }
    busy = false; root.removeAttribute("aria-busy"); draw(); say(outcome.text, outcome.tone);
  }

  function row(sv, i, all) {
    const k = "cs-" + sv.key;
    const stateSel = h("select", { id: k + "-st", class: "input", disabled: canWrite() ? null : true }, Object.entries(STATE).map(([v, t]) => h("option", { value: v, selected: v === (sv.state || "automatic") ? true : null }, t)));
    const note = h("input", { id: k + "-n", class: "input", type: "text", maxlength: "300", autocomplete: "off", value: sv.note || "", placeholder: "Optional note for the team", disabled: canWrite() ? null : true });
    const rec = h("input", { id: k + "-rec", type: "checkbox", checked: sv.recommended ? true : null, disabled: canWrite() ? null : true });
    const mv = (dir, label) => h("button", { class: "btn btn--secondary adm-small", type: "button", disabled: canWrite() && !(dir === "up" ? i === 0 : i === all.length - 1) ? null : true, "aria-label": `${label}: ${sv.name}`, onclick: () => act({ key: sv.key, move: dir }, `${sv.name} moved ${dir === "up" ? "up" : "down"} for this client.`) }, label);
    const flags = [sv.recommended ? "Recommended" : null, sv.state === "hidden" ? "Hidden" : null, sv.state === "owned" ? "Already has it" : null, sv.autoHas && !sv.state ? "Already being done by Framework" : null, !sv.enabled ? "Switched off for everyone" : null].filter(Boolean);
    return h("li", { class: "adm-clsvc__row" },
      h("div", { class: "adm-clsvc__what" }, h("span", { class: "adm-clsvc__pos", "aria-hidden": "true", text: String(i + 1).padStart(2, "0") }), h("div", null, h("p", { class: "adm-req__label", text: sv.name }), sv.category ? h("p", { class: "adm-req__auto", text: sv.category }) : null,
        flags.length ? h("p", { class: "adm-clsvc__flags" }, flags.map((f) => h("span", { class: "adm-chip", text: f }))) : null)),
      h("div", { class: "adm-clsvc__set" },
        h("div", { class: "adm-field" }, h("label", { for: k + "-st", text: "Visibility for this client" }), stateSel),
        h("div", { class: "adm-field" }, h("label", { for: k + "-n", text: "Note" }), note),
        h("div", { class: "adm-field" }, h("label", { class: "adm-choice", for: k + "-rec" }, rec, h("span", { text: "Recommended" })), h("p", { class: "adm-field__hint", text: "Shows a Recommended label on the card. It never brings back a service the client already has." })),
        canWrite() ? h("div", { class: "adm-actions" },
          h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => act({ key: sv.key, state: stateSel.value, ...(stateSel.value === "automatic" ? {} : { note: note.value }) }, `${sv.name}: visibility saved.`) }, "Save visibility"),
          h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => act({ key: sv.key, recommended: rec.checked }, `${sv.name}: ${rec.checked ? "marked Recommended" : "no longer Recommended"} for this client.`) }, "Save Recommended"),
          mv("up", "Move up"), mv("down", "Move down")) : null));
  }

  function draw() {
    const items = data.services;
    root.replaceChildren(...[
      back,
      h("div", { class: "adm-idhead" }, h("div", { class: "adm-idhead__text" }, h("span", { class: "eyebrow" }, "Client"), h("h1", { class: "adm-title", tabindex: "-1" }, "Additional Services"),
        h("p", { class: "adm-sub" }, `${data.organization.name}. The catalogue is the same for every client: edit the services themselves (content, pictures) in `, h("a", { class: "adm-link", href: "/admin/settings/additional-services", "data-link": "" }, "Settings → Additional Services"), " and prices in ", h("a", { class: "adm-link", href: "/admin/settings/service-pricing#sp-h-addon", "data-link": "" }, "Service Pricing"), ". Here you decide how it is shown to this client."),
        h("p", { class: "adm-sub" }, data.ownOrder ? "This client has their own order, shown below. " : "This client follows the global order. Moving a service gives them their own. ", "Services they already have, or that Framework is already doing for them, are never promoted, whatever is set here."))),
      !canWrite() ? h("p", { class: "adm-banner" }, "Changes are switched off on this site: you can look at the settings, but not change them.") : null,
      data.available === false ? h("p", { class: "adm-banner" }, "Hiding services and marking them as already owned can’t be saved on this site yet (a database change is waiting).") : null,
      data.settingsAvailable === false ? h("p", { class: "adm-banner" }, "Per-client order and Recommended labels can’t be saved on this site yet (a database change is waiting). Clients see the global order.") : null,
      live,
      h("ol", { class: "adm-clsvc__list" }, items.map(row)),
      canWrite() && data.ownOrder ? h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => act({ reset_order: true }, "Back to the global order for this client.") }, "Use the global order")) : null,
    ].filter(Boolean));
  }
  draw();
  return { title: "Additional Services — " + data.organization.name, node: root };
}
