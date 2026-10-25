/**
 * Content validation. A file is accepted only when ALL of these agree: the extension is on the allowlist for the profile, the file's own first bytes
 * (and structure) match that type, it is within the size limit, and it contains none of the active content the checks below refuse. The type recorded
 * for the file is chosen HERE from what the bytes are, never taken from the browser's Content-Type.
 *
 * What this is and is not: these are structural and pattern checks. They stop mislabelled files, executables, scripts in images and PDFs, macro-enabled
 * Office files, PostScript file operators and hostile ZIP structure. They are NOT an antivirus: a new or well-hidden exploit in a PDF reader, font
 * renderer or image library would not be recognised. That risk is reduced by never rendering client files in the portal or Admin, serving them only as
 * attachments, and letting Admin hold a file back (see BRANDING-FILES.md, "Residual risk").
 */
import { cleanFileName } from "./names.js";
import { inspectZip } from "./zip.js";

const MB = 1024 * 1024;
const latin1 = (b) => { let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return s; };
const startsWith = (b, sig, at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

/* ---- type checks: each returns null when the content is acceptable, or a short machine code ---- */

function png(b) {
  if (!startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || !startsWith(b, ascii("IHDR"), 12)) return "content_mismatch";
  const w = ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, h = ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0;
  return w >= 1 && h >= 1 && w <= 20000 && h <= 20000 ? null : "image_dimensions";
}
const jpeg = (b) => (startsWith(b, [0xff, 0xd8, 0xff]) ? null : "content_mismatch");
const webp = (b) => (startsWith(b, ascii("RIFF")) && startsWith(b, ascii("WEBP"), 8) ? null : "content_mismatch");

const PDF_ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFile|EmbeddedFiles|RichMedia|XFA|SubmitForm|ImportData|GoToR|GoToE|OpenAction|AA)(?![A-Za-z0-9])/;
function pdf(b) {
  const head = latin1(b.subarray(0, Math.min(b.length, 1024)));
  if (head.indexOf("%PDF-") < 0) return "content_mismatch";
  const text = latin1(b);
  const decoded = text.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))); // /J#61vaScript is the same name as /JavaScript
  if (/\/Encrypt\b/.test(text)) return "pdf_encrypted";
  return PDF_ACTIVE.test(text) || PDF_ACTIVE.test(decoded) ? "active_content" : null;
}

const PS_DANGEROUS = /(deletefile|renamefile|filenameforall|setfileposition|exitserver|startjob|setsystemparams|setuserparams|%pipe%|%disk|%lineedit|%statementedit|%stdin|%stdout|%stderr|\)\s*run\b|\)\s*\(\s*[wa]\+?\s*\)\s*file\b|\.setsafe|\bsave\s+restore\s+exec\b)/i;
function eps(b) {
  let start = 0;
  if (startsWith(b, [0xc5, 0xd0, 0xd3, 0xc6])) { start = b.length >= 12 ? (b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24)) >>> 0 : -1; } // DOS EPS binary header: where the PostScript starts
  if (start < 0 || start > b.length - 12 || !startsWith(b, ascii("%!PS-Adobe"), start)) return "content_mismatch";
  return PS_DANGEROUS.test(latin1(b)) ? "active_content" : null;
}

function font(kind) {
  return (b) => {
    const sig = { ttf: [[0, 1, 0, 0], ascii("true")], otf: [ascii("OTTO")], woff: [ascii("wOFF")], woff2: [ascii("wOF2")] }[kind];
    if (!sig.some((s) => startsWith(b, s))) return "content_mismatch";
    if (kind === "ttf" || kind === "otf") { const tables = (b[4] << 8) | b[5]; if (tables < 1 || tables > 512) return "content_mismatch"; }
    return null;
  };
}

function utf8(b) { try { return new TextDecoder("utf-8", { fatal: true }).decode(b); } catch { return null; } }

const SVG_START = /^(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i;
const SVG_BAD = [/<script/i, /<foreignobject/i, /<iframe/i, /<embed/i, /<object/i, /<audio/i, /<video/i, /<canvas/i, /<link\b/i, /<meta\b/i, /<!doctype/i, /<!entity/i, /<\?xml-stylesheet/i,
  /\bon[a-z]+\s*=/i, /javascript:/i, /vbscript:/i, /data:/i, /@import/i, /<set\b[^>]*attributename/i, /<animate\b[^>]*attributename\s*=\s*["']?(?:href|xlink)/i];
/** Every href and url(...) must point inside the file ("#id"). The values are read out and checked, so a quote or a space cannot confuse the test. */
function externalReference(text) {
  const bad = (v) => !String(v ?? "").trim().startsWith("#");
  for (const m of text.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) if (bad(m[1] ?? m[2] ?? m[3])) return true;
  for (const m of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) if (bad(m[1] ?? m[2] ?? m[3])) return true;
  return false;
}
function svg(b) {
  let text = utf8(b);
  if (text === null) return "content_mismatch";
  text = text.replace(/^\uFEFF/, "");
  const decoded = text.replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) || 0x20)).replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d) || 0x20)); // numeric entities cannot hide a keyword
  if (SVG_BAD.some((re) => re.test(text) || re.test(decoded)) || externalReference(text) || externalReference(decoded)) return "active_content";
  return SVG_START.test(text.trimStart()) ? null : "content_mismatch";
}

function txt(b) { const t = utf8(b); return t === null || t.includes("\u0000") ? "content_mismatch" : null; }

function archive(b) { const r = inspectZip(b); return r.ok ? null : r.code; }

const OOXML_ROOT = { docx: "word/document.xml", xlsx: "xl/workbook.xml", pptx: "ppt/presentation.xml" };
function ooxml(kind) {
  return (b) => {
    const r = inspectZip(b);
    if (!r.ok) return r.code;
    if (!r.names.includes("[Content_Types].xml") || !r.names.includes(OOXML_ROOT[kind])) return "content_mismatch";
    if (r.names.some((n) => /vbaProject\.bin$/i.test(n) || /(^|\/)activeX\//i.test(n) || /(^|\/)embeddings\//i.test(n) || /\.(bin|exe|dll|js|vbs)$/i.test(n) && !/printerSettings/i.test(n))) return "active_content";
    return null;
  };
}

/** The allowlist. `ext` is the canonical extension; `mime` is what the server records; `maxBytes` caps types that are parsed as text. */
export const FILE_TYPES = Object.freeze({
  png: { mime: "image/png", check: png },
  jpg: { mime: "image/jpeg", check: jpeg },
  webp: { mime: "image/webp", check: webp },
  svg: { mime: "image/svg+xml", check: svg, maxBytes: 5 * MB },
  pdf: { mime: "application/pdf", check: pdf },
  ai: { mime: "application/pdf", check: pdf },   // Illustrator files saved with PDF compatibility. Older PostScript-based .ai files are refused.
  eps: { mime: "application/postscript", check: eps },
  ttf: { mime: "font/ttf", check: font("ttf") },
  otf: { mime: "font/otf", check: font("otf") },
  woff: { mime: "font/woff", check: font("woff") },
  woff2: { mime: "font/woff2", check: font("woff2") },
  txt: { mime: "text/plain", check: txt, maxBytes: 1 * MB },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", check: ooxml("docx") },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", check: ooxml("xlsx") },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", check: ooxml("pptx") },
  zip: { mime: "application/zip", check: archive },  // download-only: inspected, never extracted, never previewed
});
const ALIASES = Object.freeze({ jpeg: "jpg" });
export const canonicalExt = (ext) => (Object.prototype.hasOwnProperty.call(ALIASES, ext) ? ALIASES[ext] : ext);

/** Types that may ever be shown inline (as an <img>) and only for Framework's own published assets. Client files are never inline. */
export const INLINE_IMAGE_TYPES = Object.freeze(["png", "jpg", "webp", "svg"]);

/** Which extensions each profile accepts. A new area (for example Files & Deliverables) adds its own profile here. */
export const PROFILES = Object.freeze({
  brand_client: Object.freeze(["png", "jpg", "webp", "svg", "pdf", "ai", "eps", "ttf", "otf", "woff", "woff2", "txt", "docx", "xlsx", "pptx", "zip"]),
  brand_admin: Object.freeze(["png", "jpg", "webp", "svg", "pdf", "ai", "eps", "ttf", "otf", "woff", "woff2", "txt", "docx", "xlsx", "pptx", "zip"]),
});

async function sha256Hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {Uint8Array} bytes the whole file (already size-capped by the caller)
 * @returns {Promise<{ ok: true, name: string, ext: string, contentType: string, size: number, sha256: string } | { ok: false, error: string }>}
 */
export async function inspectUpload({ bytes, originalName, profile, maxBytes }) {
  if (!(bytes instanceof Uint8Array)) return { ok: false, error: "no_file" };
  if (bytes.length === 0) return { ok: false, error: "empty_file" };
  if (!Number.isInteger(maxBytes) || bytes.length > maxBytes) return { ok: false, error: "file_too_large" };
  const allowed = Object.prototype.hasOwnProperty.call(PROFILES, profile) ? PROFILES[profile] : null;
  if (!allowed) return { ok: false, error: "unknown_profile" };
  const clean = cleanFileName(originalName);
  if (!clean) return { ok: false, error: "invalid_name" };
  const ext = canonicalExt(clean.ext);
  if (!allowed.includes(ext) || !Object.prototype.hasOwnProperty.call(FILE_TYPES, ext)) return { ok: false, error: "type_not_allowed" };
  const type = FILE_TYPES[ext];
  if (type.maxBytes && bytes.length > type.maxBytes) return { ok: false, error: "file_too_large" };
  const problem = type.check(bytes);
  if (problem) return { ok: false, error: problem };
  return { ok: true, name: clean.name, ext, contentType: type.mime, size: bytes.length, sha256: await sha256Hex(bytes) };
}
