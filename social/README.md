# Framework social content team

A three-agent production line for Instagram and Facebook that runs inside Claude Code. Ask, for example, "Generate our next Instagram and Facebook posts" (or `/social-batch`). Every batch is exactly 9 posts: one complete 3×3 Instagram grid block. The main session acts as **Content Director** and follows `.claude/skills/social-batch/SKILL.md`:

```
owner request
  → 01 content-strategist (Opus)   9 posts: 5 attract / 3 trust / 1 convert, six-question test, 3×3 grid plan → plan.md + briefs.json
  → owner approves plan and credit budget          ← the only stop
  → 02 creative-director (Sonnet)  Higgsfield images → engine layouts → grid preview vs. published feed → slides/*.png → Figma feed board
  → 03 social-copywriter (Sonnet)  captions by purpose (attract / trust / convert), alt text
  → Content Director QC (fw check + grid, feed, strategy, words) → export/ + zip → social/history/
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
| `social/history/posts.csv` | content history: every produced post (goal, category, layout family, tone, CTA) plus real performance numbers once published |
| `social/history/covers/` | small cover thumbnails, so each grid preview continues the real feed |
| `social/figma.json` | the Figma feed board |
| `social/examples/layout-families/` | one working spec per layout family (also the feed test fixture) |
| `social/batches/` | production work, git-ignored (deliverables leave as a zip) |

## Engine
HTML templates rendered by headless Chromium (Playwright) at exactly 1080x1350, in the real brand fonts (Switzer, General Sans, cached from Fontshare into `social/engine/.fonts/`, git-ignored). Typography, layout, the logo and colour are code, so every post is consistent; AI generation is used only for photography, scenes, mockup objects and video clips. Slides carry no automatic logo, wordmark, URL or footer; Framework branding appears only where a concept calls for it (`brand` with a reason), and `fw check` fails watermark-style placements. The renderer fits text automatically, refuses overflow, unintended headline wraps, missing images or missing fonts, cuts seamless panoramic carousels from one wide composition, and renders code-animated Reels frame by frame (ffmpeg), optionally over a Higgsfield clip.

```
node social/engine/fw.mjs fonts | validate <batch> | render <post|batch> | reel <post> | sheet <batch> | grid <batch> | check <batch> | package <batch>
node social/engine/fw.mjs history add <batch> | recent [n] | report
node social/engine/fw.mjs figma manifest | upload | layout <batch>
node --test social/engine/test/*.test.mjs        # engine smoke test (no credits)
```
Needs Node 22, Playwright with Chromium (preinstalled in Claude Code cloud sessions; locally `npm i -g playwright && npx playwright install chromium`), ffmpeg for Reels, curl, python3 (zip).

## Feed design
Fifteen templates form layout families across six visual categories (editorial typography, architectural photography, portfolio, conceptual artwork, educational graphics, minimalist). See `engine/TEMPLATES.md`. `fw grid` renders the Instagram profile as it will look after the batch is published, on top of the real history (3:4 tiles, newest first, the first nine marked), and fails on neighbouring covers in the same family; it warns on tone runs, light/dark and imagery balance, and category spread.

## Integrations
- **Higgsfield**: through its MCP connector, authorised with the owner's Higgsfield account (no API key stored anywhere). Image cost on the starter plan, measured 2026-11-11: `gpt_image_2_6` medium 2k = 1 credit, high 2k = 2.75; `nano_banana_pro` 2k = 2; Kling 3.0 5 s 9:16 silent = 7.5; Seedance 2.5 1080p 5 s = 80. Price checks (`get_cost`) are free.
- **Figma**: through its MCP connector (the owner's account, Starter plan, verified 2026-11-11). Used as the **feed board**: finished slides are uploaded into one file (`social/figma.json`) and arranged per batch as a profile preview plus every slide, for review, reordering and comments. Not used to design slides: Figma's automated runtime cannot load Switzer or General Sans (it substitutes Inter, even through SVG import), and its export and read tools are limited to a handful of calls a month on the Starter plan. Writes (file edits, uploads) work.
- **Network**: the cloud environment must allow `d8j0ntlcm91z4.cloudfront.net` (Higgsfield results), `api.fontshare.com`, `cdn.fontshare.com` and `mcp.figma.com` (Figma uploads).
- **Performance**: there is no analytics connector. The owner shares insights (numbers or screenshots); the Director records them in `social/history/posts.csv` and `fw history report` summarises them. Nothing is estimated.

## Rules
Brand rules: `social/brand/brand-system.md`. Facts: `social/brand/facts.md`. Credits are spent only after the owner approves a budget, and only by the creative director. This folder and `.claude/` are excluded from the website deploy (`.assetsignore`).
