/**
 * Feedback invitations: the email an admin can send (or copy) asking a client to fill in the existing client feedback form.
 * Pure helpers only: validation and wording. Sending goes through the existing email integration (sendEmail in assessment.js: Resend, configured
 * by RESEND_API_KEY and ASSESSMENT_FROM); nothing here sends anything, and nothing is stored (the form and its database are the existing ones).
 */
import { validEmail } from "./assessment.js";

export const FEEDBACK_PATH = "/client-feedback";
export const INVITE_SUBJECT = "Your feedback on your new website";

const oneLine = (v) => String(v == null ? "" : v).replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The public feedback form on this deployment (Staging sends Staging's form, Production sends Production's). */
export const feedbackUrl = (origin) => new URL(FEEDBACK_PATH, origin).toString();

/** @returns {{ok:true, name, email, project}|{ok:false, error:"invalid_name"|"invalid_email"|"invalid_project"}} */
export function validateInvite(body) {
  const b = body && typeof body === "object" ? body : {};
  const name = typeof b.name === "string" ? oneLine(b.name) : "";
  if (!name || name.length > 100) return { ok: false, error: "invalid_name" };
  const email = typeof b.email === "string" ? b.email.trim() : "";
  if (!email || email.length > 254 || !validEmail(email) || /[\r\n,;<>\s]/.test(email)) return { ok: false, error: "invalid_email" };
  let project = "";
  if (b.project !== undefined && b.project !== null && b.project !== "") {
    if (typeof b.project !== "string") return { ok: false, error: "invalid_project" };
    project = oneLine(b.project);
    if (project.length > 120) return { ok: false, error: "invalid_project" };
  }
  return { ok: true, name, email: email.toLowerCase(), project };
}

/** The invitation as plain text and HTML. Every dynamic value is escaped in the HTML; headers (subject, recipient) never contain client input. */
export function buildInvite({ name, project = "", url }) {
  const about = project ? ` on ${project}` : "";
  const text = [
    `Hi ${name},`,
    "",
    `Thank you for working with Framework${about}. I’d value a few minutes of your feedback on how the project went and how your new website is working for you.`,
    "",
    `Share your feedback: ${url}`,
    "",
    "It takes about five minutes, and your answers help us improve how we work.",
    "",
    "Thank you,",
    "Framework",
  ].join("\n");
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;color:#0A0A0A;max-width:560px">
<p>Hi ${esc(name)},</p>
<p>Thank you for working with Framework${esc(about)}. I’d value a few minutes of your feedback on how the project went and how your new website is working for you.</p>
<p><a href="${esc(url)}" style="display:inline-block;background:#0A0A0A;color:#FFFFFF;text-decoration:none;padding:12px 22px;font-weight:600">Share your feedback</a></p>
<p style="color:#5C5C5C">It takes about five minutes, and your answers help us improve how we work.</p>
<p>Thank you,<br>Framework</p></div>`;
  return { subject: INVITE_SUBJECT, text, html };
}
