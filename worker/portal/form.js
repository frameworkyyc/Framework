/**
 * Reading a submitted form safely: a hard size limit enforced while streaming (an oversized or chunked body is cancelled, never buffered whole),
 * urlencoded only, and a repeated field name is refused instead of silently picking one.
 */
export const MAX_PROFILE_FORM_BYTES = 24 * 1024;
export const MAX_FEEDBACK_FORM_BYTES = 16 * 1024;

/** Cheap pre-check from the headers alone, before anything is read: 400 for a malformed length, 413 for one over the limit, otherwise null. */
export function declaredBodyProblem(request, max) {
  const declared = request.headers.get("Content-Length");
  if (declared === null) return null;
  if (!/^\d{1,12}$/.test(declared.trim())) return 400;
  return Number(declared) > max ? 413 : null;
}

/** @returns {Promise<{ fields: Map<string,string> } | { error: 400 | 413 }>} */
export async function readForm(request, max = MAX_PROFILE_FORM_BYTES) {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/x-www-form-urlencoded")) return { error: 400 };
  if (!request.body) return { fields: new Map() };
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return { error: 413 };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { error: 400 };
  }
  const fields = new Map();
  for (const [k, v] of new URLSearchParams(text)) {
    if (fields.has(k)) return { error: 400 };
    fields.set(k, v);
  }
  return { fields };
}
