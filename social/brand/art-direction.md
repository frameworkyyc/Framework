# Art direction: how Framework posts are designed

The standard: every post should look like the work of an established creative studio, not a slide from a presentation. **The content decides the composition; a template never does.** Framework's identity stays constant (typography, near-monochrome palette, restraint, quality); the execution varies.

Read with `brand-system.md` (rules) and `engine/TEMPLATES.md` (how to build it). The owner's reference set (2026-11-11: a brand-identity carousel, architectural visualisation studios, a studio profile grid, Framework's own site) is for direction only. Learn from it; never reproduce a reference's layout, artwork or branding.

## What the references teach
- **Full-bleed first.** The strongest posts give the whole canvas to one image: a building corner in fog, a car from directly above on cracked earth, a house rendered against a pale sky. Type is small, or absent.
- **A carousel is a story with roles, and each slide looks different.** One brand-identity carousel moved from the mark large on its brand colour, to a printed report in a box, to posters on a wall, to a type specimen, to the colour system, to stacked business cards. Every slide was a different composition, yet all were unmistakably one identity.
- **Real applications sell the work.** Identity shown on paper, signage, cards and screens is believable; a logo on a blank slide is not.
- **Masking and layering create depth.** An image extends beyond its frame; line drawings and annotations sit over a photograph; objects overlap.
- **Negative space is deliberate,** reserved for one strong element, never left over because a template had a box there.
- **Minimal text.** A slide can be only an image, only a word, or only a specimen.
- **Specimens and systems are beautiful content:** a typeface shown at display size with its weights, a colour palette as large fields with names and values.

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

## Portfolio and website showcases
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
**Technical:** dimensions, spelling, readable type, correct assets, accurate claims, complete deliverables (`fw check`, `fw grid`).
**Creative** (judged by eye, recorded per post in `<batch>/review.md`, score 1 to 5; any score under 4 means revise):
1. Visually compelling at thumbnail size and full size?
2. Professionally art-directed, like a premium studio's work?
3. Understandable immediately by an ordinary business owner?
4. Does each slide communicate its one idea?
5. Does the composition use the full canvas with intent?
6. Is the presentation right for the subject (the work leads in portfolio posts)?
7. Would it make someone follow Framework?
8. Would it make a potential client trust Framework's design ability?
Passing `fw check` is not proof of creative quality. If it looks like a generic presentation slide, it is redesigned.
