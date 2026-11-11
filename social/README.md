# Framework social content team

A three-agent production line for Instagram and Facebook that runs inside Claude Code. Ask, for example, "Generate my next 10 Instagram and Facebook posts" (or `/social-batch 10`). The main session acts as **Content Director** and follows `.claude/skills/social-batch/SKILL.md`:

```
owner request
  → 01 content-strategist (Opus)   plan.md + briefs.json
  → owner approves plan and credit budget          ← the only stop
  → 02 creative-director (Sonnet)  Higgsfield photos → spec.json → engine → slides/*.png
  → 03 social-copywriter (Sonnet)  caption-instagram.txt, caption-facebook.txt, alt-text.txt
  → Content Director QC (fw check, contact sheet, facts) → export/ + zip
```

Nothing here is a website, app or service. Nothing is published: the output is a folder of finished posts.

## Layout
| Path | What |
|---|---|
| `.claude/agents/` | the three agent definitions (role, tools, model) |
| `.claude/skills/social-batch/SKILL.md` | the Content Director's playbook |
| `social/brand/` | the brand PDF (source of truth), `brand-system.md` (its text, for agents), `facts.md` (the only facts posts may state), the logo mark |
| `social/HANDOFFS.md` | batch folder layout and the briefs.json format |
| `social/engine/` | the deterministic renderer: `fw.mjs` CLI, `templates.mjs`, `slide.css`, `TEMPLATES.md` |
| `social/examples/sample-batch/` | a two-post fixture used by the engine test |
| `social/ledger.md` | history of produced posts, so batches do not repeat |
| `social/batches/` | production work, git-ignored (deliverables leave as a zip) |

## Engine
HTML templates rendered by headless Chromium (Playwright) at exactly 1080x1350, in the real brand fonts (Switzer, General Sans, cached from Fontshare into `social/engine/.fonts/`, git-ignored). Typography, layout, the logo and colour are code, so every post is consistent; AI generation is used only for photography. The renderer fits text automatically, refuses overflow, unintended headline wraps, missing images or missing fonts, desaturates photos, and composes Reels with ffmpeg.

```
node social/engine/fw.mjs fonts | validate <batch> | render <post|batch> | reel <post> | sheet <batch> | check <batch> | package <batch>
node --test social/engine/test/*.test.mjs        # engine smoke test (no credits)
```
Needs Node 22, Playwright with Chromium (preinstalled in Claude Code cloud sessions; locally `npm i -g playwright && npx playwright install chromium`), ffmpeg for Reels, curl, python3 (zip).

## Integrations
- **Higgsfield**: through its MCP connector, authorised with the owner's Higgsfield account (no API key stored anywhere). Image cost on the starter plan, measured 2026-11-11: `gpt_image_2_6` medium 2k = 1 credit, high 2k = 2.75; `nano_banana_pro` 2k = 2; Kling 3.0 5 s 9:16 silent = 7.5; Seedance 2.5 1080p 5 s = 80. Price checks (`get_cost`) are free.
- **Network**: the cloud environment must allow `d8j0ntlcm91z4.cloudfront.net` (Higgsfield results), `api.fontshare.com` and `cdn.fontshare.com`.

## Rules
Brand rules: `social/brand/brand-system.md`. Facts: `social/brand/facts.md`. Credits are spent only after the owner approves a budget, and only by the creative director. This folder and `.claude/` are excluded from the website deploy (`.assetsignore`).
