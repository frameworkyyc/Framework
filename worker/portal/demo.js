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

export const DEMO_BASE = "/portal/demo";
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
  const page = (active, title, body) => appPage({ title: `${title} (demo)`, bodyHtml: body, nav: { base: DEMO_BASE, active }, who: { org: vm.org.name, user: vm.user.name }, actions: ACTIONS, banner: BANNER });

  if (parts.length === 0) return page("dashboard", "Dashboard", views.dashboard(vm));
  if (parts[0] === "projects" && parts.length === 1) return page("projects", "Projects", views.projects(vm));
  if (parts[0] === "projects" && parts.length === 2) {
    const p = vm.projects.find((x) => x.id === parts[1]);
    return p ? page("projects", p.name, views.project(vm, p)) : errorPage(404, { ref: ctx.ref });
  }
  if (parts[0] === "projects" && parts.length === 4 && parts[2] === "deliverables") {
    const p = vm.projects.find((x) => x.id === parts[1]);
    const d = p && (p.deliverables || []).find((x) => x.id === parts[3]);
    return d ? page("projects", `${d.name}: ${p.name}`, views.deliverable(vm, p, d)) : errorPage(404, { ref: ctx.ref });
  }
  if (parts[0] === "activity" && parts.length === 1) return page("activity", "Activity", views.activity(vm, filters));
  if (parts[0] === "documents" && parts.length === 1) return page("documents", "Documents", views.documents(vm, filters));
  if (parts[0] === "account" && parts.length === 1) return page("account", "Account", views.account(vm));
  return errorPage(404, { ref: ctx.ref });
}
export { e };
