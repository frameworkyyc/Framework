/**
 * Invoice file service: the one place that combines permission checks, PDF validation, private storage and the database for invoices (like brand-files.js).
 * Organization ids always come from the signed-in membership (client) or from the Admin route (Framework staff); nothing is read from request data.
 *
 *   upload   validate (PDF only) -> put the object -> record it on the invoice -> delete the previous object; a failure leaves at most an unreferenced object, never a
 *            row pointing at nothing
 *   download every download is recorded (who, what, when: never an address or a key)
 * Invoices are never deleted here: archiving keeps the row and the file (see CLIENT-SERVICES.md, retention).
 */
import { can } from "./policy.js";
import { ok, fail } from "./repo/common.js";
import * as inv from "./repo/invoices.js";
import { recordActivity } from "./repo/activity.js";
import { inspectUpload, makeKey, putObject, getObject, deleteObject, fileResponse, StorageError, ADMIN_MAX_FILE_BYTES } from "./files/index.js";

const storageFail = (err) => (err instanceof StorageError ? fail(err.code) : (() => { throw err; })());
export const invoiceFileName = (number) => `Framework-Invoice-${String(number).replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;

async function stream(deps, { organizationId, row, actorType, actorRef }) {
  let object;
  try { object = await getObject(deps.bucket, { key: row.storageKey, organizationId }); } catch (err) { return storageFail(err); }
  if (!object) return fail("not_found");
  await recordActivity(deps.db, { organizationId, actorType, actorRef, action: "invoice.download", entityType: "invoice", entityId: row.id, visibility: "internal" }, { now: deps.now });
  return ok({ response: fileResponse({ object, name: invoiceFileName(row.invoiceNumber), ext: "pdf", inlineImage: false, size: row.size }) });
}

/** Framework Admin: store (or replace) the PDF of an invoice. deps: { db, bucket, env?, now? } */
export async function adminUploadInvoiceFile(deps, { organizationId, actor, invoiceId, file }) {
  const cur = await inv.getInvoiceAdmin(deps.db, organizationId, invoiceId);
  if (!cur) return fail("not_found");
  if (cur.archived) return fail("archived");
  const inspected = await inspectUpload({ bytes: file && file.bytes, originalName: file && file.name, profile: "invoice", maxBytes: ADMIN_MAX_FILE_BYTES });
  if (!inspected.ok) return fail(inspected.error);
  const key = makeKey(organizationId, "invoices");
  try { await putObject(deps.bucket, { key, organizationId, bytes: file.bytes, sha256: inspected.sha256, contentType: inspected.contentType }); } catch (err) { return storageFail(err); }
  let rec;
  try { rec = await inv.setInvoiceFile(deps.db, organizationId, invoiceId, { ext: inspected.ext, contentType: inspected.contentType, size: inspected.size, sha256: inspected.sha256, storageKey: key }, actor, { now: deps.now }); }
  catch (err) { try { await deleteObject(deps.bucket, { key, organizationId }); } catch { /* an unreferenced object; findOrphanObjects lists it */ } throw err; }
  if (!rec.ok) { try { await deleteObject(deps.bucket, { key, organizationId }); } catch { /* as above */ } return rec; }
  if (rec.previousKey) { try { await deleteObject(deps.bucket, { key: rec.previousKey, organizationId }); } catch { /* the old object is now unreferenced */ } }
  return ok({ size: inspected.size });
}

/** Framework Admin: any invoice of the organization, drafts and archived included. */
export async function adminDownloadInvoice(deps, { organizationId, invoiceId, actor }) {
  const row = await inv.getInvoiceAdmin(deps.db, organizationId, invoiceId);
  if (!row || !row.hasFile) return fail("not_found");
  return stream(deps, { organizationId, row, actorType: "admin", actorRef: actor });
}

/** A client download. Owners only (policy invoices.view); a draft, archived, void, missing or another organization's invoice is the same "not_found". */
export async function clientDownloadInvoice(deps, { role, organizationId, userId, invoiceId }) {
  if (!can(role, "invoices.view")) return fail("forbidden");
  const row = await inv.getClientInvoiceFile(deps.db, organizationId, invoiceId);
  if (!row) return fail("not_found");
  return stream(deps, { organizationId, row, actorType: "client", actorRef: userId });
}
