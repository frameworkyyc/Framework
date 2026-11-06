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
