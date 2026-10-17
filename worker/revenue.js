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
 * The combined total as { total: "$2.5M+", value: 2500000 } (display string plus the exact sum, which the homepage
 * counts up to), or null when there are no figures (or the table isn't there yet). Never includes anything per client.
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
  const sum = row && Number(row.total);
  if (!Number.isFinite(sum) || sum <= 0) return null;
  return { total: formatTotal(sum), value: Math.floor(sum) };
}
