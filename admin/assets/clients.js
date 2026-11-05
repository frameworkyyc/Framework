/* Framework Admin — Clients: /admin/clients (organizations, New client) and /admin/clients/:id (organization, invitations, members, Business Profile review).
   Access management lives in clients-access.js; the Business Profile review below stays read-only. */

import { h, api, fmtDate, stateBlock } from "./ui.js";
import { newClientPanel, accessSections } from "./clients-access.js";
import { actionsMenu, deleteClient, restoreClient } from "./clients-delete.js";
import { dashboard, sectionMap, stepAccordion, disclosure, chip, icon, STATE_TEXT } from "./client-dashboard.js";

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const statusWord = (s) => (s === "archived" ? "Deleted" : cap(s));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");

export async function render(ctx) {
  const m = ctx.url.pathname.replace(/\/+$/, "").match(/^\/admin\/clients\/([^/]+)(\/branding|\/website|\/profile|\/invoices|\/support|\/additional-services)?$/);
  if (m && m[2] === "/branding") return (await import("./branding.js")).render(decodeURIComponent(m[1]), ctx);
  if (m && m[2] === "/website") return (await import("./websites.js")).render(decodeURIComponent(m[1]), ctx);
  if (m && m[2] === "/additional-services") return (await import("./client-services.js")).render(decodeURIComponent(m[1]), ctx);
  if (m && m[2] === "/support") return (await import("./support.js")).render(decodeURIComponent(m[1]), ctx);
  if (m && m[2] === "/invoices") return (await import("./invoices.js")).render(decodeURIComponent(m[1]), ctx);
  if (m && m[2] === "/profile") return renderProfile(decodeURIComponent(m[1]), ctx);
  return m ? renderDetail(decodeURIComponent(m[1]), ctx) : renderList(ctx);
}

/* ---------- List ---------- */


/** Business Profile completion: a thin native progress bar and the percentage. The bar is decorative (the percentage and a screen-reader sentence carry the meaning), and a native element needs no inline style (the Admin CSP forbids those). */
function completion(p) {
  if (!p) return h("span", { class: "adm-clientrow__profile adm-muted" }, "Profile not available");
  const pct = Math.max(0, Math.min(100, Number(p.percent) || 0));
  return h("span", { class: "adm-clientrow__profile" },
    h("progress", { class: "adm-meter", max: 100, value: pct, "aria-hidden": "true" }),
    h("span", { class: "adm-clientrow__pct", "aria-hidden": "true" }, `${p.percent}%`),
    h("span", { class: "visually-hidden" }, `Business Profile ${p.percent}% complete (${p.done} of ${p.total} steps)`));
}

/** One whole row is the link (no arrow: the actions menu sits beside it): name first (full width), then when it was created and how far the Business Profile is. Members and invitations live on the client's own page. */
function clientRow(c) {
  const created = c.status === "active" ? "Created " + fmtDate(c.created_at) : `${statusWord(c.status)} · created ${fmtDate(c.created_at)}`;
  return h("a", { class: "adm-clientrow", href: "/admin/clients/" + encodeURIComponent(c.id), "data-link": "" },
    h("span", { class: "adm-clientrow__name", text: c.name }),
    h("span", { class: "adm-clientrow__date", text: created }),
    completion(c.profile));
}

async function renderList(ctx) {
  const data = await api("/clients");
  const rows = data.clients.filter((c) => c.status !== "archived");
  const deleted = data.clients.filter((c) => c.status === "archived");
  const writes = Boolean(data.capabilities && data.capabilities.writes);
  const done = () => ctx.retry();
  const list = h("ul", { class: "adm-clientlist", "aria-label": "Client organizations" }, rows.map((c) => h("li", { class: "adm-clientitem" }, clientRow(c),
    writes ? actionsMenu({ label: `Actions for ${c.name}`, items: [{ label: "Delete client", danger: true, run: () => deleteClient(c, { notify: ctx.notify, after: done }) }] }) : null)));
  const trash = deleted.length ? disclosure({ id: "deleted-clients", title: "Deleted clients", className: "adm-acc--quiet", meta: String(deleted.length),
    children: h("ul", { class: "adm-clientlist adm-clientlist--deleted", "aria-label": "Deleted clients" }, deleted.map((c) => h("li", { class: "adm-deleteditem" },
      h("div", { class: "adm-deleteditem__text" },
        h("a", { class: "adm-link", href: "/admin/clients/" + encodeURIComponent(c.id), "data-link": "" }, c.name),
        h("span", { class: "adm-clientrow__date", text: "Deleted " + fmtDate(c.archived_at) })),
      writes ? h("button", { class: "btn btn--secondary adm-small", type: "button", "aria-label": `Restore ${c.name}`, onclick: () => restoreClient(c, { notify: ctx.notify, after: done }) }, "Restore") : null))) }) : null;
  const create = newClientPanel({ navigate: ctx.navigate, writesEnabled: writes });
  const node = h("div", { class: "adm-page" },
    h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, "Framework Admin"), h("h1", { class: "adm-title", tabindex: "-1" }, "Clients"),
      h("p", { class: "adm-sub" }, h("span", { class: "adm-sub--full" }, "Client organizations, the people who can open their portal, and their Business Profiles."), h("span", { class: "adm-sub--short" }, "Manage your client organizations."))), h("div", { class: "adm-actions" }, create.button)),
    writes ? null : h("p", { class: "adm-banner" }, "Changes are switched off on this site: you can look at clients, but not create them or change who has access."),
    create.panel,
    data.profile_available ? null : h("p", { class: "adm-banner" }, "Business Profile data isn’t available on this deployment (its database migration hasn’t been applied)."),
    rows.length ? list : stateBlock({ title: "No client organizations yet", body: writes ? "Use New client to add the first one, then invite its first owner." : "Nothing has been created yet. Changes are switched off on this site." }),
    rows.length ? h("p", { class: "adm-sub", role: "status" }, `${plural(rows.length, "organization")}.`) : null,
    trash,
  );
  return { title: "Clients", node };
}

/* ---------- Detail ---------- */

const spec = (rows) => h("dl", { class: "adm-spec" }, rows.filter(Boolean).map(([k, v]) => h("div", null, h("dt", { text: k }), h("dd", null, v))));

async function renderDetail(id, ctx) {
  const data = await api("/clients/" + encodeURIComponent(id));
  const o = data.organization;
  const p = data.profile;
  const welcome = ctx.url.searchParams.get("welcome") === "1";
  const dash = dashboard({ org: o, profile: data.profile_available ? p : null, members: data.members, invitations: data.invitations, branding: data.branding, websites: data.websites, invoices: data.invoices, support: data.support });

  const info = disclosure({
    id: "org-details", title: "Organization details", className: "adm-acc--quiet",
    meta: o.status === "active" ? "Active" : statusWord(o.status),
    children: spec([
      ["Status", o.status === "active" ? "Active" : statusWord(o.status)],
      ["Portal address", h("code", { class: "adm-code" }, "/portal/o/" + o.slug)],
      o.website_url ? ["Website", h("a", { class: "adm-link", href: o.website_url, rel: "noopener noreferrer", target: "_blank" }, o.website_url.replace(/^https:\/\//, ""))] : ["Website", h("span", { class: "adm-muted" }, "Not given")],
      ["Created", fmtDate(o.created_at)],
    ]),
  });

  const deletedOrg = o.status === "archived";
  const writes = Boolean(data.capabilities && data.capabilities.writes);
  const done = () => ctx.retry();
  const menu = writes && !deletedOrg ? actionsMenu({ label: `Actions for ${o.name}`, items: [{ label: "Delete client", danger: true, run: () => deleteClient(o, { notify: ctx.notify, after: () => ctx.navigate("/admin/clients") }) }] }) : null;
  const deletedBanner = deletedOrg ? h("div", { class: "adm-banner adm-banner--alert adm-deletedbanner", role: "status" },
    h("p", { class: "adm-deletedbanner__text" }, `This client was deleted${o.archived_at ? " on " + fmtDate(o.archived_at) : ""}. Its team can’t open the portal, and it is hidden from the active lists. Invoices, support requests and other records are kept.`),
    writes ? h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => restoreClient(o, { notify: ctx.notify, after: done }) }, "Restore client") : null) : null;
  const access = deletedOrg ? null : accessSections({ orgId: o.id, orgName: o.name, welcome, onData: (d) => dash.update(d.members, d.invitations) });

  const node = h("div", { class: "adm-page adm-detail" },
    h("div", { class: "adm-detailbar" }, h("a", { class: "adm-back", href: "/admin/clients", "data-link": "" }, "← All clients"), menu),
    dash.header,
    deletedBanner,
    dash.overview,
    access,
    info,
  );
  return { title: o.name + " — Clients", node };
}

/* ---------- Business Profile detail: /admin/clients/:id/profile ---------- */

/** All seven sections as collapsed accordions, each with its completion state and answered count, so missing information is visible without opening anything. Read-only. */
async function renderProfile(id, ctx) {
  const data = await api("/clients/" + encodeURIComponent(id));
  const o = data.organization;
  const p = data.profile;
  const back = h("a", { class: "adm-back", href: "/admin/clients/" + encodeURIComponent(o.id), "data-link": "" }, "← " + o.name);
  if (!data.profile_available) {
    return { title: "Business Profile — " + o.name, node: h("div", { class: "adm-page adm-detail" }, back, h("h1", { class: "adm-title", tabindex: "-1" }, "Business Profile"), h("p", { class: "adm-banner" }, "Business Profile data isn’t available on this deployment.")) };
  }
  const pct = Math.max(0, Math.min(100, Number(p.percent) || 0));
  const allOpen = () => [...document.querySelectorAll(".adm-acc--step")].every((d) => d.open);
  const toggleAll = h("button", { class: "adm-linkbtn", type: "button", "aria-live": "polite", text: "Expand all", onclick: () => {
    const open = !allOpen();
    document.querySelectorAll(".adm-acc--step").forEach((d) => { d.open = open; });
    toggleAll.textContent = open ? "Collapse all" : "Expand all";
  } });
  const missing = p.steps.filter((s) => s.state !== "complete");
  const node = h("div", { class: "adm-page adm-detail" },
    back,
    h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, o.name), h("h1", { class: "adm-title", tabindex: "-1" }, "Business Profile"),
      h("p", { class: "adm-sub" }, "Answers are shown as the client saved them; staff cannot edit them here."))),
    h("div", { class: "adm-tile adm-tile--profile adm-tile--" + (p.done === p.total ? "ok" : p.steps.every((s) => s.answered === 0) ? "plain" : "pending") },
      h("p", { class: "adm-tile__label" }, "Completion"),
      h("p", { class: "adm-tile__big" }, `${p.percent}%`, h("span", { class: "adm-tile__unit", text: "complete" })),
      h("progress", { class: "adm-meter adm-meter--lg", max: 100, value: pct, "aria-label": `Business Profile ${p.percent} percent complete` }),
      h("p", { class: "adm-tile__note" }, `${p.done} of ${p.total} sections complete` + (p.last_saved ? ` · last saved ${fmtDate(p.last_saved)}` : " · nothing saved yet")),
      missing.length ? h("p", { class: "adm-tile__note" }, "Needs answers: " + missing.map((s) => s.title).join(", ")) : h("p", { class: "adm-tile__note" }, "Every section is complete.")),
    h("section", { class: "adm-section", "aria-labelledby": "adm-prof-h" },
      h("div", { class: "adm-section-title" }, h("h2", { id: "adm-prof-h", text: "Sections and saved answers" }), toggleAll),
      p.steps.every((s) => s.answered === 0) ? h("p", { class: "adm-muted" }, "This organization hasn’t saved any Business Profile answers yet.") : null,
      h("div", { class: "adm-accgroup" }, p.steps.map(stepAccordion))));
  return { title: "Business Profile — " + o.name, node };
}
