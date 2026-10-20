/**
 * Feedback invitations: the email an admin can send (or copy) asking a client to fill in the existing client feedback form.
 * Pure helpers only: validation and wording. Sending goes through the existing email integration (sendEmail in assessment.js: Resend, configured
 * by RESEND_API_KEY and ASSESSMENT_FROM); nothing here sends anything, and nothing is stored (the form and its database are the existing ones).
 */
import { validEmail } from "./assessment.js";

export const FEEDBACK_PATH = "/client-feedback";
export const INVITE_SUBJECT = "We\u2019d love your feedback on your new website";

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

/** "Thank you for choosing Framework for X." with a project, "Thank you for choosing Framework." without one. */
const thanksLine = (project) => `Thank you for choosing Framework${project ? ` for ${project}` : ""}.`;

const P1 = "We\u2019d love to hear about your experience working with us and how your new website is performing.";
const P2 = "Your feedback plays an important role in helping us improve our services and deliver an even better experience for our clients. We\u2019d really appreciate you taking a few minutes to share your thoughts.";
const P3 = "The questionnaire takes approximately five minutes to complete.";
const P4 = "Thank you for your time and for trusting Framework with your project.";

/** The invitation as plain text and HTML. Every dynamic value is escaped in the HTML; headers (subject, recipient) never contain client input. */
export function buildInvite({ name, project = "", url }) {
  const text = [`Hi ${name},`, "", thanksLine(project), "", P1, "", P2, "", `Share your feedback: ${url}`, "", P3, "", P4, "", "Framework"].join("\n");
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;color:#0A0A0A;max-width:560px">
<p>Hi ${esc(name)},</p>
<p>${esc(thanksLine(project))}</p>
<p>${esc(P1)}</p>
<p>${esc(P2)}</p>
<p><a href="${esc(url)}" style="display:inline-block;background:#0A0A0A;color:#FFFFFF;text-decoration:none;padding:12px 22px;font-weight:600">Share your feedback</a></p>
<p style="color:#5C5C5C">${esc(P3)}</p>
<p>${esc(P4)}</p>
<p>Framework</p></div>`;
  return { subject: INVITE_SUBJECT, text, html };
}

/** The copyable template shown in the admin panel: the same wording with placeholders. The project line is the only optional part. */
export function inviteTemplate(url) {
  const m = buildInvite({ name: "[Client Name]", project: "[Project Name]", url });
  return { subject: m.subject, text: m.text, projectNote: "If there is no project name, delete \u201C for [Project Name]\u201D so it reads \u201CThank you for choosing Framework.\u201D" };
}
