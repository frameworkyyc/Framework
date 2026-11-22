/* Framework Admin — Analytics settings of one website, inside the website's card on /admin/clients/:id/website. Admin records WHICH Cloudflare Web Analytics site (its site tag) and WHICH
   Google Search Console property the client's Analytics page reads, and can test each. Framework's own Cloudflare token and the Google sign-in are Worker secrets (see
   worker/portal/WEBSITE-ANALYTICS.md); this panel only says whether the server has them.
   A website whose Web Analytics site is in the CLIENT'S OWN Cloudflare account carries that account id and a read-only token. The token field is WRITE-ONLY: it is always empty,
   the value is sent once and encrypted by the server, and the panel only ever learns whether a token is saved and when. Server text is never inserted as HTML. */
import { h, api, confirmDialog, fmtDate } from "./ui.js";
import { badge } from "./kit.js";

const ERROR = {
  invalid_site_tag: "A Cloudflare Web Analytics site tag is 32 letters and numbers (0 to 9, a to f).",
  invalid_property: "Use a Search Console property exactly as Google shows it: sc-domain:example.com, or a full https:// address ending in a slash.",
  unavailable: "Analytics isn’t available on this site yet (a database change is waiting), so nothing was changed.", not_found: "That no longer exists. The panel has been refreshed.",
  invalid_account_id: "A Cloudflare account ID is 32 letters and numbers (0 to 9, a to f). It is in the dashboard address and on the account’s overview page.",
  invalid_token: "That doesn’t look like a Cloudflare API token. Paste the token itself, with no spaces.",
  token_required: "Paste the client’s read-only API token to use their own account.", account_required: "Enter the client’s Cloudflare account ID with the token.",
  accounts_unavailable: "Clients’ own Cloudflare accounts aren’t available yet (a database change is waiting), so nothing was changed.",
  credentials_key_missing: "The server’s encryption key isn’t set up, so a token can’t be saved. Nothing was changed.",
  writes_disabled: "Changes are switched off on this site, so nothing was changed.", session: "Your admin session has ended. Reload the page to sign in again.", denied: "This account isn’t allowed to make that change.",
};
const errorText = (err) => ERROR[err && err.code] || "That didn’t work and nothing was changed. Try again, and reload the page if it keeps happening.";
const TEST = {
  not_enabled: "The server doesn’t have this source’s credentials yet, so it can’t be read for anyone.", not_connected: "Save a site tag or property first.",
  unauthorized: "Cloudflare refused the API token: it is wrong, revoked or expired, or lacks Account Analytics: Read. Create a new read-only token and save it.",
  account_not_accessible: "Cloudflare accepted the token, but it can’t read this account. Check the account ID, and that the token is limited to this same account.",
  site_tag_no_data: "This account has Web Analytics data, but none for this site tag in 90 days. Check the site tag (in the site’s settings; it is not the token in the snippet) and that this site is in this account.",
  account_no_data: "Nothing has reached this Cloudflare account in 90 days, for any site. The website isn’t sending data: add the Web Analytics snippet (or turn on automatic setup), or check the account ID.",
  no_data: "No data has reached Cloudflare for this site tag in 90 days. Check the site tag and that the website carries the Web Analytics snippet.",
  credentials_key_missing: "The server’s encryption key isn’t set up, so the client’s saved token can’t be used.",
  credentials_unreadable: "The saved token can’t be decrypted (the server’s key changed). Paste the client’s token again and save.",
  reconnect_needed: "Google no longer accepts Framework’s sign-in (it was revoked or has expired). Framework’s Google connection has to be set up again; the steps are in WEBSITE-ANALYTICS.md.",
  no_access: "Google refused this property. Add the connected Google account as a Restricted user on it in Search Console, and check the Search Console API is on in the Google Cloud project.",
  property_not_found: "Google doesn’t know that property. Check it matches Search Console exactly.", rate_limited: "The source is busy. Try again in a few minutes.",
  unreachable: "The source couldn’t be reached just now. Try again.", query_failed: "The source answered but the request failed. Try again, and check the setting.",
};
const SRC = { cloudflare: "Cloudflare Web Analytics", search_console: "Google Search Console" };
const ACCOUNT_WORD = { own: "the client’s account", framework: "Framework’s account" };
/** One line for a test result. Cloudflare tells receiving data, genuine zero traffic and the setup problems apart. */
function testText(source, r) {
  const where = r.account ? ` (${ACCOUNT_WORD[r.account] || "Cloudflare"})` : "";
  if (r.ok && r.status === "receiving") return `${SRC[source]}${where}: working. ${Number(r.pageViews).toLocaleString("en-CA")} page views in the last 7 days, through ${r.through}.`;
  if (r.ok && r.status === "no_recent_traffic") return `${SRC[source]}${where}: connected correctly. This site has reported before, but no page views were recorded in the last 7 days (through ${r.through}), so the client will see zeros.`;
  if (r.ok) return `${SRC[source]} answered. Figures are available through ${r.through}.`;
  return `${SRC[source]}${where}: ${TEST[r.code] || TEST.query_failed}`;
}

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
      say(testText(source, r), r.ok ? "success" : "error");
    } catch (err) { say(errorText(err), "error"); }
    busy = false;
  }
  const field = (id, label, input, hint) => h("div", { class: "adm-field" }, h("label", { for: id, text: label }), hint ? h("p", { class: "adm-field__hint", text: hint }) : null, input);
  const text = (id, value, props = {}) => h("input", { id, class: "input", type: "text", autocomplete: "off", spellcheck: "false", value: value || "", ...props });

  function draw(d) {
    if (!d.available) { root.replaceChildren(h("p", { class: "acc__group" }, "Analytics"), h("p", { class: "adm-muted", text: "Analytics isn’t available on this site yet: a database change is waiting for approval." })); return; }
    const own = d.own_accounts || { available: false, key: false };
    const ownSaved = !!d.config.cf_account_id;
    const tag = text(pre + "-tag", d.config.cf_site_tag, { maxlength: "32", placeholder: "32 letters and numbers" });
    const prop = text(pre + "-prop", d.config.gsc_property, { maxlength: "200", placeholder: "sc-domain:example.com" });
    const state = (on) => badge(on ? "Server ready" : "Server not set up", on ? "ok" : "pending");
    const w = canWrite();

    // which Cloudflare account holds this website's Web Analytics site
    const which = h("select", { id: pre + "-acct", class: "input", disabled: own.available ? null : true },
      h("option", { value: "framework", selected: ownSaved ? null : true }, "Framework’s account"),
      h("option", { value: "own", selected: ownSaved ? true : null }, "The client’s own account"));
    const account = text(pre + "-acctid", d.config.cf_account_id, { maxlength: "32", placeholder: "32 letters and numbers" });
    // write-only: never filled in, never read back
    const token = h("input", { id: pre + "-token", class: "input", type: "password", autocomplete: "new-password", spellcheck: "false", value: "", maxlength: "200",
      placeholder: d.config.cf_token_set ? "Saved. Leave empty to keep it" : "Paste the read-only token" });
    const ownChip = ownSaved ? badge(d.config.cf_token_set ? `Client’s token saved ${fmtDate(d.config.cf_token_set_at)}` : "Token missing", d.config.cf_token_set ? "ok" : "bad") : null;
    const ownBlock = h("div", { class: "adm-field", hidden: ownSaved ? null : true },
      field(pre + "-acctid", "Client’s Cloudflare account ID", account, "In the client’s Cloudflare dashboard: the account’s overview page, or the 32 characters after dash.cloudflare.com/ in the address."),
      field(pre + "-token", "Client’s API token (read-only)", token, "The client creates it under My Profile or Manage Account, API Tokens: permission Account, Account Analytics, Read, limited to this one account. It is encrypted when saved and never shown again."),
      own.key ? null : h("p", { class: "adm-field__hint", text: "The server’s encryption key (ANALYTICS_CREDENTIALS_KEY) isn’t set up yet, so a token can’t be saved." }));
    which.addEventListener("change", () => { ownBlock.hidden = which.value !== "own"; });

    async function save() {
      const body = { cf_site_tag: tag.value.trim(), gsc_property: prop.value.trim() };
      if (own.available) {
        if (which.value === "own") { body.cf_account_id = account.value.trim(); if (token.value.trim()) body.cf_api_token = token.value.trim(); }
        else if (ownSaved) {
          const yes = await confirmDialog({ title: "Use Framework’s account?", body: "The client’s account ID and their saved API token will be removed from Framework. Traffic will be read from Framework’s own Cloudflare account.", confirmLabel: "Remove and save" });
          if (!yes) return;
          body.cf_account_id = "";
        }
      }
      await run(() => api(url, { method: "POST", body }), "Analytics settings saved.");
    }

    root.replaceChildren(
      h("p", { class: "acc__group" }, "Analytics"),
      h("p", { class: "adm-muted", text: "What this website’s Analytics page reads for the client. Nothing is shown to the client from a source until its setting is saved here." }),
      h("div", { class: "adm-field" }, h("p", null, h("strong", { text: SRC.cloudflare + " " }), ownSaved ? ownChip : state(d.platform.cloudflare))),
      field(pre + "-acct", "Cloudflare account", which, own.available ? "Where this website’s Web Analytics site was created." : "Clients’ own Cloudflare accounts need a database change that is waiting for approval. Until then every website is read from Framework’s account."),
      ownBlock,
      field(pre + "-tag", "Site tag", tag, "In Cloudflare: Analytics & Logs, Web Analytics, the site, Manage site: its site tag. It is not the token inside the snippet. The website must carry the Web Analytics snippet."),
      w ? h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => test("cloudflare") }, "Test Cloudflare")) : null,
      h("div", { class: "adm-field" }, h("p", null, h("strong", { text: SRC.search_console + " " }), state(d.platform.search_console))),
      field(pre + "-prop", "Search Console property", prop, d.google_account ? `Add ${d.google_account} as a Restricted (read-only) user on this property in Search Console first.` : d.platform.search_console ? "Add the Google account Framework signed in with as a Restricted (read-only) user on this property in Search Console first." : "Google sign-in isn’t set up on the server yet."),
      w ? h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => test("search_console") }, "Test Search Console")) : null,
      w ? h("div", { class: "adm-actions" }, h("button", { class: "btn btn--primary adm-small", type: "button", onclick: save }, "Save analytics settings")) : null,
    );
  }
  load();
  return root;
}
