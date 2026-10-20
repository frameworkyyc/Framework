/**
 * The ONLY place the portal reads view options from a request URL. It returns a fixed-shape object whose values come from allow-lists, so a
 * crafted query string can never reach a query, a log line or the page unescaped: an unknown or malformed value simply becomes undefined.
 * It selects what to SHOW from data the tenant guard already scoped; it never chooses which organization's data is read.
 */
const TYPES = new Set(["milestone", "update", "document", "review"]);
const ID = /^[A-Za-z0-9-]{1,40}$/;

/** @returns {{type: string|undefined, project: string|undefined, from: string|undefined}} `from` is a service-request id the caller then checks against its own list */
export function viewFilters(url) {
  const q = url && url.searchParams;
  if (!q) return { type: undefined, project: undefined, from: undefined };
  const type = q.get("type");
  const project = q.get("project");
  const from = q.get("from");
  return { type: TYPES.has(type) ? type : undefined, project: typeof project === "string" && ID.test(project) ? project : undefined, from: typeof from === "string" && ID.test(from) ? from : undefined };
}
