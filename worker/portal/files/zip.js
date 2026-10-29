/**
 * ZIP inspection WITHOUT extraction: only the central directory is read; nothing is ever decompressed, unpacked or executed. A ZIP is accepted as an
 * opaque, download-only file. The checks are about what the archive CLAIMS, so a lie is caught where the directory and the file disagree.
 */
import { DANGEROUS_EXTENSIONS } from "./names.js";

const NESTED_ARCHIVES = new Set(["zip", "rar", "7z", "gz", "tgz", "bz2", "xz", "cab", "tar", "z", "lz", "zst", "war", "ear"]);
const MAX_ENTRIES = 2000;
// Website packages (Admin-uploaded, download-only: never extracted, run or previewed by the portal) are made of web source files, which the general list refuses (html, js, php ...). They keep every
// other rule and still refuse real executables, installers, disk images, macro documents and nested archives.
const WEB_SOURCE = new Set(["js", "mjs", "html", "htm", "xhtml", "php", "py", "pl", "rb"]);
const MAX_ENTRIES_WEB = 10000;
const MAX_TOTAL_UNCOMPRESSED = 1024 * 1024 * 1024;
const MAX_RATIO = 100;

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** @returns {{ ok: true, names: string[] } | { ok: false, code: string }} */
export function inspectZip(bytes, { webSource = false } = {}) {
  const n = bytes.length;
  if (n < 22 || u32(bytes, 0) !== 0x04034b50) return { ok: false, code: "content_mismatch" };
  // end-of-central-directory record: the last 65557 bytes at most
  let eocd = -1;
  for (let i = n - 22; i >= Math.max(0, n - 22 - 65535); i--) if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return { ok: false, code: "content_mismatch" };
  const count = u16(bytes, eocd + 10), cdSize = u32(bytes, eocd + 12), cdOffset = u32(bytes, eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return { ok: false, code: "archive_unsupported" }; // ZIP64
  if (count === 0 || count > (webSource ? MAX_ENTRIES_WEB : MAX_ENTRIES)) return { ok: false, code: "archive_entries" };
  if (cdOffset + cdSize > eocd) return { ok: false, code: "content_mismatch" };
  const names = [];
  let p = cdOffset, total = 0, packed = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > n || u32(bytes, p) !== 0x02014b50) return { ok: false, code: "content_mismatch" };
    const flags = u16(bytes, p + 8), method = u16(bytes, p + 10), csize = u32(bytes, p + 20), usize = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28), extraLen = u16(bytes, p + 30), commentLen = u16(bytes, p + 32);
    const madeBy = u16(bytes, p + 4) >> 8, attrs = u32(bytes, p + 38), localOffset = u32(bytes, p + 42);
    if (p + 46 + nameLen + extraLen + commentLen > cdOffset + cdSize) return { ok: false, code: "content_mismatch" };
    if (flags & 0x1) return { ok: false, code: "archive_encrypted" };               // cannot be inspected
    if (method !== 0 && method !== 8) return { ok: false, code: "archive_unsupported" };
    if (madeBy === 3 && ((attrs >>> 16) & 0o170000) === 0o120000) return { ok: false, code: "archive_unsafe_entry" }; // symbolic link
    if (localOffset + 30 > n || u32(bytes, localOffset) !== 0x04034b50) return { ok: false, code: "content_mismatch" }; // directory and file disagree
    const raw = bytes.subarray(p + 46, p + 46 + nameLen);
    let name;
    try { name = new TextDecoder("utf-8", { fatal: true }).decode(raw); } catch { return { ok: false, code: "archive_unsafe_entry" }; }
    if (!name || name.length > 255 || /[\u0000-\u001F\u007F\\]/.test(name) || name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.split("/").some((s) => s === "..")) return { ok: false, code: "archive_unsafe_entry" };
    if (!name.endsWith("/")) {
      const ext = (name.split("/").pop().split(".").pop() || "").toLowerCase();
      if (name.split("/").pop().includes(".") && ((DANGEROUS_EXTENSIONS.has(ext) && !(webSource && WEB_SOURCE.has(ext))) || NESTED_ARCHIVES.has(ext))) return { ok: false, code: "archive_unsafe_entry" };
    }
    total += usize; packed += csize;
    if (total > MAX_TOTAL_UNCOMPRESSED) return { ok: false, code: "archive_too_large" };
    names.push(name);
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (total > 1024 * 1024 && packed > 0 && total / packed > MAX_RATIO) return { ok: false, code: "archive_too_large" }; // claims a bomb-shaped ratio
  return { ok: true, names };
}
