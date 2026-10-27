/* Framework Admin — Clients: /admin/clients (organizations, New client) and /admin/clients/:id (organization, invitations, members, Business Profile review).
   Access management lives in clients-access.js; the Business Profile review below stays read-only. */

import { h, api, fmtDate, stateBlock } from "./ui.js";
import { newClientPanel, accessSections } from "./clients-access.js";
import { dashboard, sectionMap, stepAccordion, disclosure, chip, icon, STATE_TEXT } from "./client-dashboard.js";

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");

export async function render(ctx) {
  const m = ctx.url.pathname.replace(/\/+$/, "").match(/^\/admin\/clients\/([^/]+)(\/branding|\/profile|\/invoices|\/support)?$/);
  if (m && m[2] === "/branding") return (await import("./branding.js")).render(decodeURIComponent(m[1]), ctx);
  if (m && m[2] === "/support") return (await import("./support.js")).render(decodeURIComponent(m[1]), ctx);
  if (m && m[2] === "/invoices") return (await import("./invoices.js")).render(decodeURIComponent(m[1]), ctx);
  if (m && m[2] === "/profile") return renderProfile(decodeURIComponent(m[1]), ctx);
  return m ? renderDetail(decodeURIComponent(m[1]), ctx) : renderList(ctx);
}

/* ---------- List ---------- */

const ARROW = () => { const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false"); svg.setAttribute("class", "adm-clientrow__arrow"); const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", "M5 12h14m-5-5 5 5-5 5"); svg.append(path); return svg; };

/** Business Profile completion: a thin native progress bar and the percentage. The bar is decorative (the percentage and a screen-reader sentence carry the meaning), and a native element needs no inline style (the Admin CSP forbids those). */
function completion(p) {
  if (!p) return h("span", { class: "adm-clientrow__profile adm-muted" }, "Profile not available");
  const pct = Math.max(0, Math.min(100, Number(p.percent) || 0));
  return h("span", { class: "adm-clientrow__profile" },
    h("progress", { class: "adm-meter", max: 100, value: pct, "aria-hidden": "true" }),
    h("span", { class: "adm-clientrow__pct", "aria-hidden": "true" }, `${p.percent}%`),
    h("span", { class: "visually-hidden" }, `Business Profile ${p.percent}% complete (${p.done} of ${p.total} steps)`));
}

/** One whole row is the link: name first (full width), then when it was created and how far the Business Profile is. Members and invitations live on the client's own page. */
function clientRow(c) {
  const created = c.status === "active" ? "Created " + fmtDate(c.created_at) : `${cap(c.status)} · created ${fmtDate(c.created_at)}`;
  return h("a", { class: "adm-clientrow", href: "/admin/clients/" + encodeURIComponent(c.id), "data-link": "" },
    h("span", { class: "adm-clientrow__name", text: c.name }),
    h("span", { class: "adm-clientrow__date", text: created }),
    completion(c.profile),
    ARROW());
}

async function renderList(ctx) {
  const data = await api("/clients");
  const rows = data.clients;
  const list = h("ul", { class: "adm-clientlist", "aria-label": "Client organizations" }, rows.map((c) => h("li", null, clientRow(c))));
  const writes = Boolean(data.capabilities && data.capabilities.writes);
  const create = newClientPanel({ navigate: ctx.navigate, writesEnabled: writes });
  const node = h("div", { class: "adm-page" },
    h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, "Framework Admin"), h("h1", { class: "adm-title", tabindex: "-1" }, "Clients"),
      h("p", { class: "adm-sub" }, h("span", { class: "adm-sub--full" }, "Client organizations, the people who can open their portal, and their Business Profiles."), h("span", { class: "adm-sub--short" }, "Manage your client organizations."))), h("div", { class: "adm-actions" }, create.button)),
    writes ? null : h("p", { class: "adm-banner" }, "Changes are switched off on this site: you can look at clients, but not create them or change who has access."),
    create.panel,
    data.profile_available ? null : h("p", { class: "adm-banner" }, "Business Profile data isn’t available on this deployment (its database migration hasn’t been applied)."),
    rows.length ? list : stateBlock({ title: "No client organizations yet", body: writes ? "Use New client to add the first one, then invite its first owner." : "Nothing has been created yet. Changes are switched off on this site." }),
    rows.length ? h("p", { class: "adm-sub", role: "status" }, `${plural(rows.length, "organization")}.`) : null,
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
  const dash = dashboard({ org: o, profile: data.profile_available ? p : null, members: data.members, invitations: data.invitations, branding: data.branding, invoices: data.invoices, support: data.support });

  const info = disclosure({
    id: "org-details", title: "Organization details", className: "adm-acc--quiet",
    meta: o.status === "active" ? "Active" : cap(o.status),
    children: spec([
      ["Status", o.status === "active" ? "Active" : cap(o.status)],
      ["Portal address", h("code", { class: "adm-code" }, "/portal/o/" + o.slug)],
      o.website_url ? ["Website", h("a", { class: "adm-link", href: o.website_url, rel: "noopener noreferrer", target: "_blank" }, o.website_url.replace(/^https:\/\//, ""))] : ["Website", h("span", { class: "adm-muted" }, "Not given")],
      ["Created", fmtDate(o.created_at)],
    ]),
  });

  const access = accessSections({ orgId: o.id, orgName: o.name, welcome, onData: (d) => dash.update(d.members, d.invitations) });

  const node = h("div", { class: "adm-page adm-detail" },
    h("a", { class: "adm-back", href: "/admin/clients", "data-link": "" }, "← All clients"),
    dash.header,
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
