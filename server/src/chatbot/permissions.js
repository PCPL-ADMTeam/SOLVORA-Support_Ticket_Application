// Permission identifiers for the chatbot, and the DENY-BY-DEFAULT tool matrix.
//
// This application has NO granular permission table: authorization is the
// user's role plus row-level scope (department access / raised-by / assigned-to,
// enforced in ticket.service). The identifiers below are therefore DERIVED from
// the authenticated role on the server (never accepted from the browser, the
// model or the message) so each tool can state, and check, what it requires.
// The spec's "TEAM_LEAD" is this application's role name TEAMLEAD.
//
// Deliberately not granted, because the application's own services refuse it
// (and the chatbot must not weaken them):
//   ADMIN  tickets.create.all, tickets.assign.all  ("Administrators cannot raise
//          tickets"; assignment is Manager/Team Lead only)

const ROLE_PERMISSIONS = {
  ADMIN: [
    "chat.use",
    "tickets.read.all", "tickets.update.all", "tickets.close.all", "tickets.reopen.all", "tickets.comment.accessible",
    "users.read.all", "users.create", "users.update.all", "users.activate", "users.deactivate",
    "roles.read", "roles.assign", "roles.change",
    "departments.read.all", "departments.update", "departments.members.read.all", "departments.members.assign",
    "departments.manager.assign", "departments.teamLead.assign",
    "dashboard.read.self", "notifications.read.self", "notifications.manage.self",
  ],
  MANAGER: [
    "chat.use",
    "tickets.create.self", "tickets.read.allocatedDepartments", "tickets.update.allocatedDepartments", "tickets.assign.allocatedDepartments",
    "tickets.close.allocatedDepartments", "tickets.reopen.allocatedDepartments", "tickets.comment.accessible",
    "users.read.allocatedDepartments", "departments.read.allocated",
    "dashboard.read.self", "notifications.read.self", "notifications.manage.self",
  ],
  TEAMLEAD: [
    "chat.use",
    "tickets.create.self", "tickets.read.allocatedDepartments", "tickets.update.allocatedDepartments", "tickets.assign.allocatedDepartments",
    "tickets.close.allocatedDepartments", "tickets.reopen.allocatedDepartments", "tickets.comment.accessible",
    "users.read.allocatedDepartments", "departments.read.allocated",
    "dashboard.read.self", "notifications.read.self", "notifications.manage.self",
  ],
  EMPLOYEE: [
    "chat.use",
    "tickets.create.self", "tickets.read.raisedBySelf", "tickets.read.assignedToSelf", "tickets.update.assignedToSelf",
    "tickets.comment.accessible", "tickets.attach.accessible", "tickets.close.accessible", "tickets.reopen.accessible",
    "departments.read.own",
    "dashboard.read.self", "notifications.read.self", "notifications.manage.self",
  ],
};

const permissionsFor = (role) => [...(ROLE_PERMISSIONS[role] || [])];

// "*" = any authenticated user with the chat.use permission (harmless reference data).
// An array = ANY of these permissions suffices. A role that is not listed is DENIED.
const READ_TICKETS = {
  ADMIN: ["tickets.read.all"],
  MANAGER: ["tickets.read.allocatedDepartments"],
  TEAMLEAD: ["tickets.read.allocatedDepartments"],
  EMPLOYEE: ["tickets.read.raisedBySelf", "tickets.read.assignedToSelf"],
};
const STAFF_TICKETS = { ADMIN: ["tickets.read.all"], MANAGER: ["tickets.read.allocatedDepartments"], TEAMLEAD: ["tickets.read.allocatedDepartments"] };
const SELF = (permission) => ({ ADMIN: [permission], MANAGER: [permission], TEAMLEAD: [permission], EMPLOYEE: [permission] });
const ALL = { ADMIN: "*", MANAGER: "*", TEAMLEAD: "*", EMPLOYEE: "*" };

const TOOL_POLICY = {
  get_current_user: ALL,
  get_portal_capabilities: ALL,
  get_profile_summary: ALL,
  get_navigation_steps: ALL,
  get_knowledge_article: ALL,
  get_status_definition: ALL,
  get_priority_definition: ALL,
  get_sla_information: ALL,
  list_departments: { ADMIN: ["departments.read.all"], MANAGER: ["departments.read.allocated"], TEAMLEAD: ["departments.read.allocated"], EMPLOYEE: ["departments.read.own"] },
  get_department_members: { ADMIN: ["departments.members.read.all"], MANAGER: ["users.read.allocatedDepartments"], TEAMLEAD: ["users.read.allocatedDepartments"] },
  search_authorized_tickets: READ_TICKETS,
  get_authorized_ticket: READ_TICKETS,
  summarize_authorized_ticket: READ_TICKETS,
  get_authorized_ticket_history: READ_TICKETS,
  get_authorized_ticket_statistics: READ_TICKETS,
  get_authorized_ticket_comments: READ_TICKETS,
  get_authorized_ticket_attachments: READ_TICKETS,
  get_authorized_ticket_reasons: READ_TICKETS,
  // Always the authenticated user's OWN dashboard numbers / notifications.
  get_my_dashboard: SELF("dashboard.read.self"),
  get_my_notifications: SELF("notifications.read.self"),
  get_tickets_by_department: STAFF_TICKETS,
  get_weekly_report: STAFF_TICKETS,
  get_department_headcount: { ADMIN: ["departments.members.read.all"] },
  get_manager_assignments: { ADMIN: ["departments.members.read.all"] },
  get_users_by_role: { ADMIN: ["roles.read"] },
  get_user_summary: { ADMIN: ["users.read.all"] },
};

// Required permission(s) for the WRITE actions (checked at preview AND again at
// confirmation). A role not listed is denied.
const ACTION_POLICY = {
  create_department: { ADMIN: ["departments.update"] },
  rename_department: { ADMIN: ["departments.update"] },
  grant_department_role: { ADMIN: ["departments.manager.assign", "departments.teamLead.assign"] },
  revoke_department_role: { ADMIN: ["departments.manager.assign", "departments.teamLead.assign"] },
  move_user_department: { ADMIN: ["departments.members.assign"] },
  add_employee: { ADMIN: ["users.create"] },
  rename_user: { ADMIN: ["users.update.all"] },
  deactivate_user: { ADMIN: ["users.deactivate"] },
  activate_user: { ADMIN: ["users.activate"] },
  change_user_role: { ADMIN: ["roles.change"] },
  raise_ticket_from_draft: { MANAGER: ["tickets.create.self"], TEAMLEAD: ["tickets.create.self"], EMPLOYEE: ["tickets.create.self"] },
  // Starting the conversation is allowed for the same roles that may raise a ticket.
  create_ticket: { MANAGER: ["tickets.create.self"], TEAMLEAD: ["tickets.create.self"], EMPLOYEE: ["tickets.create.self"] },
  change_ticket_priority: { ADMIN: ["tickets.update.all"], MANAGER: ["tickets.update.allocatedDepartments"], TEAMLEAD: ["tickets.update.allocatedDepartments"] },
  change_ticket_status: { ADMIN: ["tickets.update.all"], MANAGER: ["tickets.update.allocatedDepartments"], TEAMLEAD: ["tickets.update.allocatedDepartments"], EMPLOYEE: ["tickets.update.assignedToSelf"] },
  assign_ticket: { MANAGER: ["tickets.assign.allocatedDepartments"], TEAMLEAD: ["tickets.assign.allocatedDepartments"] },
  close_ticket: { ADMIN: ["tickets.close.all"], MANAGER: ["tickets.close.allocatedDepartments"], TEAMLEAD: ["tickets.close.allocatedDepartments"], EMPLOYEE: ["tickets.close.accessible"] },
  reopen_ticket: { ADMIN: ["tickets.reopen.all"], MANAGER: ["tickets.reopen.allocatedDepartments"], TEAMLEAD: ["tickets.reopen.allocatedDepartments"], EMPLOYEE: ["tickets.reopen.accessible"] },
  mark_all_notifications_read: SELF("notifications.manage.self"),
  mark_notification_read: SELF("notifications.manage.self"),
  clear_notifications: SELF("notifications.manage.self"),
  transfer_ticket: { MANAGER: ["tickets.update.allocatedDepartments"], TEAMLEAD: ["tickets.update.allocatedDepartments"], EMPLOYEE: ["tickets.update.assignedToSelf"] },
  add_ticket_comment: { ADMIN: ["tickets.comment.accessible"], MANAGER: ["tickets.comment.accessible"], TEAMLEAD: ["tickets.comment.accessible"], EMPLOYEE: ["tickets.comment.accessible"] },
};

function allowedBy(policy, role, granted) {
  const need = policy?.[role];
  if (!need) return false; // deny by default
  if (need === "*") return granted.includes("chat.use");
  return need.some((p) => granted.includes(p));
}

const toolAllowed = (name, role, granted) => allowedBy(TOOL_POLICY[name], role, granted);
const actionAllowed = (name, role, granted) => allowedBy(ACTION_POLICY[name], role, granted);
const actionRoles = (name) => Object.keys(ACTION_POLICY[name] || {});

module.exports = { ROLE_PERMISSIONS, permissionsFor, TOOL_POLICY, ACTION_POLICY, toolAllowed, actionAllowed, actionRoles };
