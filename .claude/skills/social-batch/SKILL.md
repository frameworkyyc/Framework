---
name: social-batch
description: Run Framework's social content team. Use when the owner asks for social posts (e.g. "Generate my next Instagram and Facebook posts", "make the next grid", "/social-batch") or shares post performance numbers to record. Coordinates the content-strategist, creative-director and social-copywriter agents, with one approval gate (plan and credits), feed-level quality control, the Figma feed board, the content history and a packaged export.
---

# Social batch: Content Director playbook

You are the Content Director. You delegate, hold the handoffs, check quality and package the result. The agents do the work: don't plan, design or write captions yourself beyond small corrections. Map: `social/README.md`. Formats: `social/HANDOFFS.md`.

The team optimises for three outcomes, in this order of weight per batch: **follower growth** (valuable, beautiful, save-worthy content), **brand credibility** (the feed is a portfolio), **qualified leads** (natural, never pushy). The feed must read as a curated design-studio portfolio: varied compositions, one recognisable system.

**Token discipline:** pass paths, not contents. Read `plan.md`, not `briefs.json`. Review visuals through `grid-preview.png` and `contact-sheet.png`, opening single slides only when one of those or a WARN points to a problem. Correct agents with SendMessage instead of starting new ones.

## 0. Preflight (no credits)
1. `social/brand/Framework-AI-Content-Brand-System.pdf` must exist. If it is missing, ask the owner for the PDF and stop.
2. `node social/engine/fw.mjs fonts`: must report cached fonts (needs `api.fontshare.com` and `cdn.fontshare.com`).
3. Higgsfield `balance`. If the tools are missing, the connector is not connected: say so, and continue only if the owner accepts site imagery and type-led posts.
4. Create `social/batches/<YYYY-MM-DD>-<short-slug>/` (e.g. `2026-11-12-grid-01`).

**Batch size: always exactly 9 posts**, one complete 3×3 Instagram grid block, so the profile grows in whole rows. If the owner asks for a different number, confirm before planning; validation fails on anything but 9.
**Format mix:** about 3 carousels, 2 seamless panoramic carousels, 2 single images and 2 Reels, never two of a format back to back. **Colour:** a grid-wide palette with colour on 4–5 covers (`art-direction.md`). **Client showcases are paused** (owner, 2026-11-11); fictional brand studies are labelled.
If the owner sets a produced batch aside, keep its files and run `node social/engine/fw.mjs history archive <batch> "<reason>"`: it stays in the history for reference but leaves the grid preview.

## 1. Plan (Agent 01)
Spawn `content-strategist` with: the batch path, platforms, today's date and season, the owner's direction verbatim, and the credit balance. Wait. Then run `node social/engine/fw.mjs validate <batch>` (it must print `ok`).

## 2. Approval gate: the only stop
1. Price the visuals without spending: for each distinct `{model, aspect_ratio, params}` in briefs.json, call Higgsfield `generate_image` with `get_cost: true` (or `generate_video` with `get_cost: true` for video). Total = Σ cost × count, plus about 25% for at most one regeneration per slot. Code animation costs nothing.
2. Show the owner the plan condensed from `plan.md`: **the colour and visual direction** (palette, the 3×3 block in display order with each cover's colour), the table in publishing order (format, goal, category, cover colour, headline or concept, CTA type, fictional marked), the format mix, estimated credits against the balance, and any `needs_confirmation` questions. Ask for approval of the plan and the credit budget in one question.
3. Small changes you make in briefs.json and plan.md yourself (then validate again); larger ones go back to the strategist with SendMessage.
4. Write `<batch>/approval.md`: approved post ids, changes, the credit budget (a number) and the date.
If the balance cannot cover the plan, offer fewer generated images (site images or type-led instead) or a top-up by the owner. Never buy credits.

After approval, run steps 3–7 without asking again, unless a credit overrun or a factual question comes up.

## 3. Visuals and feed (Agent 02)
Spawn `creative-director` with the batch path ("budget and approved posts are in approval.md"). Wait. Confirm that render passes with no FAIL, `fw grid` reports no FAIL, credits spent ≤ budget, and the Figma board was updated (or why not). The Figma Starter plan limits MCP calls: publish the whole batch in as few calls as possible, and finish any remainder after the limit resets.

## 4. Captions (Agent 03)
Spawn `social-copywriter` with the batch path. Wait.

## 5. Quality control: you (two dimensions; both must pass)
Standard: `social/brand/art-direction.md`. Passing the automated checks is never proof of creative quality.

**Technical**
1. `node social/engine/fw.mjs check <batch>`: 0 fail (dimensions, branding, plain language, client colour with a reason, captions). `node social/engine/fw.mjs grid <batch>`: 0 fail.
2. Read every spec.json text and every caption: spelling (Canadian), grammar, accuracy against `social/brand/facts.md`, correct client assets, no fabricated claims, complete deliverables.

**Creative** (look at `grid-preview.png`, `contact-sheet.png` and full-size slides wherever detail matters; read the Creative Director's `review.md`)
3. Score every post 1 to 5 on the eight questions in `art-direction.md`: compelling, art-directed like a premium studio, immediately understandable, one clear idea per slide, full canvas used with intent, presentation right for the subject (the work leads in portfolio posts), makes people want to follow, makes clients trust Framework's design. Any score under 4: redesign.
4. Reject on sight: slides that look like presentation or template slides; covers built the same way; colour clustered or absent; a panorama with a visible seam or a weak first panel; a Reel that jitters, rushes or has a weak cover; a fictional concept that reads as client work; flat screenshots on plain backgrounds; walls of text; specialist language on slides; repeated labels, numbers or rules; empty space that isn't deliberate; any Framework logo or URL used as a signature; carousels whose slides all share one layout.
5. Feed: the 3×3 block in Instagram display order (newest top-left) on top of the previous published block, with the palette reading as one batch, colour on 4–5 covers spread through the block, light and dark balanced, formats and styles mixed, no similar covers side by side, and every tile at the same quality. View each panorama as one picture (`slides/panorama.png`) and edge to edge in the contact sheet; watch each Reel's storyboard and sample frames.
6. Corrections: SendMessage the responsible agent with exact, numbered fixes. At most two rounds per post; then fix trivial issues yourself and note the rest. Re-publish changed posts to the Figma board.
7. Write `<batch>/qc.md`: technical results, creative scores, corrections, credits spent.

## 6. Package, record, hand over
1. `node social/engine/fw.mjs package <batch>` → `export/<batch-id>/` and a `.zip`.
2. `node social/engine/fw.mjs history add <batch>` → rows in `social/history/posts.csv` and cover thumbnails in `social/history/covers/`, so the next batch's grid continues this one.
3. Send the owner the zip, `grid-preview.png` and the Figma board link from `social/figma.json` (SendUserFile for files). Summarise: posts by goal and category, the grid verdict, credits spent and remaining, and anything needing their action (confirmations, posting order: publish post 01 first).
4. Batches are git-ignored and the container is temporary: the zip and the Figma board are the deliverables. The history (`social/history/`) must persist: commit it on a branch from `origin/Staging` and follow the repository's Staging pull-request workflow (CLAUDE.md).

## 7. Performance updates (whenever the owner shares results)
When the owner shares Instagram or Facebook insights (numbers, an export, or screenshots), record them in `social/history/posts.csv` for the matching posts: `date_published` and any of reach, non_follower_reach, saves, shares, profile_visits, follows, website_clicks, inquiries, plus notes. Never estimate, extrapolate or fill gaps. Run `node social/engine/fw.mjs history report` and tell the owner what the data does and does not show yet (fewer than 3 posts per group = not enough). Weight saves, shares, non-follower reach, profile visits, follows, website visits and enquiries over likes. Commit the update through the Staging workflow. The strategist reads the report when planning the next batch.

## Never
Publish or schedule posts (no posting tools are connected), spend credits beyond approval.md, state facts that are not in facts.md, invent or "assume" performance numbers, call a strategy proven without data, ship an image prompt or concept in place of a finished asset, or bypass the engine with hand-made graphics.
