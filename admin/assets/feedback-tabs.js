/* Framework Admin — the two tabs of the Feedback page: client feedback (the feedback form, /admin/feedback) and portal feedback (messages from signed-in portal clients, /admin/feedback/portal). */

import { h } from "./ui.js";

export const FEEDBACK_TABS = Object.freeze([
  { id: "client", label: "Client feedback", href: "/admin/feedback" },
  { id: "portal", label: "Portal feedback", href: "/admin/feedback/portal" },
]);

export function feedbackTabs(active) {
  return h("nav", { class: "adm-tabs", "aria-label": "Feedback" },
    h("ul", null, FEEDBACK_TABS.map((t) => h("li", null, h("a", { class: "adm-tab", href: t.href, "data-link": "", "aria-current": t.id === active ? "page" : null, text: t.label })))));
}
