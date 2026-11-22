/**
 * The client's side of the Websites data layer (migration 0011). A client sees ONLY the websites Framework has published for their own organization and not archived,
 * and only the facts meant for them: never the management notes, who changed a row, or any storage detail (the screenshot is reached through an authorised route).
 * Every statement names organization_id AND the published/unarchived conditions, so another organization's, an unpublished and an archived website are all simply "not found".
 * A database without migration 0011 reads as no websites; any OTHER database failure is thrown, so an outage is never shown to a client as "no website".
 */
import { requireOrgId, requireId } from "./common.js";

const missingTable = (err) => /no such table|no such column/i.test(String(err && err.message));

const COLUMNS = "id, name, url, origin, status, managed_by_framework, launch_date, domain_registrar, domain_owner, domain_renewal, hosting_provider, hosting_owner, hosting_renewal, screenshot_key IS NOT NULL AS has_screenshot";
const STAGING_SHOT = ", staging_screenshot_key IS NOT NULL AS has_staging_screenshot";
const VISIBLE = "organization_id = ? AND published = 1 AND archived_at IS NULL";

const toClientWebsite = (r) => ({
  phase: r.phase ?? null, id: r.id, name: r.name, url: r.url, origin: r.origin, status: r.status, managedByFramework: r.managed_by_framework === 1, launchDate: r.launch_date,
  domain: { registrar: r.domain_registrar, owner: r.domain_owner, renewal: r.domain_renewal },
  hosting: { provider: r.hosting_provider, owner: r.hosting_owner, renewal: r.hosting_renewal },
  hasScreenshot: r.has_screenshot === 1,
  hasStagingScreenshot: r.has_staging_screenshot === 1,
});

/** Runs a query that also reads `phase` (migration 0015); on a database without that column it runs the same query without it, so the Website section works before the migration. */
async function withPhase(run) {
  // each optional column (phase: migration 0015, the Staging screenshot: migration 0031) is read when it exists; a database without it runs the same query without it
  const tries = [`${COLUMNS}${STAGING_SHOT}, phase`, `${COLUMNS}${STAGING_SHOT}`, `${COLUMNS}, phase`, COLUMNS];
  let last;
  for (const cols of tries) {
    try { return await run(cols); } catch (err) { if (!/no such column: (phase|staging_screenshot_key)/i.test(String(err && err.message))) throw err; last = err; }
  }
  throw last;
}

/** The websites a client may see, in the order Framework set. [] when there are none (that is the "No Website" state) or the table does not exist yet. */
export async function listClientWebsites(db, organizationId) {
  requireOrgId(organizationId);
  try {
    return (await withPhase((cols) => db.prepare(`SELECT ${cols} FROM websites WHERE ${VISIBLE} ORDER BY sort_order, created_at, id`).bind(organizationId).all())).results.map(toClientWebsite);
  } catch (err) { if (missingTable(err)) return []; throw err; }
}

export async function getClientWebsite(db, organizationId, websiteId) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  try {
    const r = await withPhase((cols) => db.prepare(`SELECT ${cols} FROM websites WHERE id = ? AND ${VISIBLE}`).bind(websiteId, organizationId).first());
    return r ? toClientWebsite(r) : null;
  } catch (err) { if (missingTable(err)) return null; throw err; }
}

/** The private object behind a visible website's screenshot for one environment, or null. Never leaves the Worker. */
export async function getClientScreenshotRecord(db, organizationId, websiteId, env = "production") {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  const sql = env === "staging"
    ? `SELECT staging_screenshot_key AS k, staging_screenshot_name AS n, staging_screenshot_format AS f, staging_screenshot_size AS z FROM websites WHERE id = ? AND ${VISIBLE} AND staging_screenshot_key IS NOT NULL`
    : `SELECT screenshot_key AS k, screenshot_name AS n, screenshot_format AS f, screenshot_size AS z FROM websites WHERE id = ? AND ${VISIBLE} AND screenshot_key IS NOT NULL`;
  try {
    const r = await db.prepare(sql).bind(websiteId, organizationId).first();
    return r ? { key: r.k, name: r.n, format: r.f, size: r.z } : null;
  } catch (err) { if (missingTable(err)) return null; throw err; }
}
