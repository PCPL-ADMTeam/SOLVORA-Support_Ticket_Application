const prisma = require("../config/prisma");
const env = require("../config/env");
const ApiError = require("../utils/ApiError");
const { recordAudit } = require("../utils/audit");
// Same source of truth recipientBuilder.js already uses for "every active
// Team Lead/Manager of this department" — reused here ONLY to render
// {{teamLeadNames}}/{{managerNames}} as display text, never to decide who
// actually receives the email (that remains exclusively recipientBuilder.js's
// job).
const userDepartmentAccessService = require("./userDepartmentAccess.service");

// {{placeholder}} tokens only — plain string replacement, never eval'd or
// otherwise executed as code.
const PLACEHOLDER_PATTERN = /\{\{\s*(\w+)\s*\}\}/g;

// The exact set buildPlaceholders() below populates — kept as an explicit
// list (rather than introspecting an object) purely so the Admin UI has a
// single source of truth for "what placeholders exist" via
// GET /email-templates/placeholders, instead of duplicating this list in
// the frontend.
const SUPPORTED_PLACEHOLDERS = [
  "recipientName",
  "ticketNumber",
  "title",
  "department",
  "problemSummary",
  "priority",
  "status",
  "requesterName",
  "assigneeName",
  "comment",
  "attachments",
  "resolution",
  "managerName",
  "commentAuthor",
  "oldStatus",
  "newStatus",
  "ticketLink",
  "resolutionNotes",
  "onHoldReason",
  "closedReason",
  "oldDepartment",
  "transferReason",
  "resetLink",
  "assignmentCommentSection",
  "teamLeadNames",
  "managerNames",
];

// Placeholders whose value is pre-built, already-safe HTML this service
// generated itself (each dynamic part individually escaped) rather than a
// single piece of user-supplied text — exempted from renderString's
// generic per-placeholder escaping so that HTML isn't escaped a second
// time into visible entities. See buildAttachmentsHtml.
const RAW_PLACEHOLDER_KEYS = new Set(["attachments", "assignmentCommentSection"]);

function stripHtml(value) {
  if (typeof value !== "string") return value;
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// TICKET_COMMENT_ADDED only — renders each attachment's ORIGINAL filename
// (never its Azure blob path/key, which is never exposed here or anywhere
// else client-facing) as its own "📎 name" line. Each filename is escaped
// individually since this returns pre-built HTML that bypasses the
// generic per-placeholder escaping below (see {{attachments}} in
// renderTemplate) — a malicious filename can never inject markup this way.
// Returns "" when there are no attachments, so {{attachments}} disappears
// entirely rather than leaving a stray empty line.
function buildAttachmentsHtml(comment, hasText) {
  const files = comment?.attachments;
  if (!files?.length) return "";
  const items = files.map((a) => `📎 ${escapeHtml(a.fileName)}`).join("<br>");
  // No top margin when this is the box's only content (attachment-only
  // comment) — a visible gap above a list with nothing above it to
  // separate from would look like leftover empty space, the exact "empty
  // box" look this is fixing.
  return `<div style="margin-top:${hasText ? "10px" : "0"};">${items}</div>`;
}

// TICKET_ASSIGNED (and TICKET_REASSIGNED, harmlessly, if that template is
// ever given the same placeholder) only — renders the OPTIONAL assignment
// comment as a complete, self-contained, already-styled HTML block when
// present, or an empty string when it isn't. This is the ONE place that
// decides whether an "Assignment Note" section exists at all — a template
// only ever inserts the single {{assignmentCommentSection}} placeholder
// itself (see emailTemplateDefaults.js), never its own separate label/
// value markup, so there is no risk of a template showing an empty label
// with nothing after it. The comment text is escaped individually since
// this returns pre-built HTML that bypasses the generic per-placeholder
// escaping below (see {{attachments}}'s own buildAttachmentsHtml, which
// follows the identical pattern).
function buildAssignmentCommentSection(assignmentComment) {
  const trimmed = (assignmentComment || "").trim();
  if (!trimmed) return "";
  return `<div style="margin:16px 0 0;padding:12px 14px;background:#f7f7f7;border-left:3px solid #b43d35;border-radius:4px;">
    <div style="font-weight:700;font-size:13px;color:#1a1a1a;margin-bottom:4px;">Assignment Note</div>
    <div style="font-size:13px;color:#333;white-space:pre-wrap;">${escapeHtml(trimmed)}</div>
  </div>`;
}

// TICKET_ASSIGNED (and any other template that chooses to reference them)
// only — comma-joined display names of every currently active Team
// Lead/Manager for the ticket's CURRENT department, via the exact same
// userDepartmentAccessService queries recipientBuilder.js's own
// buildAssignedOrCommentRecipients/buildStandardRecipients already use for
// CC. This never decides who receives the email (recipientBuilder.js alone
// does that) — it only renders the same set as readable text inside the
// body. "None" is used instead of an empty string so the row never renders
// as a blank-looking value.
async function buildDepartmentStaffNames(toDepartmentId) {
  if (!toDepartmentId) return { teamLeadNames: "", managerNames: "" };
  const [teamLeads, managers] = await Promise.all([
    userDepartmentAccessService.getActiveDepartmentTeamLeads(toDepartmentId),
    userDepartmentAccessService.getActiveDepartmentManagers(toDepartmentId),
  ]);
  return {
    teamLeadNames: teamLeads.map((u) => u.name).join(", ") || "None",
    managerNames: managers.map((u) => u.name).join(", ") || "None",
  };
}

// All placeholders supported by the seeded templates. Every value is
// optional — a ticket/comment/statusChange that doesn't apply to a given
// event just leaves those placeholders blank when rendered, rather than
// failing.
async function buildPlaceholders({ ticket, comment, recipientName, statusChange, departmentTransfer, resetLink, assignmentComment } = {}) {
  const commentText = stripHtml(comment?.body)?.trim() || "";
  const hasCommentText = Boolean(commentText);
  const hasAttachments = Boolean(comment?.attachments?.length);
  const { teamLeadNames, managerNames } = await buildDepartmentStaffNames(ticket?.toDepartmentId);
  return {
    recipientName: recipientName || "",
    ticketNumber: ticket?.ticketNumber || "",
    title: ticket?.title || "",
    department: ticket?.toDepartment?.name || "",
    // Problem Summary is now rich-text HTML (bold/italic/underline/lists —
    // see ticket.service.js's sanitizeRichText); rendered emails aren't rich
    // text, so this reduces it to plain readable text via the SAME
    // stripHtml() the {{comment}} placeholder above already uses for the
    // identical HTML-in-a-plain-email problem — never the raw HTML (which
    // would otherwise come out as escaped, literal "&lt;p&gt;" tag text
    // once renderString's generic escaping below runs). An old plain-text
    // Problem Summary has no tags to strip, so this is unchanged for it.
    problemSummary: stripHtml(ticket?.problemSummary) || "",
    priority: ticket?.priority?.name || "",
    status: ticket?.status || "",
    requesterName: ticket?.requester?.name || "",
    assigneeName: ticket?.assignee?.name || "Unassigned",
    managerName: ticket?.manager?.name || "",
    teamLeadNames,
    managerNames,
    // TICKET_COMMENT_ADDED: text when there is any; if there's none but the
    // comment has attachment(s), leave this blank so {{attachments}} below
    // is the box's only content (no leftover empty line above the file
    // list); if there's neither (only possible for legacy data predating
    // the "text or attachment required" rule), fall back to a neutral
    // label rather than an empty box. `comment` truthy scopes that fallback
    // to this event only — every other event that doesn't pass a comment
    // still renders "" here exactly as before.
    comment: hasCommentText ? commentText : (hasAttachments || !comment ? "" : "(No comment text)"),
    attachments: buildAttachmentsHtml(comment, hasCommentText),
    commentAuthor: comment?.author?.name || "",
    resolution: ticket?.status || "",
    oldStatus: statusChange?.oldValue || "",
    newStatus: statusChange?.newValue || "",
    ticketLink: ticket ? `${env.clientUrl}/tickets/${ticket.id}` : "",
    // TICKET_RESOLVED/TICKET_CLOSED only ever fire exactly when the ticket
    // has just moved to that status, so reading straight off the ticket is
    // always the current reason — no staleness risk.
    resolutionNotes: ticket?.resolutionNotes || "",
    closedReason: ticket?.closedReason || "",
    // TICKET_STATUS_CHANGED, unlike the two above, is shared across
    // multiple possible target statuses (OPEN/IN_PROGRESS/ON_HOLD) — so
    // onHoldReason is scoped to "this specific change is the one that just
    // set it to ON_HOLD", not just "whatever the ticket's stored
    // onHoldReason happens to be right now". Without this guard, an
    // OPEN/IN_PROGRESS status-changed email sent after a ticket's *prior*
    // on-hold period would incorrectly show that old, unrelated reason.
    onHoldReason: statusChange?.newValue === "ON_HOLD" ? ticket?.onHoldReason || "" : "",
    // TICKET_DEPARTMENT_TRANSFERRED only — `department` above already reads
    // the ticket's CURRENT toDepartment (the new one, since this renders
    // after the transfer already committed), so the old department name has
    // nowhere else to come from and is passed in explicitly by the caller,
    // the same way `statusChange` carries old/new status.
    oldDepartment: departmentTransfer?.oldDepartmentName || "",
    transferReason: departmentTransfer?.reason || "",
    // PASSWORD_RESET_REQUESTED only — passed in directly by
    // auth.service.js#forgotPassword, since there's no ticket to derive a
    // link from (mirrors how ticketLink itself is built above).
    resetLink: resetLink || "",
    // TICKET_ASSIGNED only — see buildAssignmentCommentSection above.
    assignmentCommentSection: buildAssignmentCommentSection(assignmentComment),
  };
}

// Bodies are now HTML (see emailTemplateDefaults.js) — a placeholder value
// sourced from less-trusted data (a ticket title, a comment, a user's
// display name) must be HTML-escaped before insertion, or it could break
// out of surrounding markup or an href="{{ticketLink}}" attribute (HTML
// injection). Escaping a URL this way is also the *correct* way to embed
// it in an attribute — email/browser clients decode entities like "&amp;"
// back to "&" when parsing attribute values.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Missing/unknown placeholders resolve to "" rather than throwing or
// leaving the literal "{{token}}" in the sent email. `escapeValues: true`
// HTML-escapes each substituted value — used for the HTML body; the
// plain-text subject is rendered unescaped (subjects aren't HTML).
// `rawKeys` exempts specific placeholders from that escaping — used only
// for values this service built itself as already-safe HTML (see
// {{attachments}}/buildAttachmentsHtml above, which escapes each filename
// individually), never for anything sourced as-is from user input.
function renderString(str, data, { escapeValues = false, rawKeys } = {}) {
  return String(str).replace(PLACEHOLDER_PATTERN, (_match, key) => {
    const value = data[key];
    if (value === undefined || value === null) return "";
    return escapeValues && !rawKeys?.has(key) ? escapeHtml(value) : String(value);
  });
}

// This renderer is deliberately plain string substitution with no
// conditional blocks (see emailTemplateDefaults.js's `row()` helper — every
// templated fact is one `<tr><td>Label</td><td>{{value}}</td></tr>`). That
// means a placeholder that legitimately renders blank for a given event —
// e.g. {{onHoldReason}} on an OPEN -> IN_PROGRESS status-changed email —
// would otherwise leave a visible "Reason:" row with nothing after it.
// Rather than inventing a template engine, this is a narrow, generic
// post-substitution cleanup: any table row whose VALUE cell ended up
// empty after rendering is dropped entirely. It only ever looks at the
// row's already-rendered content, so it applies safely to every current
// and future template — a row with real content is never touched.
function stripEmptyLabeledRows(html) {
  // [^<]* (not .*?) for the label cell's content is deliberate: `.` matches
  // `<`/`>` too, so a non-greedy `.*?` here would happily cross a
  // `</td><td>` boundary into a LATER row while backtracking, potentially
  // swallowing every row between the first `<tr>` and the next one that
  // happens to be empty — collapsing the whole table instead of just the
  // one empty row. Labels are always plain text with no nested tags, so
  // disallowing `<` keeps each match confined to a single row.
  return html.replace(/<tr>\s*<td[^>]*>[^<]*<\/td>\s*<td[^>]*>\s*<\/td>\s*<\/tr>/g, "");
}

// Loads the EmailTemplate row for `eventKey`, verifies it's active, and
// returns { subject, body } with every supported placeholder replaced.
// Returns null — and logs why — if the template is missing, inactive, or
// fails to render for any reason; callers must treat null as "no template
// content available" and fall back gracefully rather than crash the
// ticket operation that triggered the notification.
async function renderTemplate(eventKey, context) {
  if (!eventKey) return null;

  let template;
  try {
    template = await prisma.emailTemplate.findUnique({ where: { eventKey } });
  } catch (err) {
    console.error(`[emailTemplate] Failed to load template for "${eventKey}":`, err.message);
    return null;
  }

  if (!template) {
    console.error(`[emailTemplate] No EmailTemplate row for eventKey "${eventKey}"`);
    return null;
  }
  if (!template.isActive) {
    console.log(`[emailTemplate] Template for "${eventKey}" is inactive — skipping email content.`);
    return null;
  }

  try {
    const data = await buildPlaceholders(context);
    return {
      // Every ticket-lifecycle event uses ONE centrally-generated subject
      // format ("Ticket – {{ticketNumber}} – {{status}}") rather than each
      // EmailTemplate row's own free-text subject — this is the single
      // place that format is produced, so it can never drift out of sync
      // across events. PASSWORD_RESET_REQUESTED (the only non-ticket
      // event) is untouched — it has no `ticket` in its context and keeps
      // its own stored subject exactly as before.
      subject: context?.ticket ? buildTicketEmailSubject(context.ticket) : renderString(template.subject, data),
      body: stripEmptyLabeledRows(renderString(template.body, data, { escapeValues: true, rawKeys: RAW_PLACEHOLDER_KEYS })),
    };
  } catch (err) {
    console.error(`[emailTemplate] Failed to render template for "${eventKey}":`, err.message);
    return null;
  }
}

// Central ticket-email subject format — the ONLY place any ticket-related
// email subject is assembled, so a future event never has to hardcode its
// own variant. Uses the ticket's actual current status and its NEW,
// purely-numeric ticketNumber (never the internal DB id).
function buildTicketEmailSubject(ticket) {
  return `Ticket – ${ticket.ticketNumber} – ${ticket.status}`;
}

// ---------------------------------------------------------------------------
// Admin CRUD for the EmailTemplate management UI. eventKey is deliberately
// never accepted here — it's set only by prisma/seed.js and must stay in
// lockstep with the fixed TICKET_* constants ticket.service.js emits, so
// there is intentionally no create/delete endpoint either (only the 8
// seeded rows should ever exist).
// ---------------------------------------------------------------------------

const emailTemplateSelect = {
  id: true,
  eventKey: true,
  name: true,
  subject: true,
  body: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

async function listTemplates() {
  return prisma.emailTemplate.findMany({ select: emailTemplateSelect, orderBy: { eventKey: "asc" } });
}

async function getTemplateById(id) {
  const template = await prisma.emailTemplate.findUnique({ where: { id }, select: emailTemplateSelect });
  if (!template) throw new ApiError(404, "Email template not found");
  return template;
}

async function updateTemplate(actorId, id, { name, subject, body, isActive }) {
  const existing = await prisma.emailTemplate.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "Email template not found");

  const data = {};
  if (name !== undefined) data.name = name;
  if (subject !== undefined) data.subject = subject;
  if (body !== undefined) data.body = body;
  if (isActive !== undefined) data.isActive = isActive;

  const template = await prisma.emailTemplate.update({ where: { id }, data, select: emailTemplateSelect });

  await recordAudit({
    userId: actorId,
    action: "EMAIL_TEMPLATE_UPDATED",
    entityType: "EmailTemplate",
    entityId: id,
    oldValues: { name: existing.name, subject: existing.subject, body: existing.body, isActive: existing.isActive },
    newValues: { name, subject, body, isActive },
  });

  return template;
}

function listPlaceholders() {
  return SUPPORTED_PLACEHOLDERS;
}

module.exports = { renderTemplate, listTemplates, getTemplateById, updateTemplate, listPlaceholders };
