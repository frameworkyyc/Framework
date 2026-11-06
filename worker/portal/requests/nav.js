/**
 * The signed-in navigation when the request area is on (PORTAL_REQUESTS): one list for the whole portal, and which entry a path belongs to. Pure.
 *   Home · Websites · Branding · Deliverables · SEO · Custom Development · My Requests · Support · Invoices · Settings
 * Support and Invoices exist only where Client Services is on (PORTAL_SERVICES), and Invoices only for owners, exactly as their pages are. Nothing is shown that cannot be opened.
 */
import { servicesEnabled } from "../config.js";
import { can } from "../policy.js";

export function requestsNav(env, role) {
  const services = servicesEnabled(env);
  return [
    { key: "home", label: "Home", path: "" },
    { key: "website", label: "Websites", path: "/website" },
    { key: "branding", label: "Branding", path: "/branding" },
    { key: "deliverables", label: "Deliverables", path: "/deliverables" },
    { key: "seo", label: "SEO", path: "/seo" },
    { key: "development", label: "Custom Development", path: "/development" },
    { key: "requests", label: "My Requests", path: "/requests" },
    ...(services ? [{ key: "support", label: "Support", path: "/services/requests" }] : []),
    ...(services && can(role, "invoices.view") ? [{ key: "invoices", label: "Invoices", path: "/services/invoices" }] : []),
    { key: "settings", label: "Settings", path: "/account" },
  ];
}

/** The navigation entry a path belongs to. `rest` is the path after /portal/o/<slug>. */
export function activeKey(rest) {
  const p = String(rest || "").split("?")[0].replace(/\/+$/, "");
  if (p === "" ) return "home";
  const first = p.split("/")[1];
  if (first === "website") return "website";
  if (first === "branding") return "branding";
  if (["deliverables", "seo", "development", "requests"].includes(first)) return first;
  if (first === "services") return p.startsWith("/services/invoices") ? "invoices" : "support";
  if (first === "account" || first === "members") return "settings";
  return "home";
}
