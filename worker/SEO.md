# SEO and lead tracking: how it works and what to set up

Phase 1 (Staging) of the plan to make frameworkco.ca visible for contractor website design in Calgary. Everything here is in the repository; the steps marked **You** need a person with access to Google, Bing or Cloudflare.

## What is in place

- **Contractor page:** `/contractor-websites` (`contractor-websites.html`). Calgary first, Alberta and Canada also. No prices, no testimonials, no ratings, no phone number. Client work is Red E Corp. and Aurora Surveys; the four trade websites under `/demos` are labelled as concepts, not clients.
- **Metadata:** one title and description per page, extensionless canonical and `og:url` (`/about`, not `/about.html`, which redirects), social tags on every public page, and a `noindex` on the 404 page.
- **Structured data (JSON-LD):** `ProfessionalService` and `WebSite` on the home page (Calgary service area, no street address, no phone), a breadcrumb on each inner page, and `Service`, `FAQPage` and breadcrumb on the contractor page. The FAQ markup repeats the FAQ visible on the page. There are deliberately no reviews, ratings, prices or social profiles.
- **Internal links:** a Contractors link in the main navigation, "Contractor Websites" and "Free Assessment" in every footer, and a short "free online presence assessment" prompt in each page's closing call to action, on the contact page and after a message is sent. All internal links use the final extensionless addresses, so there are no redirect hops.
- **Sitemap:** `sitemap.xml` lists the nine indexable pages by canonical address. Rebuild it with `node scripts/seo/update-sitemap.mjs` (dates come from git; a page with uncommitted changes gets today's date). `--check` fails if the list is out of date. Private pages (`/me`, `/card`, `/client-feedback`, `/portal`, `/admin`, `/demos`) are never listed and keep their `noindex`.
- **Contact form:** now sends through the website (`POST /api/contact`, `worker/contact.js`) instead of opening the visitor's email program. It reuses the assessment form's email settings and spam protections (honeypot, minimum fill time, Cloudflare Turnstile when configured, the platform rate limiter). It stores nothing; the message arrives as an email to `ASSESSMENT_NOTIFY_TO` with the visitor as Reply-To. The visitor sees "Message sent" only when the email provider accepted it; otherwise the form stays filled and offers the email address.
- **Analytics (Google Analytics 4):** built, consent-first, and **off** until you add a Measurement ID. See below.
- **Privacy policy:** updated (effective date shown as November 6, 2026) for the contact form and Google Analytics. **Review it before it goes to Production.**

## Staging and preview copies are noindex

`_headers` has two host-specific rules (`https://staging.frameworkco.ca/*` and `https://claude-:branch.frameworkco.ca/*`) that add `X-Robots-Tag: noindex` to every static response on those hosts. Because the rules name their host they cannot match `frameworkco.ca` or `www.frameworkco.ca`, so Production sends no robots header. `robots.txt` stays crawlable (no `Disallow`) so Google can read the header; the sitemap and every canonical list live-site addresses only. Not covered: per-commit hash preview hosts (`<hash>.frameworkco.ca`), because a one-label pattern would also match `www`; they are not linked anywhere public. Worker-generated pages (`/card`, `/portal`, `/admin`) set their own robots headers. `worker/test/seo-staging.test.mjs` checks all of this.

**After every Production release, run the indexability check:** `NODE_USE_ENV_PROXY=1 node scripts/ops/production-indexability.mjs`. It reads the live sitemap and fails (exit 1) if any public page is not HTTP 200, carries `noindex`/`none` in `X-Robots-Tag` or the robots meta tag, has a canonical other than its own address, or has no title; if `robots.txt` blocks crawling or the sitemap lists a non-live address; or if `/me`, `/client-feedback` or `/demos/` stopped being noindex. `worker/test/production-indexability.test.mjs` runs the same logic against the repository's own pages as the live site would serve them, so a leak of Staging's rules fails CI before release.

## Service pages (SEO phase 2)

- **Pages:** `/website-design` (Website Design & Development), `/local-seo` (Local SEO), `/branding` (Branding). `/services` stays the hub and `/contractor-websites` the specialized contractor landing page; each page has its own main phrase and they link to each other (descriptive link text), from the homepage cards and hero, the hub, every footer and the contractor page.
- **Built from existing components only** (`page-head`, `split`, `service`, `cells`, `cx-faq`, `cx-places`, the dark closing band): no new stylesheet, no images, no inline styles. Navigation is unchanged.
- **Service area:** Calgary, Airdrie, Cochrane, Okotoks and Chestermere are named in each page's "Where we work" band and in the structured data (`areaServed`, also on the homepage and the contractor page). Wider Alberta and Canada appears only in that band and one FAQ answer, never in titles or headings, so Calgary targeting is not diluted.
- **Structured data:** `Service` (provider = the business entity), `FAQPage` identical to the visible FAQ, `BreadcrumbList`. No offers, prices, ratings, reviews, phone or profiles.
- **Only confirmed claims.** `worker/test/seo-service-pages.test.mjs` fails on prices, timelines, phone numbers, addresses, Google Ads management, recurring-report packages, ranking guarantees, award or count claims, review or rating claims, and filler marketing words, and pins the owner-confirmed statements (Cloudflare "where it suits the project", ownership "in your client agreement", Google Business Profile "where your business is eligible", "not paid advertising", "no standard turnaround", branding "determined by the scope of the project"). Change one on purpose, in the same commit as the page.
- **Owner decisions still open (not published):** a stronger "we won't buy links or reviews" commitment, and any statement that checks Google's current rules on service-area addresses beyond the hedged wording now on the Local SEO page.

## Redirects, the 404 page and enquiry sources (SEO phase 2 groundwork)

- **Permanent redirects:** `_redirects` sends each page's old addresses (`/about.html`, `/about/`, `/index.html`, `/card.html`) to the one clean address with a **301**. It lists exact pages only, never a folder (`/demos/` is a real folder; redirecting it would loop with the platform's own trailing-slash handling). `worker/test/seo-redirects.test.mjs` fails on any loop, chain, wildcard, missing target, or internal link to a redirected address. The `http` to `https` and `www` to `frameworkco.ca` redirects are Cloudflare zone settings, not part of this repository, and are changed only with the owner's approval.
- **404 page:** `assets.not_found_handling: "404-page"` in `wrangler.jsonc` makes any missing page answer status 404 with `404.html` (branded, `noindex`, `<base href="/">` so it works at any depth). `/api/*` and the Worker's own routes keep their JSON 404s.
- **Where an enquiry came from:** `assets/js/main.js` is the single writer of `fw_visit` (local storage, shared by the browser's tabs, discarded after 30 minutes without activity; falls back to the tab's session storage if local storage is blocked). It keeps the **original visit** (first page path without query string, referring site origin; never replaced during the visit) and the **latest campaign** (utm_*, gclid, fbclid, plus that campaign's own landing path and referrer; a new campaign link replaces the old one completely, so campaigns are never blended). The contact form and the assessment form only read it when submitted. `worker/contact.js` adds "How they found us" (original visit), "First page they saw" and "Latest campaign" (with the page it landed on) to the email, using the real host. Nothing new is stored and nothing goes to analytics. Browsers sending Global Privacy Control or Do Not Track are never recorded and anything kept is cleared. The privacy policy and `PRIVACY-OPERATIONS.md` describe it.

**Before any Production release of this work:** change the privacy policy's effective date (`privacy.html`, `#effective-date`) to the release date, and re-read the Browser storage, Campaign information, Contact form and retention paragraphs. Visitors whose browser sends Global Privacy Control or Do Not Track are never recorded (`main.js`, `assessment.js`); the contact and assessment forms work the same for them.

## You: Google Search Console (about 10 minutes)

1. Open https://search.google.com/search-console and add a **Domain** property for `frameworkco.ca`.
2. Verify with the **DNS TXT record** Google shows you: add it in Cloudflare (DNS > Records > Add record, type TXT, name `@`). DNS verification covers every address of the site and needs no change to the website.
3. In **Sitemaps**, submit `https://frameworkco.ca/sitemap.xml`.
4. In **URL Inspection**, test `https://frameworkco.ca/contractor-websites` and press **Request indexing** (after it is live in Production). Do the same for the home page.
5. After a few days, check **Pages** (indexed or not, and why) and **Performance** (queries, impressions, clicks). Tell me what you see and I will tune titles and copy against real queries.
6. Optional: add the same domain in **Bing Webmaster Tools** (it can import from Search Console).

## You: Google Analytics 4 (about 10 minutes)

1. https://analytics.google.com > Admin > **Create property** (name Framework, time zone Calgary, currency CAD) > **Web** data stream for `https://frameworkco.ca`.
2. Copy the **Measurement ID** (looks like `G-ABC123XYZ9`). Do not turn on extra "enhanced measurement" options you do not need; the site only sends page views and the events below.
3. Send the ID to me, or edit `assets/js/analytics-config.js` yourself (`ga4: "G-..."`) in a pull request into Staging. With an ID set, visitors see a small "Website analytics" notice (Allow / No thanks). Nothing is requested from Google until they click Allow; browsers sending Global Privacy Control or Do Not Track are never asked and never measured.
4. In GA4 > Admin > **Events**, mark **`generate_lead`** as a key event (a message or assessment request was actually sent). `assessment_cta` and `contact_cta` count clicks on the prompts; they have a `location` parameter (for example `contractors_hero`, `footer`, `cta`).
5. In GA4 > Admin > **Product links**, link **Search Console** so queries and landing pages appear next to behaviour.
6. In GA4 data retention settings, choose a period you are comfortable with and say so in the privacy policy if it differs from the default.

Nothing that a visitor types into a form is ever sent to Google.

## You: Google Business Profile

Claim or create the profile (category "Website designer" or "Web designer"; mark it a service-area business and hide the address if you do not want one public; add services, a short description that matches the website, and the website link `https://frameworkco.ca/`). Use the same business name, "Framework", everywhere. This is the strongest local signal and is not something the website can do for you.

## The contractor page visuals

`/contractor-websites` is image-led: hero photo, a MacBook and iPhone for each concept website, a photo statement, client projects, a drawn process line and the homepage logo drawing. The devices are the Portfolio's (`.device-stage` in `styles.css`, frames `assets/img/device-macbook.png` and `device-iphone.png`, behaviour in `main.js`), so they carousel and scroll the same way. The logo drawing is the homepage's own markup and `.dw-*` styles, held back until it is on screen. Page styles are in `assets/css/contractors.css` (sharp corners, no shadows) and motion in `assets/js/contractors.js`. Motion is decorative and switches off under `prefers-reduced-motion`; without the script everything is visible.

- Concept screenshots in `assets/img/contractors/*-laptop-1..4.webp` (1440px wide captures: home, services, projects, build) and `*-phone-scroll.webp` (390px at 2x, fixed bars hidden) are of the four `/demos` sites. If a demo changes, recapture them at the same sizes.
- Photography (`hero-frame`, `photo-framing`, `photo-rebar`, `photo-scaffold`) is from Unsplash (Troy Mortier, Nate Johnston, Toni Reed, Marc Wieland) and credited on the page. It is atmosphere, not Framework clients, and the credit line says so. Swap in real project photography when available.
- Do not add testimonials, ratings or prices to the work section; `seo.test.mjs` guards that, and the image rules (dimensions, alt text, lazy-loading).

## Things to know

- The contractor page links to `/demos/...` concept sites. Those exist only on Staging so far, so a Production release of this work must include them (they stay `noindex`).
- Email must be configured on a deployment for the contact form to send (it is on Production and Staging for the assessment form; the same settings are used). If it is ever missing the form says so honestly and shows the email address.
- A contact message is not stored in a database, only emailed. If you want a record in Admin, that needs a new table, which is a migration and would be proposed for your review first.
- Rankings cannot be promised and the copy does not. Expect Search Console to show indexing within days and real impressions over weeks.

## Checks that keep this honest

`worker/test/seo.test.mjs` (titles, descriptions, canonicals, JSON-LD, sitemap, links, no prices or fake proof), `worker/test/contact.test.mjs` (the contact endpoint), and the Google Analytics guard in `worker/test/privacy.test.mjs` (off by default, consent first, no cookies of ours, no form contents).
