/* Framework Admin — deleting and restoring clients. "Delete" archives a client: its portal access stops and it leaves the active lists, but nothing is erased
   (invoices, support requests, brand files and Business Profile answers are kept) and it can be restored. The server insists on the typed word, whatever this page does. */

import { h, api } from "./ui.js";

const WORD = "DELETE";
const orgPath = (id, tail) => `/clients/${encodeURIComponent(id)}/${tail}`;
const friendly = (e) => (e && e.data && e.data.error === "writes_disabled" ? "Changes are switched off on this site." : e && e.status === 404 ? "This client no longer exists." : "That didn’t work and nothing was changed. Please try again.");

/** Modal that names the client, lists what happens, and enables Confirm Delete only once DELETE is typed. Resolves true only on Confirm Delete. */
export function deleteDialog(name) {
  return new Promise((resolve) => {
    const input = h("input", { class: "input", id: "adm-delete-word", type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-describedby": "adm-delete-help" });
    const confirm = h("button", { class: "btn btn--primary adm-btn--danger", type: "submit", value: "confirm", disabled: true }, "Confirm Delete");
    input.addEventListener("input", () => { confirm.disabled = input.value !== WORD; });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); }); // Enter must never confirm, or fall through to Cancel
    const dialog = h("dialog", { class: "adm-dialog", "aria-labelledby": "adm-dialog-title", "aria-describedby": "adm-delete-body" },
      h("form", { method: "dialog" },
        h("h2", { id: "adm-dialog-title", text: "Delete this client?" }),
        h("p", { class: "adm-delete__name", text: name }),
        h("div", { id: "adm-delete-body" },
          h("p", null, "This removes the client from your active lists and ends everyone’s access to their portal straight away."),
          h("ul", { class: "adm-delete__list" },
            h("li", null, "Invoices, support requests, brand files and other records are kept, as our retention rules require."),
            h("li", null, "Nothing is erased and the people on the team are not notified."),
            h("li", null, "You can restore the client later from Deleted clients."))),
        h("label", { class: "adm-delete__label", for: "adm-delete-word" }, `Type ${WORD} to confirm`),
        input,
        h("p", { id: "adm-delete-help", class: "adm-delete__help" }, "Capital letters, exactly as shown."),
        h("div", { class: "adm-dialog__actions" },
          h("button", { class: "btn btn--secondary", type: "submit", value: "cancel", autofocus: true }, "Cancel"),
          confirm)));
    dialog.addEventListener("close", () => {
      const ok = dialog.returnValue === "confirm" && input.value === WORD;
      dialog.remove();
      resolve(ok);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** Ask, then delete. `after` runs once the server has confirmed; failures are shown in plain words and leave everything as it was. */
export async function deleteClient(org, { notify, after }) {
  if (!(await deleteDialog(org.name))) return false;
  try {
    await api(orgPath(org.id, "delete"), { method: "POST", body: { confirm: WORD } });
  } catch (e) {
    notify(friendly(e));
    return false;
  }
  notify(`${org.name} was deleted. You can restore it from Deleted clients.`);
  after();
  return true;
}

export async function restoreClient(org, { notify, after }) {
  try {
    await api(orgPath(org.id, "restore"), { method: "POST", body: {} });
  } catch (e) {
    notify(friendly(e));
    return false;
  }
  notify(`${org.name} was restored and its team can sign in again.`);
  after();
  return true;
}

const DOTS = () => { const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  for (const y of [5, 12, 19]) { const c = document.createElementNS("http://www.w3.org/2000/svg", "circle"); c.setAttribute("cx", "12"); c.setAttribute("cy", String(y)); c.setAttribute("r", "1.8"); svg.append(c); } return svg; };

/** The three-dot actions menu: a button that opens a small menu. Escape or a click elsewhere closes it and returns focus to the button; arrow keys move between items. */
export function actionsMenu({ label, items }) {
  const menuId = "adm-menu-" + Math.random().toString(36).slice(2, 9);
  const button = h("button", { class: "adm-menubtn", type: "button", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": menuId, "aria-label": label }, DOTS());
  const buttons = items.map((it) => h("button", { class: "adm-menu__item" + (it.danger ? " adm-menu__item--danger" : ""), type: "button", role: "menuitem", tabindex: "-1", text: it.label, onclick: () => { close(true); it.run(); } }));
  const menu = h("div", { class: "adm-menu", id: menuId, role: "menu", "aria-label": label, hidden: true }, buttons);
  const wrap = h("div", { class: "adm-menuwrap" }, button, menu);
  function close(refocus) {
    if (menu.hidden) return;
    menu.hidden = true; button.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", outside, true); document.removeEventListener("keydown", keys, true);
    if (refocus) button.focus();
  }
  function outside(e) { if (!wrap.contains(e.target)) close(false); }
  function keys(e) {
    if (e.key === "Escape") { e.stopPropagation(); close(true); }
    else if (e.key === "Tab") close(false);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const at = buttons.indexOf(document.activeElement);
      buttons[(at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length].focus();
    }
  }
  function open() {
    menu.hidden = false; button.setAttribute("aria-expanded", "true");
    document.addEventListener("click", outside, true); document.addEventListener("keydown", keys, true);
    buttons[0].focus();
  }
  button.addEventListener("click", () => (menu.hidden ? open() : close(true)));
  return wrap;
}
