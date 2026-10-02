/**
 * Combined client revenue for the homepage. The individual figures (worker/clients.json) stay inside the Worker;
 * the only thing that ever leaves is the rounded-down total below.
 */

const usable = (client) => client && typeof client.revenue === "number" && Number.isFinite(client.revenue) && client.revenue > 0;

/** "$2.4M+" / "$750K+": rounded DOWN, so the total never claims more than the figures add up to. */
export function formatTotal(n) {
  if (n >= 1e6) {
    const m = Math.floor(n / 1e5) / 10;
    return "$" + (m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)) + "M+";
  }
  if (n >= 1e3) return "$" + Math.floor(n / 1e3) + "K+";
  return "$" + Math.floor(n) + "+";
}

/** The display string for the sum of all usable figures, or null when there are none. */
export function combinedRevenue(data) {
  const clients = data && Array.isArray(data.clients) ? data.clients : [];
  const figures = clients.filter(usable);
  if (!figures.length) return null;
  return formatTotal(figures.reduce((sum, c) => sum + c.revenue, 0));
}
