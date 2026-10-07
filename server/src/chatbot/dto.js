const { toPlainText } = require("./text");

// Field-level filtering. Every ticket-shaped value that leaves the tool layer
// goes through one of these builders, which pick fields from an explicit
// allow-list. Raw Prisma rows never reach the AI context, the database
// transcript, or the HTTP response.
//
// Deliberately NEVER included: requester/assignee emails, internal notes
// (TicketComment.isInternal), CC lists, attachment file paths/storage
// details, manager ids, any user id.

const STATUS_LABELS = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  ON_HOLD: "On Hold",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  REOPENED: "Reopened",
};

const statusLabel = (s) => STATUS_LABELS[s] || s;

// The Prisma `select` every ticket query uses, so unneeded columns are never
// even read from the database.
const TICKET_CARD_SELECT = {
  id: true,
  ticketNumber: true,
  title: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  assigneeId: true,
  priority: { select: { name: true, level: true, color: true } },
  category: { select: { name: true } },
  assignee: { select: { name: true } },
  requester: { select: { name: true } },
  toDepartment: { select: { name: true } },
};

const iso = (d) => (d ? new Date(d).toISOString() : null);

function toTicketCard(t) {
  return {
    ticketRouteId: t.id,
    ticketNumber: t.ticketNumber,
    title: toPlainText(t.title, 120),
    status: t.status,
    statusLabel: statusLabel(t.status),
    priority: t.priority ? { name: t.priority.name, color: t.priority.color } : null,
    category: t.category?.name ?? null,
    assignedTo: t.assignee?.name ?? null,
    raisedBy: t.requester?.name ?? null,
    department: t.toDepartment?.name ?? null,
    createdAt: iso(t.createdAt),
    lastUpdatedAt: iso(t.updatedAt),
  };
}

function describeHistory(h) {
  const who = h.user?.name ? ` by ${h.user.name}` : "";
  const oldV = toPlainText(h.oldValue, 120);
  const newV = toPlainText(h.newValue, 200);
  switch (h.action) {
    case "STATUS_CHANGE":
      return `Status changed from ${statusLabel(h.oldValue)} to ${statusLabel(h.newValue)}${who}`;
    case "CREATED":
      return `Ticket created${who}`;
    case "ASSIGNED":
      return `Assignment changed${oldV ? ` from ${oldV}` : ""}${newV ? ` to ${newV}` : ""}${who}`;
    case "PRIORITY_CHANGE":
      return `Priority changed${oldV ? ` from ${oldV}` : ""}${newV ? ` to ${newV}` : ""}${who}`;
    case "COMMENTED":
      return `Comment added${who}`;
    case "RESOLUTION_NOTES":
      return `Resolution notes recorded${who}${newV ? `: ${newV}` : ""}`;
    case "ON_HOLD_REASON":
      return `On-hold reason recorded${who}${newV ? `: ${newV}` : ""}`;
    case "CLOSED_REASON":
      return `Closing reason recorded${who}${newV ? `: ${newV}` : ""}`;
    default: {
      const name = String(h.action || "UPDATE").toLowerCase().replace(/_/g, " ");
      return `${name.charAt(0).toUpperCase()}${name.slice(1)}${who}${newV ? `: ${newV}` : ""}`;
    }
  }
}

function toHistoryEntry(h) {
  return { at: iso(h.createdAt), description: describeHistory(h) };
}

// Facts derived ONLY from recorded fields. `suggestions` are explicitly
// separate so the UI/model never presents advice as a recorded fact.
function derivePending(t, { isStaff }) {
  const pending = [];
  const suggestions = [];
  const done = t.status === "RESOLVED" || t.status === "CLOSED";
  if (!t.assigneeId && !done) {
    pending.push("No assignee is recorded for this ticket.");
    if (isStaff) suggestions.push("A Manager or Team Lead of the ticket's department can assign it.");
  }
  if (t.status === "ON_HOLD") {
    const reason = toPlainText(t.onHoldReason, 200);
    pending.push(reason ? `The ticket is on hold. Recorded reason: ${reason}` : "The ticket is on hold (no reason is recorded).");
  }
  if (t.status === "RESOLVED") pending.push("The ticket is resolved but not yet closed.");
  if (t.status === "REOPENED") pending.push("The ticket was reopened and is awaiting work.");
  if (t.status === "OPEN" && t.assigneeId) pending.push("The ticket is assigned but its status is still Open.");
  return { pending, suggestions };
}

// `latest` is the newest of: the latest history row, the latest NON-internal
// comment. Internal notes are never surfaced by the chatbot.
function latestUpdate(history, publicComments) {
  const h = history[0];
  const c = publicComments[publicComments.length - 1];
  const hAt = h ? new Date(h.createdAt).getTime() : -1;
  const cAt = c ? new Date(c.createdAt).getTime() : -1;
  if (c && cAt >= hAt) {
    const body = toPlainText(c.body, 200);
    return { at: iso(c.createdAt), description: `Comment${c.author?.name ? ` by ${c.author.name}` : ""}${body ? `: ${body}` : ""}` };
  }
  if (h) return { at: iso(h.createdAt), description: describeHistory(h) };
  return null;
}

// The summary contract. Absent data is `null` and listed in `unavailable`
// instead of being guessed.
function toTicketSummary(t, { isStaff }) {
  const publicComments = (t.comments || []).filter((c) => !c.isInternal);
  const latest = latestUpdate(t.history || [], publicComments);
  const { pending, suggestions } = derivePending(t, { isStaff });
  const resolutionSummary = ["RESOLVED", "CLOSED"].includes(t.status) ? toPlainText(t.resolutionNotes, 400) : null;

  const summary = {
    ticketId: t.ticketNumber,
    ticketRouteId: t.id,
    subject: toPlainText(t.title, 200),
    summary: toPlainText(t.problemSummary, 300),
    category: t.category?.name ?? null,
    priority: t.priority?.name ?? null,
    status: t.status,
    statusLabel: statusLabel(t.status),
    createdAt: iso(t.createdAt),
    lastUpdatedAt: iso(t.updatedAt),
    assignedTo: t.assignee?.name ?? null,
    raisedBy: t.requester?.name ?? null,
    department: t.toDepartment?.name ?? null,
    // SLA tracking was removed from the application (see
    // docs/chatbot-repository-analysis.md) — never invented here.
    slaStatus: "Not tracked",
    latestUpdate: latest ? `${latest.description} (${latest.at})` : null,
    latestUpdateAt: latest ? latest.at : null,
    pendingActions: pending,
    suggestions,
    resolutionSummary,
    attachmentCount: t._count?.attachments ?? null,
  };

  const unavailable = [];
  if (!summary.category) unavailable.push("category");
  if (!summary.assignedTo) unavailable.push("assignedTo");
  if (!summary.latestUpdate) unavailable.push("latestUpdate");
  if (!summary.resolutionSummary) unavailable.push("resolutionSummary");
  summary.unavailableFields = unavailable;
  return summary;
}

module.exports = {
  STATUS_LABELS,
  statusLabel,
  TICKET_CARD_SELECT,
  toTicketCard,
  toTicketSummary,
  toHistoryEntry,
  describeHistory,
};
