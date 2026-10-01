/* Framework Admin — small UI toolkit (no framework). Client-supplied text is only ever inserted as text nodes. */

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(typeof kid === "object" && kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/* ---------- API ---------- */

export class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

/** Calls /api/admin<path>. Never exposes raw server text; throws ApiError with a coarse code. */
export async function api(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers["X-Framework-Admin"] = "1"; // required by the server for writes (CSRF defence)
  }
  let res;
  try {
    res = await fetch("/api/admin" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", redirect: "manual" });
  } catch {
    throw new ApiError(0, "network");
  }
  // An expired Cloudflare Access session answers with a redirect / login page instead of JSON.
  if (res.type === "opaqueredirect" || res.redirected) throw new ApiError(401, "session");
  const isJson = (res.headers.get("Content-Type") || "").includes("application/json");
  if (!isJson) throw new ApiError(res.ok ? 401 : res.status, res.ok ? "session" : "error");
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  if (res.status === 401 || res.status === 403) throw new ApiError(res.status, "denied");
  if (res.status === 404) throw new ApiError(404, "not_found");
  if (res.status === 409) throw new ApiError(409, data.error || "conflict");
  if (res.status === 503) throw new ApiError(503, "unavailable");
  throw new ApiError(res.status, "error");
}

/* ---------- Formatting ---------- */

const TZ = "America/Edmonton";
const dateFmt = (style) => new Intl.DateTimeFormat("en-CA", { dateStyle: style, timeZone: TZ });
const dateTimeFmt = new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeStyle: "short", timeZone: TZ });

export const fmtDate = (iso, style = "medium") => (iso ? dateFmt(style).format(new Date(iso)) : "");
export const fmtDateTime = (iso) => (iso ? dateTimeFmt.format(new Date(iso)) : "");
export const shortRef = (id) => String(id || "").slice(0, 8);

export const clientName = (r) => (r.attribution_business || r.attribution_name || "").trim();

const PERMISSION_SHORT = {
  "Yes, with my name and business": "Yes — name and business",
  "Yes, attributed to my business only": "Yes — business only",
  "Yes, anonymously": "Yes — anonymous",
  No: "No",
};
export const permissionShort = (value) => PERMISSION_SHORT[value] || value || "—";

/* ---------- Components ---------- */

const cells = (n, max, extra = "") => {
  const wrap = h("span", { class: "adm-cells " + extra, "aria-hidden": "true" });
  for (let i = 1; i <= max; i++) wrap.append(h("i", { class: i <= n ? "on" : "" }));
  return wrap;
};

/** "4 / 5" (readable by screen readers) with a row of square cells (decorative). */
export const rating5 = (n) =>
  h("span", { class: "adm-rating" }, cells(n, 5), h("span", { class: "adm-num" }, String(n), h("span", { class: "adm-num__max" }, "/ 5")));

export const score = (n, max = 10) => h("span", { class: "adm-num" }, String(n), h("span", { class: "adm-num__max" }, "/ " + max));

export const meter10 = (n) => cells(n, 10, "adm-cells--10");

export function stateBlock({ title, body, actionLabel, onAction }) {
  return h(
    "div",
    { class: "adm-state", role: "status" },
    h("h2", { text: title }),
    body ? h("p", { text: body }) : null,
    actionLabel ? h("button", { class: "btn btn--secondary", type: "button", onclick: onAction }, actionLabel) : null,
  );
}

/** Maps an ApiError to a polished state block. `retry` re-runs the failed load. */
export function errorState(err, retry) {
  const code = err && err.code;
  if (code === "session" || code === "denied") {
    return stateBlock({
      title: code === "session" ? "Your session has ended" : "Access denied",
      body: code === "session" ? "Reload the page to sign in again." : "This account doesn’t have access to this part of Framework Admin.",
      actionLabel: "Reload",
      onAction: () => location.reload(),
    });
  }
  if (code === "not_found") {
    return stateBlock({ title: "Not found", body: "This item doesn’t exist, or it has been deleted." });
  }
  if (code === "unavailable") {
    return stateBlock({ title: "Database unavailable", body: "Feedback couldn’t be loaded just now. Nothing has been changed.", actionLabel: "Try again", onAction: retry });
  }
  if (code === "network") {
    return stateBlock({ title: "Can’t reach the server", body: "Check your connection and try again.", actionLabel: "Try again", onAction: retry });
  }
  return stateBlock({ title: "Something went wrong", body: "The request didn’t complete. Nothing has been changed.", actionLabel: "Try again", onAction: retry });
}

/** Modal confirmation. Resolves true only if the person confirms. `details` is [[label, value], …]. */
export function confirmDialog({ title, body, details = [], confirmLabel, cancelLabel = "Cancel" }) {
  return new Promise((resolve) => {
    const dialog = h(
      "dialog",
      { class: "adm-dialog", "aria-labelledby": "adm-dialog-title" },
      h("form", { method: "dialog" },
        h("h2", { id: "adm-dialog-title", text: title }),
        h("p", { text: body }),
        details.length ? h("dl", null, details.map(([k, v]) => h("div", null, h("dt", { text: k }), h("dd", { text: v })))) : null,
        h("div", { class: "adm-dialog__actions" },
          h("button", { class: "btn btn--secondary", type: "submit", value: "cancel", autofocus: true }, cancelLabel),
          h("button", { class: "btn btn--primary", type: "submit", value: "confirm" }, confirmLabel),
        ),
      ),
    );
    dialog.addEventListener("close", () => {
      const confirmed = dialog.returnValue === "confirm";
      dialog.remove();
      resolve(confirmed);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}
