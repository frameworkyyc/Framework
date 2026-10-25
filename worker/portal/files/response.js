import { attachmentHeader } from "./names.js";
import { FILE_TYPES, INLINE_IMAGE_TYPES } from "./sniff.js";

/**
 * Every file leaves the portal through this function. Files are attachments by default (saved, never rendered in the page) and are served with
 * headers that stop a browser from guessing a type, from running anything inside the file, or from caching it. Even so, "attachment" is a convenience,
 * not a safety control: client files are additionally never linked inline and never previewed.
 *
 * `inlineImage` is for ONE case only: a Framework-published image asset shown as an <img>. It is refused for every other type, and the response is
 * sandboxed so even a direct visit to the address cannot run script.
 */
export function fileResponse({ object, name, ext, inlineImage = false, size }) {
  const type = Object.prototype.hasOwnProperty.call(FILE_TYPES, ext) ? FILE_TYPES[ext] : null;
  const inline = inlineImage === true && type !== null && INLINE_IMAGE_TYPES.includes(ext);
  const headers = new Headers({
    "Content-Type": inline ? type.mime : "application/octet-stream",
    "Content-Disposition": inline ? "inline" : attachmentHeader(name),
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  });
  if (Number.isInteger(size) && size >= 0) headers.set("Content-Length", String(size));
  return new Response(object.body, { status: 200, headers });
}
