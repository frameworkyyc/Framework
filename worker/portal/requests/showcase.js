/**
 * What each service looks like, for the Deliverables and Custom Development pages: a concept illustration (assets/img/portal/<art>.svg, drawn by Framework, never a client
 * project), one honest sentence, and for development a few typical uses. Options and what is included are NOT written here: they come from the registry (the questions the form
 * actually asks, the included revision rounds, and the price only if Admin entered one), so the page cannot promise more than the form can take. Pure data.
 */
export const SHOWCASE = Object.freeze({
  // ---- Deliverables
  business_card: { art: "business-card", alt: "Concept illustration of a business card, front and back", lead: "A card with your name, role and contact details, designed around your brand." },
  digital_business_card: { art: "digital-card", alt: "Concept illustration of a digital business card on a phone", lead: "A card people can open on their phone, with your details and links in one place.",
    example: { href: "https://frameworkco.ca/card", img: "/assets/img/og-card.png", w: 1200, h: 630, alt: "Preview of Framework's own digital business card", label: "Real example: Framework's own digital business card" } },
  poster: { art: "poster", alt: "Concept illustration of two posters", lead: "A poster for an event, an offer or an announcement, ready to share or print." },
  flyer: { art: "flyer-brochure", alt: "Concept illustration of a flyer and a tri-fold brochure", lead: "A one-sheet flyer, or a folded brochure that walks someone through what you do." },
  social_graphics: { art: "social", alt: "Concept illustration of social media graphics in three formats", lead: "Graphics sized and styled for your social channels." },
  letterhead: { art: "letterhead", alt: "Concept illustration of a letterhead and envelope", lead: "A branded letterhead for letters, quotes and documents." },
  email_signature: { art: "email-signature", alt: "Concept illustration of an email signature", lead: "One consistent signature for you and your team." },
  custom_branded: { art: "custom-branded", alt: "Concept illustration of packaging, a bottle, a sticker and a tag carrying one brand", lead: "Anything else that should carry your brand: a banner, a menu, a sign, a slide template." },
  // ---- Custom development (typical uses are illustrations of the kind of thing that fits, not past projects)
  custom_web_app: { art: "app", alt: "Concept illustration of a custom web application", lead: "A web application built around how your business actually works.", uses: ["Booking and scheduling", "Job and customer tracking", "Internal tools for your team"] },
  business_dashboard: { art: "dashboard", alt: "Concept illustration of a business dashboard with figures and charts", lead: "One screen that pulls your numbers together.", uses: ["Sales, jobs and leads at a glance", "Figures from the tools you already use", "Reports that update themselves"] },
  business_portal: { art: "portal", alt: "Concept illustration of a client portal", lead: "A private workspace where your customers log in.", uses: ["Files and documents shared with customers", "Project progress and approvals", "Invoices and messages in one place"] },
  ai_automation: { art: "ai", alt: "Concept illustration of an AI automation that sorts incoming messages", lead: "Use AI to take a repetitive task off your team, with a person still in charge.", uses: ["Sorting and drafting replies to enquiries", "Summarising documents or calls", "Turning forms into tasks"] },
  workflow_automation: { art: "workflow", alt: "Concept illustration of an automated workflow", lead: "Connect the steps of a process so they run themselves.", uses: ["Request, approval and hand-off steps", "Reminders and notifications", "Moving data between steps"] },
  api_integration: { art: "integrations", alt: "Concept illustration of software integrations syncing data between systems", lead: "Make two tools share information instead of retyping it.", uses: ["Website to accounting or CRM", "Keeping two systems in sync", "Pulling data from a supplier or service"] },
  custom_tool: { art: "tools", alt: "Concept illustration of a custom calculator tool", lead: "A calculator, estimator or small tool for your website or your team.", uses: ["Quote or price estimators", "Material and cost calculators", "Checkers and planners for customers"] },
  other_development: { art: "other", alt: "Concept illustration of an outline waiting for your idea", lead: "Something that does not fit the list: tell us the idea.", uses: [] },
});
export const showcaseOf = (key) => (Object.prototype.hasOwnProperty.call(SHOWCASE, key) ? SHOWCASE[key] : null);
