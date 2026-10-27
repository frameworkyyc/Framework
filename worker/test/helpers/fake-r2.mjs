// An in-memory stand-in for an R2 bucket binding: put (with the sha256 integrity check R2 performs), get, delete, list (paged by prefix). No network.
import { createHash } from "node:crypto";

export function fakeR2() {
  const store = new Map();
  const calls = [];
  const toBytes = async (value) => (value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(await new Response(value).arrayBuffer()));
  return {
    store, calls,
    async put(key, value, options = {}) {
      calls.push(["put", key, options]);
      const bytes = await toBytes(value);
      if (options.sha256 && createHash("sha256").update(bytes).digest("hex") !== String(options.sha256).toLowerCase()) throw new Error("R2 put: sha256 mismatch");
      store.set(key, { bytes: new Uint8Array(bytes), httpMetadata: options.httpMetadata || {}, customMetadata: options.customMetadata || {} });
      return { key, size: bytes.length };
    },
    async get(key) {
      calls.push(["get", key]);
      const o = store.get(key);
      if (!o) return null;
      return { key, size: o.bytes.length, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata, body: new Response(o.bytes).body, arrayBuffer: async () => o.bytes.buffer.slice(0) };
    },
    async delete(key) { calls.push(["delete", key]); store.delete(key); },
    async list({ prefix = "", cursor, limit = 1000 } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const slice = keys.slice(start, start + limit);
      const next = start + limit < keys.length;
      return { objects: slice.map((key) => ({ key, size: store.get(key).bytes.length, etag: createHash("md5").update(store.get(key).bytes).digest("hex") })), truncated: next, cursor: next ? String(start + limit) : undefined };
    },
  };
}
