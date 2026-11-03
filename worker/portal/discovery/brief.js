/**
 * The creative brief: one structured summary of a finished (or part-finished) assessment, organised into Framework's nine Branding sections, with the preferences that
 * pull against each other, the questions nobody answered, and the places worth a conversation. Pure: effective content + stored answers in, plain data out. It reads
 * answers only; it never touches a brand kit, a brand asset or a Branding requirement.
 *
 * answers: Map or object of questionKey -> { picks: {mode, like[], dislike[]} | null, comment }.
 */
import { SECTIONS, SECTION_ORDER, TENSIONS, TAG_LABEL, MODE_LABEL } from "./catalogue.js";
import { answerState } from "./model.js";

const asMap = (a) => (a instanceof Map ? a : new Map(Object.entries(a || {})));

export function buildBrief(eff, answersIn, { uploads = 0, overallComment = "" } = {}) {
  const answers = asMap(answersIn);
  const labelOf = new Map();
  const tagsOf = new Map();
  for (const q of eff.questions) for (const o of q.options) { labelOf.set(`${q.key}:${o.key}`, o.label); tagsOf.set(`${q.key}:${o.key}`, o.tags || []); }

  const sections = [];
  const liked = [], disliked = []; // { q, key, label, tags, section }
  for (const key of SECTION_ORDER) {
    const meta = SECTIONS[key];
    const qs = eff.questions.filter((q) => q.section === key && q.enabled);
    const items = qs.map((q) => {
      const row = answers.get(q.key) || null;
      const state = answerState(row);
      const pick = (keys) => (keys || []).map((k) => ({ key: k, label: labelOf.get(`${q.key}:${k}`) || k, note: (q.options.find((o) => o.key === k) || {}).note || null }));
      const likes = row && row.picks ? pick(row.picks.like) : [];
      const dislikes = row && row.picks ? pick(row.picks.dislike) : [];
      for (const l of likes) liked.push({ q: q.key, key: l.key, label: l.label, tags: tagsOf.get(`${q.key}:${l.key}`) || [], section: key });
      for (const d of dislikes) disliked.push({ q: q.key, key: d.key, label: d.label, tags: tagsOf.get(`${q.key}:${d.key}`) || [], section: key });
      return { key: q.key, prompt: q.prompt, state, likes, dislikes, comment: (row && row.comment) || "" };
    });
    const states = items.map((i) => i.state);
    const status = !items.length ? "not_included"
      : states.every((s) => s === "none") ? "unanswered"
      : states.every((s) => s === "not_sure") ? "not_sure"
      : states.some((s) => s === "none" || s === "comment_only" || s === "not_sure") ? "partial" : "answered";
    sections.push({ key, number: meta.number, label: meta.label, status, items, likes: items.flatMap((i) => i.likes.map((l) => l.label)), dislikes: items.flatMap((i) => i.dislikes.map((d) => d.label)), comments: items.filter((i) => i.comment).map((i) => ({ prompt: i.prompt, text: i.comment })) });
  }

  // themes: what the liked options say, most common first
  const weight = new Map();
  for (const l of liked) for (const t of l.tags) weight.set(t, (weight.get(t) || 0) + 1);
  const themes = [...weight.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).map(([tag, count]) => ({ tag, label: TAG_LABEL[tag] || tag, count }));

  // tensions: liked options on both sides of a pair
  const conflicts = [];
  const where = (list) => [...new Set(list.map((x) => SECTIONS[x.section].label))];
  for (const [a, b, name] of TENSIONS) {
    const A = liked.filter((l) => l.tags.includes(a)), B = liked.filter((l) => l.tags.includes(b));
    if (!A.length || !B.length) continue;
    const strong = A.length >= 2 && B.length >= 2;
    conflicts.push({
      type: "tension", severity: strong ? "strong" : "mild", title: `${TAG_LABEL[a]} and ${TAG_LABEL[b].toLowerCase()} are both liked`,
      detail: `Liked as ${TAG_LABEL[a].toLowerCase()}: ${[...new Set(A.map((x) => x.label))].join(", ")}. Liked as ${TAG_LABEL[b].toLowerCase()}: ${[...new Set(B.map((x) => x.label))].join(", ")}.`,
      sections: where([...A, ...B]), name,
    });
  }
  // contradictions: an option's main quality is liked somewhere and the option carrying it is disliked elsewhere
  const seen = new Set();
  for (const d of disliked) {
    const main = d.tags[0];
    if (!main) continue;
    const likedMain = liked.filter((l) => l.tags[0] === main && !(l.q === d.q && l.key === d.key));
    if (!likedMain.length) continue;
    const id = `${d.q}:${d.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    conflicts.push({
      type: "contradiction", severity: "strong", title: `${d.label} is disliked, but ${TAG_LABEL[main].toLowerCase()} choices are liked elsewhere`,
      detail: `Not for me: ${d.label} (${SECTIONS[d.section].label}). Liked with the same quality: ${[...new Set(likedMain.map((x) => `${x.label} (${SECTIONS[x.section].label})`))].join(", ")}.`,
      sections: where([d, ...likedMain]),
    });
  }

  // gaps and things to clarify
  const clarify = [];
  for (const s of sections) {
    if (s.status === "unanswered") clarify.push({ section: s.label, reason: "Not answered." });
    else if (s.status === "not_sure") clarify.push({ section: s.label, reason: "The client is not sure. Suggest options and talk it through." });
    else for (const it of s.items) {
      if (it.state === "none") clarify.push({ section: s.label, reason: `“${it.prompt}” was not answered.` });
      else if (it.state === "not_sure") clarify.push({ section: s.label, reason: `“${it.prompt}” was marked not sure.` });
      else if (it.state === "comment_only") clarify.push({ section: s.label, reason: `“${it.prompt}” has a comment but no selection. Read the comment.` });
      else if (it.likes.length >= 6) clarify.push({ section: s.label, reason: `“${it.prompt}” has ${it.likes.length} likes. The direction is broad; help narrow it down.` });
    }
  }
  const surprise = sections.filter((s) => s.items.some((i) => i.state === "surprise")).map((s) => s.label);
  if (surprise.length) clarify.push({ section: surprise.join(", "), reason: "Marked “Surprise me”: the client is trusting Framework to propose. Their dislikes still apply." });

  const answered = sections.filter((s) => s.status === "answered" || s.status === "partial").length;
  const words = (qk) => (answers.get(qk) && answers.get(qk).picks ? answers.get(qk).picks.like.map((k) => labelOf.get(`${qk}:${k}`) || k) : []);
  return {
    kind: eff.kind, title: eff.label, sections, themes, conflicts, clarify, uploads, overallComment: overallComment || "",
    summary: { sectionsAnswered: answered, sectionsTotal: sections.length, personality: words("style.personality"), tone: words("tagline.tone") },
  };
}

/** Plain-text/Markdown version of a brief, for copying into a document or message. */
export function briefToMarkdown(brief, { client = "", title = "" } = {}) {
  const L = [`# ${title || brief.title}${client ? ` — ${client}` : ""}`, ""];
  L.push(`Sections answered: ${brief.summary.sectionsAnswered} of ${brief.summary.sectionsTotal}. Inspiration files: ${brief.uploads}.`, "");
  if (brief.themes.length) L.push("## At a glance", "", brief.themes.map((t) => `${t.label} (${t.count})`).join(", "), "");
  if (brief.summary.personality.length) L.push(`Personality words: ${brief.summary.personality.join(", ")}`, "");
  if (brief.summary.tone.length) L.push(`Tone of voice: ${brief.summary.tone.join(", ")}`, "");
  for (const s of brief.sections) {
    L.push(`## ${s.number} ${s.label}`, "");
    for (const it of s.items) {
      const mode = it.state === "not_sure" || it.state === "surprise" ? ` — ${MODE_LABEL[it.state]}` : "";
      L.push(`**${it.prompt}**${mode}`);
      if (it.likes.length) L.push(`- Likes: ${it.likes.map((x) => x.label).join(", ")}`);
      if (it.dislikes.length) L.push(`- Not for me: ${it.dislikes.map((x) => x.label).join(", ")}`);
      if (it.comment) L.push(`- Comment: ${it.comment.replace(/\n+/g, " ")}`);
      if (!it.likes.length && !it.dislikes.length && !it.comment && it.state === "none") L.push("- (no answer)");
      L.push("");
    }
  }
  if (brief.overallComment) L.push("## Overall comment", "", brief.overallComment, "");
  L.push("## Tensions and contradictions", "", ...(brief.conflicts.length ? brief.conflicts.map((c) => `- ${c.title}. ${c.detail}`) : ["None found."]), "");
  L.push("## To clarify", "", ...(brief.clarify.length ? brief.clarify.map((c) => `- ${c.section}: ${c.reason}`) : ["Nothing outstanding."]), "");
  return L.join("\n");
}
