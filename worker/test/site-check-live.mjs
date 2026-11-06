// Probes REAL websites with worker/site-check.js and prints what it decides. Not part of the test suite (the name does not end in .test.mjs): run it by hand, from a
// machine that can reach the internet:  node worker/test/site-check-live.mjs [extra-url ...]
// Expected answers are listed so a surprise is obvious; "any" means the answer may legitimately change. Nothing is written anywhere.
import { checkSite } from "../site-check.js";

const SITES = [
  // the nine Staging leads that the finder flagged "Website doesn't load" although they open in a browser
  ["https://qualitycountconstruction.com/", "online or unverified"], ["https://gooseconstruction.ca/", "online or unverified"], ["https://rightchoiceconstruction.ca/", "online or unverified"],
  ["https://www.soshandyman.ca/", "online or unverified"], ["https://www.myhomehandyman.ca/?utm_campaign=gmb", "online or unverified"], ["https://trademarkrenovations.com/?utm_source=google&utm_medium=organic&utm_campaign=gbp", "online or unverified"],
  ["https://www.rebornrenovations.com/?utm_source=Google&utm_medium=GMB", "online or unverified"], ["https://www.gsasolutions.ca/", "online or unverified"], ["https://totalfencinginc.com/", "online or unverified"],
  // sites known to refuse robots: must never be "offline"
  ["https://www.nytimes.com/", "online or unverified"], ["https://www.linkedin.com/", "online or unverified"], ["https://www.zillow.com/", "online or unverified"],
  // controls
  ["https://example.com/", "online"], ["https://httpbin.org/status/403", "unverified"], ["https://httpbin.org/status/404", "offline"], ["https://httpbin.org/status/503", "offline or unverified"],
  ["https://httpbin.org/redirect/3", "online"], ["https://expired.badssl.com/", "online or unverified"], ["https://this-domain-does-not-exist-framework-check.com/", "offline"],
];
const extra = process.argv.slice(2).map((u) => [u, "any"]);
for (const [url, expect] of [...SITES, ...extra]) {
  const t = Date.now();
  const r = await checkSite(url);
  const ok = expect === "any" || expect.split(" or ").includes(r.state);
  console.log(`${ok ? "ok  " : "SURPRISE"} ${r.state.padEnd(10)} expected ${expect.padEnd(22)} ${String(Date.now() - t).padStart(5)}ms  ${url}\n        ${r.summary}${r.attempts.length > 1 ? `  [${r.attempts.map((a) => `${new URL(a.url).protocol}//${new URL(a.url).host}→${a.status ?? a.error}`).join(", ")}]` : ""}`);
}
