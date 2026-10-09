const prisma = require("../../config/prisma");
const { ChatError, CODES } = require("../chatbot.errors");
const { authorizedWhere, mineWhere, staffScopeWhere } = require("../roleScope");
const { toPlainText } = require("../text");
const { TICKET_CARD_SELECT, toTicketCard, toTicketSummary, toHistoryEntry } = require("../dto");

const OPEN_STATUSES = ["OPEN", "IN_PROGRESS", "ON_HOLD", "REOPENED"];
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

// Accepts "2627001" or "TKT-2627001". The application's ticket numbers are
// digits only (see utils/ticketNumber.js); the optional TKT- prefix is just
// tolerated in what a user types.
const TICKET_REF_PATTERN = /^(?:TKT-?)?\d{3,12}$/i;
const normalizeTicketNumber = (ref) => String(ref).replace(/^TKT-?/i, "");

// ---- scope helpers ---------------------------------------------------------

function baseWhere(ctx, scopeName) {
  const { scope } = ctx;
  if (scopeName === "staff") {
    // Team / department / system-wide views are for staff roles only. This is
    // enforced HERE (server side), not in the router or UI.
    if (scope.role === "EMPLOYEE") {
      ctx.audit("TICKETS_SCOPE_DENIED", "Ticket", null, "DENIED");
      throw new ChatError(CODES.ACCESS_DENIED, { internal: "employee requested staff scope" });
    }
    return staffScopeWhere(scope);
  }
  return mineWhere(scope);
}

// ---- single-ticket loading -------------------------------------------------

// Returns the ticket only if it is inside the caller's authorized scope.
// "Doesn't exist" and "exists but not yours" produce the IDENTICAL
// CHAT_TICKET_NOT_FOUND response (no existence leak); the difference is only
// recorded server-side in the audit trail.
async function loadAuthorizedTicket(ctx, ticketRef, select) {
  const ticketNumber = normalizeTicketNumber(ticketRef);
  const ticket = await prisma.ticket.findFirst({
    where: { AND: [{ ticketNumber }, authorizedWhere(ctx.scope)] },
    select,
  });
  if (ticket) return ticket;

  const exists = await prisma.ticket.findUnique({ where: { ticketNumber }, select: { id: true } });
  await ctx.audit(exists ? "TICKET_ACCESS_DENIED" : "TICKET_NOT_FOUND", "Ticket", ticketNumber, exists ? "DENIED" : "ERROR");
  throw new ChatError(CODES.TICKET_NOT_FOUND);
}

const DETAIL_SELECT = {
  ...TICKET_CARD_SELECT,
  problemSummary: true,
  resolutionNotes: true,
  onHoldReason: true,
  _count: { select: { attachments: true } },
  comments: {
    where: { isInternal: false },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { body: true, isInternal: true, createdAt: true, author: { select: { name: true } } },
  },
  history: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { action: true, oldValue: true, newValue: true, createdAt: true, user: { select: { name: true } } },
  },
};

const ticketRefRule = { type: "string", required: true, max: 20, pattern: TICKET_REF_PATTERN, errorCode: CODES.INVALID_TICKET_ID };

// ---- tools -----------------------------------------------------------------

const searchAuthorizedTickets = {
  name: "search_authorized_tickets",
  description: "List tickets inside the caller's authorized scope, optionally filtered.",
  inputSchema: {
    scope: { type: "enum", values: ["mine", "staff"] },
    filter: { type: "enum", values: ["any", "open", "pending", "recent", "unassigned", "stale"] },
    text: { type: "string", max: 100 },
    // Exact (case-insensitive) names, already resolved by the handler. They only NARROW the
    // caller-scoped result; they can never widen it.
    priority: { type: "string", max: 40 },
    department: { type: "string", max: 80 },
    status: { type: "enum", values: ["OPEN", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED", "REOPENED"] },
    // "Tickets I raised" / "tickets assigned to me": always the AUTHENTICATED user (never a name from the message).
    requester: { type: "enum", values: ["me"] },
    assignee: { type: "enum", values: ["me"] },
    // Ids the handler resolved server-side against real users (a person named in the question).
    // They only NARROW the caller-scoped result.
    assigneeId: { type: "string", max: 64, pattern: /^[A-Za-z0-9_-]{1,64}$/ },
    requesterId: { type: "string", max: 64, pattern: /^[A-Za-z0-9_-]{1,64}$/ },
    involvedId: { type: "string", max: 64, pattern: /^[A-Za-z0-9_-]{1,64}$/ },
    // Names as typed, matched exactly (case-insensitive) against the ticket's own people. They only
    // NARROW the caller-scoped query: a name outside the caller's scope simply matches nothing.
    assignedTo: { type: "string", max: 80 },
    raisedBy: { type: "string", max: 80 },
    dateFrom: { type: "string", max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/ },
    dateTo: { type: "string", max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/ },
    page: { type: "int", min: 1, max: 1000 },
    staleDays: { type: "int", min: 1, max: 365 },
    updatedDays: { type: "int", min: 1, max: 90 },
    // Exact windows (ISO instants, `Until` exclusive) for "what's new today": a day starts at the user's own
    // midnight, which a whole number of days cannot express. They only NARROW the caller-scoped result.
    updatedSince: { type: "string", max: 30, pattern: ISO_INSTANT },
    updatedUntil: { type: "string", max: 30, pattern: ISO_INSTANT },
    createdSince: { type: "string", max: 30, pattern: ISO_INSTANT },
    createdUntil: { type: "string", max: 30, pattern: ISO_INSTANT },
    // "latest ticket" / "recently created": newest first by creation date instead of last update.
    sort: { type: "enum", values: ["created"] },
    withReasons: { type: "enum", values: ["yes"] },
    limit: { type: "int", min: 1, max: 10 },
    pageSize: { type: "int", min: 1, max: 100 },
  },
  async run(ctx, input) {
    const scopeName = input.scope || "mine";
    const filter = input.filter || "any";
    const limit = input.pageSize || input.limit || 5;
    const skip = ((input.page || 1) - 1) * limit;
    const staleDays = input.staleDays || 7;

    const clauses = [baseWhere(ctx, scopeName)];
    if (filter === "open") clauses.push({ status: { in: OPEN_STATUSES } });
    if (filter === "pending") clauses.push({ status: "ON_HOLD" });
    if (filter === "unassigned") clauses.push({ assigneeId: null, status: { in: OPEN_STATUSES } });
    if (filter === "stale") clauses.push({ status: { in: OPEN_STATUSES }, updatedAt: { lt: new Date(Date.now() - staleDays * DAY_MS) } });
    if (input.status) clauses.push({ status: input.status });
    if (input.updatedDays) clauses.push({ updatedAt: { gte: new Date(Date.now() - input.updatedDays * DAY_MS) } });
    if (input.updatedSince) clauses.push({ updatedAt: { gte: new Date(input.updatedSince) } });
    if (input.updatedUntil) clauses.push({ updatedAt: { lt: new Date(input.updatedUntil) } });
    if (input.createdSince) clauses.push({ createdAt: { gte: new Date(input.createdSince) } });
    if (input.createdUntil) clauses.push({ createdAt: { lt: new Date(input.createdUntil) } });
    if (input.requester === "me") clauses.push({ requesterId: ctx.scope.userId });
    if (input.assignee === "me") clauses.push({ assigneeId: ctx.scope.userId });
    if (input.assigneeId) clauses.push({ assigneeId: input.assigneeId });
    if (input.requesterId) clauses.push({ requesterId: input.requesterId });
    if (input.involvedId) clauses.push({ OR: [{ assigneeId: input.involvedId }, { requesterId: input.involvedId }] });
    if (input.assignedTo) clauses.push({ assignee: { name: { equals: input.assignedTo, mode: "insensitive" } } });
    if (input.raisedBy) clauses.push({ requester: { name: { equals: input.raisedBy, mode: "insensitive" } } });
    if (input.dateFrom) clauses.push({ createdAt: { gte: new Date(input.dateFrom) } });
    // dateTo is inclusive of the whole day (exclusive upper bound at the next midnight), like the ticket list.
    if (input.dateTo) clauses.push({ createdAt: { lt: new Date(new Date(input.dateTo).getTime() + DAY_MS) } });
    if (input.priority) clauses.push({ priority: { name: { equals: input.priority, mode: "insensitive" } } });
    if (input.department) clauses.push({ toDepartment: { name: { equals: input.department, mode: "insensitive" } } });
    if (input.text) {
      clauses.push({
        OR: [
          { title: { contains: input.text, mode: "insensitive" } },
          { ticketNumber: { contains: input.text, mode: "insensitive" } },
          { problemSummary: { contains: input.text, mode: "insensitive" } },
        ],
      });
    }
    const where = { AND: clauses };

    const [rows, total] = await Promise.all([
      prisma.ticket.findMany({ where, select: input.withReasons ? { ...TICKET_CARD_SELECT, ...REASON_SELECT } : TICKET_CARD_SELECT, orderBy: input.sort === "created" ? { createdAt: "desc" } : { updatedAt: "desc" }, skip, take: limit }),
      prisma.ticket.count({ where }),
    ]);
    await ctx.audit("TOOL_SEARCH_TICKETS", "Ticket", null, "SUCCESS");
    return { filter, scope: scopeName, staleDays, total, tickets: rows.map((r) => (input.withReasons ? { ...toTicketCard(r), reason: currentReason(r) } : toTicketCard(r))) };
  },
};

const getAuthorizedTicket = {
  name: "get_authorized_ticket",
  description: "Fetch one ticket card by ticket number, if the caller may view it.",
  inputSchema: { ticketNumber: ticketRefRule },
  async run(ctx, input) {
    const t = await loadAuthorizedTicket(ctx, input.ticketNumber, TICKET_CARD_SELECT);
    await ctx.audit("TOOL_GET_TICKET", "Ticket", t.ticketNumber, "SUCCESS");
    return { ticket: toTicketCard(t) };
  },
};

const summarizeAuthorizedTicket = {
  name: "summarize_authorized_ticket",
  description: "Build the restricted summary DTO for one authorized ticket.",
  inputSchema: { ticketNumber: ticketRefRule },
  async run(ctx, input) {
    const t = await loadAuthorizedTicket(ctx, input.ticketNumber, DETAIL_SELECT);
    await ctx.audit("TOOL_SUMMARIZE_TICKET", "Ticket", t.ticketNumber, "SUCCESS");
    return { summary: toTicketSummary(t, { isStaff: ctx.scope.role !== "EMPLOYEE" }) };
  },
};

const getAuthorizedTicketHistory = {
  name: "get_authorized_ticket_history",
  description: "Recorded activity history (newest first) for one authorized ticket.",
  inputSchema: { ticketNumber: ticketRefRule, limit: { type: "int", min: 1, max: 20 } },
  async run(ctx, input) {
    const limit = input.limit || 10;
    const t = await loadAuthorizedTicket(ctx, input.ticketNumber, {
      ...TICKET_CARD_SELECT,
      history: {
        orderBy: { createdAt: "desc" },
        take: limit,
        select: { action: true, oldValue: true, newValue: true, createdAt: true, user: { select: { name: true } } },
      },
    });
    await ctx.audit("TOOL_TICKET_HISTORY", "Ticket", t.ticketNumber, "SUCCESS");
    return { ticket: toTicketCard(t), entries: t.history.map(toHistoryEntry) };
  },
};

const getAuthorizedTicketComments = {
  name: "get_authorized_ticket_comments",
  description: "Public comments (newest first) on one authorized ticket. Internal notes are never returned.",
  inputSchema: { ticketNumber: ticketRefRule, limit: { type: "int", min: 1, max: 20 } },
  async run(ctx, input) {
    const limit = input.limit || 5;
    const t = await loadAuthorizedTicket(ctx, input.ticketNumber, {
      ...TICKET_CARD_SELECT,
      _count: { select: { comments: { where: { isInternal: false } } } },
      comments: { where: { isInternal: false }, orderBy: { createdAt: "desc" }, take: limit, select: { body: true, createdAt: true, author: { select: { name: true } } } },
    });
    await ctx.audit("TOOL_TICKET_COMMENTS", "Ticket", t.ticketNumber, "SUCCESS");
    return {
      ticket: toTicketCard(t),
      total: t._count?.comments ?? (t.comments || []).length,
      comments: (t.comments || []).map((c) => ({ author: c.author?.name || null, at: c.createdAt ? new Date(c.createdAt).toISOString() : null, text: toPlainText(c.body, 300) })),
    };
  },
};

const getAuthorizedTicketAttachments = {
  name: "get_authorized_ticket_attachments",
  description: "File names, sizes and upload dates of the attachments on one authorized ticket (never paths or contents).",
  inputSchema: { ticketNumber: ticketRefRule },
  async run(ctx, input) {
    const t = await loadAuthorizedTicket(ctx, input.ticketNumber, {
      ...TICKET_CARD_SELECT,
      attachments: { orderBy: { createdAt: "desc" }, take: 20, select: { fileName: true, fileSize: true, createdAt: true, uploadedBy: { select: { name: true } } } },
    });
    await ctx.audit("TOOL_TICKET_ATTACHMENTS", "Ticket", t.ticketNumber, "SUCCESS");
    return {
      ticket: toTicketCard(t),
      attachments: (t.attachments || []).map((a) => ({ fileName: toPlainText(a.fileName, 120), sizeKb: Math.max(1, Math.round((a.fileSize || 0) / 1024)), uploadedBy: a.uploadedBy?.name || null, at: a.createdAt ? new Date(a.createdAt).toISOString() : null })),
    };
  },
};

// The explanation recorded for a ticket's current status: why it was resolved / closed / put on hold, or the
// reopen note. The app keeps the LATEST of each on the ticket itself (resolutionNotes, closedReason,
// onHoldReason) and every occurrence in TicketHistory. A reopen has no field of its own (the Reopen button
// records only the status change), so a note is read from the "Reopened: ..." comment the assistant adds.
const REASON_LABELS = { RESOLVED: "Resolution notes", CLOSED: "Closed reason", ON_HOLD: "On-hold reason", REOPENED: "Reopened reason" };
const REASON_FIELD = { RESOLVED: "resolutionNotes", CLOSED: "closedReason", ON_HOLD: "onHoldReason" };

const REASON_SELECT = {
  status: true,
  resolutionNotes: true,
  closedReason: true,
  onHoldReason: true,
  reopenedReason: true,
  comments: { where: { isInternal: false, body: { startsWith: "Reopened:" } }, orderBy: { createdAt: "desc" }, take: 1, select: { body: true, createdAt: true, author: { select: { name: true } } } },
};

function currentReason(t) {
  if (t.status === "REOPENED" && t.reopenedReason) return { label: REASON_LABELS.REOPENED, text: toPlainText(t.reopenedReason, 400), by: null, at: null };
  if (t.status === "REOPENED") {
    // Older reopens (before the reason was stored) may have left a "Reopened: ..." comment.
    const c = t.comments?.[0];
    return { label: REASON_LABELS.REOPENED, text: c ? toPlainText(String(c.body).replace(/^Reopened:\s*/i, ""), 400) : null, by: c?.author?.name || null, at: c?.createdAt ? new Date(c.createdAt).toISOString() : null };
  }
  const field = REASON_FIELD[t.status];
  return field ? { label: REASON_LABELS[t.status], text: t[field] ? toPlainText(t[field], 400) : null, by: null, at: null } : null;
}

const getAuthorizedTicketReasons = {
  name: "get_authorized_ticket_reasons",
  description: "The recorded resolution notes / closed / on-hold reasons (each occurrence, newest first) and the reopen note of one authorized ticket.",
  inputSchema: { ticketNumber: ticketRefRule },
  async run(ctx, input) {
    const t = await loadAuthorizedTicket(ctx, input.ticketNumber, {
      ...TICKET_CARD_SELECT,
      ...REASON_SELECT,
      history: {
        where: { action: { in: ["RESOLUTION_NOTES", "CLOSED_REASON", "ON_HOLD_REASON", "REOPENED_REASON"] } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { action: true, newValue: true, createdAt: true, user: { select: { name: true } } },
      },
    });
    await ctx.audit("TOOL_TICKET_REASONS", "Ticket", t.ticketNumber, "SUCCESS");
    const label = { RESOLUTION_NOTES: REASON_LABELS.RESOLVED, CLOSED_REASON: REASON_LABELS.CLOSED, ON_HOLD_REASON: REASON_LABELS.ON_HOLD, REOPENED_REASON: REASON_LABELS.REOPENED };
    return {
      ticket: toTicketCard(t),
      current: currentReason(t),
      reopened: t.reopenedReason || t.comments?.[0] ? currentReason({ status: "REOPENED", reopenedReason: t.reopenedReason, comments: t.comments }) : null,
      history: (t.history || []).map((h) => ({ kind: h.action, label: label[h.action], text: toPlainText(h.newValue, 400), by: h.user?.name || null, at: h.createdAt ? new Date(h.createdAt).toISOString() : null })),
    };
  },
};

const getAuthorizedTicketStatistics = {
  name: "get_authorized_ticket_statistics",
  description: "Counts and short-term trends over the caller's authorized tickets.",
  inputSchema: { scope: { type: "enum", values: ["mine", "staff"] } },
  async run(ctx, input) {
    const scopeName = input.scope || "mine";
    const base = baseWhere(ctx, scopeName);
    const now = Date.now();
    const since = (days) => ({ createdAt: { gte: new Date(now - days * DAY_MS) } });

    const [byStatus, byPriority, unassigned, inactive7, last7, prev7, last30] = await Promise.all([
      prisma.ticket.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
      prisma.ticket.groupBy({ by: ["priorityId"], where: base, _count: { _all: true } }),
      prisma.ticket.count({ where: { AND: [base, { assigneeId: null, status: { in: OPEN_STATUSES } }] } }),
      prisma.ticket.count({ where: { AND: [base, { status: { in: OPEN_STATUSES }, updatedAt: { lt: new Date(now - 7 * DAY_MS) } }] } }),
      prisma.ticket.count({ where: { AND: [base, since(7)] } }),
      prisma.ticket.count({ where: { AND: [base, { createdAt: { gte: new Date(now - 14 * DAY_MS), lt: new Date(now - 7 * DAY_MS) } }] } }),
      prisma.ticket.count({ where: { AND: [base, since(30)] } }),
    ]);

    const priorities = await prisma.priority.findMany({ select: { id: true, name: true, level: true }, orderBy: { level: "desc" } });
    const nameById = new Map(priorities.map((p) => [p.id, p.name]));

    const statusCounts = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all]));
    const total = byStatus.reduce((n, r) => n + r._count._all, 0);
    await ctx.audit("TOOL_TICKET_STATISTICS", "Ticket", null, "SUCCESS");
    return {
      scope: scopeName,
      total,
      byStatus: statusCounts,
      byPriority: byPriority
        .map((r) => ({ priority: nameById.get(r.priorityId) || "Unknown", count: r._count._all }))
        .sort((a, b) => b.count - a.count),
      openUnassigned: unassigned,
      openInactiveOver7Days: inactive7,
      createdLast7Days: last7,
      createdPrevious7Days: prev7,
      createdLast30Days: last30,
    };
  },
};

module.exports = {
  tools: [searchAuthorizedTickets, getAuthorizedTicket, summarizeAuthorizedTicket, getAuthorizedTicketHistory, getAuthorizedTicketComments, getAuthorizedTicketAttachments, getAuthorizedTicketReasons, getAuthorizedTicketStatistics],
  OPEN_STATUSES,
  loadAuthorizedTicket,
  TICKET_REF_PATTERN,
  normalizeTicketNumber,
};
