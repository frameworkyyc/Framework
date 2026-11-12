# Handoffs: batch layout and file formats

Every agent reads and writes files at these paths. Agents pass **paths**, not file contents, to save tokens.

```
social/batches/<batch-id>/            e.g. 2026-11-12-grid-01   (git-ignored: production files)
  plan.md                             01 Strategist: human-readable plan the owner approves
  briefs.json                         01 Strategist: machine-readable briefs (format below), in publishing order
  approval.md                         Director: what the owner approved (posts, changes, credit budget)
  posts/NN-slug/
    spec.json                         02 Creative Director: render spec (social/engine/TEMPLATES.md)
    images/                           02: downloaded Higgsfield files and other sources
    assets.json                       02: provenance for every image (source, job id, model, prompt, credits)
    slides/01.png …                   02: finished slides (engine output)   | panoramas: + slides/panorama.png | reels: slides/reel.mp4 + reel-cover.png
    storyboard.png                    02: reels only, six frames for review
    caption-instagram.txt             03 Copywriter
    caption-facebook.txt              03 Copywriter
    alt-text.txt                      03 Copywriter: one line per slide
  grid-preview.png, grid-report.md    02: Instagram profile preview + feed checks (fw grid)
  contact-sheet.png                   02: every slide on one image (fw sheet)
  figma.json                          02: Figma node ids of the uploaded slides (fw figma upload)
  aesthetic.json                      Director: verdict per post against social/brand/references/aesthetic/ (hard gate; fw check fails without "pass")
  mockups.json                        Director: full-size realism verdict for every mockup slide (hard rule; fw check fails without "pass")
  qc.md                               Director: quality-control record
  export/<batch-id>/ + .zip           engine: the deliverable

social/history/posts.csv              one row per produced post, plus performance numbers once published (never estimated)
social/history/covers/                small cover thumbnails, so the grid preview continues the real feed
social/figma.json                     the Figma feed board (file key, page)
```

## briefs.json (01 → 02, 03)
Posts are listed in **publishing order** (post 01 goes out first and ends up lowest in the grid).
```json
{
  "batch": "2026-11-12-grid-01",
  "created": "2026-11-12",
  "theme": "one line: what this batch is about and why now",
  "colour_plan": {
    "palette": [ { "name": "Harbour", "hex": "#1F3A5F", "role": "deep" }, { "name": "Brick", "hex": "#C84B31", "role": "warm accent" }, { "name": "Paper", "hex": "#F4EFE6", "role": "ground" } ],
    "distribution": "which covers carry which colour and why the 3x3 block balances (display order, newest top-left)"
  },
  "posts": [
    {
      "id": "01",
      "slug": "strategy-before-logo",
      "goal": "attract | trust | convert",
      "visual_category": "editorial-typography | architectural-photography | portfolio | conceptual-artwork | educational-graphic | minimalist | technical-illustration",
      "format": "single | carousel | panorama | reel",
      "panels": "panoramas only: 2-10, with one slides[] entry per panel",
      "motion": "reels only: { \"duration\": 8, \"cover\": \"what the grid tile shows\", \"approach\": \"code | higgsfield + code\" }",
      "cover_colour": { "presence": "vibrant | muted | mono", "hex": ["#C84B31"], "tone": "light | mid | dark" },
      "fictional": "omit for real subjects; for a made-up brand: { \"brand\": \"Northwind Bakery\", \"disclosure\": \"captions call it a concept brand study\" }",
      "objective": "what the post should achieve",
      "audience": "who it is for, specifically",
      "key_message": "the one idea, in one sentence",
      "angle": "why this is interesting, not generic",
      "concept": "the visual idea: what the viewer sees and why it works",
      "checks": {
        "interesting": "why a stranger would stop for it",
        "value": "the educational, practical or visual value",
        "save_share_follow": "why someone would save, share or follow",
        "credibility": "how it shows Framework's quality",
        "role": "its job in the batch and the 5/3/1 goal mix",
        "different": "how it differs from the recent posts in social/history"
      },
      "facts_used": ["facts.md: Method (six stages)"],
      "needs_confirmation": null,
      "slides": [
        {
          "role": "hook | context | the work | detail | proof | takeaway | next step",
          "art_direction": "composition (art-direction.md toolbox), what fills the canvas, how much text (often none)",
          "template": "canvas | type | minimal | photo | plate | split | showcase | diagram | cover | statement | point | list | compare | quote | cta | reel",
          "layout": "family variant, e.g. giant | top | split | caption",
          "theme": "paper | ink | mist",
          "eyebrow": "HOW WE WORK",
          "headline": "Most businesses\nstart with a logo.",
          "support": "Six stages. The same sequence for every client.",
          "brand": "omit, unless the logo is part of the concept: { \"element\": \"mark\", \"reason\": \"...\" }",
          "visual": {
            "source": "none | site | higgsfield",
            "ref": "@site/assets/img/drafting.jpg",
            "prompt": "full image prompt built from the brand imagery prompts",
            "model": "gpt_image_2_6",
            "params": { "quality": "medium", "resolution": "2k" },
            "aspect_ratio": "4:5",
            "est_credits": 1,
            "colour": "mono | muted | natural (natural/muted only for portfolio, photography or conceptual art)",
            "direction": "what the image must show and why"
          }
        }
      ],
      "cta_type": "save | engage | explore | credibility | lead | none",
      "cta": "the call to action, matched to the goal (empty when cta_type is none)",
      "caption_notes": "angle, what to add beyond the slides, what not to repeat",
      "hashtag_seed": ["calgarybusiness"]
    }
  ],
  "visual_budget": { "generations": 3, "est_credits": 4 }
}
```
Check it with `node social/engine/fw.mjs validate social/batches/<batch-id>`. It fails unless the batch is exactly 9 posts (one 3×3 grid block), on missing checks, unknown values, two consecutive covers in the same layout family, two consecutive posts in the same format, a missing `colour_plan` or `cover_colour`, a panorama without matching `panels`, a reel without `motion`, a fictional brand without a disclosure, real client work while showcases are paused, and a batch with no post in Framework's technical illustration style (a post with `visual_category` or a slide with `category` "technical-illustration"). It warns when the goal mix drifts from about 5 attract / 3 trust / 1 convert, the format mix from 3 carousels / 2 panoramas / 2 singles / 2 reels, fewer than 4 covers carry colour, colour clusters in a grid row, neighbours share a lead colour, categories are too few, or three dark covers run together.

Rules that bind every agent:
- Aesthetic standard: editorial, architectural, industrial, premium, at the level of `social/brand/references/aesthetic/`. Hard QC gate.
- Mockups must look like real, finished products photographed in the real world, with the branding printed into the object (generated with the artwork as a reference image), never composited on top. Hard fail.
- Real client showcases are paused (owner, 2026-11-11). Fictional brand studies are labelled `fictional` and called "concept" in captions; never presented as client work.
- No automatic branding: no Framework logo, wordmark or URL as a corner mark, footer or watermark on any slide. Branding only as an intentional part of a concept (`brand` with a `reason`).
- Facts come only from `social/brand/facts.md` or the site pages it lists. A post that needs anything else carries `needs_confirmation` with the question for the owner.
- Text written in the brief is final copy. The Creative Director may change line breaks or trim words to fit (and logs it in `assets.json`), never the meaning. The cover *composition* is the Creative Director's call within the planned category.
- Credits are spent only by the Creative Director, only within the budget recorded in `approval.md`.
- Performance numbers are recorded only from real Instagram/Facebook insights the owner provides. Nothing is estimated or called proven before there is data.
