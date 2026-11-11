# spec.json and templates

`spec.json` sits in each post folder. `node social/engine/fw.mjs render <post-or-batch>` turns it into `slides/NN.png`.

```json
{ "id": "01", "slug": "strategy-before-logo", "format": "carousel", "size": "1080x1350", "slides": [ { "template": "cover", "...": "..." } ] }
```
- `format`: `single` (1 slide), `carousel` (3–10 slides; adds `01 / 06` counters and → cues), `reel` (adds `"video": "images/clip.mp4"`, optional `"coverAt": 1.5`; size defaults to 1080x1920; one `reel` slide).
- `size`: default `1080x1350` (4:5 feed). `1080x1080` also works.

## Fields every slide takes
| Field | Notes |
|---|---|
| `template` | one of the templates below |
| `theme` | `paper` (default), `ink` (default for `cta`), `mist`. Use ink as punctuation: at most one ink slide per carousel plus the CTA, and no more than about a third of singles in a batch |
| `grid` | `true` draws the 90px hairline grid behind the slide. Good on `statement` |
| `eyebrow` | shown as `— LABEL` in the header. Short: 1–4 words |
| `headline` | `\n` = deliberate line break. 2–4 short lines |
| `support` | one or two short sentences |
| `image` | `@site/assets/img/x.jpg` (repo image) or `images/x.png` (this post's folder). Never a URL |
| `imageFocus` | CSS object-position, e.g. `"50% 30%"` |
| `imageTreatment` | `mono` (default, black and white), `muted`, `none` (only for client work whose own palette is the point) |
| `footer` | overrides the bottom-right text (default `→` mid-carousel, `frameworkco.ca` at the end) |
| `headlineSize`, `supportSize`, … | starting px. Rarely needed: the fitter shrinks text to fit (down to 72%) and reports it |

Inline markup in any text: `{{muted text}}` (grey), `**semibold**`. No italics, no emoji.

## Templates
| Template | Use | Extra fields |
|---|---|---|
| `cover` | Carousel opener or text-led single. Huge Switzer headline anchored low | `image` + `imageHeight` (default 600) adds a full-width photo band on top |
| `photo` | Full-bleed photograph with a solid panel (no gradient) carrying eyebrow, headline, support | `image` (required; 4:5 source, 1080px+ wide) |
| `statement` | One big idea. Pairs with `grid: true` or `theme: ink` | `align: "end"` to anchor low |
| `point` | Carousel inner slide: big grey index, title, body | `index` ("02"), `body`, optional `image` + `imageHeight` (default 420) |
| `list` | Numbered rows with hairlines (3–6 rows) | `items: [{title, desc}]` |
| `compare` | Two columns, e.g. common way vs Framework way (2–4 rows) | `leftLabel`, `rightLabel`, `rows: [[l, r]]` |
| `quote` | Verbatim, attributed quotation (real sources only) | `quote`, `name`, `role` |
| `cta` | Closing slide: mark, headline, button | `button` ("Book a consultation") |
| `reel` | Transparent overlay for a Reel: lockup top-left, ink panel at the bottom | eyebrow, headline, support |

## Image slots and Higgsfield aspect ratios
| Slot | Area | Generate at |
|---|---|---|
| `photo` | 1080x1350 | `4:5` |
| `cover` band | 1080 × imageHeight (≈600) | `16:9` or `3:2` |
| `point` band | 904 × imageHeight (≈420) | `16:9` or `21:9` |
| `reel` clip | 1080x1920 | `9:16` |

Render messages: `ok`, `WARN` (fine, but look: auto-scaled text, low-resolution image), `FAIL` (must fix: overflow, unintended headline wrap, missing image, fonts not loaded).
