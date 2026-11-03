/**
 * Discovery content model: the built-in catalogue (catalogue.js) with the Admin's changes laid over it, and the rules for what a recipient's answers may look like.
 * Pure: it takes the stored differences as plain rows and returns plain objects.
 *
 * A stored content row is { item_key, option_key, label, description, enabled, sort_order, is_custom, image_id? }.
 *   option_key "" means the question itself (label = the prompt, description = the help text).
 *   is_custom 1 means an option the Admin added (its key starts with "x-"); anything else must name a built-in option.
 */
import { kindDef, MODES } from "./catalogue.js";

export const MAX_COMMENT = 500;
export const MAX_OVERALL_COMMENT = 1000;
export const MAX_LABEL = 60;
export const MAX_NOTE = 140;
export const MAX_PROMPT = 120;
export const MAX_HELP = 240;
export const CUSTOM_PREFIX = "x-";
export const CUSTOM_KEY = /^x-[0-9a-f]{8}$/;

const control = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u2028\\u2029]", "g");
/** Plain text from a person: control characters out, line breaks kept (as \n), trimmed, capped. Returns "" for anything that is not a string. */
export function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").replace(control, "").trim().slice(0, max);
}

const byOrder = (a, b) => a.sortOrder - b.sortOrder || a.index - b.index;

/**
 * @param {string} kind
 * @param {Array} rows stored content rows (may be empty)
 * @returns the kind with every question and option resolved: { kind, label, intro, stages, questions: [{ ..., prompt, help, enabled, options: [{ key, label, note, sample, tags, colours, enabled, custom, imageId, sortOrder }] }] }
 */
export function effectiveKind(kind, rows = []) {
  const def = kindDef(kind);
  if (!def) return null;
  const q = new Map(), opt = new Map(), custom = new Map();
  for (const r of rows) {
    if (!r || typeof r.item_key !== "string") continue;
    if (r.option_key === "") q.set(r.item_key, r);
    else if (r.is_custom) { if (!custom.has(r.item_key)) custom.set(r.item_key, []); custom.get(r.item_key).push(r); } else opt.set(`${r.item_key}\u0000${r.option_key}`, r);
  }
  const questions = def.questions.map((base, qi) => {
    const qo = q.get(base.key);
    const options = base.options.map((b, i) => {
      const r = opt.get(`${base.key}\u0000${b.key}`);
      const text = r && r.description ? r.description : null;
      return {
        key: b.key, label: (r && r.label) || b.label, tags: b.tags, colours: b.colours || null,
        note: base.visual === "tagline" ? b.note || null : text || b.note || null,
        sample: base.visual === "tagline" ? text || b.sample || null : null,
        enabled: r ? r.enabled !== 0 && r.enabled !== false : true, custom: false, imageId: (r && r.image_id) || null,
        sortOrder: r && Number.isInteger(r.sort_order) ? r.sort_order : (i + 1) * 10, index: i,
      };
    });
    for (const [j, r] of (custom.get(base.key) || []).entries()) {
      options.push({
        key: r.option_key, label: r.label || "Custom", tags: [], colours: null, note: r.description || null, sample: base.visual === "tagline" ? r.description || null : null,
        enabled: r.enabled !== 0 && r.enabled !== false, custom: true, imageId: r.image_id || null,
        sortOrder: Number.isInteger(r.sort_order) ? r.sort_order : (base.options.length + j + 1) * 10, index: base.options.length + j,
      });
    }
    options.sort(byOrder);
    return {
      ...base, prompt: (qo && qo.label) || base.prompt, help: qo && qo.description !== null && qo.description !== undefined && qo.description !== "" ? qo.description : base.help,
      enabled: qo ? qo.enabled !== 0 && qo.enabled !== false : true, sortOrder: qo && Number.isInteger(qo.sort_order) ? qo.sort_order : (qi + 1) * 10, index: qi, options,
    };
  });
  return { kind: def.kind, label: def.label, intro: def.intro, stages: def.stages, sectionOrder: def.sectionOrder, questions };
}

/** The questions to show on one stage, in order, skipping any the Admin has hidden. */
export function stageQuestions(eff, stage) {
  const sections = new Set(stage.sections);
  return eff.questions.filter((x) => sections.has(x.section) && x.enabled).sort(byOrder).map((x) => ({ ...x, options: x.options.filter((o) => o.enabled) })).filter((x) => x.options.length > 0);
}

export const stageByNumber = (eff, n) => eff.stages.find((s) => s.n === n) || null;

/**
 * Turns whatever was posted for one question into the stored shape, or null when it is empty. Unknown keys are dropped, a dislike wins over a like for the same option,
 * "not sure" keeps nothing, "surprise me" keeps only the dislikes.
 */
export function normalizePicks(question, input = {}) {
  const valid = new Set(question.options.map((o) => o.key));
  const pick = (arr) => [...new Set((Array.isArray(arr) ? arr : []).filter((k) => typeof k === "string" && valid.has(k)))];
  const mode = MODES.includes(input.mode) ? input.mode : "picks";
  const dislike = mode === "not_sure" ? [] : pick(input.dislike);
  const like = mode === "picks" ? pick(input.like).filter((k) => !dislike.includes(k)) : [];
  if (mode === "picks" && like.length === 0 && dislike.length === 0) return null;
  return { mode, like, dislike };
}

/** Reads one stage's posted fields (l:<question>:<option>, d:<question>:<option>, m:<question>, c:<question>) into { [questionKey]: { picks, comment } }. */
export function readStageFields(fields, questions) {
  const out = {};
  for (const qn of questions) {
    const like = [], dislike = [];
    for (const o of qn.options) {
      if (fields.get(`l:${qn.key}:${o.key}`) === "1") like.push(o.key);
      if (fields.get(`d:${qn.key}:${o.key}`) === "1") dislike.push(o.key);
    }
    const m = fields.get(`m:${qn.key}`);
    out[qn.key] = { picks: normalizePicks(qn, { like, dislike, mode: MODES.includes(m) ? m : "picks" }), comment: cleanText(fields.get(`c:${qn.key}`), MAX_COMMENT) };
  }
  return out;
}

/** The state of one answered question for progress and the brief: none | answered | not_sure | surprise. */
export function answerState(row) {
  if (!row) return "none";
  const p = row.picks;
  if (p && p.mode === "not_sure") return "not_sure";
  if (p && p.mode === "surprise") return "surprise";
  if (p && (p.like.length || p.dislike.length)) return "answered";
  return row.comment ? "comment_only" : "none";
}

/** Parses a stored picks_json; anything malformed is treated as no answer. */
export function parsePicks(json) {
  try {
    const p = JSON.parse(json);
    if (!p || typeof p !== "object") return null;
    const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 60) : []);
    return { mode: MODES.includes(p.mode) ? p.mode : "picks", like: arr(p.like), dislike: arr(p.dislike) };
  } catch { return null; }
}
