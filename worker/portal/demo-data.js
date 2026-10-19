/**
 * STATIC DEMONSTRATION DATA for the portal preview at /portal/demo. Everything here is invented: a fictional client ("Harbour & Pine Co."), fictional
 * people, fictional files that do not exist. It is never read from or written to any database, and no real client information can reach it.
 * Dates are expressed as offsets from "now" so the demo always looks current. This module has no imports and does nothing at import time.
 */
const DAY = 86400000;

/** @param now Date  @returns the demo view-model pieces (everything except `mode`/`base`, which the demo handler adds) */
export function demoViewModel(now = new Date()) {
  const at = (days, hours = 0) => new Date(now.getTime() + days * DAY + hours * 3600000).toISOString();
  const projects = [
    {
      id: "brand-identity", name: "Brand identity", kind: "brand", status: "review", progress: 82, lead: "Sam Rivera", started: at(-74), target: at(12), updatedAt: at(-1, -3),
      summary: "A complete identity system: strategy, logo, typography, colour and usage guidelines.",
      scope: ["Brand strategy and positioning", "Primary logo and secondary marks", "Typography and colour system", "Brand guidelines (PDF)", "Social media templates"],
      milestones: [
        { name: "Discovery workshop", state: "done", date: at(-60), note: "Two sessions with your leadership team." },
        { name: "Brand strategy approved", state: "done", date: at(-44), note: "Positioning, voice and audience signed off." },
        { name: "Logo concepts, round 1", state: "done", date: at(-29) },
        { name: "Logo refinement, round 2", state: "current", date: at(3), note: "Ready for your review. Feedback is due Thursday." },
        { name: "Identity system and guidelines", state: "next", date: at(9) },
        { name: "Final delivery", state: "next", date: at(12), note: "All source files and the guidelines document." },
      ],
      deliverables: [
        { name: "Brand strategy brief", state: "delivered", due: at(-44) },
        { name: "Primary logo suite", state: "review", due: at(3) },
        { name: "Typography and colour system", state: "progress", due: at(9) },
        { name: "Brand guidelines", state: "todo", due: at(12) },
        { name: "Social media templates", state: "todo", due: at(12) },
      ],
    },
    {
      id: "website", name: "Website", kind: "website", status: "build", progress: 54, lead: "Sam Rivera", started: at(-48), target: at(41), updatedAt: at(-2),
      summary: "A fast, editable website that explains what Harbour & Pine does and makes it easy to get in touch.",
      scope: ["Sitemap and content plan", "Design of key templates", "Build on a content-managed platform", "Launch support and training"],
      milestones: [
        { name: "Sitemap and content plan", state: "done", date: at(-40) },
        { name: "Wireframes", state: "done", date: at(-30) },
        { name: "Visual design", state: "done", date: at(-12) },
        { name: "Build and integration", state: "current", date: at(14), note: "Interior templates are in review; the staging site is being assembled." },
        { name: "Content entry and testing", state: "next", date: at(28) },
        { name: "Launch", state: "next", date: at(41) },
      ],
      deliverables: [
        { name: "Sitemap", state: "delivered", due: at(-40) },
        { name: "Wireframes", state: "delivered", due: at(-30) },
        { name: "Homepage design", state: "delivered", due: at(-12) },
        { name: "Interior page templates", state: "review", due: at(5) },
        { name: "Staging site", state: "progress", due: at(14) },
        { name: "Launch checklist", state: "todo", due: at(38) },
      ],
    },
    {
      id: "launch-photography", name: "Launch photography", kind: "photography", status: "discovery", progress: 12, lead: "Sam Rivera", started: at(-9), target: at(58), updatedAt: at(-4),
      summary: "A day of photography for the new website and launch materials.",
      scope: ["Creative brief and shot list", "One studio day", "Editing and retouching of 40 images"],
      milestones: [
        { name: "Creative brief", state: "current", date: at(6), note: "Draft is with you. We need your references to finish it." },
        { name: "Shot list and schedule", state: "next", date: at(20) },
        { name: "Studio day", state: "next", date: at(34) },
        { name: "Editing and retouching", state: "next", date: at(48) },
        { name: "Final image delivery", state: "next", date: at(58) },
      ],
      deliverables: [
        { name: "Creative brief", state: "progress", due: at(6) },
        { name: "Shot list", state: "todo", due: at(20) },
        { name: "Final image set (40 images)", state: "todo", due: at(58) },
      ],
    },
  ];

  const updates = [
    { title: "Logo refinement round 2 is ready for your review", detail: "Three directions, each shown on a website, a sign and a business card. Please comment by Thursday so we can keep the schedule.", at: at(-1, -3), projectId: "brand-identity", tone: "attention" },
    { title: "Interior page templates: feedback window closes Friday", detail: "Templates for services, about and contact. We’ve noted two questions in the document.", at: at(-2), projectId: "website", tone: "attention" },
    { title: "Website design is signed off", detail: "Thank you. Build has started and the staging site will be ready for a first walkthrough in about two weeks.", at: at(-9), projectId: "website", tone: "info" },
  ];

  const actions = [
    { text: "Review logo refinement round 2", due: at(3), who: "You", projectId: "brand-identity" },
    { text: "Approve interior page templates", due: at(5), who: "You", projectId: "website" },
    { text: "Send photography reference images", due: at(6), who: "You", projectId: "launch-photography" },
    { text: "Prepare the staging site for its first walkthrough", due: at(14), who: "Framework", projectId: "website" },
  ];

  const activity = [
    { type: "review", title: "Logo refinement round 2 shared for review", detail: "Three directions with application mock-ups. Feedback due Thursday.", at: at(-1, -3), projectId: "brand-identity" },
    { type: "document", title: "Logo refinement, round 2 (draft) added", at: at(-1, -3), projectId: "brand-identity" },
    { type: "update", title: "Interior templates ready for approval", detail: "Services, about and contact templates are complete in desktop and mobile layouts.", at: at(-2), projectId: "website" },
    { type: "update", title: "Creative brief drafted", detail: "The brief for the photography day is in the library; it needs your reference images to finish.", at: at(-4), projectId: "launch-photography" },
    { type: "milestone", title: "Website visual design approved", detail: "Homepage and global styles signed off. Build begins.", at: at(-9), projectId: "website" },
    { type: "document", title: "Homepage design, v3 added", at: at(-10), projectId: "website" },
    { type: "update", title: "Photography project kicked off", detail: "Introductory call held; scope and schedule confirmed.", at: at(-9, -2), projectId: "launch-photography" },
    { type: "milestone", title: "Logo concepts, round 1 complete", detail: "Feedback consolidated into one direction for refinement.", at: at(-29), projectId: "brand-identity" },
    { type: "document", title: "Invoice 0042 added", at: at(-30) },
    { type: "milestone", title: "Brand strategy approved", detail: "Positioning, voice and audience signed off.", at: at(-44), projectId: "brand-identity" },
    { type: "update", title: "Website sitemap and content plan delivered", at: at(-40), projectId: "website" },
    { type: "milestone", title: "Discovery workshop complete", detail: "Two sessions with your leadership team.", at: at(-60), projectId: "brand-identity" },
  ];

  const doc = (id, name, ext, size, desc, projectId, category, days, version, isNew = false) => ({ id, name, ext, size, desc, projectId, category, at: at(days), version, isNew });
  const documents = [
    doc("d1", "Logo refinement, round 2 (draft)", "pdf", "6.1 MB", "Three refined directions with application mock-ups. For your feedback.", "brand-identity", "Design", -1, "Draft 2", true),
    doc("d2", "Typography and colour exploration", "pdf", "3.2 MB", "Type pairings and palette options referenced in the strategy.", "brand-identity", "Design", -18, "Version 1"),
    doc("d3", "Logo concepts, round 1", "pdf", "8.9 MB", "Six initial concepts with the reasoning behind each.", "brand-identity", "Design", -29, "Version 1"),
    doc("d4", "Brand strategy brief", "pdf", "2.4 MB", "Positioning, audience, voice and the idea the identity expresses.", "brand-identity", "Strategy", -44, "Final"),
    doc("d5", "Interior page templates, v2", "pdf", "4.7 MB", "Services, about and contact templates in desktop and mobile layouts.", "website", "Design", -2, "Version 2", true),
    doc("d6", "Homepage design, v3", "png", "1.9 MB", "The approved homepage composition.", "website", "Design", -10, "Version 3"),
    doc("d7", "Website sitemap and content plan", "xlsx", "420 KB", "Every page, its purpose and who provides the content.", "website", "Strategy", -40, "Final"),
    doc("d8", "Creative brief: launch photography (draft)", "docx", "76 KB", "Goals, style, locations and the shot list outline. Needs your references.", "launch-photography", "Strategy", -4, "Draft 1", true),
    doc("d9", "Photography mood board", "pdf", "5.4 MB", "Visual references gathered so far.", "launch-photography", "Design", -7, "Version 1"),
    doc("d10", "Statement of work: brand and website", "pdf", "214 KB", "Scope, schedule and fees for the brand and website projects.", null, "Agreements", -75, "Signed"),
    doc("d11", "Invoice 0042", "pdf", "98 KB", "Milestone invoice: brand strategy and logo concepts.", null, "Billing", -30, "Issued"),
  ];

  const team = [
    { name: "Alex Morgan", email: "alex.morgan@harbourandpine.example", role: "owner" },
    { name: "Priya Shah", email: "priya.shah@harbourandpine.example", role: "member" },
  ];

  return {
    org: { name: "Harbour & Pine Co.", website: "https://harbourandpine.example", role: "owner", people: team.length },
    user: { name: "Alex Morgan", email: "alex.morgan@harbourandpine.example" },
    projects, updates, actions, activity, documents, team,
    has: { progress: true, milestones: true, deliverables: true, documents: true, updates: true, actions: true, settings: true },
  };
}
