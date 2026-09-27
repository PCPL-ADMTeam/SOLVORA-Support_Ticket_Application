// Builds the SHORT title/message shown in the in-app notification bell —
// deliberately independent of emailTemplateService/EmailTemplate. The email
// system decides what a message says by event key via a DB-editable
// template; the bell instead always shows a fixed, concise, hardcoded
// summary for that same event key. Both are triggered by the exact same
// business event (see notification.service.js#notify, which calls this
// alongside — never instead of — the email render), but they are two
// separate content representations of it, computed by two separate
// functions, so editing an EmailTemplate's subject/body in the Admin UI can
// never accidentally change what the bell shows, and vice versa.
//
// `message` below is TWO lines joined by "\n": the short sentence, then an
// optional "Department • Priority • Status"-style details line (omitted
// segments are simply left out, never rendered as "undefined"). The
// frontend splits on the first "\n" to render them as a message line and a
// smaller, muted details line — no new database column was needed for
// this, since Notification.message is already a plain, unbounded string.
function departmentName(ticket) {
  return ticket?.toDepartment?.name || null;
}

function priorityLabel(ticket) {
  return ticket?.priority?.name ? `${ticket.priority.name} Priority` : null;
}

// "IN_PROGRESS" -> "In Progress", "ON_HOLD" -> "On Hold", etc. — the same
// human-friendly casing StatusBadge.jsx already uses for this status value
// elsewhere in the app, kept in sync here only because this is a separate,
// plain-text rendering (no shared component to reuse across a REST boundary).
function statusLabel(ticket) {
  if (!ticket?.status) return null;
  return ticket.status
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

function joinDetails(parts) {
  const filtered = parts.filter(Boolean);
  return filtered.length ? filtered.join(" • ") : "";
}

function combine(message, details) {
  return details ? `${message}\n${details}` : message;
}

// `context` mirrors exactly what notification.service.js#notify already
// receives and passes through: { ticket, comment, statusChange, departmentTransfer }.
// No extra queries are made here — if a field this function wants isn't
// already on `ticket`/`comment`, it's simply omitted from the output rather
// than fetched separately.
function buildInAppNotificationContent(eventKey, { ticket, comment, statusChange, departmentTransfer } = {}) {
  const ticketNumber = ticket?.ticketNumber || "";

  switch (eventKey) {
    case "TICKET_CREATED":
      return {
        title: "New Support Ticket",
        message: combine(
          `Ticket ${ticketNumber} was created by ${ticket?.requester?.name || "a requester"}.`,
          joinDetails([departmentName(ticket), priorityLabel(ticket), statusLabel(ticket)])
        ),
      };

    case "TICKET_ASSIGNED":
    case "TICKET_SELF_ASSIGNED":
      return {
        title: "Ticket Assigned",
        message: combine(
          `Ticket ${ticketNumber} has been assigned to ${ticket?.assignee?.name || "an employee"}.`,
          joinDetails([departmentName(ticket), priorityLabel(ticket), statusLabel(ticket)])
        ),
      };

    case "TICKET_REASSIGNED":
      return {
        title: "Ticket Reassigned",
        message: combine(
          `Ticket ${ticketNumber} has been reassigned to ${ticket?.assignee?.name || "an employee"}.`,
          joinDetails([departmentName(ticket), priorityLabel(ticket), statusLabel(ticket)])
        ),
      };

    case "TICKET_COMMENT_ADDED":
      return {
        title: "New Comment",
        message: combine(
          `${comment?.author?.name || "Someone"} added a comment to ticket ${ticketNumber}.`,
          joinDetails([departmentName(ticket), statusLabel(ticket)])
        ),
      };

    case "TICKET_STATUS_CHANGED":
      return {
        title: "Ticket Status Updated",
        message: combine(
          `Ticket ${ticketNumber} status changed to ${statusLabel({ status: statusChange?.newValue }) || statusLabel(ticket)}.`,
          joinDetails([departmentName(ticket), priorityLabel(ticket)])
        ),
      };

    case "TICKET_RESOLVED":
      return {
        title: "Ticket Resolved",
        message: combine(
          `Ticket ${ticketNumber} has been resolved.`,
          joinDetails([departmentName(ticket), priorityLabel(ticket)])
        ),
      };

    case "TICKET_CLOSED":
      return {
        title: "Ticket Closed",
        message: combine(
          `Ticket ${ticketNumber} has been closed.`,
          joinDetails([departmentName(ticket), priorityLabel(ticket)])
        ),
      };

    case "TICKET_REOPENED":
      return {
        title: "Ticket Reopened",
        message: combine(
          `Ticket ${ticketNumber} has been reopened.`,
          joinDetails([departmentName(ticket), statusLabel(ticket)])
        ),
      };

    case "TICKET_DEPARTMENT_TRANSFERRED":
      // `ticket` here is already the POST-transfer ticket (see
      // ticket.service.js#transferDepartment, which calls notify() with the
      // updated row), so its own toDepartment IS the new department —
      // `departmentTransfer` itself only carries the OLD department name +
      // reason (for the email template's {{oldDepartment}}/{{transferReason}}
      // placeholders), neither of which this short message needs.
      return {
        title: "Ticket Department Changed",
        message: combine(
          `Ticket ${ticketNumber} was moved to ${departmentName(ticket) || "a new department"}.`,
          joinDetails([priorityLabel(ticket), statusLabel(ticket)])
        ),
      };

    case "TICKET_UPDATED":
      return {
        title: "Ticket Updated",
        message: combine(
          `Ticket ${ticketNumber} was updated by ${ticket?.requester?.name || "the requester"}.`,
          joinDetails([departmentName(ticket), statusLabel(ticket)])
        ),
      };

    default:
      // Unknown/future event key — a short, generic fallback rather than
      // ever falling back to email subject/body content.
      return {
        title: "Ticket Update",
        message: ticketNumber ? `Ticket ${ticketNumber} has an update.` : "There is a Helpdesk update.",
      };
  }
}

module.exports = { buildInAppNotificationContent };
