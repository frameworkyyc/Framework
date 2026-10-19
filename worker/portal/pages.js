/**
 * Server-rendered pages for the client portal (Stage 2D). No client-side script. Every dynamic value is escaped here; org and
 * project text comes from the database but is still treated as untrusted. Pages receive only data the guard already scoped.
 */
import { htmlPage, escapeHtml as e } from "./http.js";
import { csrfFor } from "./sessions.js";
import { permissionsFor } from "./policy.js";

const day = (iso) => (typeof iso === "string" ? iso.slice(0, 10) : "");
const humanize = (s) => String(s || "").replace(/[._-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
const safeHttps = (u) => (typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);

async function signOutForm(ctx, session) {
  const token = await csrfFor(ctx.cfg, session);
  return `<form method="post" action="/portal/logout" class="portal-signout"><input type="hidden" name="csrf" value="${e(token)}"><button class="btn" type="submit">Sign out</button></form>`;
}

async function shell(ctx, session, { title, body, nav = "", status = 200 }) {
  const who = `<p class="muted">Signed in as <strong>${e(session.email)}</strong></p>`;
  return htmlPage({ status, title, ref: null, bodyHtml: `${who}${nav}${body}${await signOutForm(ctx, session)}` });
}

export const orgNav = (m) => {
  const p = permissionsFor(m.role);
  const base = `/portal/o/${m.slug}`;
  const links = [[base, "Overview", "org.view"], [`${base}/projects`, "Projects", "projects.view"], [`${base}/activity`, "Activity", "activity.view"], [`${base}/members`, "Team", "members.view"]]
    .filter(([, , a]) => p.includes(a))
    .map(([href, label]) => `<a class="text-link" href="${e(href)}">${e(label)}</a>`);
  return `<nav aria-label="Organization"><p>${links.join(" · ")} · <a class="text-link" href="/portal">All organizations</a></p></nav>`;
};

export function loginPage({ continueHref, ended = false }) {
  const notice = ended ? `<p class="muted">Your previous session has ended. Please sign in again.</p>` : "";
  return htmlPage({
    title: "Sign in",
    bodyHtml: `${notice}<p class="lead">Sign in with the email address your invitation was sent to.</p><p><a class="btn btn--primary" href="${e(continueHref)}">Continue</a></p>`,
  });
}

export const signedOutPage = () => htmlPage({ title: "You’re signed out", bodyHtml: `<p class="lead">You have been signed out.</p><p><a class="btn btn--primary" href="/portal/login">Sign in again</a></p>` });

export async function noAccessPage(ctx, session) {
  return shell(ctx, session, {
    title: "No access yet",
    status: 403,
    body: `<p class="lead">Your sign-in worked, but this account isn’t connected to a Framework organization.</p><p>Access is by invitation. If you were expecting access, ask your Framework contact to send an invitation to <strong>${e(session.email)}</strong>.</p>`,
  });
}

export async function pickerPage(ctx, session, memberships) {
  const items = memberships.map((m) => `<li><a class="text-link" href="/portal/o/${e(m.slug)}">${e(m.name)}</a> <span class="muted">(${e(m.role)})</span></li>`).join("");
  return shell(ctx, session, { title: "Choose an organization", body: `<ul>${items}</ul>` });
}

export async function overviewPage(ctx, { session, membership: m }, { projects, activity }) {
  const site = safeHttps(m.websiteUrl);
  const plist = projects.length
    ? `<ul>${projects.map((p) => `<li><a class="text-link" href="/portal/o/${e(m.slug)}/projects/${e(p.id)}">${e(p.name)}</a> <span class="muted">${e(humanize(p.status))}</span></li>`).join("")}</ul>`
    : `<p class="muted">No projects yet.</p>`;
  const alist = activity.length ? `<ul>${activity.map((a) => `<li>${e(humanize(a.action))} <span class="muted">${e(day(a.created_at))}</span></li>`).join("")}</ul>` : `<p class="muted">Nothing to show yet.</p>`;
  return shell(ctx, session, {
    title: m.name,
    nav: orgNav(m),
    body: `<p class="muted">Your role: ${e(m.role)}${site ? ` · <a class="text-link" href="${e(site)}" rel="noopener noreferrer">${e(site)}</a>` : ""}</p><h2 class="h3">Projects</h2>${plist}<h2 class="h3">Recent activity</h2>${alist}`,
  });
}

export async function projectsPage(ctx, { session, membership: m }, projects) {
  const list = projects.length ? `<ul>${projects.map((p) => `<li><a class="text-link" href="/portal/o/${e(m.slug)}/projects/${e(p.id)}">${e(p.name)}</a> <span class="muted">${e(humanize(p.status))}</span></li>`).join("")}</ul>` : `<p class="muted">No projects yet.</p>`;
  return shell(ctx, session, { title: "Projects", nav: orgNav(m), body: list });
}

export async function projectPage(ctx, { session, membership: m }, p) {
  const live = safeHttps(p.live_url);
  return shell(ctx, session, {
    title: p.name,
    nav: orgNav(m),
    body: `<p class="muted">${e(humanize(p.kind))} · ${e(humanize(p.status))}${live ? ` · <a class="text-link" href="${e(live)}" rel="noopener noreferrer">${e(live)}</a>` : ""}</p>${p.summary ? `<p>${e(p.summary)}</p>` : ""}`,
  });
}

export async function activityPage(ctx, { session, membership: m }, activity) {
  const list = activity.length ? `<ul>${activity.map((a) => `<li>${e(humanize(a.action))} <span class="muted">${e(day(a.created_at))}</span></li>`).join("")}</ul>` : `<p class="muted">Nothing to show yet.</p>`;
  return shell(ctx, session, { title: "Activity", nav: orgNav(m), body: list });
}

export async function membersPage(ctx, { session, membership: m }, members) {
  const list = `<ul>${members.map((u) => `<li>${e(u.name || u.email)} <span class="muted">${e(u.email)} · ${e(u.role)}</span></li>`).join("")}</ul>`;
  return shell(ctx, session, { title: "Team", nav: orgNav(m), body: list });
}
