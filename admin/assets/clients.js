/* Framework Admin — Clients module (read-only): /admin/clients (organizations) and /admin/clients/:id (profile review). */

import { h, api, fmtDate, fmtDateTime, stateBlock } from "./ui.js";

const STATE_TEXT = { complete: "Complete", partial: "Partial", missing: "Missing" };
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

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
  return m ? renderDetail(decodeURIComponent(m[1])) : renderList();
}

/* ---------- List ---------- */

async function renderList() {
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
  const node = h("div", { class: "adm-page" },
    h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, "Framework Admin"), h("h1", { class: "adm-title", tabindex: "-1" }, "Clients"),
      h("p", { class: "adm-sub" }, "Invited client organizations and their Business Profiles. Read-only."))),
    data.profile_available ? null : h("p", { class: "adm-banner" }, "Business Profile data isn’t available on this deployment (its database migration hasn’t been applied)."),
    rows.length ? table : stateBlock({ title: "No client organizations yet", body: "Organizations appear here once they have been created in the portal database." }),
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

async function renderDetail(id) {
  const data = await api("/clients/" + encodeURIComponent(id));
  const o = data.organization;
  const p = data.profile;
  const members = data.members;
  const invitations = data.invitations;

  const profile = !data.profile_available
    ? h("p", { class: "adm-banner" }, "Business Profile data isn’t available on this deployment.")
    : [
        h("p", { class: "adm-sub" }, `${p.done} of ${p.total} steps complete · ${p.percent}%` + (p.last_saved ? ` · last saved ${fmtDateTime(p.last_saved)}` : " · nothing saved yet")),
        h("progress", { class: "adm-meter", max: "100", value: String(p.percent), "aria-label": `Business Profile ${p.percent} percent complete` }),
        p.steps.every((s) => s.answered === 0) ? h("p", { class: "adm-muted" }, "This organization hasn’t saved any Business Profile answers yet.") : null,
        p.steps.map(stepBlock),
      ];

  const memberList = members.length
    ? h("table", { class: "adm-table" }, h("thead", null, h("tr", null, ["Member", "Role", "Status", "Last sign-in"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", null, members.map((u) => h("tr", null,
          h("td", { "data-label": "Member" }, h("span", { class: "adm-client" }, u.name || u.email), u.name ? h("span", { class: "adm-client__sub" }, u.email) : null),
          h("td", { "data-label": "Role" }, u.role),
          h("td", { "data-label": "Status" }, u.status === "active" && u.user_status === "active" ? "Active" : u.status === "revoked" ? "Access revoked" : "Account disabled"),
          h("td", { "data-label": "Last sign-in" }, u.last_login_at ? fmtDate(u.last_login_at) : h("span", { class: "adm-muted" }, "Never"))))))
    : h("p", { class: "adm-muted" }, "No members yet.");

  const inviteList = invitations.length
    ? h("table", { class: "adm-table" }, h("thead", null, h("tr", null, ["Invited", "Role", "Status", "Sent", "Expires"].map((t) => h("th", { scope: "col" }, t)))),
        h("tbody", null, invitations.map((i) => h("tr", null,
          h("td", { "data-label": "Invited" }, i.email),
          h("td", { "data-label": "Role" }, i.role),
          h("td", { "data-label": "Status" }, i.status[0].toUpperCase() + i.status.slice(1), i.past_expiry ? h("span", { class: "adm-muted" }, " (past its expiry date)") : null,
            i.accepted_at ? h("span", { class: "adm-muted" }, " " + fmtDate(i.accepted_at)) : null),
          h("td", { "data-label": "Sent" }, fmtDate(i.created_at)),
          h("td", { "data-label": "Expires" }, fmtDate(i.expires_at))))))
    : h("p", { class: "adm-muted" }, "No invitations recorded.");

  const node = h("div", { class: "adm-page" },
    h("a", { class: "adm-back", href: "/admin/clients", "data-link": "" }, "← All clients"),
    h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, "Client"), h("h1", { class: "adm-title", tabindex: "-1" }, o.name),
      h("p", { class: "adm-sub" }, `${o.status === "active" ? "Active" : o.status[0].toUpperCase() + o.status.slice(1)} · created ${fmtDate(o.created_at)}`))),
    h("p", { class: "adm-banner" }, "Read-only. Answers are shown as the client saved them; staff cannot edit them here."),
    section("Business Profile", profile),
    section("Members", memberList),
    section("Invitations", inviteList,
      h("p", { class: "adm-sub" }, "These are the invitations recorded in the portal database. Invitations are created with the reviewed runbook (migrations/portal-ops) together with the person’s WorkOS account; this page cannot send or change them.")),
  );
  return { title: o.name + " — Clients", node };
}
