/**
 * Private file storage (Cloudflare R2, binding PORTAL_FILES). The bucket has no public access and no custom domain: every byte goes in and out through
 * this module, after the caller has proved the organization.
 *
 *  - Keys are `org/<organization id>/<area>/<random uuid>`: the organization is part of the key, the name is random, and no client text is ever in a key.
 *  - The object is stored as application/octet-stream whatever the file is, so a misconfigured response could never make a browser interpret it. The
 *    validated type lives in the database and in customMetadata.
 *  - Every read re-checks that the key belongs to the organization asked for (prefix AND the organization recorded on the object).
 *  - The integrity digest is handed to R2, which rejects the write if the stored bytes differ.
 */
import { UUID, newId } from "../repo/common.js";

export const AREAS = Object.freeze(["brand-assets", "brand-uploads", "files", "invoices", "support"]);
const KEY = /^org\/([0-9a-f-]{36})\/(brand-assets|brand-uploads|files|invoices|support)\/([0-9a-f-]{36})$/;

export class StorageError extends Error {
  constructor(code) { super(code); this.name = "StorageError"; this.code = code; }
}

export function makeKey(organizationId, area) {
  if (typeof organizationId !== "string" || !UUID.test(organizationId)) throw new StorageError("invalid_organization");
  if (!AREAS.includes(area)) throw new StorageError("invalid_area");
  return `org/${organizationId}/${area}/${newId()}`;
}

export function parseKey(key) {
  const m = typeof key === "string" ? KEY.exec(key) : null;
  return m && UUID.test(m[1]) && UUID.test(m[3]) ? { organizationId: m[1], area: m[2] } : null;
}

const need = (bucket) => { if (!bucket || typeof bucket.put !== "function" || typeof bucket.get !== "function") throw new StorageError("storage_unavailable"); return bucket; };

/** Writes the bytes. `sha256` (hex) is verified by R2 itself. */
export async function putObject(bucket, { key, organizationId, bytes, sha256, contentType }) {
  need(bucket);
  const parsed = parseKey(key);
  if (!parsed || parsed.organizationId !== organizationId) throw new StorageError("key_organization_mismatch");
  try {
    await bucket.put(key, bytes, { sha256, httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { org: organizationId, area: parsed.area, type: String(contentType).slice(0, 100) } });
  } catch {
    throw new StorageError("storage_write_failed");
  }
}

/** @returns the R2 object, or null when it does not exist OR does not belong to this organization (the two are indistinguishable to callers). */
export async function getObject(bucket, { key, organizationId }) {
  need(bucket);
  const parsed = parseKey(key);
  if (!parsed || parsed.organizationId !== organizationId) return null;
  let obj;
  try { obj = await bucket.get(key); } catch { throw new StorageError("storage_read_failed"); }
  if (!obj) return null;
  if (!obj.customMetadata || obj.customMetadata.org !== organizationId) return null;
  return obj;
}

/** Deleting a missing object is not an error (it is the goal). A key from another organization is refused. */
export async function deleteObject(bucket, { key, organizationId }) {
  need(bucket);
  const parsed = parseKey(key);
  if (!parsed || parsed.organizationId !== organizationId) throw new StorageError("key_organization_mismatch");
  try { await bucket.delete(key); } catch { throw new StorageError("storage_delete_failed"); }
}

/** Every object key stored for one organization (for offboarding and for finding orphans). Paged, so it never loads an unbounded list at once. */
export async function* listOrganizationKeys(bucket, organizationId) {
  need(bucket);
  if (typeof organizationId !== "string" || !UUID.test(organizationId)) throw new StorageError("invalid_organization");
  let cursor;
  do {
    const page = await bucket.list({ prefix: `org/${organizationId}/`, cursor, limit: 500 });
    for (const o of page.objects) yield o.key;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
