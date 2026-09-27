const prisma = require("../config/prisma");
const emailService = require("./email.service");
const emailTemplateService = require("./emailTemplate.service");
const blobStorageService = require("./blobStorage.service");
const { uploadRoot } = require("../config/multer");
const fs = require("fs");
const path = require("path");
const { buildInAppNotificationContent } = require("../utils/inAppNotificationContent");

// Used ONLY when the PostgreSQL EmailTemplate for `eventKey` is missing,
// inactive, or fails to render (Step 7) — a minimal safety net so the
// in-app notification and the ticket operation that triggered it still
// succeed even before templates are seeded/configured. This is not "the"
// content source; the DB template is.
function fallbackContent(eventKey, ticket) {
  const label = eventKey ? eventKey.replace(/_/g, " ").toLowerCase() : "ticket update";
  return {
    subject: ticket ? `Ticket ${ticket.ticketNumber} — ${label}` : `Helpdesk — ${label}`,
    body: ticket ? `There is an update on ticket ${ticket.ticketNumber} (${label}).` : "There is a Helpdesk update.",
  };
}

// Creates an in-app Notification row AND emails the user via the existing
// Microsoft Graph email.service.js — used for every ticket lifecycle event.
// Architecture: ticket.service.js decides WHEN to call this and WHO
// receives it (via `userId` for TO, `ccUserIds` for CC — see below) by
// passing an `eventKey`; the PostgreSQL EmailTemplate matching that
// eventKey (emailTemplate.service.js) decides WHAT the subject/body say;
// email.service.js's existing Graph implementation decides HOW it's
// delivered — untouched here. This function itself never hardcodes
// notification/email content beyond the `fallbackContent` safety net above.
//
// Recipient resolution is centralized HERE, not scattered per call site:
// every address is resolved server-side from a user id
// (email.service#resolveUserEmail, which itself now skips inactive users)
// — callers never pass a raw email. `ccUserIds` is an explicit, always-
// complete list of user ids to CC for THIS specific event; there is no
// hidden default "CC the department manager" behavior anymore — every
// ticket.service.js call site computes exactly who belongs in TO/CC per
// the event's own recipient rule and passes that list directly. This
// function's only remaining jobs are: resolve ids -> emails, drop
// unresolvable/inactive addresses, dedupe against the primary TO and
// against each other, and send. `type` is kept only for the legacy
// Notification.type column (the notification bell UI doesn't branch on
// it); it defaults to `eventKey`. Failures anywhere in here are logged,
// never thrown, so a notification problem can't fail the ticket action
// that triggered it.
// `userIds` is the event's full TO group (one or more people — e.g.
// "requester + current assignee," or "every active department TEAMLEAD" for
// TICKET_CREATED) — see utils/recipientBuilder.js, which is what every
// ticket.service.js call site now goes through to compute it. Multiple TO
// ids still produce only ONE email message (one sendMail call, every
// resolved TO address combined into a single `to`), never one email per
// TO id — that's what keeps "the same person in multiple recipient
// groups" (or two different people both legitimately in TO) from ever
// becoming multiple email sends for the same event. Each id still gets
// its own in-app Notification row, since the bell is inherently per-user.
async function notify({ eventKey, userIds, userId, ticketId, type, ticket, comment, statusChange, departmentTransfer, ccUserIds = [], attachments = [], assignmentComment }) {
  // userId (singular) kept accepted for any caller not yet migrated to the
  // plural form — treated as a one-element array, identical behavior.
  const primaryIds = [...new Set((userIds || (userId ? [userId] : [])).filter(Boolean))];
  if (!primaryIds.length) return;

  let recipientName;
  try {
    const recipient = await prisma.user.findUnique({ where: { id: primaryIds[0] }, select: { name: true } });
    recipientName = recipient?.name;
  } catch (err) {
    console.error(`[notifications] Failed to load recipient ${primaryIds[0]}:`, err.message);
  }

  // The bell (in-app Notification.title/message) and the email
  // (subject/body) are two independent content representations of the SAME
  // event — computed by two separate functions, never one derived from the
  // other. The bell's short summary never depends on whether an
  // EmailTemplate row exists/is active/was edited; it's the same fixed,
  // concise text for a given eventKey regardless. See
  // utils/inAppNotificationContent.js.
  const inApp = buildInAppNotificationContent(eventKey, { ticket, comment, statusChange, departmentTransfer });

  // One Notification (bell) row per primary recipient — independent of how
  // many end up in the single combined email below.
  for (const userId of primaryIds) {
    try {
      await prisma.notification.create({
        data: { userId, ticketId, type: type || eventKey, title: inApp.title, message: inApp.message },
      });
    } catch (err) {
      console.error("[notifications] Failed to persist notification:", err.message);
    }
  }

  try {
    const rendered = await emailTemplateService.renderTemplate(eventKey, { ticket, comment, recipientName, statusChange, departmentTransfer, assignmentComment });
    const { subject, body } = rendered || fallbackContent(eventKey, ticket);

    const toEmails = [];
    const seen = new Set();
    for (const userId of primaryIds) {
      const email = await emailService.resolveUserEmail(userId);
      if (!email) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      toEmails.push(email);
    }
    if (!toEmails.length) return;

    const cc = await resolveCcEmails(ccUserIds, seen);
    const fileAttachments = await buildEmailFileAttachments(attachments);

    await emailService.sendMail({ to: toEmails, cc: cc.length ? cc : undefined, subject, html: body, attachments: fileAttachments });
  } catch (err) {
    console.error(`[notifications] Failed to email ${primaryIds.join(", ")}:`, err.message);
  }
}

// Fetches each attachment's actual bytes server-side (Azure or local disk,
// mirroring ticket.service.js#streamAttachment's own storageProvider
// branch) and base64-encodes them for Microsoft Graph's fileAttachment
// payload (see email.service.js#toFileAttachments) — currently only ever
// invoked for TICKET_CREATED (see ticket.service.js#createTicket). A single
// attachment failing to read is logged and skipped rather than failing the
// whole email; storage credentials never leave this function.
async function buildEmailFileAttachments(attachments) {
  if (!attachments?.length) return [];
  const results = [];
  for (const attachment of attachments) {
    try {
      let buffer;
      if (attachment.storageProvider === "azure") {
        buffer = await blobStorageService.downloadBlobBuffer(attachment.filePath);
      } else {
        buffer = await fs.promises.readFile(path.join(uploadRoot, attachment.filePath));
      }
      results.push({
        name: attachment.fileName,
        contentType: attachment.mimeType || "application/octet-stream",
        contentBytes: buffer.toString("base64"),
      });
    } catch (err) {
      console.error(`[notifications] Failed to read attachment "${attachment.fileName}" for email:`, err.message);
    }
  }
  return results;
}

// Resolves each candidate CC user id to a deliverable email, silently
// dropping: falsy ids, unresolvable users, inactive users (resolveUserEmail
// itself now returns null for those), any address already in the TO group
// (toEmailsSeen — TO takes precedence over CC, per the recipient-builder
// contract), and any duplicate that already appears earlier in the CC list
// itself — so a caller can freely pass e.g. [managerId, requesterId]
// without separately worrying about either one coinciding with a TO
// recipient or with each other.
async function resolveCcEmails(ccUserIds, toEmailsSeen) {
  const seen = new Set(toEmailsSeen);
  const emails = [];
  for (const ccUserId of ccUserIds) {
    if (!ccUserId) continue;
    try {
      const ccEmail = await emailService.resolveUserEmail(ccUserId);
      if (!ccEmail) continue;
      const key = ccEmail.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      emails.push(ccEmail);
    } catch (err) {
      console.error(`[notifications] Failed to resolve CC user ${ccUserId}:`, err.message);
    }
  }
  return emails;
}

async function listForUser(userId, { unreadOnly } = {}) {
  return prisma.notification.findMany({
    where: { userId, ...(unreadOnly ? { isRead: false } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { ticket: { select: { id: true, ticketNumber: true, title: true } } },
  });
}

async function markRead(userId, id) {
  return prisma.notification.updateMany({ where: { id, userId }, data: { isRead: true } });
}

async function markAllRead(userId) {
  return prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
}

// Permanently removes every Notification row belonging to this user only —
// scoped by `userId` exactly like every other function in this file (never
// a client-supplied id), so a user can never clear anyone else's
// notifications. Distinct from markAllRead: this actually deletes the rows
// (the bell shows the existing empty state afterward) rather than just
// flipping isRead. Never touches Ticket/TicketComment/TicketHistory/
// EmailTemplate/AuditLog or any other user's Notification rows.
async function clearAll(userId) {
  return prisma.notification.deleteMany({ where: { userId } });
}

module.exports = { notify, listForUser, markRead, markAllRead, clearAll };
