// The ONE place every ticket email event computes its TO/CC recipients —
// see notification.service.js#notify (which actually sends) and every
// notify() call site in ticket.service.js (which now always goes through
// one of the two functions below instead of hand-building its own
// TO/CC arrays per event). Centralizing this is what makes "every active
// TEAMLEAD/MANAGER of the ticket's current department" and "the ticket's
// Custom CC list" mean exactly the same thing for all 10 events, rather
// than 10 slightly-divergent inline implementations.
//
// TEAMLEAD and MANAGER have DIFFERENT email priority (see the final role
// rules): a TEAMLEAD is the primary operational recipient (TO on creation,
// alongside the requester/assignee on every later event); a MANAGER is a
// department-management CC recipient — never TO on ticket creation, and
// never promoted to TO on later events either, unless they independently
// are the requester or assignee (which the TO-building logic below handles
// naturally, since it addresses the requester/assignee by id, not by role).
const prisma = require("../config/prisma");
const userDepartmentAccessService = require("../services/userDepartmentAccess.service");

async function getTicketCcUserIds(ticketId) {
  const rows = await prisma.ticketCC.findMany({ where: { ticketId }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

// TICKET_CREATED only:
//   TO = every ACTIVE TEAMLEAD with UserDepartmentAccess to the ticket's
//        selected department (never the old single derived manager)
//   CC = every ACTIVE MANAGER with UserDepartmentAccess to the ticket's
//        selected department, + the ticket's stored Custom CC users
// The requester is deliberately never in TO/CC here — they already know
// they just raised it; this is the notification TO the people who need to
// act on it. Managers are explicitly NEVER in TO for this event.
async function buildCreatedRecipients(ticket) {
  const [teamLeads, managers, ccUserIds] = await Promise.all([
    userDepartmentAccessService.getActiveDepartmentTeamLeads(ticket.toDepartmentId),
    userDepartmentAccessService.getActiveDepartmentManagers(ticket.toDepartmentId),
    getTicketCcUserIds(ticket.id),
  ]);
  return {
    userIds: teamLeads.map((u) => u.id),
    ccUserIds: [...new Set([...managers.map((u) => u.id), ...ccUserIds])],
  };
}

// Every event AFTER creation (ASSIGNED, REASSIGNED, STATUS_CHANGED,
// RESOLVED, REOPENED, COMMENT_ADDED, CLOSED, UPDATED, and
// DEPARTMENT_TRANSFERRED — called with the ticket's ALREADY-updated
// toDepartmentId/assigneeId, so "current department"/"current assignee"
// naturally mean the post-transfer state, and the OLD department's
// management users are never included):
//   TO = requester + current assignee (whichever of the two exist)
//   CC = every ACTIVE TEAMLEAD + every ACTIVE MANAGER of the ticket's
//        CURRENT department + the ticket's stored Custom CC users
// A Manager/Team Lead is only ever in TO here because they independently
// ARE the requester or assignee (e.g. they raised the ticket themselves) —
// never merely because of their department-management role, which is a CC-
// only position for every one of these events.
// `to` takes precedence over `cc` when the final email addresses are
// resolved/deduped — see notification.service.js#notify/resolveCcEmails.
async function buildStandardRecipients(ticket) {
  const [teamLeads, managers, ticketCcUserIds] = await Promise.all([
    userDepartmentAccessService.getActiveDepartmentTeamLeads(ticket.toDepartmentId),
    userDepartmentAccessService.getActiveDepartmentManagers(ticket.toDepartmentId),
    getTicketCcUserIds(ticket.id),
  ]);
  const userIds = [ticket.requesterId, ticket.assigneeId].filter(Boolean);
  const ccUserIds = [...new Set([...teamLeads.map((u) => u.id), ...managers.map((u) => u.id), ...ticketCcUserIds])];
  return { userIds, ccUserIds };
}

// TICKET_ASSIGNED and TICKET_COMMENT_ADDED share this SAME, different-from-
// the-standard-shape recipient rule (every other event keeps
// buildStandardRecipients above, untouched):
//   TO = the current assigned EMPLOYEE ONLY (empty/absent if unassigned —
//        never invented, never promoted from CC; per
//        notification.service.js#notify's existing behavior, an empty TO
//        means no email is sent for that event at all, which is the
//        intentional, accepted outcome here rather than something to work
//        around)
//   CC = the requester + every ACTIVE TEAMLEAD + every ACTIVE MANAGER of
//        the ticket's CURRENT department + the ticket's stored Custom CC
//        users
// Notably the requester is NEVER in TO here (unlike buildStandardRecipients,
// where they are) — they move to CC instead. Whoever performed the action
// (assigned the ticket, or wrote the comment) gets no special TO/CC
// treatment beyond whatever role-based group they already belong to — e.g.
// a Manager who writes a comment is included only because they're an active
// Manager of this department, exactly as if they hadn't written anything.
async function buildAssignedOrCommentRecipients(ticket) {
  const [teamLeads, managers, ticketCcUserIds] = await Promise.all([
    userDepartmentAccessService.getActiveDepartmentTeamLeads(ticket.toDepartmentId),
    userDepartmentAccessService.getActiveDepartmentManagers(ticket.toDepartmentId),
    getTicketCcUserIds(ticket.id),
  ]);
  const userIds = ticket.assigneeId ? [ticket.assigneeId] : [];
  const ccUserIds = [
    ...new Set(
      [ticket.requesterId, ...teamLeads.map((u) => u.id), ...managers.map((u) => u.id), ...ticketCcUserIds].filter(Boolean)
    ),
  ];
  return { userIds, ccUserIds };
}

module.exports = { buildCreatedRecipients, buildStandardRecipients, buildAssignedOrCommentRecipients, getTicketCcUserIds };
