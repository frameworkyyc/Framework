/* Framework Admin — Settings: /admin/settings (the hub) and /admin/settings/service-pricing (Service Pricing).
   Service Pricing: one global price per Branding service, in Canadian dollars, applied to every client. Three types: Starting at (with an amount), Custom Quote and
   Included. The client's Branding page shows the price quietly beside the request button for a section the client has nothing in yet, and records it with the request.
   A price is a starting estimate, not a quote: there is no checkout, payment or invoicing. Server text is never inserted as HTML. */

import { h, api, fmtDate, stateBlock, errorState } from "./ui.js";
import { BRAND_SECTIONS } from "./brand-sections.js";

const MAX_CAD = 1000000;
const ERRORS = {
  invalid_service: "That service isn’t one Framework prices.",
  invalid_type: "Choose Starting at, Custom Quote or Included.",
  invalid_price: `Enter a whole number of Canadian dollars from 1 to ${MAX_CAD.toLocaleString("en-CA")}.`,
  unavailable: "Service pricing isn’t available on this deployment yet, so nothing was changed.",
  writes_disabled: "Changes are switched off on this site.",
};
const errorText = (e) => ERRORS[e && e.code] || (e && e.data && ERRORS[e.data.error]) || "That didn’t work and nothing was changed. Please try again.";
const money = (n) => "$" + Number(n).toLocaleString("en-CA");
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export async function render(ctx) {
  const path = ctx.url.pathname.replace(/\/+$/, "");
  if (path === "/admin/settings/service-pricing") return pricingPage(ctx);
  if (path === "/admin/settings") return hub();
  return { title: "Not found", node: h("div", { class: "adm-page" }, h("h1", { class: "adm-title", tabindex: "-1" }, "Not found"), h("p", { class: "adm-sub" }, "There is nothing at this address."), h("p", null, h("a", { class: "adm-link", href: "/admin/settings", "data-link": "" }, "Back to Settings"))) };
}

function hub() {
  const item = (href, title, body) => h("li", { class: "adm-settings__item" }, h("a", { class: "adm-settings__link", href, "data-link": "" }, h("span", { class: "adm-settings__title", text: title }), h("span", { class: "adm-sub", text: body })));
  return { title: "Settings", node: h("div", { class: "adm-page adm-settings" },
    h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, "Framework Admin"), h("h1", { class: "adm-title", tabindex: "-1" }, "Settings"), h("p", { class: "adm-sub" }, "Settings that apply to every client."))),
    h("ul", { class: "adm-settings__list", "aria-label": "Settings" },
      item("/admin/settings/service-pricing", "Service Pricing", "The starting price of each Branding design service, in Canadian dollars."),
      item("/admin/approved-emails", "Approved Emails", "The addresses that may be invited to a client portal or receive its emails."))) };
}

async function pricingPage(ctx) {
  const root = h("div", { class: "adm-page adm-pricing" });
  let busy = false;
  const say = h("p", { class: "adm-msg", role: "status", tabindex: "-1", hidden: true });
  const speak = (text, tone = "info") => { say.textContent = text; say.className = "adm-msg is-" + tone; say.setAttribute("role", tone === "error" ? "alert" : "status"); say.hidden = !text; if (text) say.focus({ preventScroll: true }); };

  async function load() {
    let data;
    try { data = await api("/service-pricing"); } catch (err) { root.replaceChildren(errorState(err, () => ctx.retry())); return; }
    draw(data);
  }

  function draw(data) {
    const editable = data.available && Boolean(data.capabilities && data.capabilities.writes);
    const state = new Map(data.services.map((s) => [s.key, { type: s.type, price: s.priceCad === null ? "" : String(s.priceCad), original: { type: s.type, price: s.priceCad === null ? "" : String(s.priceCad) } }]));
    const save = h("button", { class: "btn btn--primary", type: "submit", disabled: true }, "Save prices");
    const changed = () => data.services.filter((s) => { const x = state.get(s.key); return x.type !== x.original.type || (x.type === "starting_at" && x.price !== x.original.price); });
    const refresh = () => { const n = changed().length; save.disabled = !editable || busy || n === 0; save.textContent = n ? `Save ${plural(n, "change")}` : "Save prices"; };

    function row(s) {
      const x = state.get(s.key);
      const typeId = `sp-type-${s.key}`, priceId = `sp-price-${s.key}`, errId = `sp-err-${s.key}`;
      const select = h("select", { id: typeId, class: "input", disabled: editable ? null : true, onchange: () => { x.type = select.value; price.disabled = !editable || x.type !== "starting_at"; if (x.type === "starting_at" && !x.price && s.defaultCad) { x.price = String(s.defaultCad); price.value = x.price; } clearError(); refresh(); } },
        data.types.map((t) => h("option", { value: t.key, selected: t.key === x.type ? true : null }, t.label)));
      const price = h("input", { id: priceId, class: "input adm-pricing__amount", type: "text", inputmode: "numeric", autocomplete: "off", maxlength: "7", value: x.type === "starting_at" ? x.price : "", disabled: editable && x.type === "starting_at" ? null : true, "aria-describedby": errId, oninput: () => { x.price = price.value.trim(); clearError(); refresh(); } });
      const err = h("p", { class: "adm-field__error", id: errId, role: "alert", hidden: true });
      const clearError = () => { err.hidden = true; price.removeAttribute("aria-invalid"); };
      row.fields.set(s.key, { price, err, select });
      return h("li", { class: "adm-pricing__row" },
        h("div", { class: "adm-pricing__name" }, h("span", { class: "adm-pricing__title", text: s.name }), h("span", { class: "adm-pricing__desc", text: s.description })),
        h("div", { class: "adm-field adm-pricing__type" }, h("label", { for: typeId }, h("span", { class: "visually-hidden", text: `${s.name}: ` }), "Pricing"), select),
        h("div", { class: "adm-field adm-pricing__price" }, h("label", { for: priceId }, h("span", { class: "visually-hidden", text: `${s.name}: ` }), "Price (CAD)"), h("div", { class: "adm-pricing__money" }, h("span", { class: "adm-pricing__sign", "aria-hidden": "true", text: "$" }), price), err),
        h("p", { class: "adm-pricing__meta", text: s.stored && s.updatedAt ? `Default ${s.defaultType === "custom_quote" ? "Custom quote" : money(s.defaultCad)} · updated ${fmtDate(s.updatedAt)}${s.updatedBy && !/^migration/.test(s.updatedBy) ? ` by ${s.updatedBy}` : ""}` : `Default ${s.defaultType === "custom_quote" ? "Custom quote" : money(s.defaultCad)}` }));
    }
    row.fields = new Map();

    const group = (title, no, services) => h("section", { class: "adm-pricing__group", "aria-labelledby": `sp-h-${no}` },
      h("h2", { class: "adm-pricing__h", id: `sp-h-${no}` }, no === "kit" || no === "website" ? null : h("span", { class: "adm-bk-no", text: no }), title),
      h("ul", { class: "adm-pricing__list" }, services.map(row)));
    const groups = BRAND_SECTIONS.map((sec) => group(sec.title, sec.no, data.services.filter((s) => s.section === sec.key))).concat(group("Complete Brand Kit", "kit", data.services.filter((s) => s.section === "all")), group("Website", "website", data.services.filter((s) => s.section === "website")));

    const form = h("form", { class: "adm-form adm-pricing__form", novalidate: true, "aria-label": "Service prices", onsubmit: async (ev) => {
      ev.preventDefault();
      if (busy) return;
      const list = changed();
      let first = null;
      const prices = list.map((s) => {
        const x = state.get(s.key);
        if (x.type !== "starting_at") return { key: s.key, type: x.type, priceCad: null };
        const n = /^\d{1,7}$/.test(x.price) ? Number(x.price) : NaN;
        if (!Number.isInteger(n) || n < 1 || n > MAX_CAD) {
          const f = row.fields.get(s.key); f.err.textContent = ERRORS.invalid_price; f.err.hidden = false; f.price.setAttribute("aria-invalid", "true"); first = first || f.price;
          return null;
        }
        return { key: s.key, type: x.type, priceCad: n };
      });
      if (first) { speak("Check the highlighted prices.", "error"); first.focus(); return; }
      busy = true; root.setAttribute("aria-busy", "true"); refresh();
      let outcome;
      try { await api("/service-pricing", { method: "POST", body: { prices } }); outcome = { tone: "success", text: `Saved ${plural(prices.length, "price")}. Clients see the new prices straight away.` }; } catch (err) { outcome = { tone: "error", text: errorText(err) }; }
      try { draw(await api("/service-pricing")); } catch { /* the old view stays; the message says what happened */ }
      busy = false; root.removeAttribute("aria-busy");
      speak(outcome.text, outcome.tone);
    } }, ...groups, h("div", { class: "adm-actions" }, save));

    root.replaceChildren(...[
      h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, "Framework Admin · Settings"), h("h1", { class: "adm-title", tabindex: "-1" }, "Service Pricing"),
        h("p", { class: "adm-sub" }, "The starting price of each Branding design service, in Canadian dollars. One price applies to every client. Clients see it quietly beside the request button, only for a section they have nothing in yet, and it is recorded with their request. These are estimates, not quotes: there is no checkout, payment or invoicing here."))),
      data.available ? null : h("p", { class: "adm-banner" }, "Service pricing isn’t available on this deployment yet (its database migration hasn’t been applied), so clients see no prices. The values below are the defaults and can’t be saved."),
      data.available && !data.capabilities.writes ? h("p", { class: "adm-banner" }, "Changes are switched off on this site: you can look at the prices, but not change them.") : null,
      say,
      form,
    ].filter(Boolean)); // replaceChildren turns a null into the text "null"
    refresh();
  }

  root.setAttribute("aria-busy", "true");
  await load();
  root.removeAttribute("aria-busy");
  return { title: "Service Pricing", node: root };
}
