/* Framework Admin — Clients: the client detail dashboard (header monogram, overview tiles, "next step", Business Profile section map, expandable sections).
   Presentation only: it reads what /api/admin/clients/:id and /access already return, computes nothing the server does not already know, and every number
   shown here comes from that data. Client text is only ever inserted as text nodes. */

import { h, fmtDate } from "./ui.js";

const SVG_NS = "http://www.w3.org/2000/svg";
export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
export const STATE_TEXT = { complete: "Complete", partial: "Partial", missing: "Missing" };

/** Small inline icons. Shape, not colour alone, tells the states apart: tick (complete), half (partial), dashed (missing), triangle (needs attention), i (info). */
export function icon(kind) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "adm-ico adm-ico--" + kind);
  const add = (tag, attrs) => { const el = document.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); svg.append(el); };
  if (kind === "complete") { add("circle", { cx: 12, cy: 12, r: 9 }); add("path", { d: "M8 12.4l2.7 2.7L16 9.8", class: "adm-ico__mark" }); }
  else if (kind === "partial") { add("circle", { cx: 12, cy: 12, r: 9 }); add("path", { d: "M12 3a9 9 0 0 1 0 18z", class: "adm-ico__fill" }); }
  else if (kind === "missing") add("circle", { cx: 12, cy: 12, r: 9, class: "adm-ico__dash" });
  else if (kind === "warn") { add("path", { d: "M12 3.8 21.4 20H2.6z" }); add("path", { d: "M12 10v4.6M12 17.4v.1", class: "adm-ico__mark" }); }
  else { add("circle", { cx: 12, cy: 12, r: 9 }); add("path", { d: "M12 11v5M12 7.6v.1", class: "adm-ico__mark" }); }
  return svg;
}

/** Up to two initials from the organization's name (letters and digits only), as a restrained stand-in for a logo: no organization has an image in the data. */
export function monogram(name) {
  const words = String(name || "").split(/[\s\-–—_/&.,]+/).map((w) => Array.from(w).find((c) => /[\p{L}\p{N}]/u.test(c))).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words.slice(0, 1);
  return (letters.join("") || "•").toLocaleUpperCase();
}

/* ---------- Team facts (pure) ---------- */

const expired = (i) => i.status === "expired" || Boolean(i.past_expiry);

/** Counts from the invitation and member rows. "failed" and "unsent" need delivery tracking, which only the /access data carries (undefined until it has loaded). */
export function teamFacts(members, invitations) {
  const active = members.filter((m) => m.status === "active" && m.user_status === "active");
  const pending = invitations.filter((i) => i.status === "pending" && !expired(i));
  const tracked = invitations.some((i) => i.delivery);
  const state = (i) => (i.delivery && i.delivery.state) || "not_tracked";
  return {
    members: active.length,
    owners: active.filter((m) => m.role === "owner").length,
    pending: pending.length,
    lapsed: invitations.filter((i) => i.status === "pending" && expired(i)).length,
    failed: tracked ? pending.filter((i) => state(i) === "failed").length : 0,
    unsent: tracked ? pending.filter((i) => !["submitted", "failed", "not_tracked"].includes(state(i))).length : 0,
    cleanup: invitations.filter((i) => i.status === "revoked" && i.workos_cleanup === "pending").length,
  };
}

/* ---------- What needs attention, and the one next step ---------- */

const RANK = { bad: 0, warn: 1, info: 2 };

/** Most urgent first. Each item: tone (bad = something failed, warn = needs action, info = waiting on the client), text, and where "Review" goes. */
export function attention({ org, profile, facts, branding = null, invoices = null, support = null }) {
  const out = [];
  const add = (tone, text, go, label, href = null) => out.push({ tone, text, go, label, href });
  if (org.status !== "active") add("bad", `This organization is ${org.status}, so it can’t receive invitations.`, "org-details", "See details");
  if (facts.failed) add("bad", `${plural(facts.failed, "invitation")} failed to send. Nothing was emailed.`, "team-invitations", "Review invitations");
  if (facts.lapsed) add("warn", `${plural(facts.lapsed, "invitation")} expired. Replace ${facts.lapsed === 1 ? "it" : "them"} to invite again.`, "team-invitations", "Review invitations");
  if (facts.unsent) add("warn", `${plural(facts.unsent, "saved invitation")} not sent yet.`, "team-invitations", "Review invitations");
  if (facts.cleanup) add("warn", `${plural(facts.cleanup, "revoked invitation")} still to be cancelled at WorkOS.`, "team-invitations", "Review invitations");
  if (org.status === "active" && facts.members === 0 && facts.pending === 0 && !facts.lapsed) add("warn", "No one has access yet. Invite the first owner.", "team-invitations", "Invite an owner");
  else if (facts.members > 0 && facts.owners === 0) add("warn", "No active owner. Make someone an owner.", "team-members", "Review members");
  if (branding && branding.requestsNew) add("warn", `${plural(branding.requestsNew, "new service request")} to follow up.`, null, "Open Branding", "__BRANDING__");
  if (branding && branding.uploadsNew) add("warn", `${plural(branding.uploadsNew, "new client upload")} to review.`, null, "Open Branding", "__BRANDING__");
  if (support && support.unseen) add("warn", `${plural(support.unseen, "support request")} with new activity.`, null, "Open requests", "__SUPPORT__");
  if (invoices && invoices.overdue) add("warn", `${plural(invoices.overdue, "published invoice")} past due.`, null, "Open Invoices", "__INVOICES__");
  if (invoices && invoices.drafts) add("info", `${plural(invoices.drafts, "draft invoice")} not published yet.`, null, "Open Invoices", "__INVOICES__");
  if (profile) {
    const firstOpen = profile.steps.find((s) => s.state !== "complete");
    if (profile.steps.every((s) => s.answered === 0)) add("info", "The client hasn’t started their Business Profile.", null, "Open Business Profile", "__PROFILE__");
    else if (firstOpen) add("info", `${profile.total - profile.done} of ${profile.total} Business Profile sections still need answers.`, null, "Open Business Profile", "__PROFILE__");
  }
  if (facts.members === 0 && facts.pending > 0 && !facts.failed && !facts.unsent) add("info", `Waiting for ${plural(facts.pending, "invitation")} to be accepted.`, "team-invitations", "View invitations");
  return out.sort((a, b) => RANK[a.tone] - RANK[b.tone]);
}

/* ---------- Disclosure (native details/summary: keyboard, focus and expanded state come from the platform) ---------- */

/** meta is a node or text shown at the right of the summary line; the body is only rendered when opened by the browser. */
export function disclosure({ id, title, meta, open = false, onToggle, className = "", children }) {
  return h("details", { class: "adm-acc " + className, id, open: open ? true : null, ontoggle: onToggle },
    h("summary", { class: "adm-acc__sum" }, h("span", { class: "adm-acc__title" }, title), meta ? h("span", { class: "adm-acc__meta" }, meta) : null),
    h("div", { class: "adm-acc__body" }, children));
}

export const chip = (tone, text, ico) => h("span", { class: "adm-chip adm-chip--" + tone }, ico ? icon(ico) : null, text);

/** Open a section by id (a disclosure is opened and its summary focused; anything else is scrolled to and focused). */
export function goTo(key) {
  const el = document.getElementById(key);
  if (!el) return;
  const target = el.tagName === "DETAILS" ? el.querySelector("summary") : el;
  if (el.tagName === "DETAILS") el.open = true;
  el.scrollIntoView({ block: "start" });
  if (target) target.focus({ preventScroll: true });
}

/* ---------- Dashboard ---------- */

const dashButton = (label, go, href) => (href ? h("a", { class: "btn btn--secondary adm-small", href, "data-link": "", text: label }) : h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => go(), text: label }));
const linkFor = (it, brandingHref, profileHref, invoicesHref, supportHref) => (it.href === "__SUPPORT__" ? supportHref : it.href === "__BRANDING__" ? brandingHref : it.href === "__PROFILE__" ? profileHref : it.href === "__INVOICES__" ? invoicesHref : it.href);

/** Header, "next step" card and the two overview tiles. `update(members, invitations)` refreshes the team-dependent parts after the access panel loads or changes. */
export function dashboard({ org, profile, members, invitations, branding = null, websites = null, invoices = null, support = null }) {
  const supportHref = `/admin/clients/${encodeURIComponent(org.id)}/support`;
  const brandingHref = `/admin/clients/${encodeURIComponent(org.id)}/branding`;
  const invoicesHref = `/admin/clients/${encodeURIComponent(org.id)}/invoices`;
  const profileHref = `/admin/clients/${encodeURIComponent(org.id)}/profile`;
  const next = h("section", { class: "adm-next", "aria-labelledby": "adm-next-h" });
  const team = h("div", { class: "adm-tile adm-tile--team" });
  const header = h("div", { class: "adm-idhead" },
    h("span", { class: "adm-mono", "aria-hidden": "true", text: monogram(org.name) }),
    h("div", { class: "adm-idhead__text" },
      h("span", { class: "eyebrow" }, "Client"),
      h("h1", { class: "adm-title", tabindex: "-1" }, org.name),
      org.status !== "active" ? h("p", { class: "adm-idhead__chips" }, chip("bad", org.status === "archived" ? "Deleted" : org.status[0].toUpperCase() + org.status.slice(1), "warn")) : null));

  function paint(facts) {
    const items = attention({ org, profile, facts, branding, invoices, support });
    const lead = items[0];
    next.className = "adm-next adm-next--" + (lead ? lead.tone : "ok");
    next.replaceChildren(...[
      h("h2", { id: "adm-next-h", class: "adm-next__label" }, lead ? "Next step" : "All clear"),
      lead
        ? h("div", { class: "adm-next__lead" }, icon(lead.tone === "info" ? "info" : "warn"), h("p", { class: "adm-next__text", text: lead.text }), dashButton(lead.label, () => goTo(lead.go), linkFor(lead, brandingHref, profileHref, invoicesHref, supportHref)))
        : h("div", { class: "adm-next__lead" }, icon("complete"), h("p", { class: "adm-next__text" }, "Nothing needs your attention right now.")),
      items.length > 1
        ? h("details", { class: "adm-next__morebox" },
            h("summary", null, `${items.length - 1} more to review`),
            h("ul", { class: "adm-next__more" }, items.slice(1).map((it) => h("li", null, icon(it.tone === "info" ? "info" : "warn"), h("span", { text: it.text }), it.href ? h("a", { class: "adm-linkbtn", href: linkFor(it, brandingHref, profileHref, invoicesHref, supportHref), "data-link": "", text: it.label }) : h("button", { class: "adm-linkbtn", type: "button", onclick: () => goTo(it.go), text: it.label })))))
        : null].filter(Boolean));
    const withAccess = facts.members === 1 ? "person has access" : "people have access";
    team.replaceChildren(
      h("p", { class: "adm-tile__label" }, "Team"),
      h("p", { class: "adm-tile__big" }, String(facts.members), h("span", { class: "adm-tile__unit", text: withAccess })),
      h("p", { class: "adm-tile__note" }, `${plural(facts.owners, "owner")} · ${plural(facts.members - facts.owners, "member")}`),
      h("p", { class: "adm-tile__chips" },
        facts.pending ? chip("pending", `${facts.pending} pending`, "info") : chip("plain", "No pending invitations"),
        facts.lapsed ? chip("warn", `${facts.lapsed} expired`, "warn") : null,
        facts.failed ? chip("bad", `${facts.failed} failed`, "warn") : null));
  }

  const pct = profile ? Math.max(0, Math.min(100, Number(profile.percent) || 0)) : 0;
  const tone = !profile ? "plain" : profile.done === profile.total ? "ok" : profile.steps.every((s) => s.answered === 0) ? "plain" : "pending";
  // The one Business Profile card on the dashboard: completion and progress only. The whole card opens the Business Profile page (sections and saved answers).
  const prof = h(profile ? "a" : "div", { class: "adm-tile adm-tile--profile adm-tile--" + tone + (profile ? " adm-tile--link" : ""), ...(profile ? { href: profileHref, "data-link": "" } : {}) },
    h("p", { class: "adm-tile__label" }, "Business Profile", profile ? h("span", { class: "adm-tile__go", "aria-hidden": "true" }, "→") : null),
    profile
      ? [
          h("p", { class: "adm-tile__big", }, `${profile.percent}%`, h("span", { class: "adm-tile__unit", text: "complete" })),
          h("progress", { class: "adm-meter adm-meter--lg", max: 100, value: pct, "aria-label": `Business Profile ${profile.percent} percent complete` }),
          h("p", { class: "adm-tile__note" }, `${profile.done} of ${profile.total} sections complete` + (profile.last_saved ? ` · last saved ${fmtDate(profile.last_saved)}` : " · nothing saved yet")),
          h("span", { class: "visually-hidden" }, "Open the Business Profile"),
        ]
      : h("p", { class: "adm-tile__note" }, "Not available on this deployment."));

  /** A whole-card link in the same style as Business Profile: label and arrow, one big figure, a note and status chips. */
  const linkTile = ({ href, label, big, unit, note, chips }) => h("a", { class: "adm-tile adm-tile--link", href, "data-link": "" },
    h("p", { class: "adm-tile__label" }, label, h("span", { class: "adm-tile__go", "aria-hidden": "true" }, "→")),
    h("p", { class: "adm-tile__big" }, big, unit ? h("span", { class: "adm-tile__unit", text: unit }) : null),
    note ? h("p", { class: "adm-tile__note", text: note }) : null,
    h("p", { class: "adm-tile__chips" }, chips.filter(Boolean)),
    h("span", { class: "visually-hidden" }, `Open ${label}`));
  const brandingTile = branding && linkTile({
    href: brandingHref, label: "Branding", big: branding.kitStatus === "published" ? "Published" : branding.kitStatus === "draft" ? "Draft" : "No kit yet", unit: branding.kitStatus ? "brand kit" : "",
    note: branding.assets ? `${branding.assetsPublished} of ${branding.assets} files published` : "No files yet",
    chips: [branding.uploadsNew ? chip("pending", plural(branding.uploadsNew, "new upload"), "info") : null, branding.requestsOpen ? chip(branding.requestsNew ? "pending" : "warn", plural(branding.requestsOpen, "open request"), "info") : null, branding.kitStatus === "published" ? chip("ok", "Visible to the client", "complete") : null] });
  const websiteTile = websites && linkTile({
    href: `/admin/clients/${encodeURIComponent(org.id)}/website`, label: "Website", big: String(websites.total), unit: websites.total === 1 ? "website" : "websites",
    note: websites.total ? "Where each one stands, and who manages it." : "None added yet.",
    chips: [websites.live ? chip("ok", `${websites.live} live`, "complete") : null, websites.inDevelopment ? chip("pending", `${websites.inDevelopment} in development`, "info") : null, websites.existing ? chip("plain", `${websites.existing} existing`) : null, websites.managed ? chip("plain", `${websites.managed} managed by Framework`) : null] });
  const invoicesTile = invoices && linkTile({
    href: invoicesHref, label: "Invoices", big: String(invoices.total), unit: invoices.total === 1 ? "invoice" : "invoices",
    note: invoices.total ? "Archived invoices are kept, not shown here." : "None entered yet.",
    chips: [invoices.drafts ? chip("pending", plural(invoices.drafts, "draft") + " to publish", "info") : null, invoices.overdue ? chip("warn", `${invoices.overdue} past due`, "warn") : null, !invoices.drafts && !invoices.overdue ? chip("plain", invoices.total ? "Nothing to do" : "No invoices yet") : null] });
  const supportTile = support && linkTile({
    href: supportHref, label: "Support & Change Requests", big: String(support.open), unit: "open",
    note: support.total ? `of ${plural(support.total, "request")} in all` : "No requests yet.",
    chips: [support.unseen ? chip("pending", plural(support.unseen, "request") + " with new activity", "info") : support.total ? chip("plain", "All seen") : null] });

  paint(teamFacts(members, invitations));
  return {
    header,
    overview: h("div", { class: "adm-dash" }, next, h("div", { class: "adm-tiles" }, prof, team, brandingTile, websiteTile, invoicesTile, supportTile)),
    update: (m, i) => paint(teamFacts(m, i)),
  };
}

/* ---------- Business Profile: section map and expandable answers ---------- */

/** The seven sections at a glance. Each is a button that opens that section's answers below. */
export function sectionMap(steps) {
  return h("ol", { class: "adm-pmap", "aria-label": "Business Profile sections" }, steps.map((s, n) =>
    h("li", null, h("button", { class: "adm-pmap__item adm-pmap__item--" + s.state, type: "button", onclick: () => goTo("profile-" + s.id) },
      icon(s.state),
      h("span", { class: "adm-pmap__text" }, h("span", { class: "adm-pmap__title" }, h("span", { class: "adm-pmap__num", text: String(n + 1).padStart(2, "0") }), s.title), h("span", { class: "adm-pmap__state", text: STATE_TEXT[s.state] }))))));
}

/** One section as a collapsed accordion item: number, title, state and answered count in the summary; saved answers (read-only) when opened. */
export function stepAccordion(s, index) {
  const answered = s.fields.filter((f) => f.value !== null);
  const body = [
    s.missing_required.length && s.state !== "complete" ? h("p", { class: "adm-acc__note" }, "Still needed: " + s.missing_required.join("; ")) : null,
    answered.length
      ? h("dl", { class: "adm-spec adm-spec--text" }, answered.map((f) => h("div", null, h("dt", { text: f.label }), h("dd", { class: "adm-wide adm-answer", text: f.value }))))
      : h("p", { class: "adm-muted" }, "Nothing saved here yet. The client hasn’t answered this section."),
  ];
  return disclosure({
    id: "profile-" + s.id, className: "adm-acc--step adm-acc--" + s.state,
    title: h("span", { class: "adm-acc__stepname" }, h("span", { class: "adm-acc__num", text: String(index + 1).padStart(2, "0") }), h("span", { class: "adm-acc__name", text: s.title })),
    meta: h("span", { class: "adm-acc__state" }, icon(s.state), h("span", { class: "adm-acc__label", text: STATE_TEXT[s.state] }), h("span", { class: "adm-acc__count", text: `${s.answered}/${s.total_questions}` })),
    children: body,
  });
}
