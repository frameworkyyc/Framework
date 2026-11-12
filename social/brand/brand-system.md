# Framework: AI Content Brand System (working copy)

Text transcription of `Framework-AI-Content-Brand-System.pdf` (July 2026), in this folder. The PDF is the source of truth. This copy exists so agents can read the rules for a few hundred tokens instead of rendering 11 PDF pages. If the two ever disagree, the PDF wins: fix this file.

Social-specific additions (logo lockups, social type scale) come from the logo sheet the owner supplied on 2026-11-11 and are marked **[social]**.

## 01 Brand in one paragraph
Framework is a business-building firm, not a design shop. It approaches business the way an architect approaches a building: strategy first, design second, execution third. The visual identity reflects that discipline: near-monochrome, grid-based, sharp-cornered and unornamented. Every element should look load-bearing, not decorative.

| Is | Is not |
|---|---|
| Professional, strategic, modern, minimal | Salesy, flashy, trendy |
| Confident, intelligent, trustworthy | Corporate, jargon-heavy |
| Premium, practical, architectural | Overly creative, cluttered, ornamental |

## 02 Colour: near-monochrome, colour is structural
| Name | Hex | Use |
|---|---|---|
| Ink | `#0A0A0A` | Primary text, headlines, primary buttons, dark section fills |
| Paper | `#FFFFFF` | Primary background, text on dark fills |
| Slate | `#5C5C5C` | Secondary body copy, muted descriptions |
| Stone | `#A3A3A3` | Eyebrow labels, tertiary text, inactive states |
| Hairline | `#E0E0E0` | 1px dividers, card borders, subtle section fills |
| Mist | `#F5F5F5` | Faint surface tint for callouts |

Rules:
- 90 / 8 / 2: about 90% paper or ink, 8% mid-grey (slate/stone), 2% hairline detail. No colour beyond these.
- No gradients, shadows or glows. Flat fills only. Depth comes from a 1px hairline, never a shadow.
- Dark sections invert, they don't tint: pure ink with paper text. Never navy, charcoal-blue or warm black.
- Photography and illustration stay desaturated: black-and-white or muted greyscale. If colour is unavoidable, keep saturation low and let structure carry the image.
- No brand accent colour unless a specific client project calls for one (e.g. showing that client's palette in a portfolio post).
- **[social] Owner-approved exception (2026-11-11):** controlled colour may appear *inside imagery only* (client portfolio work, photography, conceptual artwork) when it meaningfully improves the composition. Framework's own type, graphics, backgrounds and logo stay monochrome, and no accent colour is ever introduced. In the engine this is `imageTreatment: "none"` or `"muted"`.
- **[social] Owner direction (2026-11-11, second overhaul): grid-wide editorial colour.** Framework's official identity is unchanged, but supporting imagery, concept work and colour fields in social posts may use a planned editorial palette, chosen per batch (`colour_plan` in briefs.json; standard in `art-direction.md`). Aim for meaningful colour on 4–5 of the 9 covers, spread through the grid. Black and white is a design option, not the default. The Framework mark itself stays black and white.

## 03 Typography: Switzer for structure, General Sans for everything else
| Role | Typeface | Weight | Notes |
|---|---|---|---|
| Display / H1 | Switzer | Bold 700 | Tight tracking, about -2% |
| H2 / section titles | Switzer | Semibold 600 | About -1% |
| H3 / card titles | Switzer | Semibold 600 | About -1% |
| Body | General Sans | Regular 400 | Normal tracking, generous leading (1.6) |
| Buttons / nav | General Sans | Medium–Semibold 500–600 | No uppercase transform |
| Eyebrow / index labels | General Sans | Semibold 600 | Uppercase, wide tracking, grey |
| Wordmark **[social]** | General Sans | Semibold 600 | Uppercase "FRAMEWORK", letter-spacing 0.30em, ink |

Both are free for commercial use from Fontshare. Never more than two typefaces in one asset. (Fallback only if they truly can't load: Space Grotesk for display, Inter for body. The render engine refuses to fall back silently.)

Copy-layout rules:
- Headlines break across 2–4 short lines on purpose. Write headlines as punchy, self-contained phrases so manual line breaks read cleanly.
- An eyebrow label always precedes a headline: a short em dash, then an uppercase letter-spaced label (e.g. `— WHAT WE DO`).
- No italics for emphasis; use semibold. Italics only for quotes or asides.

## 04 Visual system: architectural structure, not surface decoration
1. **Numbered index labels:** lists of services, steps or features are numbered 01, 02, 03… in grey Switzer Semibold, smaller and lighter than the item title. Blueprint / spec-sheet numbering.
2. **Hairline dividers:** 1px `#E0E0E0` rules separate sections and rows. Never a shadow or a thick rule.
3. **Zero border radius:** every button, card and container has sharp 90° corners.
4. **Two- and three-column grids:** strict columns, consistent gutters; asymmetric widths (wide headline, narrow support) used deliberately, never centred hero blocks.
5. **Eyebrow + headline + support:** small uppercase eyebrow, large Switzer headline, one line of General Sans support.
6. **Inverted (dark) sections as punctuation:** used sparingly to mark a transition or a call to action, never as the default.

Logo: a solid black square containing a geometric "F" monogram in paper white, with the wordmark "FRAMEWORK" in uppercase General Sans and wide letter-spacing. Strictly monochrome (ink on paper or paper on ink). Never recolour, never add gradients or shadows.
**[social]** Lockups: 01 Primary (square mark above wordmark), 02 Secondary (mark left of wordmark), 03 Simplified (wordmark only), 04 Submark (square mark only). The mark file is `logo/submark.svg` (identical to the site's `assets/img/logo-mark.svg`).

Buttons: Primary = ink fill, paper semibold text, no border, 0px corners. Secondary = transparent, ink semibold text, 1px ink border, 0px corners.

## [social] Feed identity: one system, many compositions
The owner's goal: the Instagram grid should read like a curated design-studio portfolio, not a template run. Reference accounts (art direction only, never copied): Obrazur for range and variety, held inside Framework's minimal, architectural identity.
- **Constant (recognition):** the two typefaces, editorial restraint, sharp corners and the quality of the compositions; each batch's planned palette holds its nine posts together. Recognition comes from the design system, not from a stamped logo.
- **[social] Owner rule (2026-11-11), no watermarks:** Framework branding never appears automatically: no logo, wordmark or website URL in corners, along the bottom, as a footer strip or as a watermark, and no logo added just to say who made the post. Branding appears only when it is an intentional part of the concept (the logo on a product or stationery mockup, signage, packaging, a branding showcase, a post about Framework's own identity, a deliberate logo-led composition). Removed branding is never replaced by another repeated decorative element. Reference: Reputeforge and Obrazur carry no repeated logos or branded footers.
- **Variable (variety):** layout family, headline position and scale, light/dark/mid tone, photography vs typography vs graphic, density vs negative space.
- **Formats** mixed through the publishing order, never grouped: about 3 carousels, 2 seamless panoramic carousels, 2 single images and 2 Reels per batch.
- **[social] Core style (owner rule, 2026-11-12): Framework's technical illustration.** The isometric wireframe linework of frameworkco.ca (dark ground, thin white and grey lines, exploded and grid-based technical drawings) appears in 1–2 posts of every batch, or prominently inside a carousel or Reel. It is drawn by the engine in the website's exact language (`art-direction.md`), never generated.
- **Visual categories** to mix across every batch (technical illustration is the seventh): editorial typography, architectural photography, portfolio showcases, conceptual artwork, educational graphics, minimalist compositions.
- **Batches are 3×3 blocks:** every batch is exactly 9 posts, so the profile grows in whole rows and each block is designed as one composition.
- **Grid rules:** alternate light and dark; balance imagery with type; never place two covers of the same layout family side by side (in the grid or in publishing order); no grid row of three in one tone; check every batch against the posts already published.
- **Covers vs interiors:** a cover earns attention and may break the pattern; interior carousel slides stay consistent for readability.

## 05 Imagery: construction-industry precision, shot like architecture
Framework's core clients are contractors, tradespeople and construction-adjacent small businesses, so imagery nods to that world (structure, materials, tools, blueprints, job sites) through a clean, editorial, architectural lens.

Do:
- High-contrast black-and-white or desaturated photography of structural details: steel beams, concrete, scaffolding, blueprints, drafting tools, grid lines.
- Strong geometric composition: leading lines, symmetry, negative space, top-down or elevation angles.
- Minimal single-subject shots; let negative space breathe around the subject.
- Line-drawing / wireframe / blueprint graphics (isometric structures, grid overlays, technical annotations) for abstract or diagrammatic content.
- Natural, functional light: hard directional light and real shadow, not soft studio glow.

Don't:
- Bright saturated palettes, gradients, neon accents.
- Cartoon or illustrated icon sets, flat mascots, 3D "tech blob" graphics.
- Cliché business stock (handshakes, boardrooms, "team celebrating", people pointing at laptops, forced smiles).
- Cluttered scenes with competing focal points.
- Rounded, bubbly UI chrome in any generated app or dashboard mockup.

Ready-to-use prompts (swap the bracketed subject):
- **General brand photography:** Minimal architectural photograph of [SUBJECT, e.g. a steel structural beam / a set of drafting tools / a concrete stairwell], shot in high-contrast black and white, strong geometric composition with clear leading lines, generous negative space, hard directional natural light, editorial and precise, no people, no clutter, no colour saturation, resembles a page from an architecture monograph. Aspect ratio 16:9.
- **Construction / trades subject:** Clean, high-contrast black-and-white photograph of [SUBJECT, e.g. a contractor reviewing blueprints on site / scaffolding against a clear sky / a framed timber structure mid-build], shot from a considered architectural angle, minimal and uncluttered, natural hard light and real shadow, no smiling-at-camera poses, documentary and precise rather than staged, feels premium and structural, not a generic stock photo.
- **Abstract / diagrammatic graphic:** Minimal technical line-drawing of [SUBJECT, e.g. an isometric building frame / a grid-based site plan / a blueprint diagram], thin white or black lines on a solid ink (#0A0A0A) or paper (#FFFFFF) background, no colour, no gradients, no shading, precise and geometric like an architectural blueprint or engineering schematic, sharp corners, evenly spaced grid, plenty of negative space.
- **Social / carousel background:** Flat, minimal background graphic for a social media carousel slide: solid #0A0A0A or #FFFFFF field, a single thin hairline grid or a single bold geometric shape (square or rectangle) as the only visual element, generous whitespace reserved for headline text, architectural and restrained, no icons, no illustration, no drop shadows.
  **[social]** In this workflow, plain backgrounds, grids and shapes are drawn by the render engine, not generated. Never spend credits on them.

## 06 Voice: write like a strategist, not a marketer
Short, declarative, confident. Simple sentences. Claims are earned, not asserted. Explain why a decision matters rather than selling.

Principles:
- Clarity over cleverness. No wordplay, puns or forced metaphors beyond the architecture/construction framing already in the brand.
- Confidence, not arrogance. "We build the foundation your business runs on." Not hedging ("we think we might be able to help"), not overselling ("the #1 agency").
- Short sentences (most under 20 words), paragraphs of 1–3 sentences.
- Structure before style. Lead with the plan, sequence or system ("Six stages. The same sequence for every client.") before the emotional benefit.
- Problem framing, not feature dumping. Describe the business problem before the service ("Most businesses start with a logo. We start with a plan.").

Use: Framework, foundation, structure, strategy first, built to grow, system (not "stack of freelancers"), clarity, trust, long-term partner, execution, sound ("structurally sound"), repeatable.
Avoid: disrupt, game-changing, synergy, world-class, best-in-class, unlock your potential, take it to the next level, passion, hustle, exclamation points, unearned superlatives ("the best", "the ultimate"), emoji, hashtags in body copy.

| Off-brand | On-brand |
|---|---|
| "We're passionate about helping YOU unlock your business's full potential!" | "We build the foundation your business runs on, then stay involved as it grows." |
| "Our game-changing 5-step process delivers world-class results." | "Six stages. The same sequence for every client, so nothing gets built before it's been properly planned." |

## 07 Drop-in system prompt (verbatim from the PDF)
> You are creating content for FRAMEWORK, a premium business-building firm for entrepreneurs, contractors, and small businesses. Follow this brand system exactly:
>
> COLOUR — Near-monochrome only: Ink #0A0A0A, Paper #FFFFFF, Slate #5C5C5C, Stone #A3A3A3, Hairline #E0E0E0. No accent colour, no gradients, no shadows. Roughly 90% ink/paper, 8% grey, 2% hairline detail.
>
> TYPE — Switzer (Bold/Semibold) for headlines and section titles, tight letter-spacing (-1 to -2%). General Sans (Regular/Medium/Semibold) for body copy, buttons, and navigation, normal spacing. Uppercase, wide-tracked General Sans Semibold for small eyebrow labels only.
>
> LAYOUT — Strict column grids, generous whitespace, 1px hairline dividers, zero border-radius (sharp square corners everywhere), numbered index labels (01, 02, 03…) for lists and steps. Eyebrow label, then bold headline, then one line of supporting copy is the default section pattern. Use one full-ink inverted section per page at most, for emphasis or calls to action.
>
> IMAGERY — Architectural, high-contrast, black-and-white or desaturated. Construction/trade subject matter (structure, materials, blueprints, tools, job sites) shot with editorial restraint. No stock-photo clichés, no colour saturation, no illustrated icons or 3D mascots.
>
> VOICE — Clear, confident, strategic. Short sentences and short paragraphs. Lead with the plan or system before the benefit. Avoid marketing jargon, superlatives, exclamation points, and emoji. Sound like an architect explaining a structure, not an agency selling a service.
>
> OVERALL FEEL — Every asset should look load-bearing: intentional, structural, and built to last, never decorative or trend-driven.
