/* Framework Admin — Clients: /admin/clients (organizations, New client) and /admin/clients/:id (organization, invitations, members, Business Profile review).
   Access management lives in clients-access.js; the Business Profile review below stays read-only. */

import { h, api, fmtDate, fmtDateTime, stateBlock } from "./ui.js";
import { newClientPanel, accessSections } from "./clients-access.js";

const STATE_TEXT = { complete: "Complete", partial: "Partial", missing: "Missing" };
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");

function inviteSummary(i) {
  const parts = [];
  if (i.pending) parts.push(`${i.pending} pending`);
  if (i.lapsed) parts.push(`${i.lapsed} past expiry`);
  if (i.accepted) parts.push(`${i.accepted} accepted`);
  if (i.revoked) parts.push(`${i.revoked} revoked`);
  return parts.length ? parts.join(" · ") : "None";
}

const profileCell = (p) => (p ? h("span", null, `${p.done} of ${p.total} steps`, h("span", { class: "adm-muted" }, ` · ${p.percent}%`)) : h("span", { class: "adm-muted" }, "Not available"));

export async function render(ctx) {
  const m = ctx.url.pathname.replace(/\/+$/, "").match(/^\/admin\/clients\/([^/]+)$/);
  return m ? renderDetail(decodeURIComponent(m[1]), ctx) : renderList(ctx);
}

/* ---------- List ---------- */

async function renderList(ctx) {
  const data = await api("/clients");
  const rows = data.clients;
  const table = h("table", { class: "adm-table" },
    h("thead", null, h("tr", null, ["Organization", "Active members", "Business Profile", "Invitations", ""].map((t) => h("th", { scope: "col" }, t || h("span", { class: "visually-hidden" }, "Actions"))))),
    h("tbody", null, rows.map((c) => h("tr", null,
      h("td", { "data-label": "Organization" }, h("span", { class: "adm-client" }, c.name), h("span", { class: "adm-client__sub" }, c.status === "active" ? "Created " + fmtDate(c.created_at) : `${c.status[0].toUpperCase()}${c.status.slice(1)} · created ${fmtDate(c.created_at)}`)),
      h("td", { "data-label": "Active members" }, String(c.active_members)),
      h("td", { "data-label": "Business Profile" }, profileCell(c.profile)),
      h("td", { "data-label": "Invitations" }, inviteSummary(c.invitations)),
      h("td", { "data-label": "" }, h("a", { class: "adm-link", href: "/admin/clients/" + encodeURIComponent(c.id), "data-link": "", "aria-label": "View " + c.name }, "View →")),
    ))),
  );
  const writes = Boolean(data.capabilities && data.capabilities.writes);
  const create = newClientPanel({ navigate: ctx.navigate, writesEnabled: writes });
  const node = h("div", { class: "adm-page" },
    h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, "Framework Admin"), h("h1", { class: "adm-title", tabindex: "-1" }, "Clients"),
      h("p", { class: "adm-sub" }, "Client organizations, the people who can open their portal, and their Business Profiles.")), h("div", { class: "adm-actions" }, create.button)),
    writes ? null : h("p", { class: "adm-banner" }, "Changes are switched off on this site: you can look at clients, but not create them or change who has access."),
    create.panel,
    data.profile_available ? null : h("p", { class: "adm-banner" }, "Business Profile data isn’t available on this deployment (its database migration hasn’t been applied)."),
    rows.length ? table : stateBlock({ title: "No client organizations yet", body: writes ? "Use New client to add the first one, then invite its first owner." : "Nothing has been created yet. Changes are switched off on this site." }),
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
