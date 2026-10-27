/* Framework Admin — module registry.
   The shell (admin.js) builds the sidebar and the router from this list and nothing else.
   To add a module: create admin/assets/<name>.js exporting `render(ctx)`, add an entry below with enabled: true,
   and add its API handler in worker/admin/router.js. Entries with enabled: false appear as "Later" and do nothing. */

export const MODULES = [
  { id: "overview", label: "Overview", path: "/admin", enabled: true, load: () => import("./overview.js") },
  { id: "feedback", label: "Client Feedback", path: "/admin/feedback", enabled: true, load: () => import("./feedback.js") },
  { id: "portal-feedback", label: "Portal Feedback", path: "/admin/portal-feedback", enabled: true, load: () => import("./portal-feedback.js") },
  { id: "support", label: "Support Requests", path: "/admin/support", enabled: true, load: () => import("./support-global.js") },
  { id: "assessments", label: "Assessments", path: "/admin/assessments", enabled: true, load: () => import("./assessments.js") },

  { id: "clients", label: "Clients", path: "/admin/clients", enabled: true, load: () => import("./clients.js") },
  { id: "approved-emails", label: "Approved Emails", path: "/admin/approved-emails", enabled: true, load: () => import("./approved-emails.js") },
  { id: "projects", label: "Projects", path: "/admin/projects", enabled: false },
  { id: "files", label: "Files", path: "/admin/files", enabled: false },
  { id: "changes", label: "Change requests", path: "/admin/change-requests", enabled: false },
  { id: "leads", label: "Leads", path: "/admin/leads", enabled: false },
  { id: "settings", label: "Settings", path: "/admin/settings", enabled: false },
];
