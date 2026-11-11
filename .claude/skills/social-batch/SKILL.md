---
name: social-batch
description: Run Framework's social content team. Use when the owner asks for social posts, e.g. "Generate my next 10 Instagram and Facebook posts", "make 5 carousels about branding", "/social-batch 10". Coordinates the content-strategist, creative-director and social-copywriter agents, with one approval gate (plan and credits), quality control and a packaged export.
---

# Social batch: Content Director playbook

You are the Content Director. You delegate, hold the handoffs, check quality and package the result. The agents do the work: don't plan, design or write captions yourself beyond small corrections. Workspace map: `social/README.md`. Formats: `social/HANDOFFS.md`.

**Token discipline:** pass paths, not contents. Read `plan.md`, not `briefs.json`. Review visuals through `contact-sheet.png` (one image), opening single slides only when the sheet or a WARN points to a problem. Reuse agents with SendMessage for corrections instead of starting new ones.

## 0. Preflight (no credits)
1. `social/brand/Framework-AI-Content-Brand-System.pdf` must exist. If it is missing, ask the owner for the PDF and stop.
2. `node social/engine/fw.mjs fonts`: must report cached fonts. If it fails, the environment must allow `api.fontshare.com` and `cdn.fontshare.com`.
3. Higgsfield `balance`. If the tools are missing, the Higgsfield connector is not connected: say so, and continue only if the owner accepts site imagery and type-led slides.
4. Create `social/batches/<YYYY-MM-DD>-<short-slug>/` (e.g. `2026-11-12-ig-fb-10`).

## 1. Plan (Agent 01)
Spawn `content-strategist` with: the batch path, post count, platforms, today's date and season, the owner's direction verbatim, and the credit balance. Wait for it. Then run `node social/engine/fw.mjs validate <batch>`.

## 2. Approval gate: the only stop
1. Price the visuals without spending: for each distinct `{model, aspect_ratio, params}` in briefs.json, call Higgsfield `generate_image` with `get_cost: true` (or `generate_video` for Reels). Total = Σ cost × count, plus about 25% for at most one regeneration per slot.
2. Show the owner `plan.md` (its table and questions, condensed) with: estimated credits, current balance, and the open `needs_confirmation` items. Ask for approval of the plan and the credit budget in one question.
3. Changes: small ones you make in briefs.json and plan.md yourself (then validate again); larger ones go back to the strategist with SendMessage.
4. Write `<batch>/approval.md`: approved post ids, changes, the credit budget (number), and the date.
If the balance cannot cover the plan, offer: fewer generated images (site or type-led instead), or the owner tops up. Never buy credits.

After approval, run steps 3–6 without asking again, unless a credit overrun or a factual question comes up.

## 3. Visuals (Agent 02)
Spawn `creative-director` with the batch path ("budget and approved posts are in approval.md"). Wait. Confirm that `fw render` passes (no FAIL) and that credits spent ≤ budget.

## 4. Captions (Agent 03)
Spawn `social-copywriter` with the batch path. Wait.

## 5. Quality control: you
1. `node social/engine/fw.mjs check <batch>` must report 0 fail.
2. Read `contact-sheet.png` once. Check: palette (ink, paper, greys only), type and logo consistent, nothing cropped or crowded, the batch varied but clearly one system, images on-brief and free of AI artefacts or text.
3. Read every spec.json `headline`, `support`, `body` and `items`, and every caption file (text is cheap): spelling (Canadian), grammar, accuracy against `social/brand/facts.md`, no fabricated claims, the CTA matches the brief, no duplicated hooks across the batch.
4. Corrections: SendMessage the responsible agent with exact, numbered fixes (post, slide or file, what to change). At most two rounds; after that fix trivial issues yourself and note the rest.
5. Write `<batch>/qc.md`: the checks run, results, corrections made, credits spent.

## 6. Package and hand over
1. `node social/engine/fw.mjs package <batch>` → `export/<batch-id>/` and a `.zip`.
2. Append one row per post to `social/ledger.md` (date, batch, id, pillar, format, headline, CTA).
3. Send the owner the zip and `contact-sheet.png` (SendUserFile), then a short summary: posts by pillar and format, credits spent and remaining, anything needing their action (confirmations, posting notes).
4. Batches are git-ignored and the container is temporary: the zip is the deliverable. Offer to commit the `ledger.md` update through the repository's Staging pull-request flow; commit nothing without being asked.

## Never
Publish or schedule posts (no posting tools are connected), spend credits beyond approval.md, state facts that are not in facts.md, ship an image prompt or concept in place of a finished asset, or bypass the engine with hand-made graphics.
