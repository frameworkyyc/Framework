/* Framework Admin — Analytics settings of one website, inside the website's card on /admin/clients/:id/website. Admin records WHICH Cloudflare Web Analytics site (its site tag) and WHICH
   Google Search Console property the client's Analytics page reads, and can test each. No credentials are entered or shown here: the Cloudflare API token and the Google service account
   key are Worker secrets (see worker/portal/WEBSITE-ANALYTICS.md); this panel only says whether the server has them. Server text is never inserted as HTML. */
import { h, api } from "./ui.js";

const ERROR = {
  invalid_site_tag: "A Cloudflare Web Analytics site tag is 32 letters and numbers (0 to 9, a to f).",
  invalid_property: "Use a Search Console property exactly as Google shows it: sc-domain:example.com, or a full https:// address ending in a slash.",
  unavailable: "Analytics isn’t available on this site yet (a database change is waiting), so nothing was changed.", not_found: "That no longer exists. The panel has been refreshed.",
  writes_disabled: "Changes are switched off on this site, so nothing was changed.", session: "Your admin session has ended. Reload the page to sign in again.", denied: "This account isn’t allowed to make that change.",
};
const errorText = (err) => ERROR[err && err.code] || "That didn’t work and nothing was changed. Try again, and reload the page if it keeps happening.";
const TEST = {
  not_enabled: "The server doesn’t have this source’s credentials yet, so it can’t be read for anyone.", not_connected: "Save a site tag or property first.",
  unauthorized: "Access was refused. For Cloudflare, check the API token and account. For Search Console, add the service account email as a user on this property.",
  property_not_found: "Google doesn’t know that property. Check it matches Search Console exactly.", rate_limited: "The source is busy. Try again in a few minutes.",
  unreachable: "The source couldn’t be reached just now. Try again.", query_failed: "The source answered but the request failed. Try again, and check the setting.",
};
const SRC = { cloudflare: "Cloudflare Web Analytics", search_console: "Google Search Console" };

/** @param {{ base: string, site: {id: string, name: string}, canWrite: () => boolean, say: Function }} o  base is "/clients/:org/websites". */
export function analyticsPanel({ base, site, canWrite, say }) {
  const root = h("div", { class: "adm-ws__block adm-an" });
  const url = `${base}/${encodeURIComponent(site.id)}/analytics`;
  const pre = "an-" + site.id.slice(0, 8);
  let busy = false;

  async function load() {
    let d;
    try { d = await api(url); } catch (err) { root.replaceChildren(h("p", { class: "acc__group" }, "Analytics"), h("p", { class: "adm-muted", text: errorText(err) })); return; }
    draw(d);
  }
  async function run(request, success) {
    if (busy) return;
    busy = true; say("Working…", "info", { focus: false });
    try { await request(); say(success, "success"); } catch (err) { say(errorText(err), "error"); }
    busy = false;
    await load();
  }
  async function test(source) {
    if (busy) return;
    busy = true; say("Testing…", "info", { focus: false });
    try {
      const r = await api(`${url}/test`, { method: "POST", body: { source } });
      say(r.ok ? `${SRC[source]} answered. Figures are available through ${r.through}.` : `${SRC[source]}: ${TEST[r.code] || TEST.query_failed}`, r.ok ? "success" : "error");
    } catch (err) { say(errorText(err), "error"); }
    busy = false;
  }
  const field = (id, label, input, hint) => h("div", { class: "adm-field" }, h("label", { for: id, text: label }), hint ? h("p", { class: "adm-field__hint", text: hint }) : null, input);
  const text = (id, value, props = {}) => h("input", { id, class: "input", type: "text", autocomplete: "off", spellcheck: "false", value: value || "", ...props });

  function draw(d) {
    if (!d.available) { root.replaceChildren(h("p", { class: "acc__group" }, "Analytics"), h("p", { class: "adm-muted", text: "Analytics isn’t available on this site yet: a database change is waiting for approval." })); return; }
    const tag = text(pre + "-tag", d.config.cf_site_tag, { maxlength: "32", placeholder: "32 letters and numbers" });
    const prop = text(pre + "-prop", d.config.gsc_property, { maxlength: "200", placeholder: "sc-domain:example.com" });
    const state = (on) => h("span", { class: "adm-chip " + (on ? "adm-chip--ok" : "adm-chip--pending"), text: on ? "Server ready" : "Server not set up" });
    const w = canWrite();
    root.replaceChildren(
      h("p", { class: "acc__group" }, "Analytics"),
      h("p", { class: "adm-muted", text: "What this website’s Analytics page reads for the client. Nothing is shown to the client from a source until its setting is saved here." }),
      h("div", { class: "adm-field" }, h("p", null, h("strong", { text: SRC.cloudflare + " " }), state(d.platform.cloudflare))),
      field(pre + "-tag", "Site tag", tag, "In Cloudflare: Analytics & Logs, Web Analytics, the site, then its tag. The website must carry the Web Analytics snippet."),
      w ? h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => test("cloudflare") }, "Test Cloudflare")) : null,
      h("div", { class: "adm-field" }, h("p", null, h("strong", { text: SRC.search_console + " " }), state(d.platform.search_console))),
      field(pre + "-prop", "Search Console property", prop, d.service_account_email ? `Add ${d.service_account_email} as a Restricted (read-only) user on this property in Search Console first.` : "The service account isn’t set up on the server yet, so there is no email to add."),
      w ? h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => test("search_console") }, "Test Search Console")) : null,
      w ? h("div", { class: "adm-actions" }, h("button", { class: "btn btn--primary adm-small", type: "button", onclick: () => run(() => api(url, { method: "POST", body: { cf_site_tag: tag.value.trim(), gsc_property: prop.value.trim() } }), "Analytics settings saved.") }, "Save analytics settings")) : null,
    );
  }
  load();
  return root;
}
