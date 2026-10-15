/**
 * Combined client revenue for the homepage. Individual figures live in the private D1 table `client_revenue`
 * (migrations/0003); the only thing that ever leaves the Worker is the rounded-down total below.
 */

/** "$2.4M+" / "$750K+": rounded DOWN, so the total never claims more than the figures add up to. */
export function formatTotal(n) {
  if (n >= 1e6) {
    const m = Math.floor(n / 1e5) / 10;
    return "$" + (m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)) + "M+";
  }
  if (n >= 1e3) return "$" + Math.floor(n / 1e3) + "K+";
  return "$" + Math.floor(n) + "+";
}

/**
 * The display string for the sum of all stored figures, or null when there are none (or the table isn't there yet).
 * Throws on a database error so the caller can avoid caching a failure.
 */
export async function combinedRevenue(db) {
  if (!db) return null;
  let row;
  try {
    row = await db.prepare("SELECT SUM(revenue) AS total FROM client_revenue WHERE revenue > 0").first();
  } catch (err) {
    if (/no such table/i.test(String(err && err.message))) return null; // migration not run yet
    throw err;
  }
  const total = row && Number(row.total);
  return Number.isFinite(total) && total > 0 ? formatTotal(total) : null;
}
