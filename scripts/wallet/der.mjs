// Minimal DER (ASN.1) encoder and reader: just what the Apple Wallet signing tool needs.
// No dependencies, so it runs the same on Windows, macOS and Linux with plain Node.

const cat = (...parts) => Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));

export const length = (n) => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};

export const tlv = (tag, ...content) => {
  const body = cat(...content);
  return cat([tag], length(body.length), body);
};

export const seq = (...c) => tlv(0x30, ...c);
// DER requires the members of a SET OF to be sorted by their encoding.
export const setOf = (...c) => tlv(0x31, ...[...c].sort(Buffer.compare));
export const set = (...c) => tlv(0x31, ...c);
export const ctx = (n, ...c) => tlv(0xa0 | n, ...c); // [n] constructed
export const nul = () => Buffer.from([0x05, 0x00]);
export const octets = (b) => tlv(0x04, b);
export const bitString = (b) => tlv(0x03, [0], b);
export const utf8 = (s) => tlv(0x0c, Buffer.from(s, "utf8"));
export const printable = (s) => tlv(0x13, Buffer.from(s, "ascii"));

export const int = (value) => {
  let b;
  if (Buffer.isBuffer(value)) b = value;
  else {
    let hex = BigInt(value).toString(16);
    if (hex.length % 2) hex = "0" + hex;
    b = Buffer.from(hex, "hex");
  }
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = cat([0], b);
  return tlv(0x02, b);
};

export const oid = (dotted) => {
  const n = dotted.split(".").map(Number);
  const out = [40 * n[0] + n[1]];
  for (const v of n.slice(2)) {
    const chunk = [v & 0x7f];
    for (let x = v >>> 7; x > 0; x >>>= 7) chunk.unshift((x & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
};

const two = (n) => String(n).padStart(2, "0");
export const utcTime = (d) =>
  tlv(0x17, `${two(d.getUTCFullYear() % 100)}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}Z`);

// ---- reader -------------------------------------------------------------------------------------------------------
// read(buf, at) -> { tag, start, header, end, body } where buf.subarray(start, end) is the whole TLV.
export function read(buf, at = 0) {
  if (at + 2 > buf.length) throw new Error("DER: truncated");
  const tag = buf[at];
  let len = buf[at + 1];
  let header = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error("DER: unsupported length");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[at + 2 + i];
    header = 2 + n;
  }
  const end = at + header + len;
  if (end > buf.length) throw new Error("DER: length exceeds data");
  return { tag, start: at, header, end, body: buf.subarray(at + header, end), raw: buf.subarray(at, end) };
}

export function children(node) {
  const out = [];
  for (let at = 0; at < node.body.length; ) {
    const c = read(node.body, at);
    out.push({ ...c, raw: c.raw });
    at = c.end;
  }
  return out;
}

export function oidToString(body) {
  const parts = [Math.floor(body[0] / 40), body[0] % 40];
  for (let i = 1, v = 0; i < body.length; i++) {
    v = v * 128 + (body[i] & 0x7f);
    if (!(body[i] & 0x80)) { parts.push(v); v = 0; }
  }
  return parts.join(".");
}
