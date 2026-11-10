// "Copy Lead Info": the prospect brief built from the lead detail already on screen (admin/assets/lead-brief.js, wired in lead-panel.js).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leadBrief } from "../../admin/assets/lead-brief.js";

const panel = readFileSync(new URL("../../admin/assets/lead-panel.js", import.meta.url), "utf8");
const NOW = new Date("2026-11-10T18:00:00Z");

const full = () => ({
  lead: { id: "lead_SECRETID123", dedupe_key: "dk-abc-123", source_ref: "places/ChIJsecret", demo_link_id: "lnk_SECRET", name: "Acme Fence Calgary", trade: "Fencing", city: "Calgary", address: "12 Main St SW", website: "https://acmefence.example", maps_url: "https://maps.google.com/?cid=1",
    rating: 4.6, review_count: 38, last_review_at: "2026-10-30T00:00:00Z", site_status: "online", site_issues: JSON.stringify(["No title tag"]), reason: "Strong reviews, weak site", status: "approved", source: "finder", created_at: "2026-10-01T10:00:00Z",
    notes: "Owner is Sam. Prefers text.", next_action_note: "Text on Monday", next_action: "Create a draft email", opted_out: false,
    outreach: { status: "follow_up", status_word: "Follow-up needed", method_word: "Text", last_contact_at: "2026-11-05T15:00:00Z", follow_up_on: "2026-11-13", note: "Left a message" },
    seo: { score: 72, level: "high", label: "Strong opportunity", assessed_at: "2026-11-02T12:00:00Z",
      components: [{ id: "maps", label: "Google Maps", basis: "measured", points: 18, max: 25, finding: "Ranks 7th of 20 in Maps." }, { id: "onpage", label: "On-page", basis: "not_measured", points: 0, max: 20, note: "Site blocked the check." }],
      report: { reputation: { rating: 4.6, reviews: 38 }, maps: { position: 7, checked: 20 }, organic: [{ keyword: "fence calgary", location: "Calgary", position: null, depth: 100, checked: "2026-11-01" }], lighthouse: { seo: 81 }, competitor: { median: 90, medianRating: 4.7, compared: 19 },
        issues: [{ text: "Home page has no meta description", fix: "Write a meta description" }], recommendations: ["Build up reviews: 38 against a local median of 90."] } } },
  contacts: [{ id: 9, type: "email", value: "info@acmefence.example", eligibility: "eligible", source_url: "https://acmefence.example/contact" }, { id: 10, type: "phone", value: "403-555-0100", eligibility: "eligible" }],
  messages: [{ id: "m1", kind: "first", subject: "Quick idea for Acme Fence", status: "sent", sent_at: "2026-11-04T16:00:00Z", is_test: false }, { id: "m2", kind: "first", subject: "TEST", status: "sent", is_test: true }],
  timeline: [{ at: "2026-11-05T15:00:00Z", type: "note", detail: "Contacted by text. Left a message" }, { at: "2026-10-02T09:00:00Z", type: "approved", detail: "" }],
  demo: { link: { id: "lnk_SECRET", url: "https://staging.example/d/TOKEN_abc.def", revoked_at: null }, summary: { opens: 3, visits: 2, enquiries: 1 }, journeys: [{ id: "j1", company: "Typed By Visitor Ltd" }] },
});

test("the brief has every labelled section and the business facts", () => {
  const md = leadBrief(full(), NOW);
  for (const h of ["# Prospect brief: Acme Fence Calgary", "## 1. Business profile", "## 2. Google presence", "## 3. SEO opportunity and assessment", "## 4. Website weaknesses and opportunities", "## 5. Priority and qualification", "## 6. Public contact details", "## 7. Outreach status and history", "## 8. Framework demo", "## 9. What this brief cannot tell you"]) assert.ok(md.includes(h), h);
  for (const f of ["Fencing", "12 Main St SW, Calgary", "https://acmefence.example", "https://maps.google.com/?cid=1", "4.6 stars from 38 reviews", "#7 of 20", "not found in the top 100", "72/100", "Assessment date:** 2026-11-02", "Lighthouse SEO score:** 81/100", "No title tag", "Home page has no meta description", "info@acmefence.example", "403-555-0100", "Follow-up needed", "2026-11-13", "Left a message", "Owner is Sam", "Quick idea for Acme Fence", "3 opens, 2 visitors, 1 enquiries", "High: worth contacting"]) assert.ok(md.includes(f), f);
});

test("verified facts are told apart from measurements and internal estimates", () => {
  const md = leadBrief(full(), NOW);
  assert.match(md, /Google Maps rating:\*\* 4\.6 stars from 38 reviews \[Verified, Google Maps listing\]/);
  assert.match(md, /Google Maps ranking:\*\* #7 of 20 results \[Measured 2026-11-02/);
  assert.match(md, /Opportunity score:\*\* 72\/100.*\[Estimate/);
  assert.match(md, /Priority:\*\* High.*\[Estimate/);
  assert.match(md, /Outreach status:\*\* Follow-up needed \[Internal record\]/);
});

test("internal ids, the dedupe key, the demo tracking link and visitor-typed text never appear", () => {
  const md = leadBrief(full(), NOW);
  for (const secret of ["lead_SECRETID123", "dk-abc-123", "places/ChIJsecret", "lnk_SECRET", "TOKEN_abc", "/d/", "Typed By Visitor", "TEST"]) assert.ok(!md.includes(secret), secret);
  assert.match(md, /tracking link itself is left out/);
});

test("a bare lead says what is unavailable instead of leaving gaps or throwing", () => {
  const md = leadBrief({ lead: { name: "Bare Co", status: "new", seo: null, outreach: null }, contacts: [], messages: [], timeline: [], demo: { link: null, summary: {} } }, NOW);
  for (const f of ["Services offered:** Not available", "Website:** Not available", "Social media:** Not available", "Google Search ranking:** Not available", "Opportunity score:** Not scored yet", "no assessment has been run", "no public phone number or email address has been found", "Outreach status:** Not contacted yet", "no demo has been made"]) assert.ok(md.includes(f), f);
  assert.ok(!/undefined|null|NaN/.test(md));
  assert.doesNotThrow(() => leadBrief({ lead: {} }, NOW));
});

test("a Facebook-only site is listed as social media, not as the website; opted-out contacts are flagged", () => {
  const d = full(); d.lead.website = "https://www.facebook.com/acmefence"; d.contacts[0].opted_out_at = "2026-11-06T00:00:00Z"; d.lead.opted_out = true;
  const md = leadBrief(d, NOW);
  assert.match(md, /Social media:\*\* Facebook: https:\/\/www\.facebook\.com\/acmefence/);
  assert.match(md, /Website:\*\* Not available/);
  assert.match(md, /opted out, do not contact/);
  assert.match(md, /Opted out: do not contact/);
});

test("the button sits in the action bar for every status, copies on click, says Copied, and falls back to a text box", () => {
  assert.match(panel, /import \{ leadBrief \} from "\.\/lead-brief\.js"/);
  assert.match(panel, /bar\.copy\.button, bar\.copy\.say/);
  assert.match(panel, /copy: copyBrief\(\)/);
  assert.match(panel, /navigator\.clipboard\.writeText\(md\)[\s\S]*say\.textContent = "Copied"/);
  assert.match(panel, /Lead brief text/);
  assert.ok(!/api\([^)]*brief/.test(panel), "no new request: the brief is built from what is already loaded");
});
