# Framework — frameworkco.ca

Static website for Framework. Plain HTML, CSS, and JavaScript — no build step, no framework, no dependencies. Built to be hosted on GitHub Pages.

## Structure

```
index.html          Home
about.html          About
services.html       Services (anchors: #strategy #branding #website #digital-presence #systems #automation #growth)
method.html         The Framework Method
portfolio.html      Portfolio
contact.html        Contact form
404.html            Not-found page
assets/css/styles.css   All styling (brand tokens at the top)
assets/js/main.js       Mobile menu, image placeholders, contact form
assets/img/             Logo, favicons, social share image, photos
CNAME               Custom domain for GitHub Pages
sitemap.xml, robots.txt
```

## 1. Photos

All photos are included in `assets/img/`. The stylesheet shows Framework's own photos in black and white, so colour originals are fine. Client case studies on the portfolio page keep their original colour. To swap a photo, replace the file with one of the same name, ideally around 1000px wide and under ~300 KB.

## 2. Contact form

The form needs no setup. On submit it opens the visitor's email app with a pre-filled message to hello@frameworkco.ca (a `mailto:` link). To change the recipient, edit the `data-mailto` attribute on the form in `contact.html`.

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
