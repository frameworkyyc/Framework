/* Framework Admin: the six navigation sections and which section each address belongs to (pure data, no DOM, so tests and the search can import it). Operations and Settings group the older
   pages without changing their addresses. */

export const clean = (p) => p.replace(/\/+$/, "") || "/";

export const NAV = [
  { id: "overview", label: "Overview", path: "/admin", icon: "overview" },
  { id: "clients", label: "Clients", path: "/admin/clients", icon: "clients" },
  { id: "websites", label: "Websites", path: "/admin/websites", icon: "websites" },
  { id: "analytics", label: "Analytics", path: "/admin/analytics", icon: "analytics" },
  { id: "operations", label: "Operations", path: "/admin/operations", icon: "operations", children: [
    ["Overview", "/admin/operations"], ["Leads", "/admin/leads"], ["Enquiries", "/admin/assessments"], ["Brand Discovery", "/admin/discovery"], ["Requests", "/admin/requests"], ["Support", "/admin/support"], ["Invoices", "/admin/operations/invoices"], ["Feedback", "/admin/feedback"],
  ] },
  { id: "settings", label: "Settings", path: "/admin/settings", icon: "settings", children: [
    ["Overview", "/admin/settings"], ["Approved emails", "/admin/approved-emails"], ["Additional services", "/admin/settings/additional-services"], ["Service pricing", "/admin/settings/service-pricing"],
  ] },
];
const SECTION_PREFIXES = [["operations", ["/admin/operations", "/admin/leads", "/admin/assessments", "/admin/discovery", "/admin/requests", "/admin/support", "/admin/feedback", "/admin/portal-feedback", "/admin/demo-traffic"]], ["settings", ["/admin/settings", "/admin/approved-emails"]], ["clients", ["/admin/clients"]], ["websites", ["/admin/websites"]], ["analytics", ["/admin/analytics"]]];
export function sectionOf(pathname) {
  const path = clean(pathname);
  for (const [id, prefixes] of SECTION_PREFIXES) if (prefixes.some((x) => path === x || path.startsWith(x + "/"))) return NAV.find((n) => n.id === id);
  return path === "/admin" ? NAV[0] : null;
}


