// Ticket row-level access rules, shared by ticket.service.js (list queries
// and single-ticket checks). Pure functions only — no Prisma, no
// sanitize-html — so they can be unit-tested directly (see
// services/__tests__/ticketAccess.test.js).
//
// Access levels for a single ticket (resolveTicketAccess):
//   "full"           — the existing operational access (assertCanView in
//                      ticket.service.js): ADMIN, a MANAGER/TEAMLEAD with
//                      UserDepartmentAccess to the ticket's department, or
//                      the ticket's requester/assignee. Every mutating
//                      action still requires this, unchanged.
//   "participant"    — may VIEW the ticket (internal notes stripped) and add
//                      a PUBLIC comment, nothing else. Granted to an EMPLOYEE
//                      whose department is the ticket's department
//                      (Department Tickets), and to any user on the
//                      ticket's Custom CC list (TicketCC).
//   "requester-read" — the pre-existing read-only exception for a
//                      MANAGER/TEAMLEAD who raised a ticket now routed to a
//                      department they don't manage (view only).
//   null             — no access.

function isManagementRole(user) {
  return user.role.name === "MANAGER" || user.role.name === "TEAMLEAD";
}

// Never matches any ticket — used when a scope has no valid department.
const MATCH_NOTHING = { id: "" };

// Row-level authorization: what tickets can this user even see/act on.
// ADMIN -> everything (view only — see the operational checks in
// ticket.service.js for why ADMIN never reaches assign/reassign/transfer).
// MANAGER/TEAMLEAD -> every ticket routed to ANY department they currently
// have UserDepartmentAccess to. EMPLOYEE -> tickets they raised, or that
// they've been assigned to work on. Used both for list filtering and as the
// default list scope.
function scopeWhereForUser(user, userDepartmentIds = []) {
  if (user.role.name === "ADMIN") return {};
  if (isManagementRole(user)) {
    // No accessible department => no tickets, rather than matching everything.
    return userDepartmentIds.length ? { toDepartmentId: { in: userDepartmentIds } } : MATCH_NOTHING;
  }
  return { OR: [{ requesterId: user.id }, { assigneeId: user.id }] };
}

// An EMPLOYEE's department is the server-side User.departmentId (the
// authoritative field for this role — see ticket.service.js#
// resolveFromDepartmentId); MANAGER/TEAMLEAD departments come from
// UserDepartmentAccess (userDepartmentIds). Never a client-supplied id.
function departmentScopeWhere(user, userDepartmentIds = []) {
  if (user.role.name === "EMPLOYEE") {
    return user.departmentId ? { toDepartmentId: user.departmentId } : MATCH_NOTHING;
  }
  return scopeWhereForUser(user, userDepartmentIds);
}

// Tickets on which this user is a Custom CC recipient.
function ccScopeWhere(user) {
  return { ccUsers: { some: { userId: user.id } } };
}

// Maps a ticket-list tab's `scope` to its authorization filter. Every scope
// is built from the caller's own server-side identity; filters from the
// query string are only ever ANDed on top of it (see listTickets).
function scopeWhereForTab(user, scope, userDepartmentIds = []) {
  if (scope === "assigned") return { assigneeId: user.id };
  if (scope === "created") return { requesterId: user.id };
  // "mine" = raised by me OR assigned to me, as ONE query so a ticket
  // matching both is never double counted.
  if (scope === "mine") return { OR: [{ requesterId: user.id }, { assigneeId: user.id }] };
  // "department" = Department Tickets: an EMPLOYEE's own department, or a
  // MANAGER/TEAMLEAD's accessible departments (same as their default).
  if (scope === "department") return departmentScopeWhere(user, userDepartmentIds);
  // "authorized" = global search: everything the caller may VIEW — their
  // normal scope, plus tickets they personally raised (MANAGER/TEAMLEAD
  // requester-read exception), their department's tickets (EMPLOYEE), and
  // tickets they are Custom CC'd on.
  if (scope === "authorized") {
    if (user.role.name === "ADMIN") return {};
    if (isManagementRole(user)) {
      return { OR: [scopeWhereForUser(user, userDepartmentIds), { requesterId: user.id }, ccScopeWhere(user)] };
    }
    return { OR: [scopeWhereForUser(user, userDepartmentIds), departmentScopeWhere(user, userDepartmentIds), ccScopeWhere(user)] };
  }
  return scopeWhereForUser(user, userDepartmentIds);
}

// The existing operational check (what assertCanView enforces), as a
// boolean.
function hasFullTicketAccess(user, ticket, userDepartmentIds = []) {
  if (user.role.name === "ADMIN") return true;
  if (isManagementRole(user)) {
    return Boolean(ticket.toDepartmentId) && userDepartmentIds.includes(ticket.toDepartmentId);
  }
  return ticket.requesterId === user.id || ticket.assigneeId === user.id;
}

function isDepartmentEmployeeViewer(user, ticket) {
  return user.role.name === "EMPLOYEE" && Boolean(user.departmentId) && ticket.toDepartmentId === user.departmentId;
}

// `isCcUser` must come from a server-side TicketCC lookup for THIS ticket
// and THIS authenticated user — never from the request.
function resolveTicketAccess(user, ticket, { userDepartmentIds = [], isCcUser = false } = {}) {
  if (hasFullTicketAccess(user, ticket, userDepartmentIds)) return "full";
  if (isCcUser || isDepartmentEmployeeViewer(user, ticket)) return "participant";
  if (isManagementRole(user) && ticket.requesterId === user.id) return "requester-read";
  return null;
}

// View ticket details + public comments.
function canViewTicket(access) {
  return access === "full" || access === "participant" || access === "requester-read";
}

// Add a PUBLIC comment (and its attachments), or download a public attachment.
function canParticipate(access) {
  return access === "full" || access === "participant";
}

module.exports = {
  isManagementRole,
  scopeWhereForUser,
  departmentScopeWhere,
  ccScopeWhere,
  scopeWhereForTab,
  hasFullTicketAccess,
  isDepartmentEmployeeViewer,
  resolveTicketAccess,
  canViewTicket,
  canParticipate,
};
