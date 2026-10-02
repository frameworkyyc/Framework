# Framework — frameworkco.ca

Static website for Framework. Plain HTML, CSS, and JavaScript — no build step, no framework, no dependencies. Hosted on Cloudflare (static assets plus one small Worker for the private client feedback form); the pages themselves also work on any static host.

## Structure

```
index.html          Home
about.html          About
services.html       Services (anchors: #strategy #branding #website #digital-presence #systems #automation #growth)
method.html         The Framework Method
portfolio.html      Portfolio
contact.html        Contact form
client-feedback.html  Private client feedback form (unlisted, noindex) → /client-feedback
404.html            Not-found page
assets/css/styles.css   All styling (brand tokens at the top)
assets/js/main.js       Mobile menu, image placeholders, contact form, Red E mockup
assets/js/feedback.js   Client feedback form (steps, validation, submit)
assets/js/live-demos.js Live website demos inside the portfolio mockups. The Aurora demo URL is set at the top of this file:
                        `production` (frameworkco.ca) is null = screenshots; `preview` (everything else) = the staging demo
worker/index.js         Cloudflare Worker entry: /api/feedback (store), /api/feedback/export, routes /admin
worker/shared.js        Columns, schema, JSON/CSV helpers shared by the form and the admin
worker/admin/           Framework Admin back end: Access token check (access.js), API (feedback-api.js), router
worker/test/            Unit tests for the admin authentication (node --test worker/test/*.test.mjs)
admin/                  Framework Admin front end (static app served only after authentication)
migrations/             Reference SQL for the feedback table (the Worker also creates it)
wrangler.jsonc          Cloudflare config (static assets, Worker, D1 database)
_headers                Security headers for the feedback page
assets/img/             Logo, favicons, social share image, photos
CNAME               Custom domain for GitHub Pages
sitemap.xml, robots.txt
```

## 1. Photos

All photos are included in `assets/img/`. The stylesheet shows Framework's own photos in black and white, so colour originals are fine. Client case studies on the portfolio page keep their original colour. To swap a photo, replace the file with one of the same name, ideally around 1000px wide and under ~300 KB.

## 2. Contact form

The form needs no setup. On submit it opens the visitor's email app with a pre-filled message to hello@frameworkco.ca (a `mailto:` link). To change the recipient, edit the `data-mailto` attribute on the form in `contact.html`.

## 2b. Client feedback form (private)

`/client-feedback` is a permanent feedback form to send to clients after a project. It is **not** linked from the navigation, footer, or `sitemap.xml`, is not listed in `robots.txt`, and carries `noindex, nofollow` (meta tag plus an `X-Robots-Tag` header from `_headers`).

**How responses are stored.** The form posts JSON to `/api/feedback`, handled by `worker/index.js`, which validates every field on the server and saves one row per submission in a Cloudflare **D1** database (`framework-feedback`, binding `DB`). Nothing is stored in the page source or in the browser. Repeat submissions of the same form are ignored (each page load has a unique id), a hidden honeypot field silently drops bots, and the Worker accepts at most 40 submissions per 10 minutes site-wide.

**One-time setup (Cloudflare):**

1. **Database.** Create the D1 database `framework-feedback` (`npx wrangler d1 create framework-feedback`) and put its `database_id` in `wrangler.jsonc` in **both** places: the top-level `d1_databases` (normal deploys) and `previews.d1_databases` (branch builds such as Staging run `wrangler preview`, and a Preview does **not** inherit top-level bindings; without the `previews` entry the form fails with `503 storage_not_configured`). The table creates itself on the first submission; `migrations/0001_create_feedback_responses.sql` is only a reference.
2. **Set an export token** (a long random string only you know). Secrets are not shared with Previews: for Staging use `npx wrangler preview secret put FEEDBACK_EXPORT_TOKEN --name Staging`, or skip it, the export then answers 404 on Staging:
   `npx wrangler secret put FEEDBACK_EXPORT_TOKEN`
   (Or in the dashboard: Workers & Pages → framework → Settings → Variables and Secrets → add a *Secret* named `FEEDBACK_EXPORT_TOKEN`.) Until it is set, the export endpoint answers 404.
3. The form needs the Cloudflare Worker to be running. On a plain static host such as GitHub Pages `/api/feedback` does not exist, so submitting shows an error asking people to email hello@frameworkco.ca.

**Reviewing and exporting responses.**

- Spreadsheet export (opens in Excel / Sheets):
  `curl -H "Authorization: Bearer YOUR_TOKEN" https://frameworkco.ca/api/feedback/export -o feedback.csv`
  Add `?format=json` for JSON. The token goes in the header only, never in the URL.
- Browse or query: Cloudflare dashboard → Storage & Databases → D1 → `framework-feedback` → Explore data / Console, or
  `npx wrangler d1 execute framework-feedback --remote --command "SELECT * FROM feedback_responses ORDER BY created_at DESC"`.

Revenue is optional and is stored per response (it needs to be to produce combined statistics); only ever publish combined figures. To delete a response: `DELETE FROM feedback_responses WHERE id = '...'` in the D1 console.

**Local testing:** `npx wrangler dev --var FEEDBACK_EXPORT_TOKEN:test` serves the site and the API with a local D1 database (kept in `.wrangler/`, which is git-ignored).

## 2c. Framework Admin (private)

`/admin` is an internal admin area. Today it has two working modules, **Overview** and **Feedback** (`/admin/feedback`, and one response at `/admin/feedback/<id>`); the other modules are listed as "Later" in the sidebar and do nothing yet. It reads the same D1 table the feedback form writes to (`feedback_responses`); there is no second database.

**Security model (read this before changing anything).** Two independent locks:

1. **Cloudflare Access** is the front door for `/admin*` and `/api/admin*`: nobody reaches the app without logging in.
2. **The Worker verifies the Access token itself** on every `/admin` and `/api/admin` request (`worker/admin/access.js`): RS256 signature against your team's published keys, issuer, audience, expiry, and that the email is in `ADMIN_EMAILS`. If any setting is missing it denies everything. So a wrong Access policy, a `workers.dev` URL or a Preview URL still cannot reveal any feedback. Static admin files are only served after this check (they are listed under `assets.run_worker_first`).

Writes (mark reviewed, delete) additionally require a same-origin request with the `X-Framework-Admin` header, which blocks cross-site request forgery. Admin authorisation is separate from any future client login: a valid Access login alone does not make someone an admin.

**One-time Cloudflare setup**

1. *Create the Access application.* Zero Trust dashboard → **Access → Applications → Add an application → Self-hosted**. Add these destinations (repeat for `staging.frameworkco.ca` if you want Staging protected too):
   `frameworkco.ca` path `/admin*`, and `frameworkco.ca` path `/api/admin*`.
   Add a policy: **Allow**, Include → **Emails** → your email address. Login method: One-time PIN is fine. Save.
2. *Copy two values.* From the application's overview, the **Application Audience (AUD) Tag**. And your **team domain** (Zero Trust → Settings → General → Team domain), which looks like `yourteam.cloudflareaccess.com`.
3. *Set three secrets on the Worker* (secrets survive deploys, unlike plain variables):
   ```
   npx wrangler secret put ACCESS_TEAM_DOMAIN     # yourteam.cloudflareaccess.com
   npx wrangler secret put ACCESS_AUD             # the AUD tag (several, comma-separated, are allowed)
   npx wrangler secret put ADMIN_EMAILS           # you@yourdomain.com  (comma-separated for more than one admin)
   ```
   **Staging** is a Preview and does not share these. Put the three values in a file (`.env` format, e.g. `staging-secrets.env`, never committed) and run
   `npx wrangler preview secret bulk staging-secrets.env --name Staging`, or set them once for every Preview with `npx wrangler preview base-config secret put <KEY>`.
4. *Enable "Reviewed" (optional).* The Feedback pages work without it. To turn it on, run **once** in the D1 console (or `npx wrangler d1 execute framework-feedback --remote --file migrations/0002_add_reviewed_at.sql`):
   `ALTER TABLE feedback_responses ADD COLUMN reviewed_at TEXT;`
   It adds one empty column and changes no existing data; the admin notices within about 30 seconds. A second run fails harmlessly ("duplicate column").

**Admin API** (all require the Access token; JSON, never cached): `GET /api/admin/me`, `/api/admin/overview`, `/api/admin/feedback`, `/api/admin/feedback/<id>`, `/api/admin/feedback/export` (CSV of everything), `/api/admin/feedback/<id>/export` (CSV, or `?format=json`), `PATCH /api/admin/feedback/<id>` (`{"reviewed": true|false}`), `DELETE /api/admin/feedback/<id>`.

The older `GET /api/feedback/export` (bearer token) still works unchanged; the admin's **Export CSV** button replaces its day-to-day use.

**Adding a module later** (Clients, Projects, Files…): add `admin/assets/<name>.js` exporting `render(ctx)`, switch the entry in `admin/assets/modules.js` to `enabled: true`, and add an API handler to the list in `worker/admin/router.js`. The shell, navigation and router need no changes.

**Local testing.** `node --test worker/test/*.test.mjs` runs the authentication tests. To try the admin under `npx wrangler dev`, you need a signed test token; the tests show how to mint one, and `ACCESS_JWKS_JSON` can pin test keys locally (leave it unset in real deployments).

**"Needs attention"** in the Feedback filters means: satisfaction or recommendation of 6 or below, any 1–5 rating of 2 or below, or the new site rated "Worse" than before.

## 2d. Combined client revenue (homepage)

The homepage shows one number, "Combined annual client revenue", and nothing else about revenue. Individual client figures are private: they live in `worker/clients.json` (never served as a file) and are only read by the Worker, which adds them up, rounds the total down and serves just that total at `/api/client-revenue`. To add a figure, set that client's `revenue` to a number in `worker/clients.json` (use the lower bound of a range; only with the client's permission) and deploy. The block stays hidden until at least one figure exists.

## 3. Publish on GitHub Pages

1. Create a new repository on GitHub (e.g. `frameworkco.ca`).
2. Upload everything in this folder to the repository root — including the hidden `.nojekyll` file. (On github.com: **Add file → Upload files**, then drag the folder contents in.)
3. Go to **Settings → Pages**. Under "Build and deployment", choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
4. The `CNAME` file sets the custom domain to `frameworkco.ca`. Confirm it appears under **Settings → Pages → Custom domain**.

### DNS (at your domain registrar)

Point the domain away from the current host to GitHub Pages:

- **Apex (`frameworkco.ca`)** — four `A` records:
  `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
- **`www`** — a `CNAME` record pointing to `<your-github-username>.github.io`

DNS changes can take up to 24 hours. Once GitHub shows the certificate is ready, tick **Enforce HTTPS**.

## Editing

- **Copy:** edit the text directly in each `.html` file. The header and footer are repeated on every page, so a nav or footer change needs to be made in all seven files.
- **Colours, type, spacing:** the brand tokens are at the top of `assets/css/styles.css`. The palette is Ink `#0A0A0A`, Paper `#FFFFFF`, Slate `#5C5C5C`, Stone `#A3A3A3`, Hairline `#E0E0E0`, Mist `#F5F5F5`.
- **Fonts:** Switzer and General Sans load from Fontshare. If they fail to load, the site falls back to Space Grotesk / Inter / Helvetica.
- **Hero drawing:** the animated mark on the home page is inline SVG in `index.html`; its timing is controlled by the `.dw-*` rules in the stylesheet. It shows its finished state immediately for visitors who have reduced motion turned on.
- **Portfolio:** to turn a "coming soon" tile into a real client, copy the West Peak `<article>` block in `portfolio.html` and swap in the new logo, name, and scope.
