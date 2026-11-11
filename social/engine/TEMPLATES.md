# spec.json, layout families and templates

`spec.json` sits in each post folder. `node social/engine/fw.mjs render <post-or-batch>` turns it into `slides/NN.png`. Working examples of every family: `social/examples/layout-families/posts/*/spec.json`.

```json
{ "id": "01", "slug": "strategy-before-logo", "format": "carousel", "size": "1080x1350", "slides": [ { "template": "type", "layout": "giant", "...": "..." } ] }
```
- `format`: `single` (1 slide), `carousel` (3–10 slides; adds `01 / 06` counters and → cues), `reel` (adds `"video": "images/clip.mp4"`, optional `"coverAt": 1.5`; size defaults to 1080x1920; one `reel` slide).
- `size`: default `1080x1350` (4:5 feed). `1080x1080` also works.

## One system, many compositions
The **constants** keep the feed recognisable: Switzer and General Sans, ink/paper/greys, the eyebrow, hairlines and sharp corners. The **layout family** changes the silhouette. A family is `template` + `layout` (e.g. `type:giant`, `photo:caption`, `plate`). The grid check (`fw grid`) refuses two neighbouring covers in the same family.

**Covers** (slide 1) should make someone stop: pick the family that fits the idea and differs from the neighbours. **Interior slides** stay consistent for reading: `point`, `list`, `compare`, `diagram`, `quote`, `statement`, `cta`.

| Visual category | Cover families | Notes |
|---|---|---|
| Editorial typography | `type:bottom`, `type:top`, `type:giant`, `type:split`, `statement`, `cover` | Oversized type, varied position and scale; `align: "right"` flips it |
| Architectural photography | `photo` (panel), `photo:caption`, `plate`, `split`, `cover` with image | Higgsfield or site photos, black and white by default |
| Portfolio | `showcase`, `plate`, `split`, `quote` (real client words) | Real client work only; client colour allowed (`imageTreatment: "none"`) |
| Conceptual artwork | `photo:caption`, `plate`, `split` with a Higgsfield concept image | Set `"category": "conceptual-artwork"` on the slide; colour allowed when it earns it |
| Educational graphic | `diagram` (flow, bars), `compare`, `list` | Bars only with real, sourced numbers (`source` is printed) |
| Minimalist | `minimal` | One short line, lots of space; use sparingly |

## Fields every slide takes
| Field | Notes |
|---|---|
| `template`, `layout` | the family (tables above and below) |
| `theme` | `paper` (default), `ink` (default for `cta`), `mist` |
| `category` | overrides the default visual category of the family (e.g. `conceptual-artwork`) |
| `grid` | `true` draws the 90px hairline grid behind the slide |
| `eyebrow` | optional `— LABEL` at the top, with no rule. Use only where it orients the reader; never on every slide |
| `header` | `true` brings back the ruled header (eyebrow + hairline) for a deliberate specification look. No slide numbers: Instagram shows its own |
| `clientColour` | required whenever a slide uses colours outside Framework's palette: the reason (e.g. "Red E Corp.'s brand palette") |
| `intentionalSpace` | the reason a type-only slide is mostly empty (a deliberate pause); otherwise `fw check` warns |
| `plainLanguageOk` | rare: why a specialist term must stay on the slide |
| `headline` | `\n` = deliberate line break. 2–4 short lines |
| `support` | one or two short sentences |
| `image` | `@site/assets/img/x.jpg` (repo image) or `images/x.png` (this post's folder). Never a URL |
| `imageFocus` | CSS object-position, e.g. `"50% 30%"` |
| `imageTreatment` | `mono` (default), `muted`, `none`. Colour (`muted`/`none`) only inside portfolio, photography or conceptual imagery when it improves the composition |
| `source` | citation for a fact on the slide, printed small under the content ("Source: …") |
| `brand` | **intentional branding only**: `{ "element": "mark" \| "lockup", "size": 240, "reason": "why the logo belongs to this concept" }`. Rendered large (160px minimum) inside the composition on `statement`, `type`, `minimal` and `cta`. Refused without a reason |
| `headlineSize`, `supportSize`, `giantSize`, `itemsSize`… | starting px. The fitter shrinks text to fit (down to 72%) and reports it |

Inline markup in any text: `{{muted text}}` (grey), `**semibold**`. Quotes and apostrophes are set typographically. No italics, no emoji.

## Branding (owner rule, 2026-11-11)
Framework branding never appears automatically: no logo, wordmark or website URL in corners, along the bottom, as a footer strip or as a watermark, and no logo added just to say who made the post. Branding appears only when it is an intentional part of the concept (the logo on a product or stationery mockup, signage, packaging, a branding showcase, a post about Framework's own identity, a deliberate logo-led composition). Removed branding is never replaced by another repeated decorative element.
- No template places the mark, wordmark or `frameworkco.ca` anywhere by default; there is no footer.
- To brand a slide on purpose, set `brand` with a `reason`. At most one branded slide per post. A logo inside a photograph or mockup (Higgsfield or real) is part of the image, not a stamp.
- A website URL may appear only as content: a CTA button (`button`) or a sentence. Never as a signature.
- `fw render` writes `slides/render.json` (every brand element and every "Framework"/URL text with its position). `fw check` fails a post with a brand element under 160px, a mark in a corner, a name or URL along the bottom edge, a brand without a reason, a retired `footer` field, or brand elements on more than one slide.

## canvas: free compositions (the default for covers, portfolio and visual storytelling)
Read `social/brand/art-direction.md` first. A canvas slide is a stack of layers placed in canvas pixels (`x`, `y`, `w`, `h`; numbers or `"50%"`), later layers on top. Layers may bleed off the edge (they are clipped by the canvas). Set `layout` to the composition's name (`hero-bleed`, `device-pair`, `detail-crop`, `colour-system`, `type-specimen`, `frame-break`, `annotated`, `statement`…): it is the layout family for the grid check. Set `background` (a hex or `theme`).

| Layer `type` | Fields |
|---|---|
| `image` | `src`, `x y w h`, `fit` (`cover`/`contain`), `focus` ("50% 30%"), `crop` `{x, y, w, h}` as 0–1 fractions to zoom into a detail, `treatment` (`mono`/`muted`/none = original colour), `mask` (`circle`, `arch`), `rotate`, `opacity` |
| `laptop`, `phone` | `src` (a screenshot), `x y w`, `scroll` 0–1 down a tall capture, `tilt` `{x, y, z}` degrees, `shadow` (default on; `false` to remove). Real device frames from the website; a soft shadow is allowed on device and print mockups only |
| `browser` | `src`, `x y w h`, `url` (shown in the bar), `scroll`, `shadow` |
| `text` | `text` (markup as elsewhere), `x y w` (`h` makes it a fit box), `font` (`display` Switzer, `body` General Sans, or a family from `spec.fonts`), `size`, `weight`, `leading`, `tracking` (em), `color`, `align`, `uppercase`, `bleed: true` if it may run off the canvas. Display text must keep its written line breaks |
| `rect` | `x y w h`, `fill`, `stroke` (1px): frames, colour fields, rules where they help |
| `swatch` | `x y w h`, `color`, `name`, `label` (defaults to the hex): colour-system slides |
| `svg` | `src` (e.g. `@site/assets/img/red-e-crest.svg`), `x y w h`: crisp vector marks at any size |
| `brand` | Framework's mark, only with `reason` (branding rule) |

Client typefaces: add `"fonts": [{ "family": "Barlow Semi Condensed", "src": "images/barlow-600.woff2", "weight": 600 }]` at the top of `spec.json` (download the woff2 from the `@fontsource` npm package with `npm pack`). Authentic website captures: `fw capture <url> <out.jpg> [desktop|mobile] [full]` into `social/assets/clients/<client>/` (2880px desktop, 1170px-wide mobile).

## Templates
| Template | Layouts / extra fields |
|---|---|
| `type` | `layout`: `bottom` (default), `top`, `giant` (`giant`: one word at ~400px, `bleed: true` lets it run off the edge), `split` (`headline` top-left, `headline2` bottom-right); `align: "right"` |
| `minimal` | `position`: `center`, `top-left`, `bottom-left`, `bottom-right`; `rule: false` drops the short rule |
| `photo` | full-bleed photo. Default: solid panel with eyebrow, headline, support. `layout: "caption"`: small label block, maximum image |
| `plate` | architecture-monograph page: framed photo (`imageHeight`, default 600), `figure` caption (default "Fig. 01") |
| `split` | photo full height + text column. `side: "left"`/`"right"`, `cols: "1.15fr 1fr"` |
| `showcase` | portfolio stage: `image` (desktop view), `image2` (phone view, optional; `image2Side: "left"` moves it), `tags: ["Website", "Brand"]`, `imageHeight` (default 640); colour on by default |
| `diagram` | `kind: "flow"` (`items: [{title, desc}]`, `active: 3` fills a step) or `kind: "bars"` (`items: [{label, value, display}]`, `source`) |
| `cover` | eyebrow + big headline anchored low; optional photo band (`image`, `imageHeight`) |
| `statement` | one big idea; `align: "end"` anchors it low |
| `point` | carousel interior: title, `body`, optional photo band; a large grey `index` only if set |
| `list` | numbered rows (3–6): `items: [{title, desc}]` |
| `compare` | `leftLabel`, `rightLabel`, `rows: [[l, r]]` (2–4 rows) |
| `quote` | `quote`, `name`, `role`: verbatim, real, attributed |
| `cta` | closing slide: headline, support, `button` (no logo unless `brand` is set on purpose) |
| `reel` | transparent overlay for a Reel (`fw reel`) |

## Image slots and Higgsfield aspect ratios
| Slot | Area | Generate at |
|---|---|---|
| `photo` (both layouts) | 1080x1350 | `4:5` |
| `split` half | ~540x1350 | `2:3` (crop) or `9:16` |
| `plate` | 904 × 600 | `3:2` |
| `cover` band | 1080 × ~600 | `16:9` or `3:2` |
| `point` band | 904 × ~420 | `16:9` or `21:9` |
| `reel` clip | 1080x1920 | `9:16` |

Render messages: `ok`, `WARN` (fine, but look: auto-scaled text, low-resolution image), `FAIL` (must fix: overflow, unintended headline wrap, missing image, fonts not loaded).
