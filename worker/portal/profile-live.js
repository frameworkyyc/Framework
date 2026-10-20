/**
 * Pages of the connected Business Profile and the Coming Soon pages. Rendered from the saved answers of the member's OWN organization only; they
 * never use the fictional demonstration data. The questionnaire is a real form (POST, session-bound CSRF token); /assets/js/portal-profile.js only
 * adds the unsaved-changes warning and a Saving state, and the form works without it.
 */
import { e } from "./ui.js";
import { overview, crumb } from "./guided.js";
import { PROFILE_STEPS, profileProgress, stepStatus } from "./profile-schema.js";
import { AREAS } from "./guided-data.js";

const href = (vm, p) => `${vm.base}${p}`;
const area = (key) => AREAS.find((a) => a.key === key);

/** Overview: seven rows and one progress line, both calculated from saved answers. */
export function profileOverview(vm, saved) {
  const prog = profileProgress(saved);
  return overview(vm, { key: "profile", progress: { done: prog.done, total: prog.total, noun: "steps" }, rows: PROFILE_STEPS.map((s, i) => ({ title: s.title, href: `/profile/${s.id}`, state: prog.steps[i].state })) });
}

function field(scope, def, value, error) {
  const id = `${scope}-${def.id}`, hint = def.hint ? `<span class="field__hint" id="${id}-h">${e(def.hint)}</span>` : "", err = error ? `<span class="field__error" id="${id}-e">${e(error)}</span>` : "";
  const desc = [def.hint ? `${id}-h` : "", error ? `${id}-e` : ""].filter(Boolean).join(" "), aria = (desc ? ` aria-describedby="${desc}"` : "") + (error ? ' aria-invalid="true"' : "");
  const optional = def.required ? "" : ' <span class="field__opt">Optional</span>';
  if (def.kind === "choice") return `<fieldset class="field choice"><legend>${e(def.label)}${optional}</legend>${def.options.map((o) => `<label class="choice__opt"><input type="radio" name="${e(def.id)}" value="${e(o)}"${o === value ? " checked" : ""}> <span>${e(o)}</span></label>`).join("")}${err}</fieldset>`;
  const label = `<label for="${id}">${e(def.label)}${optional}</label>${hint}`;
  if (def.kind === "textarea") return `<div class="field">${label}<textarea id="${id}" name="${e(def.id)}" rows="4" maxlength="2000"${aria} placeholder="${e(def.placeholder || "")}">${e(value)}</textarea>${err}</div>`;
  if (def.kind === "select") return `<div class="field">${label}<select id="${id}" name="${e(def.id)}"${aria}><option value="">Choose…</option>${def.options.map((o) => `<option${o === value ? " selected" : ""}>${e(o)}</option>`).join("")}</select>${err}</div>`;
  return `<div class="field">${label}<input id="${id}" name="${e(def.id)}" type="${e(def.kind)}" value="${e(value)}" maxlength="${def.kind === "email" ? 254 : def.kind === "url" ? 300 : def.kind === "tel" ? 40 : 200}" placeholder="${e(def.placeholder || "")}"${aria} autocomplete="off">${err}</div>`;
}

/**
 * One questionnaire step.
 * @param o {values, errors, csrf, saved, failed}  values: what to show (saved answers, or the rejected submission); errors: per-question messages;
 *   saved: show the "Saved" note; failed: the save could not be stored (values are kept on the page)
 */
export function profileStep(vm, step, saved, { values = saved, errors = {}, csrf, savedNote = false, failed = false } = {}) {
  const i = PROFILE_STEPS.indexOf(step), prev = PROFILE_STEPS[i - 1], next = PROFILE_STEPS[i + 1];
  const st = stepStatus(step, saved);
  const nErr = Object.keys(errors).length;
  const banner = failed
    ? `<p class="form-banner form-banner--error" role="alert">We couldn’t save your answers just now. Nothing was lost on this page. Please try again in a moment.</p>`
    : nErr
      ? `<p class="form-banner form-banner--error" role="alert">Some answers need attention before they can be saved. Nothing was saved.</p>`
      : savedNote
        ? `<p class="form-banner" role="status">Saved.${st.missingRequired.length ? ` ${st.missingRequired.length} required ${st.missingRequired.length === 1 ? "answer is" : "answers are"} still needed to complete this step.` : " This step is complete."}</p>`
        : "";
  const stepper = `<nav class="stepper" aria-label="Business Profile steps"><ol>${PROFILE_STEPS.map((s, n) => { const ss = stepStatus(s, saved).state; return `<li class="is-${ss}"><a href="${e(href(vm, `/profile/${s.id}`))}"${s === step ? ' aria-current="step"' : ""}><span class="visually-hidden">Step ${n + 1}: ${e(s.title)}, ${ss === "done" ? "complete" : ss === "current" ? "in progress" : "not started"}</span><span aria-hidden="true">${n + 1}</span></a></li>`; }).join("")}</ol></nav>`;
  return `<header class="page-head">${crumb(vm, [["Business Profile", "/profile"], [step.title]])}<span class="eyebrow">Step ${i + 1} of ${PROFILE_STEPS.length}</span><h1 class="h1">${e(step.title)}</h1><p class="lead">${e(step.intro)}</p></header>
${stepper}${banner}
<form method="post" action="${e(href(vm, `/profile/${step.id}`))}" data-guard novalidate><input type="hidden" name="csrf" value="${e(csrf)}">
<div class="questions">${step.fields.map((d) => field(`p-${step.id}`, d, values[d.id] || "", errors[d.id])).join("")}</div>
<p class="form-status muted small" data-status role="status" aria-live="polite"></p>
<div class="step-nav">${prev ? `<a class="btn" href="${e(href(vm, `/profile/${prev.id}`))}"><span aria-hidden="true">←</span> Previous</a>` : `<a class="btn" href="${e(href(vm, "/profile"))}"><span aria-hidden="true">←</span> All steps</a>`}<button class="btn btn--primary" type="submit" data-save>Save</button>${next ? `<a class="btn" href="${e(href(vm, `/profile/${next.id}`))}">Next <span aria-hidden="true">→</span></a>` : `<a class="btn" href="${e(href(vm, "/profile"))}">Back to your steps</a>`}</div></form>`;
}

/** A section that is not built yet. Authenticated clients never see demonstration content here. */
export function comingSoon(vm, key) {
  const a = area(key);
  return `<header class="page-head page-head--compact">${crumb(vm, [[a.title]])}<h1 class="h1 h1--section">${e(a.title)}</h1></header>
<div class="soon"><span class="tag">Coming soon</span><p class="lead">We’re still building this part of your workspace.</p><p class="muted">We’ll let you know when it’s ready. Your Business Profile is the best place to start.</p><p><a class="btn btn--primary" href="${e(href(vm, "/profile"))}">Open your Business Profile <span aria-hidden="true">→</span></a></p></div>`;
}
