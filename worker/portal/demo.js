/**
 * The static demonstration portal at /portal/demo. A visual preview of the finished product for a FICTIONAL client, built from
 * worker/portal/demo-data.js only. It never touches the database, a session, a cookie or any real client information, writes nothing, and
 * is served only where config.demoEnabled says so (Staging; never a production host, whatever the variables say). Every page carries a
 * demonstration banner, and file downloads, settings and the like are visibly inert.
 */
import { appPage, e } from "./ui.js";
import { errorPage } from "./http.js";
import { demoViewModel } from "./demo-data.js";
import { viewFilters } from "./filters.js";
import * as views from "./views.js";
import * as guided from "./guided.js";
import { PROFILE_STEPS, BRAND_PATHS, SERVICES, WORKSPACES } from "./guided-data.js";

export const DEMO_BASE = "/portal/demo";
const NAV = [{ key: "home", label: "Home", path: "" }, { key: "projects", label: "Projects", path: "/projects" }, { key: "account", label: "Account", path: "/account" }];
export const isDemoPath = (p) => p === DEMO_BASE || p.startsWith(DEMO_BASE + "/");

const BANNER = `<div class="demo-banner" role="note"><div class="wrap"><span><strong>Demo mode</strong> · Fictional client data</span><a href="/portal/login">Go to sign-in</a></div></div>`;
const ACTIONS = `<a class="btn btn--small" href="/portal/login">Sign in</a>`;

/** @param ctx {request, now, ref}  @param path the normalized request path */
export function handleDemo(ctx, path) {
  if (ctx.request.method !== "GET" && ctx.request.method !== "HEAD") return errorPage(405, { ref: ctx.ref, headers: { Allow: "GET, HEAD" } });
  const vm = { mode: "demo", base: DEMO_BASE, now: ctx.now, ...demoViewModel(ctx.now) };
  const rest = path.slice(DEMO_BASE.length).replace(/^\/+/, "");
  const parts = rest ? rest.split("/") : [];
  const filters = viewFilters(ctx.url);
  const SUB = { progress: "progress", projects: "projects", activity: "activity", documents: "documents" };
  const page = (active, title, body, sub) => appPage({ title: `${title} (demo)`, bodyHtml: (sub ? guided.projectNav(vm, sub) : "") + body, nav: { base: DEMO_BASE, active: sub ? "projects" : active, list: NAV }, who: { org: vm.org.name, user: vm.user.name }, actions: ACTIONS, banner: BANNER });

  if (parts.length === 0) return page("home", "Home", guided.home(vm));
  if (parts[0] === "progress" && parts.length === 1) return page("progress", "Progress and activity", views.dashboard(vm), "progress");
  const area = parts[0];
  if (area === "profile" && parts.length === 1) return page("home", "Business Profile", guided.profile(vm));
  if (area === "profile" && parts.length === 2) { const s = PROFILE_STEPS.find((x) => x.id === parts[1]); return s ? page("home", `${s.title}: Business Profile`, guided.profileStep(vm, s)) : errorPage(404, { ref: ctx.ref }); }
  if (area === "branding" && parts.length <= 2) { const sel = parts[1]; if (sel && !BRAND_PATHS.some((x) => x.id === sel)) return errorPage(404, { ref: ctx.ref }); return page("home", "Branding", guided.branding(vm, sel)); }
  if ((area === "website" || area === "marketing" || area === "content") && parts.length === 1 && WORKSPACES[area]) return page("home", WORKSPACES[area].title, guided.workspace(vm, area));
  if (area === "files" && parts.length === 1) return page("home", "Files and deliverables", guided.files(vm));
  if (area === "requests" && parts.length === 2) { const s = SERVICES.find((x) => x.id === parts[1]); return s ? page("home", `${s.title}: service request`, guided.request(vm, s)) : errorPage(404, { ref: ctx.ref }); }
  if (parts[0] === "projects" && parts.length === 1) return page("projects", "Projects", views.projects(vm), "projects");
  if (parts[0] === "projects" && parts.length === 2) {
    const p = vm.projects.find((x) => x.id === parts[1]);
    return p ? page("projects", p.name, views.project(vm, p), "projects") : errorPage(404, { ref: ctx.ref });
  }
  if (parts[0] === "projects" && parts.length === 4 && parts[2] === "deliverables") {
    const p = vm.projects.find((x) => x.id === parts[1]);
    const d = p && (p.deliverables || []).find((x) => x.id === parts[3]);
    return d ? page("projects", `${d.name}: ${p.name}`, views.deliverable(vm, p, d), "projects") : errorPage(404, { ref: ctx.ref });
  }
  if (parts[0] === "activity" && parts.length === 1) return page("activity", "Activity", views.activity(vm, filters), "activity");
  if (parts[0] === "documents" && parts.length === 1) return page("documents", "Documents", views.documents(vm, filters), "documents");
  if (parts[0] === "account" && parts.length === 1) return page("account", "Account", views.account(vm));
  return errorPage(404, { ref: ctx.ref });
}
export { e };
