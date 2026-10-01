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
worker/index.js         Cloudflare Worker: /api/feedback (store) and /api/feedback/export
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
