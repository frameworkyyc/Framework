/* Framework Admin — Leads: ONE lead, one single-column panel (/admin/leads/<id>), answer first:
   header and next action, the action bar for its status, why they are a prospect, contacts, the pitch, demo activity, timeline, notes.
   API: GET /leads/<id> and the action endpoints in the contract. Text from the server is only ever set as text. */

import { h, api, errorState, confirmDialog, fmtDateTime, fmtDate } from "./ui.js";
import { badge, card, fold, statCard } from "./kit.js";
import { statusChip, view, SITE_WORDS, extLink, safeUrl, shortUrl, stars, errText, copyText } from "./leads-common.js";
import { pitchSection } from "./lead-pitch.js";
import { reviewScreen } from "./lead-review.js";
import { swatch, pretty, fmt, when } from "./demo-traffic.js";

const EVENT_WORD = { imported: "Found by the finder", approved: "Approved", dismissed: "Dismissed", reopened: "Reopened", draft: "Draft written", edited: "Draft edited", email_approved: "Email approved", email_unapproved: "Email unapproved",
  sent: "Email sent", test_sent: "Test email sent", delivered: "Delivered", failed: "Failed to send", bounced: "Bounced", complained: "Complaint", replied: "Replied", opted_out: "Opted out", won: "Marked won", note: "Note", contact_added: "Contact added", contact_confirmed: "Address confirmed", followup_drafted: "Follow-up drafted" };
const ELIG = { eligible: ["Eligible", "ok"], review: ["Needs your check", "warn"], blocked: ["Blocked", "bad"] };
const DAY = 86400000;
const clock = new Intl.DateTimeFormat("en-CA", { timeStyle: "short", timeZone: "America/Edmonton" });

export async function render(id, ctx) {
  const host = h("div");
  const node = h("div", { class: "adm-page ld-panel" }, host);
  const ctl = { pitch: null, flash: "" };
  let data = null;

  const back = h("a", { class: "adm-back ld-backlink", href: "/admin/leads" + (view.status ? "?status=" + view.status : ""), "data-link": "" }, "← Back to leads");

  async function load() { data = await api("/leads/" + encodeURIComponent(id)); }
  async function reload() {
    const y = window.scrollY;
    try { await load(); paint(); window.scrollTo(0, y); } catch (err) { ctx.notify(errText(err)); }
  }

  /* run an action; disable its button meanwhile; report a failure in words */
  const act = (btn, fn) => async () => {
    btn.disabled = true;
    try { await fn(); } catch (err) { btn.disabled = false; ctx.notify(errText(err)); }
  };
  const post = (path, body = {}) => api(`/leads/${encodeURIComponent(id)}${path}`, { method: "POST", body });

  /* ---------- header, next action, action bar ---------- */

  function header() {
    const l = data.lead;
    const links = [extLink(l.website, "Website ↗", "adm-link"), extLink(l.maps_url, "Google Maps ↗", "adm-link")].filter(Boolean);
    return h("header", { class: "ld-head" },
      h("div", { class: "ld-head__top" }, h("h1", { class: "adm-title", tabindex: "-1", text: l.name }), statusChip(l)),
      h("p", { class: "ld-head__meta" }, [l.trade, l.city].filter(Boolean).join(" · "), links.length ? " " : null, links.map((a, i) => [i ? " · " : "", a])));
  }

  function nextBox() {
    const l = data.lead;
    const note = h("input", { class: "input", id: "ld-nextnote", type: "text", maxlength: "200", value: l.next_action_note || "", placeholder: "Add your own note (optional)", "aria-label": "Your note on the next action", autocomplete: "off" });
    const saved = h("span", { class: "ld-saved", role: "status", "aria-live": "polite" });
    let last = l.next_action_note || "";
    note.addEventListener("blur", async () => {
      if (note.value === last) return;
      try { await api("/leads/" + encodeURIComponent(id), { method: "PATCH", body: { next_action_note: note.value } }); last = note.value; saved.textContent = "Saved"; window.setTimeout(() => { saved.textContent = ""; }, 2500); }
      catch (err) { saved.textContent = errText(err); }
    });
    return h("div", { class: "ld-next" }, h("span", { class: "ld-label", text: "Next action" }), h("p", { class: "ld-next__text", text: l.next_action || "" }), h("div", { class: "ld-next__note" }, note, saved));
  }

  function openReview() {
    host.hidden = true;
    const box = h("div", null, h("div"));
    node.append(box);
    box.replaceChildren(reviewScreen({ ids: [id], mode: "send", notify: ctx.notify, onBack: async (changed) => { box.remove(); host.hidden = false; if (changed) await reload(); window.scrollTo(0, 0); } }));
    window.scrollTo(0, 0);
  }

  function actionBar() {
    const { lead: l, message: m, messages } = data;
    const btns = [];
    let hint = "";
    const btn = (label, cls, fn) => { const b = h("button", { class: "btn " + cls, type: "button" }, label); b.addEventListener("click", act(b, () => fn(b))); btns.push(b); return b; };
    const confirmed = (opts, fn) => async (b) => { if (await confirmDialog(opts)) await fn(); else b.disabled = false; };
    const dismiss = () => btn("Dismiss", "btn--secondary", confirmed({ title: "Dismiss this lead?", body: "It leaves your working lists and won’t be contacted. You can reopen it later if it was never contacted.", details: [["Business", l.name]], confirmLabel: "Dismiss lead" }, async () => { await post("/dismiss"); await reload(); }));

    if (l.status === "new") {
      btn("Approve", "btn--primary", async () => { await post("/approve"); await reload(); });
      dismiss();
    } else if (l.status === "approved") {
      const b = btn("Approve email", "btn--primary", async () => { if (ctl.pitch && ctl.pitch.dirty()) await ctl.pitch.save(); await post("/message/approve"); await reload(); });
      if (!m) { b.disabled = true; hint = "Create a draft email first (see Pitch below)."; }
      else if (m.blockers.length) { b.disabled = true; hint = m.blockers.join(" "); }
      dismiss();
    } else if (l.status === "ready") {
      btn("Review & send", "btn--primary", async (b) => { openReview(); b.disabled = false; });
      btn("Edit", "btn--secondary", async (b) => { const s = document.getElementById("ld-pitch-section"); if (s) s.scrollIntoView(); const f = document.getElementById("ld-subject"); if (f) f.focus({ preventScroll: true }); b.disabled = false; });
      dismiss();
    } else if (l.status === "contacted") {
      btn("Mark replied", "btn--primary", confirmed({ title: "Mark this lead as replied?", body: "Use this when they have answered you. It moves to Replied.", details: [["Business", l.name]], confirmLabel: "Mark replied" }, async () => { await post("/status", { status: "replied" }); await reload(); }));
      const hasFollow = messages.some((x) => x.kind === "followup");
      const live = messages.filter((x) => !x.is_test && x.kind === "first" && x.sent_at).map((x) => Date.parse(x.sent_at)).filter(Number.isFinite);
      const due = live.length ? Math.max(...live) + 5 * DAY : null;
      if (!hasFollow && !l.opted_out && due) {
        const fb = btn("Draft follow-up", "btn--secondary", async () => { await post("/followup"); await reload(); });
        if (Date.now() < due) { fb.disabled = true; hint = "A follow-up can be drafted from " + fmt(when, new Date(due).toISOString()) + "."; }
      }
      btn("Opt-out", "btn--secondary", confirmed({ title: "Record an opt-out?", body: "They asked not to be contacted. All of their addresses are blocked and the lead is dismissed. This cannot be undone.", details: [["Business", l.name]], confirmLabel: "Record opt-out" }, async () => { await post("/status", { status: "optout" }); await reload(); }));
    } else if (l.status === "replied") {
      btn("Mark won", "btn--primary", confirmed({ title: "Mark this lead as won?", body: "They are now a client. This moves to Won.", details: [["Business", l.name]], confirmLabel: "Mark won" }, async () => { await post("/status", { status: "won" }); await reload(); }));
    } else if (l.status === "dismissed") {
      if (!l.contacted_at && !l.opted_out) btn("Reopen", "btn--primary", async () => { await post("/reopen"); await reload(); });
      else hint = l.opted_out ? "This business opted out, so it cannot be reopened." : "It was already contacted, so it cannot be reopened.";
    }
    return h("div", { class: "ld-actionbar" }, btns.length ? h("div", { class: "adm-actions" }, btns) : null, hint ? h("p", { class: "ld-hint", role: "status", text: hint }) : null);
  }

  /* ---------- why, contacts ---------- */

  function why() {
    const l = data.lead;
    let issues = [];
    try { const p = JSON.parse(l.site_issues || "[]"); if (Array.isArray(p)) issues = p.filter((x) => typeof x === "string"); } catch { /* none */ }
    const srcs = [];
    const seen = new Set();
    const add = (label, url) => { if (safeUrl(url) && !seen.has(url)) { seen.add(url); srcs.push(h("li", null, h("span", { class: "adm-muted", text: label + ": " }), extLink(url, shortUrl(url)))); } };
    add("Google Maps", l.maps_url); add("Website", l.website);
    data.contacts.forEach((c) => add(c.type === "email" ? "Where " + c.value + " was published" : "Source of " + c.value, c.source_url));
    const rating = stars(l.rating, l.review_count);
    return card("Why they’re a prospect", h("div", null,
      h("p", { class: "ld-reason", text: l.reason }),
      h("dl", { class: "adm-spec ld-facts" },
        [["Website", SITE_WORDS[l.site_status] || "Unknown"], issues.length ? ["Website issues", issues.join("; ")] : null, rating ? ["Reviews", rating + (l.last_review_at ? ` (latest ${fmtDate(l.last_review_at)})` : "")] : null, l.address ? ["Address", l.address] : null]
          .filter(Boolean).map(([k, v]) => h("div", null, h("dt", { text: k }), h("dd", { text: v })))),
      srcs.length ? h("div", null, h("p", { class: "rk-sub", text: "Sources" }), h("ul", { class: "ld-sources" }, srcs)) : null), { id: "ld-why" });
  }

  function contactRow(c) {
    const [label, tone] = c.opted_out_at ? ["Opted out", "bad"] : ELIG[c.eligibility] || [c.eligibility, ""];
    if (c.type === "phone") {
      const tel = String(c.value).replace(/[^\d+]/g, "");
      return h("li", { class: "ld-contact" }, h("div", { class: "ld-contact__main" }, h("strong", null, tel ? h("a", { class: "adm-link", href: "tel:" + tel, text: c.value }) : c.value), h("span", { class: "adm-muted", text: "Phone only, not emailed" }), c.source_url ? extLink(c.source_url, "Source", "adm-link") : null));
    }
    const confirmBtn = c.eligibility === "review" && !c.opted_out_at ? h("button", { class: "btn btn--secondary", type: "button" }, "Confirm this address") : null;
    if (confirmBtn) confirmBtn.addEventListener("click", act(confirmBtn, async () => {
      if (!(await confirmDialog({ title: "Confirm this address?", body: "Only confirm it if it is the business’s own address and is published for business enquiries. You become responsible for emailing it.", details: [["Address", c.value]], confirmLabel: "Confirm address" }))) { confirmBtn.disabled = false; return; }
      await post("/contacts/" + c.id, { eligibility: "eligible" }); await reload();
    }));
    return h("li", { class: "ld-contact" },
      h("div", { class: "ld-contact__main" }, h("strong", { class: "ld-contact__value", text: c.value }), badge(label, tone), c.eligibility_note ? h("span", { class: "adm-muted", text: c.eligibility_note }) : null,
        c.source_url ? extLink(c.source_url, "Source: " + shortUrl(c.source_url), "adm-link") : h("span", { class: "adm-muted", text: c.source === "manual" ? "Added by you" : "No source link" })), confirmBtn);
  }

  function addContact() {
    const type = h("select", { class: "input", id: "ld-ct-type", "aria-label": "Type" }, h("option", { value: "email" }, "Email"), h("option", { value: "phone" }, "Phone"));
    const value = h("input", { class: "input", id: "ld-ct-value", type: "text", maxlength: "200", required: true, autocomplete: "off" });
    const src = h("input", { class: "input", id: "ld-ct-src", type: "url", maxlength: "500", placeholder: "https://…", autocomplete: "off" });
    const err = h("p", { class: "adm-field__error", role: "alert", hidden: true });
    const go = h("button", { class: "btn btn--secondary", type: "submit" }, "Add");
    const form = h("form", { class: "adm-form ld-addform", onsubmit: async (e) => {
      e.preventDefault(); if (!value.value.trim()) return;
      go.disabled = true; err.hidden = true;
      try { await post("/contacts", { type: type.value, value: value.value.trim(), source_url: src.value.trim() || undefined }); await reload(); }
      catch (x) { go.disabled = false; err.textContent = errText(x); err.hidden = false; }
    } },
      h("div", { class: "adm-field" }, h("label", { for: "ld-ct-type", text: "Type" }), type),
      h("div", { class: "adm-field" }, h("label", { for: "ld-ct-value", text: "Email address or phone number" }), value),
      h("div", { class: "adm-field" }, h("label", { for: "ld-ct-src", text: "Where you found it (optional link)" }), src, h("p", { class: "adm-field__hint", text: "A new email needs your check before it can be used." })),
      h("div", { class: "adm-actions" }, go), err);
    return fold({ title: "Add an email or phone", body: form });
  }

  function contacts() {
    const list = data.contacts;
    const emailsOk = list.some((c) => c.type === "email" && c.eligibility === "eligible" && !c.opted_out_at);
    return card("Contacts", h("div", null,
      list.length ? h("ul", { class: "ld-contacts" }, list.map(contactRow)) : h("p", { class: "rk-quiet", text: "No contact found yet. Add an email or phone you have." }),
      !emailsOk && list.length ? h("p", { class: "ld-hint", text: "No address is ready to email yet. Confirm one above or add one." }) : null,
      addContact()), { id: "ld-contacts" });
  }

  /* ---------- demo activity, timeline, notes ---------- */

  function journeyRow(j) {
    const choices = [j.discipline, j.vibe].filter(Boolean).map(pretty).join(" · ");
    const facts = [j.device ? pretty(j.device) : "", j.country || ""].filter(Boolean).join(" · ");
    return h("li", { class: "ld-journey" },
      h("time", { class: "ld-journey__when", datetime: j.first_seen_at, text: fmt(when, j.first_seen_at) + (j.last_seen_at && j.last_seen_at !== j.first_seen_at ? " to " + fmt(clock, j.last_seen_at) : "") }),
      h("div", { class: "ld-journey__what" },
        choices || j.colour ? h("span", { class: "ld-journey__choice" }, swatch(j.colour), choices ? h("span", { text: "Chose " + choices }) : null) : h("span", { class: "adm-muted", text: "Opened the link" }),
        j.company ? h("span", { text: "Entered company: " + j.company }) : null,
        facts ? h("span", { class: "adm-muted", text: facts }) : null),
      h("div", { class: "ld-chips" }, [j.bot ? badge("Likely bot", "warn") : null, j.demo_opens ? badge("Demo opened" + (j.demo_opens > 1 ? " ×" + j.demo_opens : ""), "ok") : null, j.enquired ? badge("Enquiry", "ok") : null].filter(Boolean)));
  }

  function demo() {
    const d = data.demo || {};
    if (!d.link) return card("Demo activity", h("p", { class: "rk-quiet", text: "No tracking link yet. It is made when you approve this lead." }), { id: "ld-demo" });
    const manual = h("input", { class: "input dt-link__manual", type: "text", readonly: true, hidden: true, "aria-label": "Tracking link" });
    const copy = h("button", { class: "btn btn--secondary", type: "button", disabled: d.link.revoked_at ? true : null }, "Copy link");
    copy.addEventListener("click", () => copyText(d.link.url, copy, "Copy link", manual));
    const s = d.summary || {};
    const js = d.journeys || [];
    return card("Demo activity", h("div", null,
      h("div", { class: "ld-linkrow" }, h("div", { class: "ld-linkrow__text" }, h("span", { class: "ld-label", text: "Their tracking link" }), h("code", { class: "ld-linkrow__url", text: d.link.url }), d.link.revoked_at ? badge("Revoked", "bad") : null), copy), manual,
      h("div", { class: "rk-stats ld-stats" }, statCard({ label: "Opens", value: String(s.opens || 0) }), statCard({ label: "Visitors", value: String(s.visits || 0) }), statCard({ label: "Enquiries", value: String(s.enquiries || 0), tone: s.enquiries ? "ok" : "" })),
      js.length ? h("ul", { class: "ld-journeys" }, js.map(journeyRow)) : h("p", { class: "rk-quiet", text: "No visits yet." })), { id: "ld-demo" });
  }

  function history() {
    const ev = [...(data.timeline || [])].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const msgs = data.messages || [];
    const body = h("div", null,
      ev.length ? h("ol", { class: "dt-timeline" }, ev.map((e) => h("li", null, h("time", { datetime: e.at, text: fmtDateTime(e.at) }), h("span", null, h("strong", { text: EVENT_WORD[e.type] || e.type }), e.detail ? " " + e.detail : "")))) : h("p", { class: "rk-quiet", text: "Nothing has happened yet." }),
      msgs.length ? h("div", null, h("p", { class: "rk-sub", text: "Emails" }), h("ul", { class: "ld-msgs" }, msgs.map((m) => h("li", null, badge(m.status, m.status === "sent" || m.status === "approved" ? "ok" : m.status === "draft" ? "pending" : "bad"), h("span", { class: "ld-msgs__subj", text: (m.kind === "followup" ? "Follow-up: " : "") + m.subject + (m.is_test ? " (test)" : "") }), h("span", { class: "adm-muted", text: m.sent_at ? fmtDateTime(m.sent_at) : "" }), m.error ? h("span", { class: "adm-field__error", text: m.error }) : null)))) : null);
    return fold({ title: "Timeline", meta: `${ev.length} event${ev.length === 1 ? "" : "s"}${msgs.length ? ", " + msgs.length + " email" + (msgs.length === 1 ? "" : "s") : ""}`, body });
  }

  function notes() {
    const l = data.lead;
    const ta = h("textarea", { class: "input ld-notes", id: "ld-notes", rows: "5", maxlength: "4000", "aria-label": "Notes" }, l.notes || "");
    const saved = h("span", { class: "ld-saved", role: "status", "aria-live": "polite" });
    let last = l.notes || "";
    ta.addEventListener("blur", async () => {
      if (ta.value === last) return;
      saved.textContent = "Saving…";
      try { await api("/leads/" + encodeURIComponent(id), { method: "PATCH", body: { notes: ta.value } }); last = ta.value; saved.textContent = "Saved"; window.setTimeout(() => { saved.textContent = ""; }, 2500); }
      catch (err) { saved.textContent = errText(err); }
    });
    return card("Notes", h("div", null, ta, saved), { id: "ld-notes-h" });
  }

  function paint() {
    const keepOpen = [...host.querySelectorAll("details[open]")].map((d) => d.querySelector("summary") && d.querySelector("summary").textContent);
    host.replaceChildren(back, header(), nextBox(), actionBar(), why(), contacts(), pitchSection({ data, reload, ctl }), demo(), history(), notes());
    host.querySelectorAll("details").forEach((d) => { const t = d.querySelector("summary"); if (t && keepOpen.includes(t.textContent)) d.open = true; });
    document.title = data.lead.name + " — Leads — Framework Admin";
  }

  try { await load(); } catch (err) {
    host.replaceChildren(back, errorState(err, ctx.retry));
    return { title: "Lead", node };
  }
  paint();
  return { title: data.lead.name + " — Leads", node };
}
