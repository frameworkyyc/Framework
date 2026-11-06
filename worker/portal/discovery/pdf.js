/**
 * A small, dependency-free PDF writer for the Brand Discovery export. Text only, US Letter, the two built-in Helvetica faces (no font is embedded, so the file is tiny
 * and selectable/searchable), black on white with ruled lines, which is Framework's Admin look. Pure: the export model in, bytes out. Nothing is fetched, stored or cached.
 *
 * Text is encoded as WinAnsi (the Latin-1 letters, curly quotes, dashes, bullets, ellipsis and the euro sign). A character the built-in fonts cannot draw (other scripts,
 * emoji) is printed as "?" so a gap is visible instead of silent; "Copy for AI" keeps every character exactly.
 */
const W = 612, H = 792, M = 54, TOP = H - 76, BOTTOM = 70, BODY = W - 2 * M;

// Helvetica / Helvetica-Bold advance widths (1/1000 em) for ASCII 32..126.
const REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
// WinAnsi positions of the typographic characters people paste.
const SPECIAL = { "\u20AC": 0x80, "\u201A": 0x82, "\u0192": 0x83, "\u201E": 0x84, "\u2026": 0x85, "\u2020": 0x86, "\u2021": 0x87, "\u02C6": 0x88, "\u2030": 0x89, "\u0160": 0x8A, "\u2039": 0x8B, "\u0152": 0x8C, "\u017D": 0x8E,
  "\u2018": 0x91, "\u2019": 0x92, "\u201C": 0x93, "\u201D": 0x94, "\u2022": 0x95, "\u2013": 0x96, "\u2014": 0x97, "\u02DC": 0x98, "\u2122": 0x99, "\u0161": 0x9A, "\u203A": 0x9B, "\u0153": 0x9C, "\u017E": 0x9E, "\u0178": 0x9F };
const SPECIAL_W = { 0x80: [556, 556], 0x85: [1000, 1000], 0x91: [222, 278], 0x92: [222, 278], 0x93: [333, 500], 0x94: [333, 500], 0x95: [350, 350], 0x96: [556, 556], 0x97: [1000, 1000], 0x99: [1000, 1000] };

/** One character -> { c: the single byte (as a char) to write, w: its width per 1000 em } or null for "draw nothing". */
function glyph(ch, bold) {
  const cp = ch.codePointAt(0);
  if (cp === 0x200B || cp === 0x200C || cp === 0x200D || cp === 0xFEFF || cp === 0xAD) return null; // zero-width and soft hyphen
  if (cp === 0x2009 || cp === 0x200A || cp === 0x2002 || cp === 0x2003 || cp === 0x202F) return { c: " ", w: 278 };
  if (cp === 0x2010 || cp === 0x2011 || cp === 0x2212) return { c: "-", w: bold ? 333 : 333 };
  if (cp >= 32 && cp <= 126) return { c: ch, w: (bold ? BOLD : REG)[cp - 32] };
  if (SPECIAL[ch] !== undefined) { const b = SPECIAL[ch]; const sw = SPECIAL_W[b]; return { c: String.fromCharCode(b), w: sw ? sw[bold ? 1 : 0] : bold ? 611 : 556 }; }
  if (cp === 0xA0) return { c: String.fromCharCode(0xA0), w: 278 };
  if (cp >= 0xA1 && cp <= 0xFF) {
    const base = ch.normalize("NFD")[0];
    const bc = base.codePointAt(0);
    return { c: ch, w: bc >= 32 && bc <= 126 ? (bold ? BOLD : REG)[bc - 32] : bold ? 611 : 556 };
  }
  if (/\p{M}/u.test(ch)) return null; // a combining mark with no precomposed letter: skip it, the letter before it stays
  if (/\p{Cc}/u.test(ch)) return null;
  return { c: "?", w: bold ? 611 : 556 };
}
function glyphs(text, bold) {
  const out = [];
  for (const ch of String(text).normalize("NFC")) { const g = glyph(ch, bold); if (g) out.push(g); }
  return out;
}
const widthOf = (gs, size, spacing = 0) => (gs.reduce((a, g) => a + g.w, 0) * size) / 1000 + spacing * gs.length;
const str = (gs) => gs.map((g) => g.c).join("");
const lit = (s) => "(" + s.replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7E]/g, (c) => "\\" + c.charCodeAt(0).toString(8).padStart(3, "0")) + ")";
const num = (n) => (Math.round(n * 100) / 100).toString();

/** Break text into lines no wider than `max`. Newlines are kept; a word too long for a line (a URL) is broken after / ? & = - or, failing that, anywhere. */
function wrap(text, size, bold, max) {
  const lines = [];
  for (const para of String(text).split("\n")) {
    const words = para.split(/ +/).filter(Boolean);
    let line = [], lw = 0;
    const space = glyph(" ", bold);
    const flush = () => { lines.push(line); line = []; lw = 0; };
    const put = (gs) => {
      const w = widthOf(gs, size);
      const sw = line.length ? (space.w * size) / 1000 : 0;
      if (line.length && lw + sw + w > max) flush();
      if (line.length) { line.push(space); lw += (space.w * size) / 1000; }
      line.push(...gs); lw += w;
    };
    for (const word of words) {
      const gs = glyphs(word, bold);
      if (!gs.length) continue;
      if (widthOf(gs, size) <= max) { put(gs); continue; }
      // too long for any line: pieces after URL punctuation, then hard breaks
      const pieces = word.split(/(?<=[/?&=#,;_-])/);
      if (line.length) { if (lw + (space.w * size) / 1000 + widthOf(glyphs(pieces[0], bold), size) > max) flush(); else { line.push(space); lw += (space.w * size) / 1000; } }
      for (const piece of pieces) {
        let pg = glyphs(piece, bold);
        while (pg.length && widthOf(pg, size) > max) {
          let n = pg.length; while (n > 1 && widthOf(pg.slice(0, n), size) > max) n--;
          if (line.length) flush();
          line = pg.slice(0, n); lw = widthOf(line, size); flush();
          pg = pg.slice(n);
        }
        if (pg.length) { if (line.length && lw + widthOf(pg, size) > max) flush(); line.push(...pg); lw += widthOf(pg, size); }
      }
    }
    if (line.length || !para.trim()) lines.push(line);
  }
  return lines;
}

class Page { constructor() { this.ops = []; } }

/** The page-layout toolkit both documents are drawn with: flowing text, rules, headings, quotations, a title block, then header/footer on every page once the count is known. */
function makeDoc() {
  const pages = [new Page()];
  let y = TOP;
  const cur = () => pages[pages.length - 1];
  const newPage = () => { pages.push(new Page()); y = TOP; };
  const need = (h) => { if (y - h < BOTTOM) newPage(); };
  const op = (s) => cur().ops.push(s);
  const rule = (x1, x2, yy, w, grey = 0) => op(`${num(w)} w ${grey} G ${num(x1)} ${num(yy)} m ${num(x2)} ${num(yy)} l S`);
  const vrule = (x, y1, y2, w, grey = 0) => op(`${num(w)} w ${grey} G ${num(x)} ${num(y1)} m ${num(x)} ${num(y2)} l S`);
  const draw = (gs, x, yy, size, bold, grey = 0, spacing = 0) => { if (gs.length) op(`BT /${bold ? "F2" : "F1"} ${num(size)} Tf ${grey} g ${num(spacing)} Tc ${num(x)} ${num(yy)} Td ${lit(str(gs))} Tj ET`); };

  /** A paragraph: wrapped, page-breaking, optionally with a rule down its left edge (a quotation). */
  function para(text, { size = 10, bold = false, grey = 0, indent = 0, lead = size * 1.4, quote = false, after = 0 } = {}) {
    const x = M + indent + (quote ? 10 : 0);
    const lines = wrap(text, size, bold, BODY - indent - (quote ? 10 : 0));
    for (const gs of lines) {
      need(lead);
      y -= lead;
      draw(gs, x, y + lead * 0.28, size, bold, grey);
      if (quote) vrule(M + indent + 2, y - lead * 0.22, y + lead * 0.78, 0.75, 0);
    }
    y -= after;
  }
  const bullet = (text, o = {}) => {
    const size = o.size || 10, lead = size * 1.4, x = M + (o.indent || 0), lines = wrap(text, size, false, BODY - (o.indent || 0) - 12);
    lines.forEach((gs, i) => { need(lead); y -= lead; if (i === 0) draw(glyphs("\u2022", false), x, y + lead * 0.28, size, false); draw(gs, x + 12, y + lead * 0.28, size, false); });
  };
  const gap = (n) => { y -= n; };

  function heading(text, { size = 13, before = 22, ruleW = 1.5, keep = 60 } = {}) {
    need(before + size * 1.4 + keep);
    if (y !== TOP) y -= before;
    const lines = wrap(text, size, true, BODY);
    for (const gs of lines) { y -= size * 1.35; draw(gs, M, y + size * 0.3, size, true); }
    y -= 5; rule(M, W - M, y, ruleW); y -= 6;
  }

  const titleBlock = (eyebrow, title, rows) => {
    y -= 6;
    draw(glyphs(eyebrow, true), M, y, 8, true, 0.4, 1.5); y -= 10;
    for (const gs of wrap(title, 24, true, BODY)) { y -= 29; draw(gs, M, y + 6, 24, true); }
    y -= 8; rule(M, W - M, y, 2.5); y -= 4;
    for (const [k, v] of rows) {
      const lines = wrap(v, 10, false, BODY - 110);
      const hgt = Math.max(1, lines.length) * 14 + 10;
      need(hgt);
      draw(glyphs(k.toUpperCase(), true), M, y - 15, 7.5, true, 0.4, 0.8);
      lines.forEach((gs, i) => draw(gs, M + 110, y - 14 - i * 14, 10, false));
      y -= hgt; rule(M, W - M, y, 0.5, 0.75);
    }
  };

  /** Header (brand + label) and footer (note, page n of N) on every page, then the file. */
  const finish = ({ label, title, exportedOn }) => {
    const total = pages.length;
    const day = exportedOn.toISOString().slice(0, 10);
    const right = (text, size, yy, grey) => { const gs = glyphs(text, false); let t = gs; while (t.length > 3 && widthOf(t, size) > BODY * 0.7) t = t.slice(0, -1); const g2 = t.length < gs.length ? [...t.slice(0, -1), ...glyphs("...", false)] : t; return { gs: g2, x: W - M - widthOf(g2, size), yy, size, grey }; };
    pages.forEach((p, i) => {
      const add = (s) => p.ops.push(s);
      const t = (gs, x, yy, size, bold, grey, spacing = 0) => gs.length && add(`BT /${bold ? "F2" : "F1"} ${num(size)} Tf ${grey} g ${num(spacing)} Tc ${num(x)} ${num(yy)} Td ${lit(str(gs))} Tj ET`);
      t(glyphs("FRAMEWORK", true), M, H - 40, 9, true, 0, 2);
      const hd = right(label, 9, H - 40, 0.35); t(hd.gs, hd.x, hd.yy, 9, false, 0.35);
      add(`1 w 0 G ${M} ${H - 48} m ${W - M} ${H - 48} l S`);
      add(`0.5 w 0.6 G ${M} 52 m ${W - M} 52 l S`);
      t(glyphs(`Internal project documentation. Confidential. Exported ${day}.`, false), M, 38, 8, false, 0.4);
      const pg = glyphs(`Page ${i + 1} of ${total}`, false); t(pg, W - M - widthOf(pg, 8), 38, 8, false, 0.4);
    });
    return assemble(pages, title, exportedOn);
  };

  /** One Business Profile question: its label, then the client's answer quoted, or "Not answered". */
  const answerField = (f) => {
    need(40);
    para(f.label, { size: 8.5, bold: true, grey: 0.35, lead: 12 });
    if (f.value) para(f.value, { size: 10, quote: true, after: 5 }); else para("Not answered", { size: 10, grey: 0.45, indent: 10, after: 5 });
  };
  /** Every Business Profile section with its status and every question (gaps visible). */
  const profileSteps = (p) => {
    for (const step of p.steps) {
      need(60); gap(8);
      para(step.title, { size: 11, bold: true, after: 0 });
      para(step.state.toUpperCase(), { size: 7.5, bold: true, grey: 0.4, lead: 11, after: 3 });
      step.fields.forEach(answerField);
    }
  };

  return { para, bullet, gap, heading, need, rule, titleBlock, finish, profileSteps, get y() { return y; } };
}

export function renderExportPdf(m, { exportedOn = new Date() } = {}) {
  const d = makeDoc();
  const { para, bullet, gap, heading, need, rule } = d;
  d.titleBlock("BRAND DISCOVERY SUBMISSION", m.client, [["Business", m.client], ["Questionnaire", m.assessment.title && m.assessment.title !== m.assessment.kind ? `${m.assessment.kind} (${m.assessment.title})` : m.assessment.kind], m.assessment.recipient ? ["Completed by", m.assessment.recipient] : null,
    m.assessment.submitted ? ["Submitted", m.assessment.submitted] : null, m.assessment.reviewed ? ["Reviewed", m.assessment.reviewed] : null].filter(Boolean));
  // ---- business information
  if (m.business.length) {
    heading("Business information");
    para("From the client\u2019s own Business Profile. Questions they left blank are not listed.", { size: 9, grey: 0.4, after: 4 });
    for (const step of m.business) {
      need(60); gap(8);
      para(step.title, { size: 11, bold: true, after: 2 });
      for (const f of step.fields) {
        need(40);
        para(f.label, { size: 8.5, bold: true, grey: 0.35, lead: 12 });
        para(f.value, { size: 10, quote: true, after: 5 });
      }
    }
  }

  // ---- the questionnaire
  heading("Brand Discovery responses");
  para("Sections and questions are in the order the client saw them.", { size: 9, grey: 0.4, after: 2 });
  for (const s of m.sections) {
    need(70); gap(10);
    para(`${s.number}  ${s.label}`, { size: 11.5, bold: true });
    rule(M, W - M, d.y - 3, 0.75); gap(6);
    for (const it of s.items) {
      need(56);
      para(it.prompt, { size: 10, bold: true, after: 2 });
      const mode = it.state === "not_sure" ? "Not sure" : it.state === "surprise" ? "Surprise me" : "";
      if (mode) para(mode, { size: 10, indent: 10, after: 2 });
      if (it.likes.length) { para("LIKES", { size: 7.5, bold: true, grey: 0.4, indent: 10, lead: 11 }); it.likes.forEach((x) => bullet(x, { indent: 10 })); gap(2); }
      if (it.dislikes.length) { para("NOT FOR ME", { size: 7.5, bold: true, grey: 0.4, indent: 10, lead: 11 }); it.dislikes.forEach((x) => bullet(x, { indent: 10 })); gap(2); }
      if (it.comment) { para("COMMENT", { size: 7.5, bold: true, grey: 0.4, indent: 10, lead: 11 }); para(it.comment, { size: 10, indent: 10, quote: true }); gap(2); }
      if (!mode && !it.likes.length && !it.dislikes.length && !it.comment) para("No answer given", { size: 10, grey: 0.45, indent: 10 });
      gap(8);
    }
  }

  heading("Overall comment from the client");
  if (m.overallComment) para(m.overallComment, { quote: true }); else para("No overall comment.", { grey: 0.45 });
  heading("Inspiration files");
  if (m.uploads.length) { para("Uploaded by the client. The files themselves are not part of this document.", { size: 9, grey: 0.4, after: 3 }); m.uploads.forEach((u) => bullet(`${u.name} (${Math.max(1, Math.round(u.size / 1024))} KB)`)); }
  else para("None uploaded.", { grey: 0.45 });

  return d.finish({ label: `Brand Discovery  \u00B7  ${m.client}`, title: `Brand Discovery - ${m.client}`, exportedOn });
}

/** The Business Profile as a PDF: details block, completion, every section and question (an unanswered one says so). */
export function renderProfilePdf(p, { exportedOn = new Date() } = {}) {
  const d = makeDoc();
  const { para, heading } = d;
  d.titleBlock("BUSINESS PROFILE", p.client, [["Business", p.client], p.website ? ["Website on file", p.website] : null, p.since ? ["Client since", p.since] : null,
    ["Completion", `${p.answered} of ${p.questions} questions answered; ${p.sectionsDone} of ${p.sectionsTotal} sections complete (${p.percent}%)`], p.lastSaved ? ["Last saved", p.lastSaved] : null].filter(Boolean));
  heading("Business Profile");
  para("The client\u2019s own answers, in the order of the questionnaire. A question with no answer says so.", { size: 9, grey: 0.4, after: 2 });
  d.profileSteps(p);
  return d.finish({ label: `Business Profile  \u00B7  ${p.client}`, title: `Business Profile - ${p.client}`, exportedOn });
}

function assemble(pages, title, exportedOn) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // pages, filled below
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const ascii = (s) => String(s).replace(/[^\x20-\x7E]/g, "?");
  const d = exportedOn.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "");
  add(`<< /Title ${lit(ascii(title))} /Creator (Framework Admin) /Producer (Framework) /CreationDate (D:${d}) >>`);
  const kids = [];
  for (const p of pages) {
    const stream = p.ops.join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const page = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${content} 0 R >>`);
    kids.push(`${page} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  let out = "%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n";
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xFF;
  return bytes;
}
