/* Framework Admin — module registry.
   The shell (admin.js) builds the sidebar and the router from this list and nothing else.
   To add a module: create admin/assets/<name>.js exporting `render(ctx)`, add an entry below with enabled: true,
   and add its API handler in worker/admin/router.js. An entry with enabled: false is a placeholder for a module that is not built: it is not shown in the navigation and its
   path is not routed. Files and Change requests are intentionally not listed (client files live on each client's Branding, Invoices and Support pages; change requests are Support Requests). */

export const MODULES = [
  { id: "overview", label: "Overview", path: "/admin", enabled: true, load: () => import("./overview.js") },
  { id: "feedback", label: "Feedback", path: "/admin/feedback", enabled: true, load: () => import("./feedback.js") },
  { id: "support", label: "Support Requests", path: "/admin/support", enabled: true, load: () => import("./support-global.js") },
  { id: "assessments", label: "Assessments", path: "/admin/assessments", enabled: true, load: () => import("./assessments.js") },

  { id: "clients", label: "Clients", path: "/admin/clients", enabled: true, load: () => import("./clients.js") },
  { id: "approved-emails", label: "Approved Emails", path: "/admin/approved-emails", enabled: true, load: () => import("./approved-emails.js") },
  { id: "projects", label: "Projects", path: "/admin/projects", enabled: false },
  { id: "leads", label: "Leads", path: "/admin/leads", enabled: false },
  { id: "settings", label: "Settings", path: "/admin/settings", enabled: false },
];
