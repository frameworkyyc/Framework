/* Framework Admin — Clients: /admin/clients (organizations, New client) and /admin/clients/:id (organization, invitations, members, Business Profile review).
   Access management lives in clients-access.js; the Business Profile review below stays read-only. */

import { h, api, fmtDate, fmtDateTime, stateBlock } from "./ui.js";
import { newClientPanel, accessSections } from "./clients-access.js";

const STATE_TEXT = { complete: "Complete", partial: "Partial", missing: "Missing" };
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");

export async function render(ctx) {
  const m = ctx.url.pathname.replace(/\/+$/, "").match(/^\/admin\/clients\/([^/]+)$/);
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
const section = (title, ...body) => h("section", { class: "adm-section", "aria-label": title }, h("div", { class: "adm-section-title" }, h("h2", { text: title })), body);

function stepBlock(s, index) {
  const answered = s.fields.filter((f) => f.value !== null);
  return h("div", { class: "adm-step" },
    h("div", { class: "adm-step__head" },
      h("h3", { class: "adm-step__title" }, h("span", { class: "adm-muted" }, String(index + 1).padStart(2, "0") + "  "), s.title),
      h("span", { class: "adm-cstate adm-cstate--" + s.state }, STATE_TEXT[s.state])),
    s.missing_required.length && s.state !== "complete" ? h("p", { class: "adm-sub" }, "Still needed: " + s.missing_required.join("; ")) : null,
    answered.length
      ? h("dl", { class: "adm-spec adm-spec--text" }, answered.map((f) => h("div", null, h("dt", { text: f.label }), h("dd", { class: "adm-wide adm-answer", text: f.value }))))
      : h("p", { class: "adm-muted" }, "No answers saved."),
  );
}

async function renderDetail(id, ctx) {
  const data = await api("/clients/" + encodeURIComponent(id));
  const o = data.organization;
  const p = data.profile;
  const welcome = ctx.url.searchParams.get("welcome") === "1";

  const profile = !data.profile_available
    ? h("p", { class: "adm-banner" }, "Business Profile data isn’t available on this deployment.")
    : [
        h("p", { class: "adm-sub" }, `${p.done} of ${p.total} steps complete · ${p.percent}%` + (p.last_saved ? ` · last saved ${fmtDateTime(p.last_saved)}` : " · nothing saved yet")),
        h("progress", { class: "adm-meter", max: "100", value: String(p.percent), "aria-label": `Business Profile ${p.percent} percent complete` }),
        p.steps.every((s) => s.answered === 0) ? h("p", { class: "adm-muted" }, "This organization hasn’t saved any Business Profile answers yet.") : null,
        p.steps.map(stepBlock),
      ];

  const info = spec([
    ["Status", o.status === "active" ? "Active" : cap(o.status)],
    ["Portal address", h("code", { class: "adm-code" }, "/portal/o/" + o.slug)],
    o.website_url ? ["Website", h("a", { class: "adm-link", href: o.website_url, rel: "noopener noreferrer", target: "_blank" }, o.website_url.replace(/^https:\/\//, ""))] : ["Website", h("span", { class: "adm-muted" }, "Not given")],
    ["Created", fmtDate(o.created_at)],
  ]);

  const node = h("div", { class: "adm-page" },
    h("a", { class: "adm-back", href: "/admin/clients", "data-link": "" }, "← All clients"),
    h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, "Client"), h("h1", { class: "adm-title", tabindex: "-1" }, o.name),
      h("p", { class: "adm-sub" }, `${o.status === "active" ? "Active" : cap(o.status)} · created ${fmtDate(o.created_at)}`))),
    section("Organization", info),
    accessSections({ orgId: o.id, orgName: o.name, welcome }),
    section("Business Profile", h("p", { class: "adm-banner" }, "Answers are shown as the client saved them; staff cannot edit them here."), profile),
  );
  return { title: o.name + " — Clients", node };
}
