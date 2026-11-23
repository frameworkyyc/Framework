/* The environment switch for Framework staff: which environment a request is on (from the verified Framework hostnames only) and the entry point of the OTHER one.
   The link is always a fixed https origin plus a fixed entry path: no session, token, query or client-specific path is ever carried across; the destination makes its own sign-in and permission decision. */
const ENVS = Object.freeze({
  production: { label: "Production", origin: "https://frameworkco.ca", hosts: ["frameworkco.ca", "www.frameworkco.ca"] },
  staging: { label: "Staging", origin: "https://staging.frameworkco.ca", hosts: ["staging.frameworkco.ca"] },
});

/** "production" | "staging", or null for any other host (workers.dev, localhost, previews): nothing is shown there. */
export const envOf = (hostname) => Object.keys(ENVS).find((k) => ENVS[k].hosts.includes(String(hostname || "").toLowerCase())) || null;

/** { label: "Switch to Staging", href: "https://staging.frameworkco.ca/portal" } for the other environment, or null. kind is "portal" or "admin". */
export function switchLink(hostname, kind = "portal") {
  const here = envOf(hostname);
  if (!here) return null;
  const there = here === "production" ? "staging" : "production";
  return { label: `Switch to ${ENVS[there].label}`, href: `${ENVS[there].origin}/${kind === "admin" ? "admin" : "portal"}` };
}

/** "Staging" on Staging, otherwise "" (Production shows no label). */
export const envTag = (hostname) => (envOf(hostname) === "staging" ? "Staging" : "");
