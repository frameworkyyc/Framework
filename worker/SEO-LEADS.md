# SEO-led Leads

Admin -> Leads finds local businesses that would gain the most from better search visibility. Website availability is a secondary diagnostic.

## Data flow
1. **Finder (`framework-leadgen`) measures.** The weekly discovery already runs a Google Places text search per trade and city; it now records each result's position in `search_results` (no extra API cost). A new step (`ASSESS_PER_RUN`, default 2 per 5-minute run) stores one versioned snapshot per qualified lead in `seo_assessments`: Maps position, the home page read for on-page and technical SEO, robots.txt and sitemap, Lighthouse via PageSpeed Insights (free, uses the existing `GOOGLE_API_KEY`), the other businesses in the same search (median reviews and rating, the top three home pages), and, only if `SERP_PROVIDER` and `SERP_API_KEY` are set, Google organic positions.
2. **Admin scores.** `worker/seo-score.js` (pure, versioned) turns a snapshot into the SEO Opportunity Score. `syncFinder` imports only assessed leads scoring at least the `SEO_IMPORT_THRESHOLD` variable (default 35, whole number 0 to 100); `syncAssessments` refreshes existing leads' snapshots without touching notes, status, drafts or the timeline.
3. **Report.** `worker/seo-report.js` builds one model and renders the Admin card, Markdown for ChatGPT/Claude ("Copy for AI") and a PDF. Routes: `GET /api/admin/leads/:id/seo-report` and `/seo-report.pdf`.
4. **Outreach.** `seoFact` in `worker/leads.js` gives the first email only measured facts (Maps position for the exact search, or a problem read from the home page). No competitor names, no "last", no promises.

## Score (version 1)
Maps visibility 25, Google Search rankings 25, on-page and technical 25, competitor gap 15, reputation to build on 10. A signal that was not measured is **left out** and the rest renormalised; below 40% coverage no score is given. The score is an **estimate**; positions and page facts are **measured** and show their source and date. "Not among the first N results" is only said for the N actually checked.

## Google Search rankings (Serper)
The finder checks a fixed set of keywords per trade (table `rank_keywords`; renovations in Calgary, Alberta first, three enabled and two on file) once a week through Serper (`SERPER_API_KEY`, a secret on `framework-leadgen`). Each check stores the top 100 organic results with their real positions (`serp_results`), and leads are matched by their own domain (www and subdomains; never a social page). A lead's assessment then records, per keyword, its position or that it was not among the N results checked, with the location and date. Maps position and Google Search position stay separate (two score components). A keyword that was not checked gives no entry, and a signal with no data is left out of the score, never counted against the business.

Cost control: `SERPER_CREDIT_LIMIT` is a hard monthly limit on credits (default 250); usage is the credits the API reports, summed per calendar month in `serp_checks`, and a request is not made when the remaining credits cannot cover it. A keyword with a good check in the last 7 days is never searched again, a failed one waits an hour, and no search is ever made per lead. `RANK_PER_RUN` (default 1) keeps checks spread across runs.

## Limits
- The Maps position is the Places API result order for one search from one location; it is close to, not identical to, what a person sees.
- Organic rankings cover only the tracked keywords, from one location, and the 100 results checked; "not found" means not among those.
- On-page checks read the home page only; a site that blocks automated visits is reported as unreadable, not as bad.

## Website verification
"Mark as Working" sets `site_status = online` and `site_verified_at`; the automatic check then skips that lead. Diagnostics sit in a collapsed "Website check (technical)" section.

## Rollout
Migration `0025_seo_leads.sql` (4 nullable columns on `outreach_leads`) is **proposed**, not applied. Until it and the finder tables exist, every SEO feature is dormant and Leads works as before. The finder tables are in `framework-leadgen/schema.sql`.
