const ticketService = require("../services/ticket.service");
const { permissionsFor } = require("./permissions");

// Single place where the chatbot turns the AUTHENTICATED user (req.user, set
// by middleware/auth.js from the verified JWT + a fresh DB read) into a ticket
// scope. It delegates to ticket.service's own scope functions so the chatbot
// can never see more (or fewer) tickets than the portal itself shows — there
// is deliberately no chatbot-specific copy of the access rules.
//
// Nothing in here reads a role from a request body/query: `user` is only ever
// req.user.
async function resolveRoleScope(user) {
  const role = user.role.name;
  const departmentIds = await ticketService.resolveUserDepartmentIds(user);
  return Object.freeze({
    user,
    userId: user.id,
    role,
    departmentIds,
    // Derived from the authenticated role on the server (see permissions.js); never client-supplied.
    permissions: permissionsFor(role),
    isManagement: ticketService.isManagementRole(user),
    isAdmin: role === "ADMIN",
  });
}

// Prisma `where` for "every ticket this user may view".
function authorizedWhere(scope) {
  return ticketService.scopeWhereForTab(scope.user, "authorized", scope.departmentIds);
}

// Tickets raised by OR assigned to the user (same OR shape the portal uses).
function mineWhere(scope) {
  return ticketService.scopeWhereForTab(scope.user, "mine", scope.departmentIds);
}

// Department/team/system view: ADMIN -> everything, MANAGER/TEAMLEAD -> their
// UserDepartmentAccess departments. Never called for EMPLOYEE (the tool layer
// rejects that first).
function staffScopeWhere(scope) {
  return ticketService.scopeWhereForTab(scope.user, undefined, scope.departmentIds);
}

const PORTALS = {
  ADMIN: { key: "admin", name: "Admin Portal", home: "/admin" },
  MANAGER: { key: "manager", name: "Manager Portal", home: "/agent" },
  TEAMLEAD: { key: "team-lead", name: "Team Lead Portal", home: "/agent" },
  EMPLOYEE: { key: "employee", name: "Employee Portal", home: "/portal" },
};

function portalFor(role) {
  return PORTALS[role] || null;
}

module.exports = { resolveRoleScope, authorizedWhere, mineWhere, staffScopeWhere, portalFor, PORTALS };
