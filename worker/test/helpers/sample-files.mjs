// Small, valid example files for the upload tests, and a minimal ZIP writer (store method) so ZIP and Office structure can be built, and corrupted, on purpose.
const enc = new TextEncoder();
export const text = (s) => enc.encode(s);
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

export function png(w = 8, h = 8) {
  const be = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be(w), ...be(h), 8, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
}
export const jpeg = () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
export const webp = () => cat(text("RIFF"), Uint8Array.from([26, 0, 0, 0]), text("WEBPVP8 "), new Uint8Array(14));
export const svg = (body = '<rect width="10" height="10" fill="#123456"/>') => text(`<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${body}</svg>`);
export const pdf = (extra = "") => text(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R ${extra}>>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`);
export const eps = (extra = "") => text(`%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\n0 0 moveto 10 10 lineto stroke\n${extra}%%EOF\n`);
export const ttf = (tag = [0, 1, 0, 0]) => Uint8Array.from([...tag, 0, 5, 0, 0, 0, 0, 0, 0, ...new Array(40).fill(0)]);
export const otf = () => ttf([0x4f, 0x54, 0x54, 0x4f]);
export const woff2 = () => Uint8Array.from([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0, ...new Array(40).fill(0)]);

const crc32 = (() => { const t = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }); return (b) => { let c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }; })();
const le16 = (n) => [n & 255, (n >>> 8) & 255], le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

/** entries: [{ name, data?, flags?, madeBy?, attrs?, method?, usize?, csize? }]. method 0 only (stored); usize/csize can lie to simulate a bomb. */
export function zip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = text(e.name), data = e.data || new Uint8Array(0);
    const local = Uint8Array.from([0x50, 0x4b, 3, 4, 20, 0, ...le16(e.flags || 0), ...le16(e.method || 0), 0, 0, 0x21, 0, ...le32(crc32(data)), ...le32(e.csize ?? data.length), ...le32(e.usize ?? data.length), ...le16(name.length), 0, 0]);
    locals.push(cat(local, name, data));
    central.push(cat(Uint8Array.from([0x50, 0x4b, 1, 2, 20, e.madeBy ?? 0, 20, 0, ...le16(e.flags || 0), ...le16(e.method || 0), 0, 0, 0x21, 0, ...le32(crc32(data)), ...le32(e.csize ?? data.length), ...le32(e.usize ?? data.length), ...le16(name.length), 0, 0, 0, 0, 0, 0, 0, 0, ...le32((e.attrs ?? 0) >>> 0), ...le32(offset)]), name));
    offset += local.length + name.length + data.length;
  }
  const cd = cat(...central);
  return cat(...locals, cd, Uint8Array.from([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...le16(entries.length), ...le16(entries.length), ...le32(cd.length), ...le32(offset), 0, 0]));
}
export const brandPack = () => zip([{ name: "logo/primary.svg", data: svg() }, { name: "guidelines.pdf", data: pdf() }]);
export const docx = (extra = []) => zip([{ name: "[Content_Types].xml", data: text("<Types/>") }, { name: "word/document.xml", data: text("<w:document/>") }, ...extra]);
