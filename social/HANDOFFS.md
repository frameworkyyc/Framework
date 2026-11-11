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
    slides/01.png …                   02: finished slides (engine output)   | reels: slides/reel.mp4 + reel-cover.png
    caption-instagram.txt             03 Copywriter
    caption-facebook.txt              03 Copywriter
    alt-text.txt                      03 Copywriter: one line per slide
  grid-preview.png, grid-report.md    02: Instagram profile preview + feed checks (fw grid)
  contact-sheet.png                   02: every slide on one image (fw sheet)
  figma.json                          02: Figma node ids of the uploaded slides (fw figma upload)
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
  "posts": [
    {
      "id": "01",
      "slug": "strategy-before-logo",
      "goal": "attract | trust | convert",
      "visual_category": "editorial-typography | architectural-photography | portfolio | conceptual-artwork | educational-graphic | minimalist",
      "format": "single | carousel | reel",
      "objective": "what the post should achieve",
      "audience": "who it is for, specifically",
      "key_message": "the one idea, in one sentence",
      "angle": "why this is interesting, not generic",
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
          "template": "type | minimal | photo | plate | split | showcase | diagram | cover | statement | point | list | compare | quote | cta | reel",
          "layout": "family variant, e.g. giant | top | split | caption",
          "theme": "paper | ink | mist",
          "eyebrow": "HOW WE WORK",
          "headline": "Most businesses\nstart with a logo.",
          "support": "Six stages. The same sequence for every client.",
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
Check it with `node social/engine/fw.mjs validate social/batches/<batch-id>`. It fails unless the batch is exactly 9 posts (one 3×3 grid block), on missing checks, unknown values, and two consecutive covers in the same layout family; it warns when the goal mix drifts from about 5 attract / 3 trust / 1 convert, when every post has the same format, when categories are too few, or when three dark covers run together.

Rules that bind every agent:
- Facts come only from `social/brand/facts.md` or the site pages it lists. A post that needs anything else carries `needs_confirmation` with the question for the owner.
- Text written in the brief is final copy. The Creative Director may change line breaks or trim words to fit (and logs it in `assets.json`), never the meaning. The cover *composition* is the Creative Director's call within the planned category.
- Credits are spent only by the Creative Director, only within the budget recorded in `approval.md`.
- Performance numbers are recorded only from real Instagram/Facebook insights the owner provides. Nothing is estimated or called proven before there is data.
