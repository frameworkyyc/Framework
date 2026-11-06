/**
 * The request lifecycle, in one place. Pure: no database, request or environment access.
 *
 *   Request -> Review -> Quote -> Approval -> In progress -> Client review -> Completed
 *   plus: Revision requested (the client asked for changes), Declined (Framework said no), Cancelled (withdrawn).
 *
 * `canMove(from, to, actor)` is the whole rulebook for WHO may make WHICH move; the repository adds the guards that need data (a quote exists, a proof exists, a revision
 * round is left). A move that is not listed here cannot be made by anyone, however the request is crafted.
 */

export const STATUSES = Object.freeze(["new", "in_review", "quoted", "approved", "in_progress", "client_review", "revision_requested", "completed", "declined", "cancelled"]);
export const CLOSED = Object.freeze(["completed", "declined", "cancelled"]);
export const isClosed = (s) => CLOSED.includes(s);

/** What the client reads. */
export const STATUS_LABEL = Object.freeze({
  new: "Submitted", in_review: "In review", quoted: "Quote ready", approved: "Approved", in_progress: "In progress", client_review: "Ready for your review",
  revision_requested: "Revision requested", completed: "Completed", declined: "Declined", cancelled: "Cancelled",
});

/** The tone a status is drawn in (the portal's .status classes): active work, waiting on the client, finished, or closed without delivery. */
export const STATUS_TONE = Object.freeze({
  new: "active", in_review: "active", quoted: "attention", approved: "active", in_progress: "active", client_review: "attention",
  revision_requested: "active", completed: "live", declined: "idle", cancelled: "idle",
});

/** The track shown on a request: seven stages. A status maps to the stage it is in (a revision request is back inside "In progress"). */
export const STAGES = Object.freeze([
  { key: "request", label: "Request" }, { key: "review", label: "Review" }, { key: "quote", label: "Quote" }, { key: "approval", label: "Approval" },
  { key: "in_progress", label: "In progress" }, { key: "client_review", label: "Your review" }, { key: "completed", label: "Completed" },
]);
const STAGE_OF = Object.freeze({ new: 0, in_review: 1, quoted: 2, approved: 3, in_progress: 4, revision_requested: 4, client_review: 5, completed: 6 });
/** Index of the current stage, or -1 for a request that ended without delivery. */
export const stageIndex = (status) => (Object.prototype.hasOwnProperty.call(STAGE_OF, status) ? STAGE_OF[status] : -1);

/** from -> { to: who }. who: "staff", "client" or "both". Client-only moves are further limited by role in policy.js and by guards in the repository. */
const MOVES = Object.freeze({
  new: { in_review: "staff", quoted: "staff", declined: "staff", cancelled: "both" },
  in_review: { quoted: "staff", approved: "staff", declined: "staff", cancelled: "both" },
  quoted: { in_review: "staff", approved: "both", declined: "staff", cancelled: "both" },
  approved: { in_progress: "staff", cancelled: "staff" },
  in_progress: { client_review: "staff", completed: "staff", cancelled: "staff" },
  client_review: { completed: "both", revision_requested: "client", in_progress: "staff", cancelled: "staff" },
  revision_requested: { in_progress: "staff", client_review: "staff", completed: "staff", cancelled: "staff" },
});

/** @param actor "staff" | "client" */
export function canMove(from, to, actor) {
  if (!Object.prototype.hasOwnProperty.call(MOVES, from)) return false;
  const who = MOVES[from][to];
  return who === "both" || who === actor;
}

/** Statuses a staff member may choose from here (for the Admin buttons). */
export const staffMoves = (from) => Object.keys(MOVES[from] || {}).filter((to) => canMove(from, to, "staff"));

/** Whole rounds a client may still ask for. */
export const revisionsLeft = (r) => Math.max(0, r.revisionsIncluded + r.revisionsPaid - r.revisionsUsed);

/** Statuses in which a client reply is accepted (every open one). */
export const acceptsReplies = (status) => !isClosed(status);

/** Why a request needs the CLIENT's attention, or "". owner: whether this person may accept quotes. */
export function clientActionReason(r, { owner = false } = {}) {
  if (isClosed(r.status)) return "";
  if (r.status === "client_review") return "proof";
  if (r.status === "quoted" && owner) return "quote";
  if (r.unreadForClient) return "reply";
  return "";
}
export const ACTION_LABEL = Object.freeze({ proof: "Review the design", quote: "Review the quote", reply: "New reply from Framework" });

/** Why a request needs FRAMEWORK's attention, or "". */
export function staffAttentionReason(r) {
  if (isClosed(r.status)) return "";
  if (r.status === "new") return "New request";
  if (r.status === "revision_requested") return "Revision requested";
  if (r.lastMessageBy === "client" && r.newForAdmin) return "Client replied";
  if (r.status === "approved") return "Approved: ready to start";
  if (r.newForAdmin) return "Unseen";
  return "";
}
