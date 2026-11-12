# Art direction: how Framework posts are designed

The standard: the feed should look like a premium creative studio's Instagram portfolio, never a deck of presentation slides. **The content decides the composition; a template never does.** Every slide is art-directed, not populated with text. Framework's identity stays constant (Switzer and General Sans, restraint, quality, its black-and-white mark); the execution varies, and supporting imagery and concepts may use a planned editorial palette (below).

**Owner direction, 2026-11-11 (second overhaul).** The first art-directed batch still read as slides and is archived, never published. From now on: full-bleed photography and artwork, edge-to-edge compositions, editorial typography with real hierarchy, creative masking and layered imagery, lifestyle and environmental scenes, physical brand applications (print, signage, stationery, packaging, books), and striking conceptual artwork. Minimal text; no labels, dividers or numbering by habit; no excessive empty space.

Read with `brand-system.md` (rules) and `engine/TEMPLATES.md` (how to build it). The owner's reference set (2026-11-11: a brand-identity carousel, architectural visualisation studios, a studio profile grid, Framework's own site) is for direction only. Learn from it; never reproduce a reference's layout, artwork or branding.

## What the references teach
- **Full-bleed first.** The strongest posts give the whole canvas to one image: a building corner in fog, a car from directly above on cracked earth, a house rendered against a pale sky. Type is small, or absent.
- **A carousel is a story with roles, and each slide looks different.** One brand-identity carousel moved from the mark large on its brand colour, to a printed report in a box, to posters on a wall, to a type specimen, to the colour system, to stacked business cards. Every slide was a different composition, yet all were unmistakably one identity.
- **Real applications sell the work.** Identity shown on paper, signage, cards and screens is believable; a logo on a blank slide is not.
- **Masking and layering create depth.** An image extends beyond its frame; line drawings and annotations sit over a photograph; objects overlap.
- **Negative space is deliberate,** reserved for one strong element, never left over because a template had a box there.
- **Minimal text.** A slide can be only an image, only a word, or only a specimen.
- **Specimens and systems are beautiful content:** a typeface shown at display size with its weights, a colour palette as large fields with names and values.

## Aesthetic standard (non-negotiable)
**Owner rule, 2026-11-12. Editorial. Architectural. Industrial. Premium.** Every post, carousel, panorama and Reel must reach the visual quality and aesthetic of the reference set in `social/brand/references/aesthetic/` (ref-01 to ref-13). This governs the visual treatment, not the subject: vehicles, products, businesses, architecture and abstract ideas are all fine when art-directed this way. Framework's brand identity stays as it is; colour is used creatively.

**What the references show**
| Ref | What it teaches |
|---|---|
| 01, 07 | Print and stationery as real objects: a brand book in a cloth clamshell, stacked cards shot top-down. Neutral grey or white ground, one hard shadow, one saturated accent against charcoal. |
| 03 | Cinematic scale from directly above: a real, precisely made product in a real landscape (a car on cracked earth). It works because the object, the ground and the light are all physically true; never imitate it with an empty pad and a lone figure. |
| 04 | Creative masking: a photograph escapes its rectangular frame onto white; the subject breaks the boundary. |
| 05 | Hybrid: architectural line drawing and annotations laid over the photograph they describe; construction lines as content. |
| 06, 08, 09 | Systems as editorial pages: a type specimen at monumental scale with refined small text, a colour system with tints and values, a mark derived step by step. Calm grounds, strict alignment, generous space. |
| 11 | Identity in architecture: a monochrome building corner in hard daylight, the mark large and integrated into the facade. |
| 12 | Confidence: one mark on one flat saturated field. |
| 13 | Environmental application: posters on corrugated metal cladding in raking sun, with real shadow bands across them. |
| 02, 10 | Framework's own isometric linework (the technical illustration style). |

**Do:** sophisticated editorial photography and composition; architectural geometry, structure and precision; industrial textures and materials (concrete, steel, corrugated metal, stone, cloth bindings, uncoated paper, cracked earth); dramatic, directional light with real, crisp shadows; cinematic framing (top-down, elevation, low angle, extreme scale contrast); bold or refined typography with intentional negative space; a controlled palette, often one saturated accent against charcoal, grey or white; artistic experimentation, creative masking and conceptual visuals.

**Avoid (automatic reject):** friendly, cheerful or playful small-business aesthetics; generic suburban lifestyle photography; cozy, soft-focus, warm-and-inviting or overly commercial imagery; cheap-looking mockups and generic stock photography; anything that resembles an ordinary social-media marketing template. `fw validate` fails plans and prompts that ask for these, and `fw check` fails image prompts that did.

**Hard QC rule:** a post that does not meet the visual quality and aesthetic of the references is rejected and revised, whatever else it gets right. The Director compares every post with the reference set and records a verdict in `<batch>/aesthetic.json` (`[{"post": "01", "verdict": "pass" | "fail", "note": "..."}]`); `fw check` fails a batch without a "pass" for every post.

**Image prompts (Higgsfield).** Build every photograph prompt from this grammar, not from a lifestyle description:
`[subject named precisely, in its real setting and purpose], [camera: directly overhead / straight elevation / low three-quarter / wide with real architectural or industrial context], editorial architectural photograph, [exact materials and construction: e.g. hot-rolled structural steel W-beam with flanges, web and mill scale, bolted to a column base plate; board-formed concrete with tie holes], hard directional [low sun / raking window / single studio key] light with crisp real shadows, controlled palette of [colours from the batch colour_plan], generous negative space, medium-format clarity, premium campaign quality`, then end with `physically accurate materials, scale and construction, no people posing, no clutter, no cozy or lifestyle staging, no stock-photo look, no soft haze, no oversaturation, no AI artifacts, no garbled text`. Brand applications add the artwork reference and print method (mockup realism rule).

## Grid-wide colour (plan it before any post)
Black and white is a design option, not the default. Each batch gets an **editorial palette** (3 to 6 colours with roles: a deep, a warm accent, a quiet neutral…) chosen for the season and the concepts, written to `briefs.json` `colour_plan` before the posts are designed.
- **4 to 5 of the 9 covers carry meaningful colour** (photography, artwork or colour fields), the rest are deliberate black, white or quiet tiles so colour has room.
- Balance vibrant, muted, light and dark. Spread colour through the 3×3 block: no row or column entirely in colour, no row without any, and no two neighbours led by the same colour.
- The covers should complement one another without looking identical: shared palette, different compositions, scales and subjects.
- Colour lives in imagery, concepts and colour fields; Framework's own mark stays black and white. Colours outside the palette need a `colourReason` (`fw check`).
- `fw grid` measures each cover's colour (black-and-white, muted, vibrant) and hue, and warns on too little colour, clustered colour and look-alike neighbours.

## Physical plausibility and material truth (hard rule)
**Owner rule, 2026-11-12. Never again:** an image with incorrect construction materials, unrealistic scale, impractical site logic, ambiguous textures or obvious AI artifacts. Example of what fails: `social/brand/references/plausibility-fail-0[12].png`, a "steel" beam that reads as concrete, dusted with snow, lying alone on a giant empty pad with a lone figure beside it.
- **Every image must be physically plausible and contextually real:** something that could be photographed or rendered by an architectural or industrial studio, with a reason to exist where it is.
- **Materials are exact.** Steel is steel: a hot-rolled I-beam or H-beam (W-section) with flanges, web, fillets, mill scale or primer, bolt holes and connections where it joins something. Concrete is concrete: board-formed, cast, cored or cut, with aggregate, joints and edges that behave like concrete. Never a material that could be either.
- **Structure makes sense.** Columns sit on footings or base plates and carry beams; beams frame into columns; girts and purlins run between frames at regular spacing; nothing floats, stops mid-air or connects to nothing. Through-cores go through.
- **Site logic.** Steel sits in a fabrication bay, on timber dunnage in a laydown yard, or erected in a frame, never as a lone oversized member on an empty slab. Scale comes from real context (a building, a crane, a doorway, a truck), not from a tiny person placed for effect.
- **Textures are unambiguous:** snow is snow where snow would settle, concrete reads as concrete, paint as paint.
- **No AI artifacts:** melted or merged details, repeated or mirrored patterns, impossible geometry, inconsistent shadows or light direction, garbled lettering or annotations, warped hands or tools.
- **Banned outright:** "concrete beams"; giant empty pads or slabs; snowy or concrete-looking surfaces with no clear purpose; a lone person beside a single oversized beam in an empty scene. `fw validate` fails plans and prompts that describe them.
- **QC:** the Director inspects every generated image at full size (structure, connections, materials, edges, lettering, shadows) and records a verdict in `<batch>/imagery.json` (`[{"post": "02", "file": "images/s01.png", "verdict": "pass" | "fail", "note": "..."}]`). `fw check` fails any generated image in use without a "pass". If an image feels uncanny, synthetic or materially wrong, it is rejected and regenerated (or replaced by a site image or type), never shipped; a rejected file is marked `"rejected": true` in assets.json.

## Mockup realism (hard rule)
**Owner rule, 2026-11-12. A hard fail, not a preference.** A mockup or branded physical object (book, brochure, card, letterhead, sign, shopfront, packaging, vehicle, clothing, any branded object) must look like a real, finished product photographed in the real world, with the branding naturally part of it.
- **Required:** the artwork is physically integrated into the object, with correct perspective and scale, natural light and shadow falling across it, believable printing or material behaviour (ink on paper, vinyl on a van, embroidery or screen print on fabric, paint or lit lettering on a sign), and the surface texture showing through the design. A panorama keeps that realism continuous across every slide boundary: one photograph, one light.
- **Automatic fail** (example: `social/brand/references/mockup-realism-fail-example.png`, a black page laid flat over a book with no paper texture, curve or light): any overlay look; a "sticker pasted on" appearance; logo blocks or graphics floating unnaturally on a product; a flat panel with no paper texture or curve; lettering lit differently from the object it sits on; any image that reads as an AI-generated background with a design composited over it.
- **How to make one:** render the exact artwork flat in the engine (mark, wordmark, page layout), upload it as a reference image, then generate the photograph with the artwork printed on the object (`nano_banana_pro` or `gpt_image_2_6` with `image_references`). Describe the object, material, print method, camera angle and light. Check the lettering and mark against the artwork at full size; if anything is misspelt, distorted or invented, regenerate or drop the shot.
- **Never** composite a design over a photograph in the engine: the renderer refuses marks, vector graphics, swatches, and blended or tilted layers on top of a photograph. The post's own editorial headline may sit over or beside a photograph, as type on the slide, never on the object.
- **QC:** every mockup slide carries `mockup` (the object) in spec.json. The Director inspects each at full size and records a verdict in `<batch>/mockups.json`; `fw check` fails any mockup without a "pass".

## Framework technical illustration (core style)
**Owner rule, 2026-11-12.** Framework's isometric wireframe illustration, the linework on frameworkco.ca (`assets/img/ill/*.svg`: website, SEO, branding, systems), is one of Framework's core visual styles. Every 9-post batch includes **1–2 posts in this style**, or features it prominently inside a carousel or Reel (`fw validate` and `fw check` fail a batch without it).
- **Reference:** `social/brand/references/technical-illustration-site-0[12].png` (the owner's screenshots of the services section on frameworkco.ca, 2026-11-12) and the drawings themselves in `assets/img/ill/`.
- **The exact visual language of the website, not a generic minimal style:** a dark ground (#0A0A0A, #101010 or #141414); thin white linework in true 30° isometric; a hairline floor grid at 16% opacity; inner details at 42%; dashed construction lines dropping to the grid; plates and blocks whose side faces carry a faint fill (3.5% and 8%); exploded layers stacked on a vertical axis; small cubes, nodes and rings as the vocabulary. The result should feel precise, architectural and engineered.
- **Drawn by the engine, never generated.** Use the `iso` layer (TEMPLATES.md): new drawings from plates, boxes, grids, lines, rings and drops, or one of the site's own illustrations (`src`) restyled for the slide. An image model does not draw this style.
- **Use it for:** website systems (pages as exploded layers), SEO and digital ecosystems (nodes on a grid), branding systems (a mark built from a grid, applications as plates), process breakdowns (stages as stacked plates), service explanations.
- **In motion:** layers separate and settle (one `iso` layer per plate, each with an `anim` on `y`), lines draw in with `clip` reveals, nodes light up one by one.
- Type around it stays in Switzer and General Sans, large and few, as on the site. The illustration carries the slide.

## Physical applications, lifestyle and concept work
- Show design in the world: a brand book open on a desk, business cards stacked on stone, signage on a building, a truck door, packaging, an invoice on a clipboard, a shopfront at dusk. These sell design far better than a logo on a blank slide.
- Lifestyle and environmental images: real-feeling places, light and materials; no posed stock people, no clichés.
- Conceptual artwork: one strong visual idea (a metaphor made physical), striking enough to stop the scroll.
- **Fictional brand studies are welcome and clearly labelled.** A made-up business (a bakery, a roofer, a coffee roaster) lets Framework show identity thinking end to end. In the brief it carries `fictional {brand, disclosure}`; the captions say "concept" (or "fictional"), and nothing implies it was client work (`fw check` fails both). Choose names that are not real businesses in Alberta.
- **Client showcases are paused** (owner, 2026-11-11) until the showcase workflow is rebuilt: no Aurora Surveys, Red E Corp., Eagle's Nest Resort or other real client work, assets or names. `fw validate` and `fw check` fail on them.

## Panoramic carousels
One continuous composition that unfolds as the viewer swipes (format `panorama`, 2 to 10 panels).
- Design the whole canvas first (panels × 1080 by 1350), then let the engine cut it: the slides are exact crops, so they align to the pixel.
- Let imagery, objects and colour fields cross the seams (that is the delight); keep every word inside one panel, 64 px clear of a seam (`fw render` fails text on a seam).
- The first panel is the grid cover: it must work alone and invite the swipe (something cut off at the right edge).
- Good subjects: a brand kit laid out as an open book or flat lay, a street of signage, a long table of print applications, a landscape with a story along it, a timeline.

## Motion and Reels
Format `reel` (1080×1920). Two ways to make one; choose the cheaper that is good enough:
1. **Code animation** (no credits): kinetic typography, an identity building itself, masks revealing images, smooth moves between compositions. Layers get `anim` keyframes; the engine renders every frame exactly (`fw render`), with a cover frame and a storyboard.
2. **Higgsfield video** where real motion of a scene genuinely improves the post (cinematic product or architectural shots), with code-animated type composited on top.
- 5 to 15 seconds is usually right; the idea lands in the first second; nothing flashes or jitters; motion eases.
- Keep type inside the safe area (Instagram covers the bottom and right edge); `fw render` warns.
- **Video QC is a hard gate** (TEMPLATES.md): no ghosted cross-fades, no stray fragments, no flicker, no dropped frames. Fix the timing at its cause: one element leaves before the next arrives in the same place; masks open and close fully. Never hide an artifact behind a cut or a blur.
- **Every Reel needs a strong cover** (`motion.coverAt`) that works as a grid tile: the profile grid shows only its middle 3:4.

## Composition toolbox (built with the `canvas` template)
Name the composition in `layout` so the grid check can tell neighbours apart.

| Composition (`layout`) | What it is | Good for |
|---|---|---|
| `hero-bleed` | One image or website hero across the whole canvas; small type or none | covers, portfolio openers, photography |
| `device-pair` | Laptop and phone together on the client's own colour, overlapping, with depth | website case studies |
| `device-solo` | One large device, tilted or straight, bleeding off an edge | mobile-first work, a single strong page |
| `browser-bleed` | A browser window filling most of the canvas, cropped by the edge | showing a page as people see it |
| `detail-crop` | A tight crop of one part of the work: navigation, a headline, a photo, an icon | the craft behind a project |
| `colour-system` | The palette as large fields (swatch layers) with names and values | brand identity work |
| `type-specimen` | A typeface at display size, its weights, a short line about it | brand identity work (the client's own font, `spec.fonts`) |
| `mark` | The client's mark large on its brand colour | identity carousels (client marks only; Framework's own only per the branding rule) |
| `frame-break` | An image inside a frame with part of it overlapping the frame edge | conceptual and architectural posts |
| `annotated` | A photograph with thin line annotations and small labels over it | explaining something visual (light, framing, structure) |
| `statement` | One sentence set large, edge to edge, or a single word | ideas, quotes, pauses in a carousel |
| `quiet` | A small line of type in a large field, placed with intent | rest moments in the grid (sparingly) |

The older templates (`type`, `photo`, `plate`, `split`, `diagram`, `list`, `compare`, `quote`, `cta`) remain useful for text-led educational slides, but they are a choice, never the default.

## Portfolio and website showcases (paused for real clients; the standards apply to concept work too)
**The work is the focal point.** The post should make a business owner think "I want my business to look that good."
- Use authentic assets: `node social/engine/fw.mjs capture <url> <file> [desktop|mobile] [full]` captures the live site at 2×/3× into `social/assets/clients/<client>/`. Never invent or alter an interface; mockups show the real design.
- Present it the way a studio would: a full-bleed hero, a device pairing on the client's colour, a tight detail of the interface, the client's own photography, the client's palette and type as a system.
- **The client's identity leads.** Use their colours, typography and imagery (`clientColour` with a reason, `spec.fonts` for their typeface). Framework's monochrome system must not flatten their work.
- Keep words minimal: the project name, one line on what was built, the discipline. The case study goes in the caption.
- AI imagery may set a scene (a desk, a site trailer, a landscape) but must never depict work that was not delivered. Concept applications of a client's brand (signage, vehicles, print that was not produced) are labelled "concept" on the slide and in the caption.
- **Reject:** a flat screenshot on a plain background, slides that read like a design review, PowerPoint, a generic portfolio template, technical documentation, slides where the explanation is bigger than the work.

## Educational posts: plain language
Written for an everyday business owner, contractor or entrepreneur, not a developer or marketer.
- One idea per slide, understood in a few seconds. Plain English. Say why it matters to their business.
- Prefer a relatable example over a statistic; keep facts accurate. If a benchmark cannot be stated plainly and truthfully, choose a more useful example.
- Technical terms, definitions and sources go in the caption ("Google's measure for this is called Largest Contentful Paint").
- Before a slide is approved, ask: **Would an ordinary small-business owner understand this without looking anything up? Why should they care?** If either answer is weak, rewrite.
- `fw check` fails specialist terms on slides (LCP, WCAG, percentile, px, CTA, UX…) and more than 45 words on one slide, and warns above 32.

Example. Instead of "2.5 s · Google's 'good' threshold for Largest Contentful Paint, measured at the 75th percentile of page loads", write "Your website should load in under 2.5 seconds." with "Slow websites frustrate visitors. If people have to wait, many leave before they see what you offer."

## Carousels
- Start from a concept, then give every slide a role: hook, context, the work, a detail, proof, the takeaway, the next step. Drop any slide without a role.
- Vary the compositions inside one carousel; keep it one family through palette, type and the quality of image. Plan transitions (an element that bleeds off the right edge can continue on the next slide; a colour can carry across).
- Every slide should be worth stopping on by itself. No filler, no "agenda" slides.
- Length follows the story: 3 to 7 slides usually. A slide does not need a headline, a paragraph or a number.

## No template furniture
Do not add slide numbers, section labels, header or footer rules, decorative dividers, repeated eyebrow labels, fixed text boxes or identical margins on every slide. Use one only where it genuinely helps the reader (a label that orients a technical diagram, a rule in a specification layout). Framework's logo, wordmark and URL are never a watermark or footer (brand rule, 2026-11-11).

## Two-part quality control
**Technical:** dimensions, spelling, readable type, correct assets, accurate claims, complete deliverables, seamless panorama alignment, Reel length, safe area and cover, the format mix, no back-to-back formats, the colour plan, the client pause, honest fictional labels (`fw validate`, `fw check`, `fw grid`).
**Creative** (judged by eye, recorded per post in `<batch>/review.md`, score 1 to 5; any score under 4 means revise):
1. Visually compelling at thumbnail size and full size?
2. Professionally art-directed, like a premium studio's work?
3. Understandable immediately by an ordinary business owner?
4. Does each slide communicate its one idea?
5. Does the composition use the full canvas with intent?
6. Is the presentation right for the subject (the work leads in portfolio posts)?
7. Would it make someone follow Framework?
8. Would it make a potential client trust Framework's design ability?
9. **Hard gate:** does it meet the visual quality and aesthetic of the reference set (editorial, architectural, industrial, premium)? If not, reject and revise, regardless of the other scores.

**Hard gate per image:** physical plausibility and material truth (above), recorded in `imagery.json`.

**Batch level** (the Director, on `grid-preview.png`, the contact sheet, panoramas viewed edge to edge and every Reel played through):
- Visual originality: no two covers built the same way; nothing that looks like a template.
- Framework's technical illustration appears (1–2 posts, or prominently in a carousel or Reel) and reads unmistakably as frameworkco.ca's linework.
- Grid-wide colour harmony: the palette reads as one batch; colour spread, not clustered.
- Variety of content and formats, mixed through the publishing order.
- Panoramas: seamless, with the cover working alone.
- Motion: smooth, purposeful, readable, with a cover that holds the grid.
- Branding: consistent through design quality, never a repeated watermark.
- **Mockup realism (hard fail):** every branded object reads as a real photographed product with the design physically part of it; no overlay or pasted look anywhere, including across panorama seams.
- Claims accurate, concepts labelled, CTAs natural and compelling.

Passing `fw check` is not proof of creative quality. If it looks like a generic presentation slide, it is redesigned.
