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
import { AREAS, PROFILE_STEPS, BRAND_PATHS, SERVICES, WORKSPACE_ROWS, SERVICE_AREAS, projectsFor } from "./guided-data.js";

export const DEMO_BASE = "/portal/demo";
const NAV = [{ key: "home", label: "Home", path: "" }, { key: "account", label: "Account", path: "/account" }];
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
  // Header navigation is Home and Account only; every other page is reached from Home through the six areas.
  const page = (active, title, body, before = "") => appPage({ title: `${title} (demo)`, bodyHtml: before + body, nav: { base: DEMO_BASE, active, list: NAV }, who: { org: vm.org.name, user: vm.user.name }, actions: ACTIONS, banner: BANNER });
  const notFound = () => errorPage(404, { ref: ctx.ref });
  const areaTitle = (key) => AREAS.find((x) => x.key === key).title;
  /** A project opened from a service workspace keeps that service in its links and breadcrumbs; the direct URL has a neutral trail. */
  const inService = (key, p) => ({ ...vm, projectBase: `${DEMO_BASE}/${key}/projects`, crumbs: [["Home", DEMO_BASE], [areaTitle(key), `${DEMO_BASE}/${key}`], ["Projects", `${DEMO_BASE}/${key}/projects`]], partOf: guided.partOf(vm, p) });
  const direct = (p) => ({ ...vm, crumbs: [["Home", DEMO_BASE], ["Files & Deliverables", `${DEMO_BASE}/files`], ["Projects", `${DEMO_BASE}/projects`]], partOf: guided.partOf(vm, p) });
  const filesTrail = (label) => `<p class="crumb"><a href="${DEMO_BASE}">Home</a> / <a href="${DEMO_BASE}/files">Files &amp; Deliverables</a> / ${e(label)}</p>`;

  if (parts.length === 0) return page("home", "Home", guided.home(vm));
  const area = parts[0];
  const from = SERVICES.find((x) => x.id === filters.from) || null; // the service request a questionnaire was opened from, if any

  if (SERVICE_AREAS.includes(area) && parts[1] === "projects") {
    if (parts.length === 2) return page("home", `${areaTitle(area)}: projects`, guided.projectsPage(vm, area));
    const p = vm.projects.find((x) => x.id === parts[2]);
    if (!p || !projectsFor([p], area).length) return notFound();
    const svm = inService(area, p);
    if (parts.length === 3) return page("home", p.name, views.project(svm, p));
    const d = parts.length === 5 && parts[3] === "deliverables" ? (p.deliverables || []).find((x) => x.id === parts[4]) : null;
    return d ? page("home", `${d.name}: ${p.name}`, views.deliverable(svm, p, d)) : notFound();
  }
  if (SERVICE_AREAS.includes(area) && parts[1] === "requests" && parts.length === 2) return page("home", `${areaTitle(area)}: request a service`, guided.requestsPage(vm, area));
  if (area === "profile" && parts.length === 1) return page("home", "Business Profile", guided.profile(vm));
  if (area === "profile" && parts.length === 2) { const s = PROFILE_STEPS.find((x) => x.id === parts[1]); return s ? page("home", `${s.title}: Business Profile`, guided.profileStep(vm, s, from)) : notFound(); }
  if (area === "branding" && parts.length === 1) return page("home", "Branding", guided.brandingOverview(vm));
  if (area === "branding" && parts.length === 2) {
    if (parts[1] === "discovery") return page("home", "Brand discovery", guided.brandDiscovery(vm, from));
    return BRAND_PATHS.some((x) => x.id === parts[1]) ? page("home", "Branding", guided.branding(vm, parts[1], from)) : notFound();
  }
  if ((area === "website" || area === "marketing" || area === "content") && parts.length === 1) return page("home", areaTitle(area), guided.workspace(vm, area));
  if ((area === "website" || area === "marketing" || area === "content") && parts.length === 2) { const row = WORKSPACE_ROWS[area].find((x) => x.id === parts[1]); return row ? page("home", `${row.title}: ${areaTitle(area)}`, guided.workspaceRow(vm, area, row, from)) : notFound(); }
  if (area === "files" && parts.length === 1) return page("home", "Files and deliverables", guided.filesOverview(vm));
  if (area === "files" && parts.length === 2) { const f = { review: guided.filesReview, completed: guided.filesCompleted, projects: guided.filesProjects, history: guided.filesHistory }[parts[1]]; return Object.hasOwn({ review: 1, completed: 1, projects: 1, history: 1 }, parts[1]) && f ? page("home", "Files and deliverables", f(vm)) : notFound(); }
  if (area === "requests" && parts.length === 2) { const s = SERVICES.find((x) => x.id === parts[1]); return s ? page("home", `${s.title}: service request`, guided.request(vm, s)) : notFound(); }

  // Existing project pages: unchanged URLs, reached from the service workspaces and from Files & Deliverables.
  if (area === "progress" && parts.length === 1) return page("home", "Progress and activity", views.dashboard(vm), filesTrail("Progress"));
  if (area === "projects" && parts.length === 1) return page("home", "Projects", views.projects(vm), filesTrail("Projects"));
  if (area === "projects" && parts.length === 2) { const p = vm.projects.find((x) => x.id === parts[1]); return p ? page("home", p.name, views.project(direct(p), p)) : notFound(); }
  if (area === "projects" && parts.length === 4 && parts[2] === "deliverables") {
    const p = vm.projects.find((x) => x.id === parts[1]);
    const d = p && (p.deliverables || []).find((x) => x.id === parts[3]);
    return d ? page("home", `${d.name}: ${p.name}`, views.deliverable(direct(p), p, d)) : notFound();
  }
  if (area === "activity" && parts.length === 1) return page("home", "Activity", views.activity(vm, filters), filesTrail("Activity"));
  if (area === "documents" && parts.length === 1) return page("home", "Documents", views.documents(vm, filters), filesTrail("Documents"));
  if (area === "account" && parts.length === 1) return page("account", "Account", views.account(vm));
  return notFound();
}
export { e };
