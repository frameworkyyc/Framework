/* Framework Admin — module registry.
   The shell (admin.js) builds the sidebar and the router from this list and nothing else.
   To add a module: create admin/assets/<name>.js exporting `render(ctx)`, add an entry below with enabled: true,
   and add its API handler in worker/admin/router.js. Entries with enabled: false appear as "Later" and do nothing. */

export const MODULES = [
  { id: "overview", label: "Overview", path: "/admin", enabled: true, load: () => import("./overview.js") },
  { id: "feedback", label: "Feedback", path: "/admin/feedback", enabled: true, load: () => import("./feedback.js") },

  { id: "clients", label: "Clients", path: "/admin/clients", enabled: false },
  { id: "projects", label: "Projects", path: "/admin/projects", enabled: false },
  { id: "testimonials", label: "Testimonials", path: "/admin/testimonials", enabled: false },
  { id: "files", label: "Files", path: "/admin/files", enabled: false },
  { id: "changes", label: "Change requests", path: "/admin/change-requests", enabled: false },
  { id: "leads", label: "Leads", path: "/admin/leads", enabled: false },
  { id: "settings", label: "Settings", path: "/admin/settings", enabled: false },
];
