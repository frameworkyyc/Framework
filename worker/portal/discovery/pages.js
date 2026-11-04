/**
 * Discovery pages (HTML). One renderer serves both ways in: a guest with a secret link (no account) and a signed-in client under Branding. The caller supplies `base`
 * (where the forms post), `csrf` (members only; a guest's credential is the unguessable link in the path) and `imageUrl`. Pages carry no inline style and no inline script
 * (the portal Content-Security-Policy forbids both): selections are native checkboxes and radios styled with sibling selectors, so the whole assessment works without
 * JavaScript; /assets/js/discovery.js only tidies the interaction (mutual exclusion, a progress hint).
 * Everything a person or an Admin typed goes through escapeHtml.
 */
import { escapeHtml as e } from "../frame.js";
import { visualFor } from "./visuals.js";
import { stageQuestions, answerState } from "./model.js";
import { SECTIONS, MODE_LABEL, TAG_LABEL } from "./catalogue.js";
import { MAX_COMMENT, MAX_OVERALL_COMMENT } from "./model.js";

const MINUTES_PER_QUESTION = 1.2;
const idPart = (s) => String(s).replace(/[^a-z0-9]+/gi, "-");

export const minutesLeft = (eff, fromStage) => {
  let q = 0;
  for (const s of eff.stages) if (s.n >= fromStage) q += stageQuestions(eff, s).length;
  return Math.max(1, Math.round(q * MINUTES_PER_QUESTION));
};

function stepper(eff, current, base, assessment) {
  const reached = Math.max(assessment.stage, current);
  return `<ol class="dsc__steps" aria-label="Progress">${eff.stages.map((s) => {
    const state = s.n === current ? "is-current" : s.n < current ? "is-done" : "";
    const link = s.n <= reached ? `<a href="${e(base)}/${s.n}"${s.n === current ? ' aria-current="step"' : ""}>` : `<span>`;
    return `<li class="dsc__step ${state}">${link}<span class="dsc__num">${s.n}</span><span class="dsc__label">${e(s.title)}</span>${s.n <= reached ? "</a>" : "</span>"}</li>`;
  }).join("")}</ol>`;
}

const FONT_CLASS = new Set(["serif-classic", "serif-modern", "sans-geometric", "sans-humanist", "slab", "script", "display", "mono", "condensed", "elegant-italic", "calligraphic", "handwritten", "deco", "old-style"]);

const DIRECTION_IMAGES = new Set(["modern", "minimalist", "luxury", "traditional", "bold", "playful", "industrial", "organic", "retro", "editorial", "holistic", "mystical", "romantic", "bohemian", "feminine", "rustic"]);

function cardVisual(q, o, imageUrl) {
  if (o.imageId) return `<img class="dv dv--photo" src="${e(imageUrl(o.imageId))}" alt="${e(o.label)}" loading="lazy" width="480" height="300">`;
  if (q.key === "style.direction" && DIRECTION_IMAGES.has(o.key)) return `<img class="dv dv--direction" src="/assets/img/discovery-directions/${o.key}.jpg" alt="" loading="lazy" width="480" height="300">`;
  if (q.visual === "word") return `<span class="dc__word">${e(o.label)}</span>`;
  if (q.visual === "font") return FONT_CLASS.has(o.key) ? `<span class="dc__font dc__font--${e(o.key)}" aria-hidden="true"><span class="dc__font-big">Your Brand</span><span class="dc__font-small">Made with care, for you.</span><span class="dc__font-small">ABC abc 123</span></span>` : `<span class="dc__word">${e(o.label)}</span>`;
  if (q.visual === "tagline") return `<span class="dc__tagline">“${e(o.sample || o.label)}”</span>`;
  const svg = visualFor(q.visual, o, q.key);
  return svg || `<span class="dc__word">${e(o.label)}</span>`;
}

function card(q, o, picks, imageUrl) {
  const like = picks && picks.like.includes(o.key);
  const id = `${idPart(q.key)}-${idPart(o.key)}`;
  const showLabel = q.visual !== "word";
  return `<div class="dc dc--${e(q.visual)}">
<input class="dc__in dc__in--like" type="checkbox" id="l-${id}" name="l:${e(q.key)}:${e(o.key)}" value="1"${like ? " checked" : ""}>
<label class="dc__main" for="l-${id}"><span class="dc__vis">${cardVisual(q, o, imageUrl)}</span>${showLabel ? `<span class="dc__name">${e(o.label)}</span>` : ""}${o.note && q.visual !== "tagline" ? `<span class="dc__note">${e(o.note)}</span>` : ""}<span class="dc__tick" aria-hidden="true"></span></label>
</div>`;
}

function question(q, answer, imageUrl) {
  const picks = answer && answer.picks;
  const mode = picks ? picks.mode : "picks";
  const sec = SECTIONS[q.section];
  const id = idPart(q.key);
  const pill = (value, label) => `<label class="dq__pill"><input type="radio" name="m:${e(q.key)}" value="${value}"${mode === value ? " checked" : ""}><span>${e(label)}</span></label>`;
  return `<section class="dq" aria-labelledby="q-${id}">
<header class="dq__head"><span class="eyebrow">${e(sec.number)} · ${e(sec.label)}</span><h2 class="dq__title" id="q-${id}">${e(q.prompt)}</h2>${q.help ? `<p class="dq__help">${e(q.help)}</p>` : ""}<p class="dq__hint">Tap a card to choose it. Tap it again to unchoose it.</p></header>
<div class="dq__grid dq__grid--${e(q.visual)}">${q.options.map((o) => card(q, o, picks, imageUrl)).join("")}</div>
<div class="dq__mode" role="radiogroup" aria-label="Or">${pill("picks", "Choose from these")}${pill("not_sure", MODE_LABEL.not_sure)}${pill("surprise", MODE_LABEL.surprise)}</div>
<div class="dq__comment"><label for="c-${id}">Anything to add? <span class="muted">Optional</span></label><textarea id="c-${id}" name="c:${e(q.key)}" rows="2" maxlength="${MAX_COMMENT}" placeholder="Tell us more, in your own words">${e(answer ? answer.comment : "")}</textarea></div>
</section>`;
}

function summary(eff, answers, base) {
  const rows = eff.sectionOrder.map((key) => {
    const qs = eff.questions.filter((x) => x.section === key && x.enabled);
    if (!qs.length) return "";
    const stage = eff.stages.find((s) => s.sections.includes(key));
    const items = qs.map((x) => {
      const a = answers.get(x.key), st = answerState(a), label = (k) => (x.options.find((o) => o.key === k) || { label: k }).label;
      if (st === "none") return `<li class="muted">${e(x.prompt)}: not answered</li>`;
      if (st === "not_sure") return `<li>${e(x.prompt)}: <strong>${e(MODE_LABEL.not_sure)}</strong></li>`;
      const likes = a.picks ? a.picks.like.map(label) : [], no = a.picks ? a.picks.dislike.map(label) : [];
      return `<li>${e(x.prompt)}: ${a.picks && a.picks.mode === "surprise" ? `<strong>${e(MODE_LABEL.surprise)}</strong>` : likes.length ? e(likes.join(", ")) : '<span class="muted">no likes</span>'}${no.length ? ` <span class="muted">· not for me: ${e(no.join(", "))}</span>` : ""}${a.comment ? ` <span class="muted">· “${e(a.comment.length > 80 ? a.comment.slice(0, 77) + "…" : a.comment)}”</span>` : ""}</li>`;
    }).join("");
    return `<div class="dr"><div class="dr__head"><h3 class="dr__title">${e(SECTIONS[key].number)} ${e(SECTIONS[key].label)}</h3><a class="dr__edit" href="${e(base)}/${stage.n}">Change</a></div><ul class="dr__list">${items}</ul></div>`;
  }).join("");
  return `<div class="dr-wrap">${rows}</div>`;
}

const errorText = {
  type_not_allowed: "That file type is not accepted. Use a PNG, JPG, WebP or PDF.", file_too_large: "That file is too large (10 MB at most).", empty_file: "That file is empty.", invalid_name: "That file name cannot be used.",
  content_mismatch: "That file does not look like its file type.", file_limit: "You have added the most files allowed.", quota_exceeded: "These files are more than can be added in total.", storage_unavailable: "Files cannot be added right now. Please try again shortly.",
  too_many: "You can add up to 3 files at a time.", closed: "This assessment has been sent, so it can’t be changed.",
};
export const uploadErrorText = (code) => errorText[code] || "That file could not be added.";

/**
 * @param {object} o { eff, assessment, stage (object), answers (Map), uploads, base, csrf, imageUrl, notice, error, limits, mode: 'guest'|'member', backHref }
 */
export function stageBody(o) {
  const { eff, assessment, stage, answers, uploads = [], base, csrf, imageUrl, notice, error, mode = "guest" } = o;
  const qs = stageQuestions(eff, stage);
  const review = Boolean(stage.review);
  const multipart = review ? ' enctype="multipart/form-data"' : "";
  const total = eff.stages.length;
  const left = minutesLeft(eff, stage.n);
  const files = review ? `<section class="dq dq--files" aria-labelledby="q-files"><header class="dq__head"><span class="eyebrow">Optional</span><h2 class="dq__title" id="q-files">Inspiration</h2><p class="dq__help">Add logos you like, photos, a competitor’s brand, a mood board or anything that shows what you mean. PNG, JPG, WebP or PDF, up to 10 MB each, 3 at a time.</p></header>
${uploads.length ? `<ul class="dfiles">${uploads.map((u) => `<li><span>${e(u.name)}</span> <span class="muted">${Math.max(1, Math.round(u.size / 1024))} KB</span><button class="dfiles__x" type="submit" name="remove" value="${e(u.id)}" formnovalidate>Remove</button></li>`).join("")}</ul>` : ""}
<div class="dq__comment"><label for="dfile">Add files</label><input id="dfile" class="dfile" type="file" name="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf"></div></section>` : "";
  const overall = review ? `<section class="dq" aria-labelledby="q-overall"><header class="dq__head"><span class="eyebrow">Last thing</span><h2 class="dq__title" id="q-overall">Anything else we should know?</h2></header><div class="dq__comment"><label class="visually-hidden" for="c-overall">Anything else</label><textarea id="c-overall" name="overall" rows="4" maxlength="${MAX_OVERALL_COMMENT}" placeholder="Deadlines, competitors, things to avoid, a story behind the name…">${e(assessment.overallComment)}</textarea></div></section>` : "";
  const nav = `<nav class="dsc__nav" aria-label="Move between steps">
${stage.n > 1 ? `<button class="btn btn--ghost" type="submit" name="go" value="back" formnovalidate>Back</button>` : `<span></span>`}
<span class="dsc__nav-right"><button class="btn btn--quiet" type="submit" name="go" value="save" formnovalidate>Save and finish later</button>
${review ? `<button class="btn btn--primary" type="submit" name="go" value="submit">Send to Framework</button>` : `<button class="btn btn--primary" type="submit" name="go" value="next">Continue</button>`}</span></nav>`;
  return `<div class="dsc dsc--${e(mode)}" data-dsc>
<header class="dsc__top"><p class="dsc__meta"><strong>Step ${stage.n} of ${total}</strong> · about ${left} minute${left === 1 ? "" : "s"} left</p>${stepper(eff, stage.n, base, assessment)}</header>
${notice ? `<p class="dsc__notice" role="status">${e(notice)}</p>` : ""}${error ? `<p class="dsc__error" role="alert">${e(error)}</p>` : ""}
<form class="dsc__form" method="post" action="${e(base)}/${stage.n}"${multipart} novalidate>
${csrf ? `<input type="hidden" name="csrf" value="${e(csrf)}">` : ""}
<div class="dsc__intro"><h1 class="dsc__h1">${e(stage.title)}</h1><p class="dsc__lead">${e(stage.blurb)}</p></div>
${qs.map((q) => question(q, answers.get(q.key), imageUrl)).join("")}
${review ? `<section class="dq dq--review" aria-labelledby="q-review"><header class="dq__head"><span class="eyebrow">Review</span><h2 class="dq__title" id="q-review">Your choices so far</h2><p class="dq__help">Check everything is right. You can change any step before you send it.</p></header>${summary(eff, answers, base)}</section>` : ""}
${files}${overall}${nav}
</form></div>`;
}

export function welcomeBody({ eff, assessment, base, resumeStage, mode = "guest" }) {
  const started = assessment.status === "in_progress";
  const hello = assessment.recipientName ? `Hello ${e(assessment.recipientName)}` : "Welcome";
  return `<div class="dsc dsc--welcome dsc--${e(mode)}"><div class="dsc__intro dsc__intro--hero"><span class="eyebrow">${e(eff.label)}</span><h1 class="dsc__h1">${started ? `${hello}, welcome back` : hello}</h1>
<p class="dsc__lead">${e(eff.intro)}</p>
<ul class="dsc__facts"><li><strong>${eff.stages.length}</strong> short steps</li><li><strong>About ${minutesLeft(eff, 1)}</strong> minutes</li><li><strong>Saved</strong> as you go</li></ul>
<p><a class="btn btn--primary btn--lg" href="${e(base)}/${started ? resumeStage : 1}">${started ? `Continue at step ${resumeStage}` : "Start"}</a></p>
<p class="muted small">There are no right or wrong answers. Choose what you like, mark what you don’t, and say “not sure” whenever you are.</p></div></div>`;
}

export function doneBody({ eff, assessment, mode = "guest", backHref = null }) {
  return `<div class="dsc dsc--welcome dsc--${e(mode)}"><div class="dsc__intro dsc__intro--hero"><span class="eyebrow">${e(eff.label)}</span><h1 class="dsc__h1">Thank you${assessment.recipientName ? `, ${e(assessment.recipientName)}` : ""}</h1>
<p class="dsc__lead">${assessment.status === "reviewed" ? "Framework has read your answers and will be in touch about what comes next." : "Your answers are with Framework. We will read them carefully and get back to you."}</p>
${backHref ? `<p><a class="btn btn--primary" href="${e(backHref)}">Back to Branding</a></p>` : `<p class="muted small">You can close this page.</p>`}</div></div>`;
}

export const closedBody = () => `<div class="dsc dsc--welcome dsc--guest"><div class="dsc__intro dsc__intro--hero"><span class="eyebrow">Framework</span><h1 class="dsc__h1">This link isn’t active</h1>
<p class="dsc__lead">It may have expired or been replaced. Please ask Framework for a new link at <a href="mailto:hello@frameworkco.ca">hello@frameworkco.ca</a>.</p></div></div>`;

export { TAG_LABEL };
