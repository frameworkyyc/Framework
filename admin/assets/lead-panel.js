/* Framework Admin — Leads: ONE lead, one single-column panel (/admin/leads/<id>), answer first:
   header and next action, the action bar for its status, why they are a prospect, contacts, the pitch, demo activity, timeline, notes.
   API: GET /leads/<id> and the action endpoints in the contract. Text from the server is only ever set as text. */

import { h, api, errorState, confirmDialog, fmtDateTime, fmtDate } from "./ui.js";
import { badge, card, fold, navIcon, statCard } from "./kit.js";
import { statusChip, outreachChip, view, SITE_WORDS, SITE_TONE, extLink, safeUrl, shortUrl, shortName, errText, copyText, iconLabel } from "./leads-common.js";
import { pitchSection } from "./lead-pitch.js";
import { reviewScreen } from "./lead-review.js";
import { markContactedDialog, outreachCard } from "./lead-outreach.js";
import { swatch, pretty, fmt, when } from "./demo-traffic.js";

const EVENT_WORD = { imported: "Found by the finder", approved: "Approved", dismissed: "Dismissed", reopened: "Reopened", draft: "Draft written", edited: "Draft edited", email_approved: "Email approved", email_unapproved: "Email unapproved",
  sent: "Email sent", test_sent: "Test email sent", delivered: "Delivered", failed: "Failed to send", bounced: "Bounced", complained: "Complaint", replied: "Replied", opted_out: "Opted out", won: "Marked won", note: "Note", contact_added: "Contact added", contact_confirmed: "Address confirmed", followup_drafted: "Follow-up drafted" };
const ELIG = { eligible: ["Eligible", "ok"], review: ["Needs your check", "warn"], blocked: ["Blocked", "bad"] };
const DAY = 86400000;
const clock = new Intl.DateTimeFormat("en-CA", { timeStyle: "short", timeZone: "America/Edmonton" });

const siteHost = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return shortUrl(u); } };
const LEVEL_WORD = { high: "Worth contacting", medium: "Worth a look", low: "Low priority", unknown: "Not enough data yet" };
const clean1 = (t) => { const x = String(t).replace(/\s+/g, " ").trim(); return x.length > 40 ? x.slice(0, 40) + "…" : x; };
const unique = (list) => [...new Set(list)];

/** A section: a black rule, an icon and a title, then its content. */
const section = (title, body, id) => h("section", { class: "ld-sec", "aria-labelledby": title ? id : null }, title ? h("h2", { class: "ld-sec__title", id, text: title }) : null, body);

export async function render(id, ctx) {
  const host = h("div");
  const node = h("div", { class: "adm-page ld-panel" }, host);
  const ctl = { pitch: null, flash: "" };
  let data = null;

  const back = h("a", { class: "adm-back ld-backlink", href: "/admin/leads" + (view.status ? "?status=" + view.status : ""), "data-link": "" }, iconLabel("back", "Back to leads"));

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

  /* ---------- Overview: who, where, links, status and the few actions that matter ---------- */

  function overview(bar) {
    const l = data.lead;
    const links = [l.website ? extLink(l.website, siteHost(l.website), "adm-link") : null, extLink(l.maps_url, "Google Maps", "adm-link")].filter(Boolean);
    return h("header", { class: "ld-ov" },
      h("div", { class: "ld-ov__top" }, h("h1", { class: "adm-title", tabindex: "-1", text: shortName(l.name, l.city) }), statusChip(l), outreachChip(l.outreach)),
      h("p", { class: "ld-ov__meta" }, [l.trade, l.city].filter(Boolean).join(" · ")),
      links.length ? h("div", { class: "ld-links" }, links) : null,
      bar.primary.length || bar.secondary.length ? h("div", { class: "adm-actions ld-acts" }, bar.primary, bar.secondary) : null,
      bar.hint ? h("p", { class: "ld-hint", role: "status", text: bar.hint }) : null);
  }

  /* ---------- Three figures: opportunity, Maps position, rating ---------- */

  function figures() {
    const l = data.lead, s = l.seo, r = s && s.report;
    const rep = r && r.reputation ? r.reputation : l.rating ? { rating: Number(l.rating), reviews: l.review_count } : null;
    const clip = (t) => (t.length > 30 ? t.slice(0, 29) + "…" : t);
    // Google Search: the best measured position among the tracked keywords; if none was found, that it was not found in the results that were checked; otherwise not measured
    const org = r && r.organic && r.organic.length ? r.organic : null;
    const found = org ? org.filter((q) => q.position !== null) : [];
    const best = found.length ? found.reduce((b, q) => (q.position < b.position ? q : b)) : null;
    const depth = org ? Math.min(...org.map((q) => q.depth)) : 0;
    const search = !org ? { value: "–", sub: "Not measured yet", off: true }
      : best ? { value: `#${best.position}`, sub: `for "${clip(best.keyword)}"` }
      : { value: "Not found", sub: `in the top ${depth}`, word: true };
    // Google Maps: a separate measurement (Places result order), never mixed with the Search position
    const mapsOk = !!(r && r.maps);
    const maps = !mapsOk ? { value: "–", sub: "Not measured yet", off: true }
      : r.maps.position === null ? { value: "Not found", sub: `in the top ${r.maps.checked}`, word: true }
      : { value: `#${r.maps.position}`, sub: `of ${r.maps.checked}` };
    const figs = [
      { label: "SEO opportunity", value: s && s.score !== null ? String(s.score) : "–", unit: s && s.score !== null ? "/100" : "", sub: s ? "" : "Not assessed yet", lead: true, level: s ? s.level : "unknown" },
      { label: "Google Search", ...search },
      { label: "Google Maps", ...maps },
      { label: "Rating", value: rep ? rep.rating.toFixed(1) : "–", sub: rep && rep.reviews ? `${rep.reviews} reviews` : "", off: !rep },
    ];
    const fig = h("div", { class: "ld-figs" }, figs.map((f) => h("div", { class: "ld-fig" + (f.lead ? " ld-fig--lead ld-fig--" + f.level : "") + (f.off ? " ld-fig--off" : "") },
      h("span", { class: "ld-fig__label", text: f.label }),
      h("strong", { class: "ld-fig__value" + (f.word ? " ld-fig__value--word" : "") }, f.value, f.unit ? h("span", { class: "ld-fig__unit", text: f.unit }) : null),
      f.sub ? h("span", { class: "ld-fig__sub", text: f.sub }) : null)));
    return h("div", null, fig, org ? fold({ title: "Google Search by keyword", meta: `${org.length} keyword${org.length === 1 ? "" : "s"}`, body: organicList(r) }) : null);
  }

  /* ---------- Opportunity: the verdict and the three things that matter ---------- */

  function opportunity() {
    const l = data.lead, s = l.seo, r = s && s.report;
    if (!s) return h("p", { class: "ld-fallback", text: l.reason || "" });
    const wrong = findings().slice(0, 3);
    return h("div", { class: "ld-opp" },
      h("p", { class: "ld-verdict", text: LEVEL_WORD[s.level] || "" }),
      wrong.length ? h("ul", { class: "ld-pts" }, wrong.map((t) => h("li", { text: t }))) : h("p", { class: "rk-quiet", text: "Nothing significant was measured." }));
  }

  /** The weaknesses actually measured, most important first. */
  function findings() {
    const s = data.lead.seo, r = s && s.report;
    if (!s) return [];
    const mc = s.components.find((c) => c.id === "maps" && c.basis === "measured" && c.points > 0);
    const gc = s.components.find((c) => c.id === "competitors" && c.basis === "measured" && c.points / c.max >= 0.4);
    return [mc && mc.finding, gc && gc.finding, ...((r && r.issues) || []).map((i) => i.text)].filter(Boolean);
  }

  function reportButtons() {
    if (!data.lead.seo) return [];
    const say = h("span", { class: "ld-saved", role: "status", "aria-live": "polite" });
    const manual = h("textarea", { class: "input dt-link__manual", readonly: true, hidden: true, rows: "6", "aria-label": "Report text" });
    const copy = h("button", { class: "btn btn--secondary", type: "button" }, iconLabel("copy", "Copy SEO assessment"));
    copy.addEventListener("click", async () => {
      copy.disabled = true; say.textContent = "";
      try {
        const r = await api(`/leads/${encodeURIComponent(id)}/seo-report`);
        try { await navigator.clipboard.writeText(r.markdown); say.textContent = "Copied. Paste it into ChatGPT or Claude."; }
        catch { manual.hidden = false; manual.value = r.markdown; manual.focus(); manual.select(); say.textContent = "Copy the text below."; }
      } catch (err) { say.textContent = errText(err); }
      copy.disabled = false;
    });
    const pdf = h("a", { class: "btn btn--secondary", href: `/api/admin/leads/${encodeURIComponent(id)}/seo-report.pdf`, download: "" }, iconLabel("download", "Generate report (PDF)"));
    return [copy, pdf, say, manual];
  }

  /* ---------- Expandable detail: SEO details, notes, website check, sources, timeline ---------- */

  const NOTE = () => {
    const l = data.lead;
    const note = h("input", { class: "input", id: "ld-nextnote", type: "text", maxlength: "200", value: l.next_action_note || "", placeholder: "A short note on the next step (optional)", "aria-label": "Your note on the next step", autocomplete: "off" });
    const saved = h("span", { class: "ld-saved", role: "status", "aria-live": "polite" });
    let last = l.next_action_note || "";
    note.addEventListener("blur", async () => {
      if (note.value === last) return;
      try { await api("/leads/" + encodeURIComponent(id), { method: "PATCH", body: { next_action_note: note.value } }); last = note.value; saved.textContent = "Saved"; window.setTimeout(() => { saved.textContent = ""; }, 2500); }
      catch (err) { saved.textContent = errText(err); }
    });
    return h("div", { class: "ld-next__note" }, note, saved);
  };

  function seoDetails() {
    const l = data.lead, s = l.seo, r = s && s.report;
    if (!s) return null;
    const rows = s.components.map((c) => h("li", { class: "ld-bk" },
      h("span", { class: "ld-bk__label", text: c.label }),
      c.basis === "measured" ? h("progress", { class: "rk-meter ld-bk__bar", max: String(c.max), value: String(c.points), "aria-label": `${c.label}: ${c.points} of ${c.max}` }) : h("span", { class: "ld-bk__bar" }),
      h("span", { class: "ld-bk__pts", text: c.basis === "measured" ? `${c.points}/${c.max}` : "–" }),
      h("span", { class: "ld-bk__text", text: c.basis === "measured" ? c.finding : c.note })));
    const onC = s.components.find((c) => c.id === "onpage") || {};
    const lh = r && r.lighthouse && r.lighthouse.seo !== null ? `${r.lighthouse.seo}/100` : r && r.psi_error ? `Not available (${r.psi_error})` : "Not available";
    const facts = [["Lighthouse SEO", lh], ["Technical issues", onC.basis === "measured" ? String((r && r.issues ? r.issues : []).length) : "Not measured"]];
    const wrong = findings();
    const fix = unique([...((r && r.issues) || []).map((i) => i.fix), ...((r && r.recommendations) || []).filter((x) => !/\(.*\.\)$/.test(x) && !/^No significant/.test(x))]);
    const list = (items) => h("ul", { class: "ld-pts" }, items.map((t) => h("li", { text: t })));
    const comps = r && r.competitor && r.competitor.top && r.competitor.top.length ? competitors(r) : null;
    return fold({ title: "SEO details", meta: `${wrong.length} finding${wrong.length === 1 ? "" : "s"}`, body: h("div", null,
      h("dl", { class: "adm-spec ld-facts" }, facts.map(([k, v]) => h("div", null, h("dt", { text: k }), h("dd", { text: v })))),
      h("h3", { class: "ld-sub", text: "Score" }), h("ul", { class: "ld-bks", "aria-label": "Score components" }, rows),
      comps ? h("div", null, h("h3", { class: "ld-sub", text: "Local competitors" }), comps) : null,
      wrong.length || fix.length ? h("div", { class: "ld-cols" }, h("div", null, h("h3", { class: "ld-sub", text: "Findings" }), wrong.length ? list(wrong) : null), h("div", null, h("h3", { class: "ld-sub", text: "To improve" }), fix.length ? list(fix) : null)) : null) });
  }

  /** Every tracked keyword with the business's real position, or that it was not among the results checked. Nothing is shown for a keyword that was not checked. */
  function organicList(r) {
    const org = r && r.organic ? r.organic : [];
    return h("ul", { class: "ld-kw", "aria-label": "Google Search rankings by keyword" }, org.map((q) => h("li", { class: "ld-kw__row" },
      h("span", { class: "ld-kw__q", text: q.keyword }),
      h("strong", { class: "ld-kw__pos" + (q.position === null ? " ld-kw__pos--none" : ""), text: q.position === null ? `Not found in top ${q.depth}` : `#${q.position}` }),
      h("span", { class: "ld-kw__when adm-muted", text: [q.location, q.checked ? "checked " + q.checked : ""].filter(Boolean).join(" · ") }))));
  }

  function competitors(r) {
    const me = data.lead;
    const row = (pos, name, rating, reviews, mine) => h("li", { class: "ld-cmp__row" + (mine ? " ld-cmp__row--me" : "") },
      h("span", { class: "ld-cmp__pos", text: pos }), h("span", { class: "ld-cmp__name", text: name }),
      h("span", { class: "ld-cmp__n", text: rating === null || rating === undefined ? "–" : Number(rating).toFixed(1) }), h("span", { class: "ld-cmp__n", text: reviews === null || reviews === undefined ? "–" : String(reviews) }));
    const myPos = r.maps && r.maps.position !== null && r.maps.position !== undefined ? "#" + r.maps.position : "–";
    return h("div", { class: "ld-cmp" },
      h("div", { class: "ld-cmp__head", "aria-hidden": "true" }, h("span", { text: "Rank" }), h("span", { text: "Business" }), h("span", { class: "ld-cmp__n", text: "Rating" }), h("span", { class: "ld-cmp__n", text: "Reviews" })),
      h("ul", { class: "ld-cmp__list", "aria-label": "Competitors" }, [row(myPos, shortName(me.name, me.city), me.rating, me.review_count, true), ...r.competitor.top.map((t) => row("#" + t.position, t.name, t.rating, t.reviews, false))]),
      r.competitor.median ? h("p", { class: "ld-cmp__foot adm-muted", text: `Local median: ${r.competitor.median} reviews${r.competitor.medianRating ? `, ${r.competitor.medianRating} stars` : ""} (${r.competitor.compared} businesses).` }) : null);
  }

  function sources() {
    const l = data.lead;
    const srcs = [], seen = new Set();
    const add = (label, url) => { if (safeUrl(url) && !seen.has(url)) { seen.add(url); srcs.push(h("li", null, h("span", { class: "adm-muted", text: label + ": " }), extLink(url, siteHost(url)))); } };
    add("Google Maps", l.maps_url); add("Website", l.website);
    data.contacts.forEach((c) => add(c.type === "email" ? "Where " + c.value + " was published" : "Source of " + c.value, c.source_url));
    return fold({ title: "Sources", meta: srcs.length ? `${srcs.length}` : "", body: srcs.length ? h("ul", { class: "ld-sources" }, srcs) : h("p", { class: "rk-quiet", text: "No source links recorded." }) });
  }

  /** Outreach: contacts always; the pitch once there is a draft to work on; the demo link once it exists. */
  function outreach() {
    const l = data.lead, d = data.demo || {};
    return h("div", { class: "ld-out" }, outreachCard({ lead: l, tracking: data.tracking !== false, post, reload, notify: ctx.notify }), contacts(), l.status === "new" ? null : pitchSection({ data, reload, ctl }), d.link ? demo() : null);
  }

  function actionBar() {
    const { lead: l, message: m, messages } = data;
    const primary = [], secondary = [];
    let hint = "";
    const btn = (label, cls, fn) => { const b = h("button", { class: "btn " + cls, type: "button" }, label); b.addEventListener("click", act(b, () => fn(b))); (/btn--primary/.test(cls) ? primary : secondary).push(b); return b; };
    const confirmed = (opts, fn) => async (b) => { if (await confirmDialog(opts)) await fn(); else b.disabled = false; };
    const dismiss = () => btn("Dismiss", "btn--secondary", confirmed({ title: "Dismiss this lead?", body: "It leaves your working lists and won’t be contacted. You can reopen it later if it was never contacted.", details: [["Business", l.name]], confirmLabel: "Dismiss lead" }, async () => { await post("/dismiss"); await reload(); }));

    /* "Mark as Contacted": you reached them yourself (text, phone, Facebook...). Their approval is left as it is. Not for a lead already contacted, dismissed or opted out. */
    const markContacted = () => {
      if (l.outreach || l.opted_out) return;
      const b = btn("Mark as Contacted", "btn--secondary", async (x) => {
        const r = await markContactedDialog(l);
        if (!r) { x.disabled = false; return; }
        try { await post("/contacted", r); ctx.notify("Marked as contacted."); await reload(); } catch (e) { x.disabled = false; ctx.notify(errText(e)); }
      });
      if (data.tracking === false) { b.disabled = true; hint = hint || "Mark as Contacted is waiting for migration 0026 to be approved."; }
    };

    if (l.status === "new") {
      btn("Approve", "btn--primary", async () => { await post("/approve"); await reload(); });
      markContacted();
      dismiss();
    } else if (l.status === "approved") {
      const b = btn("Approve email", "btn--primary", async () => { if (ctl.pitch && ctl.pitch.dirty()) await ctl.pitch.save(); await post("/message/approve"); await reload(); });
      if (!m) { b.disabled = true; hint = "Create a draft email first (see Pitch below)."; }
      else if (m.blockers.length) { b.disabled = true; hint = m.blockers.join(" "); }
      markContacted();
      dismiss();
    } else if (l.status === "ready") {
      btn("Review & send", "btn--primary", async (b) => { openReview(); b.disabled = false; });
      btn("Edit", "btn--secondary", async (b) => { const s = document.getElementById("ld-pitch-section"); if (s) s.scrollIntoView(); const f = document.getElementById("ld-subject"); if (f) f.focus({ preventScroll: true }); b.disabled = false; });
      markContacted();
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
    return { primary, secondary, hint };
  }

  function openReview() {
    host.hidden = true;
    const box = h("div", null, h("div"));
    node.append(box);
    box.replaceChildren(reviewScreen({ ids: [id], mode: "send", notify: ctx.notify, onBack: async (changed) => { box.remove(); host.hidden = false; if (changed) await reload(); window.scrollTo(0, 0); } }));
    window.scrollTo(0, 0);
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

  function journeyRow(j) {
    const choices = [j.discipline, j.vibe].filter(Boolean).map(pretty).join(" · ");
    const facts = [j.device ? pretty(j.device) : "", j.country || ""].filter(Boolean).join(" · ");
    return h("li", { class: "ld-journey" },
      h("time", { class: "ld-journey__when", datetime: j.first_seen_at, text: fmt(when, j.first_seen_at) + (j.last_seen_at && j.last_seen_at !== j.first_seen_at ? " to " + fmt(clock, j.last_seen_at) : "") }),
      h("div", { class: "ld-journey__what" },
        choices || j.colour ? h("span", { class: "ld-journey__choice" }, swatch(j.colour), choices ? h("span", { text: "Chose " + choices }) : null) : h("span", { class: "adm-muted", text: "Opened the link" }),
        j.company ? h("span", { text: "Entered company: " + j.company }) : null,
        facts ? h("span", { class: "adm-muted", text: facts }) : null),
      h("div", { class: "ld-chips" }, [j.bot ? badge("Likely bot", "warn") : null, j.demo_opens ? badge("Demo opened" + (j.demo_opens > 1 ? " (" + j.demo_opens + " times)" : ""), "ok") : null, j.enquired ? badge("Enquiry", "ok") : null].filter(Boolean)));
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
    return fold({ title: "Notes", meta: l.notes ? clean1(l.notes) : "", body: h("div", null, NOTE(), ta, saved) });
  }

  function siteCheck() {
    const l = data.lead;
    if (!l.website && !l.site_status) return null;
    let issues = [];
    try { const p = JSON.parse(l.site_issues || "[]"); if (Array.isArray(p)) issues = p.filter((x) => typeof x === "string"); } catch { /* none */ }
    const verified = !!l.site_verified_at;
    const btns = [];
    if (l.website && l.status === "new" && !verified && ["broken", "unverified", "offline", "online"].includes(l.site_status)) {
      const b = h("button", { class: "btn btn--secondary", type: "button" }, "Check website again");
      b.addEventListener("click", act(b, async () => { await api("/leads/recheck-sites", { method: "POST", body: { ids: [id] } }); await reload(); }));
      btns.push(b);
    }
    if (l.website) {
      const b = h("button", { class: "btn btn--secondary", type: "button" }, verified ? "Remove Working mark" : "Mark as Working");
      b.addEventListener("click", act(b, async () => { await post("/site-working", { verified: !verified }); await reload(); }));
      btns.push(b);
    }
    const facts = [["Status", verified ? "Marked as working by you" : SITE_WORDS[l.site_status] || "Unknown"], issues.length ? ["What the check saw", issues.join("; ")] : null, verified ? ["Marked", fmtDateTime(l.site_verified_at)] : null].filter(Boolean);
    return fold({ title: "Website check (technical)", badges: badge(verified ? "Working" : SITE_WORDS[l.site_status] || "Unknown", verified ? "ok" : SITE_TONE[l.site_status] || ""),
      body: h("div", null, h("dl", { class: "adm-spec ld-facts" }, facts.map(([k, v]) => h("div", null, h("dt", { text: k }), h("dd", { text: v })))),
        h("p", { class: "adm-muted", text: "Whether the website loads is a side check. It does not change the SEO score. If you have opened the site yourself and it works, mark it as working and it won’t be overruled." }),
        btns.length ? h("div", { class: "adm-actions" }, btns) : null) });
  }


  function paint() {
    const keepOpen = [...host.querySelectorAll("details[open]")].map((d) => d.querySelector("summary") && d.querySelector("summary").textContent);
    const bar = actionBar();
    const rb = reportButtons();
    const figs = section(null, h("div", null, figures(), rb.length ? h("div", { class: "adm-actions ld-tools" }, rb) : null), "ld-s-fig");
    host.replaceChildren(back, overview(bar), figs, section(null, opportunity(), "ld-s-opp"), section("Outreach", outreach(), "ld-s-out"),
      section(null, h("div", { class: "ld-folds" }, [seoDetails(), notes(), siteCheck(), sources(), history()].filter(Boolean)), "ld-s-more"));
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
