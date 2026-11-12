# spec.json, layout families and templates

`spec.json` sits in each post folder. `node social/engine/fw.mjs render <post-or-batch>` turns it into `slides/NN.png`. Working examples of every family: `social/examples/layout-families/posts/*/spec.json`.

```json
{ "id": "01", "slug": "strategy-before-logo", "format": "carousel", "size": "1080x1350", "slides": [ { "template": "type", "layout": "giant", "...": "..." } ] }
```
- `format`: `single` (1 slide), `carousel` (3–10 slides), `panorama` (one `canvas` slide spanning `"panels": N` slides, below), `reel` (1080x1920; a motion reel is one `canvas` slide with `"motion"`, below; the older static-overlay reel takes `"video"` and one `reel` slide and is built with `fw reel`).
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
| `colourReason` (`clientColour`) | required when a slide uses a colour that is neither Framework's palette nor in the batch `colour_plan` / the post's `cover_colour`: the reason |
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
| `iso` | **Framework's technical illustration** (frameworkco.ca's isometric linework, a core style). `x y w h`, `unit` (px per scene unit, default 60), `origin` [x, y] (where scene 0,0,0 lands in the box; default its centre), `stroke` (default `#FFFFFF`; `#0A0A0A` on light), `strokeWidth` (default 2.5 px, which reads like the site's 1 px lines on a phone), and `items`, drawn in order. Scene axes: x runs down-right, y down-left, z up. Items (`kind`): `grid` {x, y, z, w, d, step} hairline floor grid · `plate` {x, y, z, w, d, t} a slab (exploded layers) · `box` {x, y, z, w, d, h} a block or cube · `rect` {x, y, z, w, d, fill} a flat outline on a plane · `line` {points: [[x, y, z]…]} · `ring` {x, y, z, r} a circle on the plane · `dot` {x, y, z, r} solid · `drop` {x, y, z, to} a dashed construction line. Any item takes `dim` (42% line), `hl` (heavier line) or `dash`. Or `src: "@site/assets/img/ill/seo-dark.svg"` (also `website-`, `branding-`, `systems-`) to place the site's own drawing, restyled. Backgrounds: `#0A0A0A`, `#101010` or `#141414` |

**Mockup realism (hard rule):** never lay a design onto a photographed object. `fw check` fails a slide where a mark, vector graphic, swatch, or a blended or tilted layer sits over a photograph. Branded objects are generated with the artwork as a reference image (`art-direction.md`). Mark such slides `"mockup": "book"` (the object); the Director's full-size verdict goes in `<batch>/mockups.json` (`[{"post": "01", "slide": 1, "object": "book", "verdict": "pass" | "fail", "note": "..."}]`).

Every layer also takes `tilt` `{x, y, z}` (degrees, with perspective; for type and graphics on plain or illustrated grounds, never over a photograph), `clip` (a CSS clip-path for creative masks: `"polygon(0 0,100% 0,70% 100%,0 100%)"`, `"inset(0 40% 0 0)"`, `"circle(45% at 50% 50%)"`), `blend` (a CSS mix-blend-mode such as `multiply`), `rotate`, `opacity`, `z`, and, in a motion reel, `anim`. `background: "transparent"` leaves a reel's canvas clear over a video.

### Panorama (`"format": "panorama", "panels": 3`)
One `canvas` slide whose canvas is `panels × 1080` wide and 1350 high: design it as one picture. `fw render` saves `slides/panorama.png` (review) and cuts `01.png…NN.png` as exact crops, so neighbouring slides align to the pixel. Images, objects and colour may cross the seams; **text may not**: every text layer must sit inside one panel and 64px clear of each seam (render fails otherwise). Panel *k* (from 1) spans x = 1080·(k−1) to 1080·k. Panel 1 is the grid cover.

### Motion reel (`"format": "reel", "motion": { "duration": 8, "fps": 30, "coverAt": 5.5 }`)
One `canvas` slide at 1080x1920. Give layers `anim`, keyframes on one timeline in seconds:
```json
"anim": [ { "t": 0, "opacity": 0, "y": 80 }, { "t": 0.7, "opacity": 1, "y": 0, "ease": "cubic-bezier(.2,.7,.1,1)" }, { "t": 6, "scale": 1.06 } ]
```
Properties: `opacity`, `x`, `y` (px offsets from the layer's place), `scale`, `rotate` (deg), `blur` (px), `clip` (an inset() reveal, e.g. from `"inset(0% 100% 0% 0%)"` to `"inset(0% 0% 0% 0%)"`). Values hold before the first and after the last keyframe; `ease` applies to the move that starts at that keyframe. `fw render` renders every frame exactly and writes `slides/reel.mp4` (H.264, silent), `slides/reel-cover.png` (the frame at `coverAt`: the grid tile, of which the profile shows the middle 3:4) and `storyboard.png` (six frames, for review). With `"video": "images/clip.mp4"` (e.g. a Higgsfield clip; `"videoTreatment": "mono"` for black and white) the animated layers are composited over the clip; set `background: "transparent"`. Keep text in the safe area (x < 960, 120 < y < 1600): render warns.

Client typefaces: add `"fonts": [{ "family": "Barlow Semi Condensed", "src": "images/barlow-600.woff2", "weight": 600 }]` at the top of `spec.json` (download the woff2 from the `@fontsource` npm package with `npm pack`). Already available: `social/assets/clients/red-e/fonts/` (Barlow Semi Condensed 400–700; Red E's body face Inter is installed system-wide) and `social/assets/clients/aurora/fonts/` (Noto Sans, Noto Serif, Noto Sans Mono 400–700), each with its open font licence. Authentic website captures: `fw capture <url> <out.jpg> [desktop|mobile] [full]` into `social/assets/clients/<client>/` (2880px desktop, 1170px-wide mobile).

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
| `reel` | transparent overlay for the older static Reel (`fw reel`); motion reels use `canvas` |

## Image slots and Higgsfield aspect ratios
| Slot | Area | Generate at |
|---|---|---|
| `photo` (both layouts) | 1080x1350 | `4:5` |
| `split` half | ~540x1350 | `2:3` (crop) or `9:16` |
| `plate` | 904 × 600 | `3:2` |
| `cover` band | 1080 × ~600 | `16:9` or `3:2` |
| `point` band | 904 × ~420 | `16:9` or `21:9` |
| `reel` clip / motion reel image | 1080x1920 | `9:16` |
| panorama background | (panels × 1080) × 1350 | `21:9` for 3 panels (crop), or one image per panel area |

Render messages: `ok`, `WARN` (fine, but look: auto-scaled text, low-resolution image), `FAIL` (must fix: overflow, unintended headline wrap, missing image, fonts not loaded).
