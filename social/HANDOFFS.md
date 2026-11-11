# Handoffs: batch layout and file formats

Every agent reads and writes files at these paths. Agents pass **paths**, not file contents, to save tokens.

```
social/batches/<batch-id>/            e.g. 2026-11-12-ig-fb-10   (git-ignored: production files)
  plan.md                             01 Strategist: human-readable plan the owner approves
  briefs.json                         01 Strategist: machine-readable briefs (format below)
  approval.md                         Director: what the owner approved (posts, changes, credit budget)
  posts/NN-slug/
    spec.json                         02 Creative Director: render spec (social/engine/TEMPLATES.md)
    images/                           02: downloaded Higgsfield files and other sources
    assets.json                       02: provenance for every image (source, job id, model, prompt, credits)
    slides/01.png …                   02: finished slides (engine output)   | reels: slides/reel.mp4 + reel-cover.png
    caption-instagram.txt             03 Copywriter
    caption-facebook.txt              03 Copywriter
    alt-text.txt                      03 Copywriter: one line per slide
  contact-sheet.png                   engine: every slide on one image, for review
  qc.md                               Director: quality-control record
  export/<batch-id>/ + .zip           engine: the deliverable
```

## briefs.json (01 → 02, 03)
```json
{
  "batch": "2026-11-12-ig-fb-10",
  "created": "2026-11-12",
  "theme": "one line: what this batch is about and why now",
  "posts": [
    {
      "id": "01",
      "slug": "strategy-before-logo",
      "pillar": "educational | promotional | portfolio | brand",
      "format": "single | carousel | reel",
      "objective": "what the post should achieve for Framework",
      "audience": "who it is for, specifically",
      "key_message": "the one idea, in one sentence",
      "facts_used": ["facts.md: Method (six stages)"],
      "needs_confirmation": null,
      "slides": [
        {
          "template": "cover | photo | statement | point | list | compare | quote | cta | reel",
          "theme": "paper | ink",
          "eyebrow": "HOW WE WORK",
          "headline": "Most businesses\nstart with a logo.\n{{We start with\na plan.}}",
          "support": "Six stages. The same sequence for every client.",
          "body": "for point slides",
          "items": [{ "title": "", "desc": "" }],
          "rows": [["left", "right"]],
          "visual": {
            "source": "none | site | higgsfield",
            "ref": "@site/assets/img/drafting.jpg",
            "prompt": "full image prompt built from the brand imagery prompts",
            "model": "gpt_image_2_6",
            "params": { "quality": "medium", "resolution": "2k" },
            "aspect_ratio": "4:5",
            "est_credits": 1,
            "direction": "what the image must show and why"
          }
        }
      ],
      "cta": "the call to action and where it points",
      "caption_notes": "angle, points to make, what not to repeat from the slides",
      "hashtag_seed": ["calgarybusiness", "contractors"]
    }
  ],
  "visual_budget": { "generations": 3, "est_credits": 4 }
}
```
Check it with `node social/engine/fw.mjs validate social/batches/<batch-id>`.

Rules that bind every agent:
- Facts come only from `social/brand/facts.md` or the site pages it lists. A post that needs anything else carries `needs_confirmation` with the question for the owner.
- Text written in the brief is final copy. The Creative Director may change line breaks or trim words to fit (and logs it in `assets.json`), never the meaning.
- Credits are spent only by the Creative Director, only within the budget recorded in `approval.md`.
