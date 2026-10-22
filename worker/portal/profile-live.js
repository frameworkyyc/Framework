/**
 * Pages of the connected Business Profile and the Coming Soon pages. Rendered from the saved answers of the member's OWN organization only; they
 * never use the fictional demonstration data. The questionnaire is a real form (POST, session-bound CSRF token); /assets/js/portal-profile.js only
 * adds the unsaved-changes warning and a Saving state, and the form works without it.
 */
import { e, errorSummary, conflictSummary } from "./ui.js";
import { overview, crumb } from "./guided.js";
import { PROFILE_STEPS, profileProgress, stepStatus, MULTI_SEP } from "./profile-schema.js";
import { can } from "./policy.js";
import { AREAS } from "./guided-data.js";
import { FEEDBACK_KINDS, feedbackPageChoices, MAX_MESSAGE } from "./repo/portal-feedback.js";

const href = (vm, p) => `${vm.base}${p}`;
const area = (key) => AREAS.find((a) => a.key === key);

/** Overview: seven rows and one progress line, both calculated from saved answers. */
export function profileOverview(vm, saved) {
  const prog = profileProgress(saved);
  const left = (i) => prog.steps[i].missingRequired.length;
  const firstOpen = prog.steps.findIndex((s) => s.missingRequired.length > 0); // the first step that still lacks a REQUIRED answer (optional-only steps never count)
  const started = prog.steps.some((s) => s.answered > 0);
  const rows = PROFILE_STEPS.map((s, i) => ({ title: s.title, href: `/profile/${s.id}`, state: prog.steps[i].state, status: left(i) ? `${left(i)} required ${left(i) === 1 ? "answer" : "answers"} left` : "" }));
  const action = firstOpen >= 0
    ? `<p class="progress-next"><a class="btn btn--primary" href="${e(href(vm, `/profile/${PROFILE_STEPS[firstOpen].id}`))}">${started ? "Continue" : "Start"}: ${e(PROFILE_STEPS[firstOpen].title)} <span aria-hidden="true">→</span></a></p>`
    : `<p class="muted small progress-next" role="status">All required answers are complete.${prog.done < prog.total ? " The remaining steps are optional: add to them whenever it helps." : ""}</p>`;
  return overview(vm, { key: "profile", progress: { done: prog.done, total: prog.total, noun: "steps" }, action, rows }) + privacyNotice();
}

/**
 * How Business Profile information is used. Plain statements about what the portal does today; deliberately no claims about encryption,
 * retention periods, regulatory compliance or where data is stored (those need the owner's and an adviser's review: see PRIVACY-DRAFT.md).
 */
export function privacyNotice() {
  return `<section class="privacy" id="privacy" aria-labelledby="h-privacy"><h2 id="h-privacy" class="privacy__title">How we use your Business Profile</h2>
<p class="muted">The client portal is in private beta, so this may change as we learn.</p>
<dl class="privacy__list">
<div><dt>What we collect</dt><dd>The answers you save here about your business, customers, goals, online presence, contact person and brand.</dd></div>
<div><dt>Why</dt><dd>So Framework can understand your business and plan and deliver services for you.</dd></div>
<div><dt>Who can see it</dt><dd>It is saved against your organization. People in your organization who use the portal can see and edit it, and authorized Framework staff may review it to provide services to you.</dd></div>
<div><dt>Corrections and deletion</dt><dd>You can change your answers here at any time. To ask for something to be corrected or deleted, email <a class="text-link" href="mailto:hello@frameworkco.ca">hello@frameworkco.ca</a>.</dd></div>
</dl>
<p class="muted small">Our <a class="text-link" href="/privacy.html#portal">privacy policy</a> describes how we handle personal information, including in the client portal.</p></section>`;
}

function field(scope, def, value, error) {
  const id = `${scope}-${def.id}`, hint = def.hint ? `<span class="field__hint" id="${id}-h">${e(def.hint)}</span>` : "", err = error ? `<span class="field__error" id="${id}-e">${e(error)}</span>` : "";
  const desc = [def.hint ? `${id}-h` : "", error ? `${id}-e` : ""].filter(Boolean).join(" "), aria = (desc ? ` aria-describedby="${desc}"` : "") + (error ? ' aria-invalid="true"' : "");
  const optional = def.required ? "" : ' <span class="field__opt">Optional</span>';
  // Required questions are announced as required, but NEVER with the native `required` attribute: a partial save must stay possible.
  const req = def.required ? ' aria-required="true"' : "";
  const ac = e(def.autocomplete || "off");
  if (def.kind === "multi") {
    // several checkboxes, each with its OWN name (<field>__<n>): the form reader refuses a repeated name, and the server assembles the answer from them
    const chosen = new Set(String(value || "").split(MULTI_SEP));
    return `<fieldset class="field choice" id="${id}" tabindex="-1"${desc ? ` aria-describedby="${desc}"` : ""}><legend>${e(def.label)}${optional}</legend>${hint}${def.options.map((o, i) => `<label class="choice__opt"><input type="checkbox" name="${e(def.id)}__${i}" value="${e(o)}"${chosen.has(o) ? " checked" : ""}> <span>${e(o)}</span></label>`).join("")}${err}</fieldset>`;
  }
  if (def.kind === "choice") return `<fieldset class="field choice" id="${id}" tabindex="-1"${def.required ? ' role="radiogroup" aria-required="true"' : ""}><legend>${e(def.label)}${optional}</legend>${def.options.map((o) => `<label class="choice__opt"><input type="radio" name="${e(def.id)}" value="${e(o)}"${o === value ? " checked" : ""}> <span>${e(o)}</span></label>`).join("")}${err}</fieldset>`;
  const label = `<label for="${id}">${e(def.label)}${optional}</label>${hint}`;
  if (def.kind === "textarea") return `<div class="field">${label}<textarea id="${id}" name="${e(def.id)}" rows="4" maxlength="2000"${aria}${req} placeholder="${e(def.placeholder || "")}">${e(value)}</textarea>${err}</div>`;
  if (def.kind === "select") return `<div class="field">${label}<select id="${id}" name="${e(def.id)}"${aria}${req}><option value="">Choose…</option>${def.options.map((o) => `<option${o === value ? " selected" : ""}>${e(o)}</option>`).join("")}</select>${err}</div>`;
  // a website is a plain text box (so "yourbusiness.ca" is accepted) with the URL keyboard on phones; the server adds https:// and validates
  if (def.kind === "website") return `<div class="field">${label}<input id="${id}" name="${e(def.id)}" type="text" inputmode="url" autocapitalize="none" autocorrect="off" spellcheck="false" value="${e(value)}" maxlength="300" placeholder="${e(def.placeholder || "")}"${aria}${req} autocomplete="${ac}" data-website>${err}</div>`;
  return `<div class="field">${label}<input id="${id}" name="${e(def.id)}" type="${e(def.kind)}" value="${e(value)}" maxlength="${def.kind === "email" ? 254 : def.kind === "tel" ? 40 : 200}" placeholder="${e(def.placeholder || "")}"${aria}${req} autocomplete="${ac}">${err}</div>`;
}

/**
 * One questionnaire step.
 * @param o {values, errors, csrf, saved, failed}  values: what to show (saved answers, or the rejected submission); errors: per-question messages;
 *   saved: show the "Saved" note; failed: the save could not be stored (values are kept on the page)
 */
export function profileStep(vm, step, saved, { values = saved, errors = {}, csrf, savedNote = false, unchanged = false, failed = false, conflict = null, revision = "" } = {}) {
  const i = PROFILE_STEPS.indexOf(step), prev = PROFILE_STEPS[i - 1], next = PROFILE_STEPS[i + 1];
  const st = stepStatus(step, saved);
  const nErr = Object.keys(errors).length;
  const differing = conflict ? step.fields.filter((d) => (values[d.id] || "").trim() !== (conflict[d.id] || "")) : [];
  const banner = conflict
    ? conflictSummary(differing.map((d) => ({ id: `p-${step.id}-${d.id}`, label: d.label, saved: conflict[d.id] || "" })), href(vm, `/profile/${step.id}`))
    : failed
    ? `<p class="form-banner form-banner--error" role="alert">We couldn’t save your answers just now. Nothing was lost on this page. Please try again in a moment.</p>`
    : nErr
      ? errorSummary(step.fields.filter((d) => errors[d.id]).map((d) => ({ id: `p-${step.id}-${d.id}`, label: d.label, message: errors[d.id] })), "Some answers need attention. Nothing was saved.")
      : savedNote || unchanged
        ? `<p class="form-banner" role="status">${savedNote ? "Saved." : "No changes to save. Your answers on this step are already up to date."}${st.missingRequired.length ? ` ${st.missingRequired.length} required ${st.missingRequired.length === 1 ? "answer is" : "answers are"} still needed to complete this step.` : " This step is complete."}</p>`
        : "";
  const stepper = `<nav class="stepper" aria-label="Business Profile steps"><ol>${PROFILE_STEPS.map((s, n) => { const ss = stepStatus(s, saved).state; return `<li class="is-${ss}"><a href="${e(href(vm, `/profile/${s.id}`))}"${s === step ? ' aria-current="step"' : ""}><span class="visually-hidden">Step ${n + 1}: ${e(s.title)}, ${ss === "done" ? "complete" : ss === "current" ? "in progress" : "not started"}</span><span aria-hidden="true">${n + 1}</span></a></li>`; }).join("")}</ol></nav>`;
  return `<header class="page-head">${crumb(vm, [["Business Profile", "/profile"], [step.title]])}<span class="eyebrow">Step ${i + 1} of ${PROFILE_STEPS.length}</span><h1 class="h1">${e(step.title)}</h1><p class="lead">${e(step.intro)}</p></header>
${stepper}${banner}
<form method="post" action="${e(href(vm, `/profile/${step.id}`))}" data-guard novalidate><input type="hidden" name="csrf" value="${e(csrf)}"><input type="hidden" name="rev" value="${e(revision)}">
<div class="questions">${step.fields.map((d) => field(`p-${step.id}`, d, values[d.id] || "", errors[d.id])).join("")}</div>
<p class="form-status muted small" data-status role="status" aria-live="polite"></p>
<div class="step-nav"><button class="btn btn--primary" type="submit" name="intent" value="continue" data-save>${next ? "Save and continue" : "Save and finish"}</button><button class="btn" type="submit" name="intent" value="save" data-save>Save changes</button><a class="step-nav__back text-link" href="${e(prev ? href(vm, `/profile/${prev.id}`) : href(vm, "/profile"))}"><span aria-hidden="true">←</span> ${prev ? "Previous" : "All steps"}</a></div></form>
<p class="muted small privacy__link">Your answers are saved for your organization and may be reviewed by authorized Framework staff. <a class="text-link" href="${e(href(vm, "/profile#privacy"))}">How we use this information</a></p>`;
}

/** A section that is not built yet. Authenticated clients never see demonstration content here. */
export function comingSoon(vm, key) {
  const a = area(key);
  return `<header class="page-head page-head--compact">${crumb(vm, [[a.title]])}<h1 class="h1 h1--section">${e(a.title)}</h1></header>
<div class="soon"><span class="tag">Coming soon</span><p class="lead">We’re still building this part of your workspace.</p><p class="muted">We’ll let you know when it’s ready. Your Business Profile is the best place to start.</p><p><a class="btn btn--primary" href="${e(href(vm, "/profile"))}">Open your Business Profile <span aria-hidden="true">→</span></a></p></div>`;
}

/**
 * The feedback form. o: {values, errors, csrf, sent, failed, tooMany, from}. Asks only for what the session does not already know.
 */
export function feedbackForm(vm, { values = {}, errors = {}, csrf, sent = false, failed = false, tooMany = false, from = "" } = {}) {
  const page = values.page !== undefined ? values.page : from;
  const nErr = Object.keys(errors).length;
  const banner = sent ? `<p class="form-banner" role="status">Thank you. Your feedback has been sent to Framework.</p>`
    : failed ? `<p class="form-banner form-banner--error" role="alert">We couldn’t send your feedback just now. Your message is still here. Please try again in a moment.</p>`
    : tooMany ? `<p class="form-banner form-banner--error" role="alert">You’ve sent several messages recently. Please try again a little later.</p>`
    : nErr ? errorSummary([["kind", "fb-kind", "What kind of feedback is this?"], ["message", "fb-message", "Your message"], ["page", "fb-page", "About"]].filter(([k]) => errors[k]).map(([k, id, label]) => ({ id, label, message: errors[k] })), "Please check these parts. Nothing was sent.") : "";
  const head = `<header class="page-head page-head--compact">${crumb(vm, [["Send feedback"]])}<h1 class="h1 h1--section">Send feedback</h1>${sent ? "" : `<p class="lead">Tell us what isn’t working, or what would help. Framework staff will read it.</p>`}</header>`;
  if (sent) return `${head}${banner}<p><a class="btn btn--primary" href="${e(vm.base)}">Back to Home</a> <a class="btn" href="${e(vm.base)}/feedback">Send more feedback</a></p>`;
  const err = (k) => (errors[k] ? `<span class="field__error" id="fb-${k}-e">${e(errors[k])}</span>` : "");
  const kinds = `<fieldset class="field choice"${errors.kind ? ' id="fb-kind" tabindex="-1"' : ""}><legend>What kind of feedback is this?</legend>${FEEDBACK_KINDS.map(([k, label]) => `<label class="choice__opt"><input type="radio" name="kind" value="${k}"${values.kind === k ? " checked" : ""}> <span>${e(label)}</span></label>`).join("")}${err("kind")}</fieldset>`;
  const message = `<div class="field"><label for="fb-message">Your message</label><textarea id="fb-message" name="message" rows="6" maxlength="${MAX_MESSAGE}"${errors.message ? ' aria-invalid="true" aria-describedby="fb-message-e"' : ""}>${e(values.message || "")}</textarea>${err("message")}</div>`;
  const about = `<div class="field"><label for="fb-page">About <span class="field__opt">Optional</span></label><select id="fb-page" name="page"${errors.page ? ' aria-invalid="true" aria-describedby="fb-page-e"' : ""}><option value="">Not about a specific page</option>${feedbackPageChoices(vm.org && vm.org.role, can).map(([k, label]) => `<option value="${k}"${k === page ? " selected" : ""}>${e(label)}</option>`).join("")}</select>${err("page")}</div>`;
  return `${head}${banner}<form method="post" action="${e(vm.base)}/feedback" novalidate><input type="hidden" name="csrf" value="${e(csrf)}"><div class="questions">${kinds}${message}${about}</div><div class="step-nav"><button class="btn btn--primary" type="submit">Send feedback</button></div></form>`;
}
