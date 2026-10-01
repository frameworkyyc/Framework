/* Framework Admin — Feedback module: /admin/feedback (list) and /admin/feedback/:id (response). */

import { h, api, ApiError, fmtDate, fmtDateTime, shortRef, clientName, permissionShort, rating5, score, meter10, stateBlock, confirmDialog } from "./ui.js";

const RATING_LABELS = [
  ["rating_visual_design", "Visual design"],
  ["rating_ease_of_use", "Ease of use"],
  ["rating_mobile_experience", "Mobile experience"],
  ["rating_accuracy", "Accurately represents the business"],
  ["rating_professionalism", "Professionalism and credibility"],
  ["rating_communication", "Communication during the project"],
  ["rating_overall_product", "Overall finished product"],
];

/* ---------- Shared pieces (the overview imports these too) ---------- */

/** "Needs attention": a low score anywhere, or the new site rated worse than before. */
export function needsAttention(r) {
  const ratings = RATING_LABELS.map(([k]) => r[k]).filter((n) => typeof n === "number");
  return r.satisfaction <= 6 || r.recommend <= 6 || (ratings.length > 0 && Math.min(...ratings) <= 2) || r.improvement === "Worse";
}
export const NEEDS_ATTENTION_HINT = "Satisfaction or recommendation of 6 or below, any rating of 2 or below, or the site rated “Worse” than before.";

const clientCell = (r) => {
  const name = clientName(r);
  const sub = r.attribution_business && r.attribution_name ? r.attribution_name + " · " : "";
  return h("td", { "data-label": "Client" },
    h("span", { class: "adm-client" + (name ? "" : " adm-client--none") }, name || "Business not provided"),
    h("span", { class: "adm-client__sub" }, sub + "Ref " + shortRef(r.id)),
    "reviewed_at" in r ? h("span", { class: "adm-status-mark " + (r.reviewed_at ? "is-reviewed" : "is-unreviewed") }, r.reviewed_at ? "Reviewed" : "Unreviewed") : null,
  );
};

const COLUMNS = {
  client: { label: "Client", cell: clientCell },
  date: { label: "Submitted", cell: (r) => h("td", { "data-label": "Submitted" }, fmtDate(r.created_at)) },
  satisfaction: { label: "Satisfaction", cell: (r) => h("td", { "data-label": "Satisfaction" }, score(r.satisfaction)) },
  recommend: { label: "Recommend", cell: (r) => h("td", { "data-label": "Recommend" }, score(r.recommend)) },
  improvement: { label: "Improvement", cell: (r) => h("td", { "data-label": "Improvement" }, r.improvement) },
  testimonial: { label: "Testimonial", cell: (r) => h("td", { "data-label": "Testimonial" }, permissionShort(r.testimonial_permission)) },
  logo: { label: "Portfolio", cell: (r) => h("td", { "data-label": "Portfolio" }, r.logo_permission) },
  revenue: { label: "Revenue", cell: (r) => h("td", { "data-label": "Revenue" }, r.revenue ? r.revenue : h("span", { class: "adm-muted" }, "Not answered")) },
  view: {
    label: "",
    cell: (r) => h("td", { "data-label": "" }, h("a", { class: "adm-link", href: "/admin/feedback/" + encodeURIComponent(r.id), "data-link": "", "aria-label": "View response from " + (clientName(r) || "Ref " + shortRef(r.id)) }, "View response →")),
  },
};

export function responseTable(rows, keys) {
  const cols = keys.map((k) => COLUMNS[k]);
  return h("table", { class: "adm-table" },
    h("thead", null, h("tr", null, cols.map((c) => h("th", { scope: "col" }, c.label || h("span", { class: "visually-hidden" }, "Actions")))))
    , h("tbody", null, rows.map((r) => h("tr", null, cols.map((c) => c.cell(r))))));
}

const emptyFeedback = () =>
  stateBlock({ title: "No feedback yet", body: "Responses appear here after a client completes the feedback form." });

/* ---------- Router ---------- */

export async function render(ctx) {
  const m = ctx.url.pathname.replace(/\/+$/, "").match(/^\/admin\/feedback\/([^/]+)$/);
  return m ? renderDetail(ctx, decodeURIComponent(m[1])) : renderList(ctx);
}

/* ---------- List ---------- */

const FILTERS = [
  { id: "all", label: "All", test: () => true },
  { id: "testimonial", label: "Testimonial permission", test: (r) => /^Yes/.test(r.testimonial_permission || "") },
  { id: "logo", label: "Portfolio permission", test: (r) => r.logo_permission === "Yes" },
  { id: "high", label: "High satisfaction", test: (r) => r.satisfaction >= 9 },
  { id: "attention", label: "Needs attention", test: needsAttention },
  { id: "unreviewed", label: "Unreviewed", test: (r) => !r.reviewed_at, needsReviewed: true },
];

async function renderList(ctx) {
  const data = await api("/feedback");
  const rows = data.responses;
  const filters = FILTERS.filter((f) => !f.needsReviewed || data.reviewed_supported);
  let active = filters.find((f) => f.id === ctx.url.searchParams.get("filter")) || filters[0];

  const results = h("div", { id: "adm-results" });
  const note = h("p", { class: "adm-filter-note", hidden: true });
  const bar = h("div", { class: "adm-filters", role: "group", "aria-label": "Filter responses" });

  const paint = () => {
    const shown = rows.filter(active.test);
    bar.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === active.id)));
    note.hidden = active.id !== "attention";
    note.textContent = NEEDS_ATTENTION_HINT;
    const keys = ["client", "date", "satisfaction", "recommend", "improvement", "testimonial", "logo", "revenue", "view"];
    results.replaceChildren(
      shown.length
        ? responseTable(shown, keys)
        : rows.length
          ? stateBlock({ title: "No matching responses", body: "No feedback matches this filter." })
          : emptyFeedback(),
      h("p", { class: "adm-sub", role: "status" }, `Showing ${shown.length} of ${data.total} ${data.total === 1 ? "response" : "responses"}.` + (data.truncated ? " Only the newest 1,000 are listed; the CSV export includes everything." : "")),
    );
  };

  filters.forEach((f) => {
    bar.append(h("button", { class: "adm-filter", type: "button", "data-filter": f.id, "aria-pressed": "false", onclick: () => {
      active = f;
      const u = new URL(location.href);
      if (f.id === "all") u.searchParams.delete("filter"); else u.searchParams.set("filter", f.id);
      history.replaceState(null, "", u.pathname + u.search);
      paint();
    } }, f.label, h("span", { class: "adm-filter__count" }, String(rows.filter(f.test).length))));
  });
  paint();

  const node = h("div", { class: "adm-page" },
    h("div", { class: "adm-head" },
      h("div", null, h("span", { class: "eyebrow" }, "Framework Admin"), h("h1", { class: "adm-title", tabindex: "-1" }, "Feedback"),
        h("p", { class: "adm-sub" }, "Responses from the client feedback form, newest first.")),
      h("div", { class: "adm-actions" }, h("a", { class: "btn btn--secondary", href: "/api/admin/feedback/export", download: "" }, "Export CSV")),
    ),
    data.reviewed_supported ? null : h("p", { class: "adm-banner" }, "Reviewed tracking is off. Apply migrations/0002_add_reviewed_at.sql in the D1 console to enable it."),
    rows.length ? bar : null,
    note,
    results,
  );
  return { title: "Feedback", node };
}

/* ---------- Detail ---------- */

const section = (title, ...body) => h("section", { class: "adm-section", "aria-label": title }, h("div", { class: "adm-section-title" }, h("h2", { text: title })), body);
const spec = (rows, cls = "") => h("dl", { class: "adm-spec " + cls }, rows.filter(Boolean).map(([k, v, wide]) => h("div", null, h("dt", { text: k }), h("dd", { class: wide ? "adm-wide" : "" }, v))));
const list = (items) => h("ul", { class: "adm-list adm-list--plain" }, items.map((i) => h("li", { text: i })));
const splitList = (value) => String(value || "").split("; ").map((s) => s.trim()).filter(Boolean);
/** "Other" becomes "Other — what they wrote" instead of a bare label plus a second block. */
const withOther = (items, text) => items.map((i) => (i === "Other" && typeof text === "string" && text.trim() ? "Other — " + text.trim() : i));
const has = (v) => typeof v === "string" && v.trim() !== "";

async function renderDetail(ctx, id) {
  const data = await api("/feedback/" + encodeURIComponent(id));
  let r = data.response;
  const supported = data.reviewed_supported;
  const name = clientName(r);
  const heading = name || "Feedback response";

  const statusLine = h("p", { class: "adm-sub" });
  const reviewBtn = supported ? h("button", { class: "btn btn--secondary", type: "button" }) : null;
  const paintStatus = () => {
    const parts = [`Submitted ${fmtDateTime(r.created_at)} · Ref ${shortRef(r.id)}`];
    if (supported) parts.push(h("span", { class: "adm-status-mark " + (r.reviewed_at ? "is-reviewed" : "is-unreviewed") }, r.reviewed_at ? "Reviewed " + fmtDate(r.reviewed_at) : "Unreviewed"));
    statusLine.replaceChildren(...parts);
    if (reviewBtn) reviewBtn.textContent = r.reviewed_at ? "Mark as unreviewed" : "Mark as reviewed";
  };
  paintStatus();

  if (reviewBtn) {
    reviewBtn.addEventListener("click", async () => {
      reviewBtn.disabled = true;
      try {
        const out = await api("/feedback/" + encodeURIComponent(id), { method: "PATCH", body: { reviewed: !r.reviewed_at } });
        r = { ...r, reviewed_at: out.reviewed_at };
        paintStatus();
      } catch (err) {
        ctx.notify(err instanceof ApiError && err.code === "reviewed_unavailable" ? "Reviewed tracking isn’t enabled yet." : "Couldn’t update the status. Nothing was changed.");
      }
      reviewBtn.disabled = false;
    });
  }

  const del = h("button", { class: "btn btn--secondary", type: "button", onclick: async () => {
    const ok = await confirmDialog({
      title: "Delete this response?",
      body: "This permanently removes the response from the database. It can’t be undone. Export it first if you may need it.",
      details: [["Client", name || "Business not provided"], ["Submitted", fmtDateTime(r.created_at)], ["Satisfaction", r.satisfaction + " / 10"], ["Ref", r.id]],
      confirmLabel: "Delete response",
    });
    if (!ok) return;
    del.disabled = true;
    try {
      await api("/feedback/" + encodeURIComponent(id), { method: "DELETE" });
      ctx.navigate("/admin/feedback");
      ctx.notify("Response deleted.");
    } catch (err) {
      del.disabled = false;
      ctx.notify(err instanceof ApiError && err.code === "not_found" ? "That response was already deleted." : "Couldn’t delete the response. Nothing was changed.");
    }
  } }, "Delete response");

  const impact = splitList(r.impact);
  const services = splitList(r.services);
  const hasTestimonialBlock = has(r.testimonial) || r.testimonial_permission;
  const attribution = [r.attribution_name, r.attribution_title, r.attribution_business].filter(has);

  const node = h("div", { class: "adm-page" },
    h("a", { class: "adm-back", href: "/admin/feedback", "data-link": "" }, "← All feedback"),
    h("div", { class: "adm-head" },
      h("div", null, h("span", { class: "eyebrow" }, "Client feedback"), h("h1", { class: "adm-title", tabindex: "-1" }, heading), statusLine),
      h("div", { class: "adm-actions" },
        reviewBtn,
        h("a", { class: "btn btn--secondary", href: "/api/admin/feedback/" + encodeURIComponent(id) + "/export", download: "" }, "Export CSV"),
        h("button", { class: "btn btn--secondary", type: "button", onclick: () => window.print() }, "Print"),
        del,
      ),
    ),

    h("div", { class: "adm-section" }, h("div", { class: "adm-scores" },
      h("div", { class: "adm-score" }, h("p", { class: "adm-metric__label" }, "Overall satisfaction"), h("div", { class: "adm-score__value" }, String(r.satisfaction), h("span", { class: "adm-score__max" }, "/ 10")), meter10(r.satisfaction)),
      h("div", { class: "adm-score" }, h("p", { class: "adm-metric__label" }, "Would recommend"), h("div", { class: "adm-score__value" }, String(r.recommend), h("span", { class: "adm-score__max" }, "/ 10")), meter10(r.recommend)),
    )),

    section("Experience", spec(RATING_LABELS.map(([k, label]) => [label, rating5(r[k])]))),
    section("Improvement", spec([["Compared with previous website", r.improvement]])),
    section("Business impact", impact.length ? list(withOther(impact, r.impact_other)) : null),
    section("Value", spec([["Fair price at market rates", r.fair_price], ["Annual revenue", has(r.revenue) ? r.revenue : h("span", { class: "adm-muted" }, "Not answered")]])),

    section("Written feedback", spec([["What they like most", r.liked, true], has(r.could_improve) ? ["What could be better", r.could_improve, true] : null], "adm-spec--text")),

    hasTestimonialBlock ? section("Testimonial",
      has(r.testimonial) ? h("blockquote", { class: "adm-quote", text: r.testimonial }) : null,
      spec([["Permission to use", r.testimonial_permission], attribution.length ? ["Attribution", attribution.join(" · ")] : null])) : null,

    section("Portfolio permission", spec([["Display name and logo as a client", r.logo_permission]])),
    section("Future services", services.length ? list(withOther(services, r.services_other)) : null),
    has(r.comments) ? section("Additional comments", spec([["Comments", r.comments, true]], "adm-spec--text")) : null,
  );
  return { title: heading, node };
}
