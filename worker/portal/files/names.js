/** Filenames are DATA, never paths: they are cleaned once on the way in, stored for display and for the download name, and never used to build a storage key. */

const CONTROL_AND_BIDI = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g;

/** Extensions that must not appear anywhere in a name (so "logo.exe.png" is refused, not just "logo.exe"). */
export const DANGEROUS_EXTENSIONS = new Set([
  "exe", "dll", "bat", "cmd", "com", "scr", "msi", "msp", "pif", "js", "jse", "mjs", "vbs", "vbe", "wsf", "wsh", "ps1", "psm1", "psd1", "sh", "bash", "zsh", "csh", "command",
  "jar", "class", "app", "pkg", "dmg", "iso", "img", "lnk", "url", "reg", "hta", "cpl", "gadget", "apk", "ipa", "deb", "rpm", "so", "dylib", "sys", "drv", "ocx", "scf", "inf",
  "docm", "xlsm", "pptm", "dotm", "xltm", "potm", "ppam", "xlam", "html", "htm", "xhtml", "php", "py", "pl", "rb", "svgz", "swf",
]);

/** @returns {{ name: string, ext: string } | null} null when the name cannot be used. */
export function cleanFileName(raw) {
  if (typeof raw !== "string") return null;
  let name = raw.normalize("NFC").replace(CONTROL_AND_BIDI, "");
  name = name.split(/[\\/]/).pop().replace(/\s+/g, " ").trim().replace(/^[. ]+|[. ]+$/g, "");
  if (!name || name.length > 120) return null;
  const parts = name.split(".");
  if (parts.length < 2 || !parts[0]) return null; // an extension is required, and a name made only of an extension is not a name
  const ext = parts[parts.length - 1].toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(ext)) return null;
  if (parts.slice(1).some((p) => DANGEROUS_EXTENSIONS.has(p.toLowerCase()))) return null;
  return { name, ext };
}

/** Content-Disposition for a download: always "attachment", with a plain ASCII fallback and the real name encoded per RFC 5987. */
export function attachmentHeader(name) {
  const clean = cleanFileName(name);
  const shown = clean ? clean.name : "download";
  const ascii = shown.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/"/g, "_");
  const encoded = encodeURIComponent(shown).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
