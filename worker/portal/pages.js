/**
 * Server-rendered pages for the signed-in portal. No client-side script, no inline style. Every dynamic value is escaped (in ui.js / views.js);
 * org and project text comes from the database but is still treated as untrusted. Pages receive only data the tenant guard already scoped;
 * they never read the request. Sections that have no backend yet are rendered as an honest "not connected yet" block by views.js.
 */
import { htmlPage, escapeHtml as e } from "./http.js";
import { csrfFor } from "./sessions.js";
import { permissionsFor } from "./policy.js";
import { appPage } from "./ui.js";
import * as views from "./views.js";
import * as guided from "./guided.js";
import * as live from "./profile-live.js";
import { LIVE_AREAS } from "./guided-data.js";

/** The one portal script: tidies website fields and warns about unsaved Business Profile changes, and moves keyboard focus to a form's error summary after a refused save. Loaded only where it has a job. */
const FOCUS_SCRIPT = "/assets/js/portal-profile.js";
const OFF = Object.freeze({ progress: false, milestones: false, deliverables: false, documents: false, updates: false, actions: false, settings: false });

async function signOutForm(ctx, session) {
  const token = await csrfFor(ctx.cfg, session);
  return `<form method="post" action="/portal/logout" class="signout"><input type="hidden" name="csrf" value="${e(token)}"><button class="btn" type="submit">Sign out</button></form>`;
}

/** The view-model of the connected portal: only what the database holds for the member's own organization. */
function liveModel(ctx, { session, membership: m, returning }, data = {}) {
  const projects = (data.projects || []).map((p) => ({ id: p.id, name: p.name, kind: p.kind, status: p.status, summary: p.summary || "", liveUrl: p.live_url, updatedAt: p.updated_at }));
  const activity = (data.activity || []).map((a) => {
    let detail = "";
    try {
      const d = a.detail ? JSON.parse(a.detail) : null;
      const text = d && typeof d === "object" ? d.summary || d.message : null;
      if (typeof text === "string" && text.length <= 300) detail = text;
    } catch { /* detail is optional, free-form JSON: ignore anything that is not our shape */ }
    return { type: views.activityType(a.action), title: views.actionTitle(a.action), detail, at: a.created_at, projectId: a.entity_type === "project" ? a.entity_id : undefined };
  });
  return {
    mode: "live", base: `/portal/o/${m.slug}`, now: ctx.now, liveAreas: LIVE_AREAS, returning: Boolean(returning),
    org: { name: m.name, website: m.websiteUrl, role: m.role },
    user: { name: session.name || "", email: session.email },
    projects, activity, updates: [], actions: [], documents: [], team: data.team || [], has: OFF,
  };
}

async function shell(ctx, a, { title, active, body, status = 200, vm, script = null, ref = null }) {
  const { session, membership: m } = a;
  // Header navigation of the connected portal: Home and Account (and Team for owners). Every other page is reached from Home.
  const list = [{ key: "home", label: "Home", path: "" }, { key: "account", label: "Account", path: "/account" }, ...(permissionsFor(m.role).includes("members.view") ? [{ key: "team", label: "Team", path: "/members" }] : [])];
  return appPage({ status, title, bodyHtml: body, nav: { base: vm.base, active: active === "account" || active === "team" ? active : "home", list }, who: { org: m.name, user: session.email }, actions: await signOutForm(ctx, session), script, feedbackHref: `${vm.base}/feedback${ref ? `?from=${ref}` : ""}` });
}

export function loginPage({ continueHref, ended = false, demoHref = null }) {
  const notice = ended ? `<p class="muted">Your previous session has ended. Please sign in again.</p>` : "";
  const demo = demoHref ? `<p class="auth__alt">Not signed in yet? <a class="text-link" href="${e(demoHref)}">See a demonstration of the portal</a>. It uses sample data for a fictional client.</p>` : "";
  return htmlPage({
    title: "Sign in",
    bodyHtml: `${notice}<p class="lead">Use the email address your Framework invitation was sent to. We’ll email you a one-time code.</p><p><a class="btn btn--primary" href="${e(continueHref)}">Continue</a></p><p class="auth__alt">Access is by invitation. Questions? <a class="text-link" href="mailto:hello@frameworkco.ca">hello@frameworkco.ca</a></p>${demo}`,
  });
}

export const signedOutPage = () => htmlPage({ title: "You’re signed out", bodyHtml: `<p class="lead">You have been signed out of the client portal.</p><p><a class="btn btn--primary" href="/portal/login">Sign in again</a></p>` });

export async function noAccessPage(ctx, session) {
  return htmlPage({
    status: 403,
    title: "No access yet",
    bodyHtml: `<p class="lead">Your sign-in worked, but <strong>${e(session.email)}</strong> isn’t connected to a Framework organization yet.</p><p>Access is by invitation. If you were expecting it, ask your Framework contact to send an invitation to this address.</p>${await signOutForm(ctx, session)}`,
  });
}

export async function pickerPage(ctx, session, memberships) {
  const items = memberships.map((m) => `<li><a class="row" href="/portal/o/${e(m.slug)}"><span class="row__title">${e(m.name)}</span><span class="row__meta">${e(views.roleLabel(m.role))}</span></a></li>`).join("");
  return htmlPage({ title: "Choose an organization", bodyHtml: `<p class="lead">You belong to more than one organization.</p><ul class="rows">${items}</ul><div class="auth__alt">${await signOutForm(ctx, session)}</div>` });
}

/** The home of the connected portal: the six workspace blocks. Nothing from the demonstration is shown. */
export async function homePage(ctx, a, moduleStatus = {}, nextAction = {}) {
  const vm = { ...liveModel(ctx, a, {}), moduleStatus, nextAction };
  return shell(ctx, a, { title: "Home", active: "home", body: guided.home(vm), vm, ref: "home" });
}
export async function overviewPage(ctx, a, data) {
  const vm = liveModel(ctx, a, data);
  return shell(ctx, a, { title: "Progress", active: "dashboard", body: views.dashboard(vm), vm, ref: "progress" });
}
export async function profileOverviewPage(ctx, a, saved) {
  const vm = liveModel(ctx, a, {});
  return shell(ctx, a, { title: "Business Profile", active: "home", body: live.profileOverview(vm, saved), vm, ref: "profile" });
}
/** @param o see profile-live.js profileStep; `status` is the HTTP status (422 for rejected answers, 503 when the save could not be stored) */
export async function profileStepPage(ctx, a, step, saved, o = {}) {
  const vm = liveModel(ctx, a, {});
  const csrf = await csrfFor(ctx.cfg, a.session);
  return shell(ctx, a, { title: `${step.title}: Business Profile`, active: "home", body: live.profileStep(vm, step, saved, { ...o, csrf }), vm, status: o.status || 200, script: FOCUS_SCRIPT, ref: `profile-${step.id}` });
}
export async function comingSoonPage(ctx, a, key) {
  const vm = liveModel(ctx, a, {});
  return shell(ctx, a, { title: "Coming soon", active: "home", body: live.comingSoon(vm, key), vm, ref: key });
}
export async function projectsPage(ctx, a, projects) {
  const vm = liveModel(ctx, a, { projects });
  return shell(ctx, a, { title: "Projects", active: "projects", body: views.projects(vm), vm, ref: "projects" });
}
export async function projectPage(ctx, a, p) {
  const vm = liveModel(ctx, a, { projects: [p] });
  return shell(ctx, a, { title: p.name, active: "projects", body: views.project(vm, vm.projects[0]), vm, ref: "projects" });
}
export async function activityPage(ctx, a, activity, filters = {}) {
  const vm = liveModel(ctx, a, { activity });
  return shell(ctx, a, { title: "Activity", active: "activity", body: views.activity(vm, filters), vm, ref: "activity" });
}
export async function documentsPage(ctx, a, filters = {}) {
  const vm = liveModel(ctx, a, {});
  return shell(ctx, a, { title: "Documents", active: "documents", body: views.documents(vm, filters), vm, ref: "documents" });
}
export async function accountPage(ctx, a, o = {}) {
  const vm = liveModel(ctx, a, {});
  const csrf = await csrfFor(ctx.cfg, a.session);
  // `derived`: the shown name came from the Business Profile contact (same verified email), not from the account; it is saved only if the person confirms it.
  const value = o.value !== undefined ? o.value : a.session.name || "";
  const nameForm = { action: `${vm.base}/account`, csrf, value, error: o.error || "", saved: Boolean(o.saved), suggested: Boolean(o.derived) && o.value === undefined };
  return shell(ctx, a, { title: "Account", active: "account", body: views.account(vm, { signOut: await signOutForm(ctx, a.session), nameForm }), vm, ref: "account", status: o.status, script: o.error ? FOCUS_SCRIPT : null });
}
export async function membersPage(ctx, a, members) {
  const vm = liveModel(ctx, a, { team: members.map((u) => ({ name: u.name, email: u.email, role: u.role })) });
  return shell(ctx, a, { title: "Team", active: "team", body: views.team(vm), vm, ref: "team" });
}

/** The feedback form (and its sent / error states) for the signed-in member's own organization. */
export async function feedbackPage(ctx, a, o = {}) {
  const vm = liveModel(ctx, a, {});
  const csrf = await csrfFor(ctx.cfg, a.session);
  return shell(ctx, a, { title: "Send feedback", active: "home", body: live.feedbackForm(vm, { ...o, csrf }), vm, status: o.status || 200, script: o.errors && Object.keys(o.errors).length ? FOCUS_SCRIPT : null });
}
