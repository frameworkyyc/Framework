/** Date arithmetic for the analytics views (pure, UTC calendar days as YYYY-MM-DD). Each source says which day is its newest complete day. */
export const RANGES = Object.freeze([7, 30, 90]);
export const DEFAULT_RANGE = 30;
export const parseRange = (v) => { const n = Number(v); return RANGES.includes(n) ? n : DEFAULT_RANGE; };

const MS = 86400000;
export const ymd = (date) => date.toISOString().slice(0, 10);
export const addDays = (day, n) => ymd(new Date(Date.parse(`${day}T12:00:00Z`) + n * MS));
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / MS);

/** Every day from..to inclusive. */
export function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The newest day a source has complete figures for. Web Analytics: yesterday (today is still being counted). Search Console: two days ago (its figures arrive about two days late). */
export function newestDay(source, now = new Date()) {
  return addDays(ymd(now), source === "search_console" ? -2 : -1);
}

/** The period asked for and the one right before it, the same length: { current: {from, to}, previous: {from, to} }. */
export function periods(end, days) {
  const from = addDays(end, -(days - 1));
  const prevTo = addDays(from, -1);
  return { current: { from, to: end }, previous: { from: addDays(prevTo, -(days - 1)), to: prevTo } };
}
