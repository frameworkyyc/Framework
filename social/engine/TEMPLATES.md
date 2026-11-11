# spec.json, layout families and templates

`spec.json` sits in each post folder. `node social/engine/fw.mjs render <post-or-batch>` turns it into `slides/NN.png`. Working examples of every family: `social/examples/layout-families/posts/*/spec.json`.

```json
{ "id": "01", "slug": "strategy-before-logo", "format": "carousel", "size": "1080x1350", "slides": [ { "template": "type", "layout": "giant", "...": "..." } ] }
```
- `format`: `single` (1 slide), `carousel` (3–10 slides; adds `01 / 06` counters and → cues), `reel` (adds `"video": "images/clip.mp4"`, optional `"coverAt": 1.5`; size defaults to 1080x1920; one `reel` slide).
- `size`: default `1080x1350` (4:5 feed). `1080x1080` also works.

## One system, many compositions
The **constants** keep the feed recognisable: Switzer and General Sans, ink/paper/greys, the eyebrow, hairlines, sharp corners and the Framework mark (drawn by the engine, never recoloured). The **layout family** changes the silhouette. A family is `template` + `layout` (e.g. `type:giant`, `photo:caption`, `plate`). The grid check (`fw grid`) refuses two neighbouring covers in the same family.

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
| `eyebrow` | shown as `— LABEL`. Short: 1–4 words |
| `headline` | `\n` = deliberate line break. 2–4 short lines |
| `support` | one or two short sentences |
| `image` | `@site/assets/img/x.jpg` (repo image) or `images/x.png` (this post's folder). Never a URL |
| `imageFocus` | CSS object-position, e.g. `"50% 30%"` |
| `imageTreatment` | `mono` (default), `muted`, `none`. Colour (`muted`/`none`) only inside portfolio, photography or conceptual imagery when it improves the composition |
| `footer` | overrides the bottom-right text (default `→` mid-carousel, `frameworkco.ca` at the end) |
| `headlineSize`, `supportSize`, `giantSize`, `itemsSize`… | starting px. The fitter shrinks text to fit (down to 72%) and reports it |

Inline markup in any text: `{{muted text}}` (grey), `**semibold**`. Quotes and apostrophes are set typographically. No italics, no emoji.

## Templates
| Template | Layouts / extra fields |
|---|---|
| `type` | `layout`: `bottom` (default), `top`, `giant` (`giant`: one word at ~400px, `bleed: true` lets it run off the edge), `split` (`headline` top-left, `headline2` bottom-right); `align: "right"` |
| `minimal` | `position`: `center`, `top-left`, `bottom-left`, `bottom-right`; `rule: false` drops the short rule |
| `photo` | full-bleed photo. Default: solid panel with eyebrow, headline, support. `layout: "caption"`: small label block, maximum image |
| `plate` | architecture-monograph page: framed photo (`imageHeight`, default 600), `figure` caption (default "Fig. 01") |
| `split` | photo full height + text column. `side: "left"`/`"right"`, `cols: "1.15fr 1fr"` |
| `showcase` | portfolio stage: `image` (desktop view), `image2` (phone view, optional), `tags: ["Website", "Brand"]`, `imageHeight` (default 640); colour on by default |
| `diagram` | `kind: "flow"` (`items: [{title, desc}]`, `active: 3` fills a step) or `kind: "bars"` (`items: [{label, value, display}]`, `source`) |
| `cover` | eyebrow + big headline anchored low; optional photo band (`image`, `imageHeight`) |
| `statement` | one big idea; `align: "end"` anchors it low |
| `point` | carousel interior: big grey index, title, `body`, optional photo band |
| `list` | numbered rows (3–6): `items: [{title, desc}]` |
| `compare` | `leftLabel`, `rightLabel`, `rows: [[l, r]]` (2–4 rows) |
| `quote` | `quote`, `name`, `role`: verbatim, real, attributed |
| `cta` | closing slide: mark, headline, `button` |
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
