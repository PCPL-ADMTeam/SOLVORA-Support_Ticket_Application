const knowledge = require("../knowledge");
const { intentForArticle } = require("../intents/router");

// SERVER-OWNED allow-list of intents the AI interpreter may select.
//
// The model chooses an `id` and fills text references; it never defines
// intents, permissions, tools or schemas. Each entry maps onto an EXISTING
// handler (intents/handlers.js) or admin action (actions/registry.js), so a
// rule-matched and an AI-matched request end up in the same secured tool.
//
// Fields
//   roles         portals/roles allowed. This application has no granular
//                 permission table, so "required permission" = this role set
//                 plus the existing row-level scope rules enforced inside tools.
//   readOnly/risk classification; every write is `preview_confirm`.
//   params        allowed parameter names (all others are rejected)
//   required      fields that must be present or the user is asked
//   entities      which references the BACKEND must resolve to ids (the model
//                 never supplies ids)
//   route(p, ctx) -> { intent, params } for handlers.handlerFor(...)
//   rule / ai     whether the rule engine / AI interpreter may produce it

const ALL = ["ADMIN", "MANAGER", "TEAMLEAD", "EMPLOYEE"];
const STAFF = ["ADMIN", "MANAGER", "TEAMLEAD"];
const ADMIN = ["ADMIN"];

// Every parameter the interpreter may ever return (flat, nullable). Types are
// enforced again server-side in intentSchemas.js.
const PARAMS = {
  userReference: { type: "string", max: 80, description: "A person's name or email exactly as written." },
  departmentReference: { type: "string", max: 80, description: "A department name as written." },
  ticketReference: { type: "string", max: 24, description: "A ticket number as written, e.g. 2627001." },
  priorityReference: { type: "string", max: 40, description: "A priority name as written, e.g. High or Critical." },
  roleName: { type: "enum", values: ["MANAGER", "TEAMLEAD", "EMPLOYEE"], description: "A role." },
  newName: { type: "string", max: 80, description: "A new name for a department or person." },
  reason: { type: "string", max: 300, description: "A reason text." },
  searchText: { type: "string", max: 100, description: "Words to search ticket titles/summaries for." },
  statusFilter: { type: "enum", values: ["open", "pending", "any"], description: "Ticket status group." },
  ranking: { type: "enum", values: ["most_open", "most_total", "fewest_open"], description: "Rank departments by tickets." },
  ticketStatus: { type: "enum", values: ["OPEN", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED", "REOPENED"], description: "An exact ticket status." },
  assignedTo: { type: "string", max: 80, description: "The name of the person a ticket is assigned to." },
  raisedBy: { type: "string", max: 80, description: "The name of the person who raised a ticket." },
  dateFrom: { type: "string", max: 10, description: "Earliest creation date, YYYY-MM-DD." },
  dateTo: { type: "string", max: 10, description: "Latest creation date, YYYY-MM-DD." },
  allDepartments: { type: "enum", values: ["yes"], description: "yes when the user means every department." },
  title: { type: "string", max: 200, description: "A short ticket subject." },
  description: { type: "string", max: 600, description: "A ticket description of up to 50 words." },
  comment: { type: "string", max: 600, description: "Comment text to add to a ticket." },
  assigneeReference: { type: "string", max: 80, description: "The name of the person to assign a ticket to." },
  emailAddress: { type: "string", max: 150, description: "An email address exactly as written." },
  statusValue: { type: "enum", values: ["IN_PROGRESS", "ON_HOLD", "RESOLVED", "OPEN"], description: "The ticket status to set." },
  topic: { type: "string", max: 120, description: "A portal feature or help topic in the user's words." },
};

const guidanceFor = (ids) => (p, ctx) => {
  const id = ids.find((i) => knowledge.getArticle(i, ctx.role));
  return id ? { intent: intentForArticle(id), params: { articleId: id } } : null;
};

const topicArticle = (p, ctx) => {
  const a = knowledge.searchArticles(p.topic || "", ctx.role, 1)[0];
  return a ? { intent: intentForArticle(a.id), params: { articleId: a.id } } : null;
};

const act = (action, map = (p) => p) => (p) => ({ intent: "admin_action", params: { parsed: { action, args: map(p) } } });
const redirect = (key) => () => ({ intent: "admin_redirect", params: { key } });

const SCOPE = (ctx) => (ctx.role === "EMPLOYEE" ? "mine" : "staff");

const DEFS = [
  // ---- common guidance -----------------------------------------------------
  { id: "PROFILE_GUIDANCE", description: "How to view or open my profile.", examples: ["where is my profile"], roles: ALL, params: [], route: () => ({ intent: "view_profile", params: {} }) },
  { id: "PROFILE_UPDATE_GUIDANCE", description: "How to edit my own profile or name.", examples: ["how can I edit my profile"], roles: ALL, params: [], route: guidanceFor(["common.update-profile"]) },
  { id: "PASSWORD_CHANGE_GUIDANCE", description: "How to change my own password.", examples: ["how do I change my password"], roles: ALL, params: [], route: guidanceFor(["common.change-password"]) },
  { id: "PORTAL_NAVIGATION", description: "How to use a portal feature or find a page; put the feature in `topic`.", examples: ["where do I manage priorities"], roles: ALL, params: ["topic"], required: ["topic"], route: topicArticle },
  { id: "EXPLAIN_TICKET_STATUS", description: "Explain what the ticket statuses mean.", examples: ["what does on hold mean"], roles: ALL, params: [], route: guidanceFor(["common.ticket-status"]) },
  { id: "EXPLAIN_PRIORITY", description: "Explain ticket priorities.", examples: ["what priorities exist"], roles: ALL, params: [], route: guidanceFor(["common.ticket-priority"]) },
  { id: "EXPLAIN_SLA", description: "Explain SLA (this app does not track SLAs).", examples: ["how does SLA work"], roles: ALL, params: [], route: guidanceFor(["common.sla"]) },
  { id: "EXPLAIN_ESCALATION", description: "Explain escalation (this app has no escalation feature).", examples: ["how does escalation work"], roles: ALL, params: [], route: guidanceFor(["common.escalation"]) },
  { id: "EXPLAIN_NOTIFICATIONS", description: "Explain notifications and emails.", examples: ["how do notifications work"], roles: ALL, params: [], route: guidanceFor(["common.notifications"]) },
  { id: "CREATE_TICKET_GUIDANCE", description: "How to create or raise a ticket.", examples: ["how do I raise a ticket"], roles: ALL, params: [], route: guidanceFor(["employee.create-ticket", "agent.create-ticket"]) },
  { id: "ATTACHMENT_GUIDANCE", description: "How to attach a file to a ticket.", examples: ["how do I attach a file"], roles: ALL, params: [], route: guidanceFor(["common.attachments"]) },
  { id: "ASSIGN_TICKET_GUIDANCE", description: "How ticket assignment works.", examples: ["how do I assign a ticket"], roles: ALL, params: [], route: guidanceFor(["agent.assignment", "employee.assignment", "admin.assignment"]) },

  // ---- ticket reads (scope is decided by the server from the caller's role) ---
  { id: "MY_OPEN_TICKETS", description: "List the caller's own open tickets.", examples: ["what issues of mine are still open"], roles: ALL, params: [], route: () => ({ intent: "list_tickets", params: { scope: "mine", filter: "open", title: "Open tickets" } }) },
  { id: "MY_PENDING_TICKETS", description: "List the caller's own tickets that are on hold / pending.", examples: ["which of my tickets are waiting"], roles: ALL, params: [], route: () => ({ intent: "list_tickets", params: { scope: "mine", filter: "pending", title: "Pending (on hold) tickets" } }) },
  {
    id: "SEARCH_TICKETS",
    description: "Find tickets in the caller's authorized scope by words, priority, department or status group.",
    examples: ["display critical tickets assigned to Finance", "find tickets about printer"],
    roles: ALL,
    params: ["searchText", "priorityReference", "departmentReference", "statusFilter", "ticketStatus", "assignedTo", "raisedBy", "dateFrom", "dateTo"],
    entities: { priorityReference: "priority", departmentReference: "department" },
    route: (p, ctx) => ({ intent: "search_tickets", params: { scope: SCOPE(ctx), filter: p.statusFilter || "any", text: p.searchText, priority: p.priorityReference, department: p.departmentReference, status: p.ticketStatus, assignedTo: p.assignedTo, raisedBy: p.raisedBy, dateFrom: p.dateFrom, dateTo: p.dateTo, title: "Matching tickets" } }),
  },
  { id: "GET_TICKET", description: "Show one ticket by its number.", examples: ["open ticket 2627001"], roles: ALL, params: ["ticketReference"], required: ["ticketReference"], entities: { ticketReference: "ticket" }, route: (p) => ({ intent: "find_ticket", params: { ticketNumber: p.ticketReference } }) },
  { id: "SUMMARIZE_TICKET", description: "Summarize one ticket by number.", examples: ["summarize ticket 2627001", "give me the gist of ticket 2627001"], roles: ALL, params: ["ticketReference"], required: ["ticketReference"], entities: { ticketReference: "ticket" }, route: (p) => ({ intent: "summarize_ticket", params: { ticketNumber: p.ticketReference } }) },
  { id: "TICKET_HISTORY", description: "Show the recorded history of one ticket.", examples: ["what happened on ticket 2627001"], roles: ALL, params: ["ticketReference"], required: ["ticketReference"], entities: { ticketReference: "ticket" }, route: (p) => ({ intent: "ticket_history", params: { ticketNumber: p.ticketReference } }) },
  { id: "TICKET_PENDING_ACTIONS", description: "What is still pending on one ticket, from recorded data.", examples: ["what is left to do on ticket 2627001"], roles: ALL, params: ["ticketReference"], required: ["ticketReference"], entities: { ticketReference: "ticket" }, route: (p) => ({ intent: "pending_actions", params: { ticketNumber: p.ticketReference } }) },
  { id: "UNASSIGNED_TICKETS", description: "List open tickets that have no assignee.", examples: ["which tickets nobody owns"], roles: ALL, params: [], route: (p, ctx) => ({ intent: "list_tickets", params: { scope: SCOPE(ctx), filter: "unassigned", title: "Unassigned open tickets" } }) },
  { id: "STALE_TICKETS", description: "List open tickets with no update for 7 days.", examples: ["which tickets have gone quiet"], roles: ALL, params: [], route: (p, ctx) => ({ intent: "list_tickets", params: { scope: SCOPE(ctx), filter: "stale", staleDays: 7, title: "Open tickets with no update in 7 days" } }) },
  { id: "TICKET_STATISTICS", description: "Ticket counts by status/priority and short trends for the caller's scope.", examples: ["give me ticket numbers", "show ticket trends"], roles: ALL, params: [], route: (p, ctx) => ({ intent: "ticket_statistics", params: { word: ctx.role === "EMPLOYEE" ? "mine" : "department" } }) },
  {
    id: "DEPARTMENT_TICKET_SUMMARY",
    description: "Tickets and open tickets per department (department-wise breakdown); can rank departments.",
    examples: ["department-wise ticket breakdown", "how many open issues does each department have", "which department has the most unresolved tickets"],
    roles: STAFF,
    params: ["ranking"],
    route: (p) => ({ intent: "tickets_by_department", params: { rank: p.ranking } }),
  },
  { id: "WEEKLY_REPORT", description: "Ticket report for the last 7 days.", examples: ["generate the weekly report"], roles: STAFF, params: [], route: () => ({ intent: "weekly_report", params: {} }) },
  { id: "OVERDUE_TICKETS", description: "Overdue tickets (not tracked by this app).", examples: ["what is overdue"], roles: ALL, params: [], route: () => ({ intent: "overdue_tickets", params: {} }) },
  { id: "SLA_EXCEPTIONS", description: "SLA breaches / exceptions (not tracked by this app).", examples: ["show SLA breaches"], roles: ALL, params: [], route: () => ({ intent: "sla_approaching", params: {} }) },
  { id: "ESCALATED_TICKETS", description: "Escalated tickets (not tracked by this app).", examples: ["which tickets are escalated"], roles: ALL, params: [], route: () => ({ intent: "escalated_tickets", params: {} }) },

  // ---- admin reads --------------------------------------------------------------
  { id: "LIST_DEPARTMENTS", description: "List department names.", examples: ["what departments do we have"], roles: ALL, params: [], route: () => ({ intent: "list_departments", params: {} }) },
  {
    id: "DEPARTMENT_MEMBERS",
    description: "Names and roles of active people in a department (or every department).",
    examples: ["show active employees working in HR", "who works in Finance"],
    roles: ADMIN,
    params: ["departmentReference", "allDepartments"],
    entities: { departmentReference: "department" },
    route: (p) => ({ intent: "people_directory", params: { all: p.allDepartments === "yes", question: p.departmentReference || "" } }),
  },
  { id: "DEPARTMENT_HEADCOUNT", description: "Employees, managers and team leads per department (counts).", examples: ["employee count by department"], roles: ADMIN, params: [], route: () => ({ intent: "department_headcount", params: {} }) },
  { id: "USERS_BY_ROLE", description: "Active user counts per role.", examples: ["how many managers do we have"], roles: ADMIN, params: [], route: () => ({ intent: "users_by_role", params: {} }) },
  {
    id: "GET_MANAGER_ASSIGNMENTS",
    description: "Which managers and team leads manage departments; optionally one department.",
    examples: ["who manages the Support department", "show manager assignments"],
    roles: ADMIN,
    params: ["departmentReference"],
    entities: { departmentReference: "department" },
    route: (p) => ({ intent: "manager_assignments", params: { department: p.departmentReference } }),
  },
  { id: "GET_USER_SUMMARY", description: "Role, department and active status of one person (no contact details).", examples: ["who is Arun"], roles: ADMIN, params: ["userReference"], required: ["userReference"], entities: { userReference: "user" }, route: (p) => ({ intent: "user_summary", params: { user: p.userReference } }) },

  // ---- admin writes (always preview + Confirm) ------------------------------------
  { id: "CREATE_DEPARTMENT", description: "Create a new department.", examples: ["create a department called Legal"], roles: ADMIN, readOnly: false, risk: "medium", params: ["newName"], required: ["newName"], route: act("create_department", (p) => ({ name: p.newName })) },
  { id: "UPDATE_DEPARTMENT", description: "Rename a department.", examples: ["rename HR to People Ops"], roles: ADMIN, readOnly: false, risk: "medium", params: ["departmentReference", "newName"], required: ["departmentReference", "newName"], entities: { departmentReference: "department" }, route: act("rename_department", (p) => ({ department: p.departmentReference, newName: p.newName })) },
  { id: "UPDATE_USER", description: "Change a person's display name.", examples: ["change Ravi Kumar's name to Ravi K"], roles: ADMIN, readOnly: false, risk: "medium", params: ["userReference", "newName"], required: ["userReference", "newName"], entities: { userReference: "user" }, route: act("rename_user", (p) => ({ user: p.userReference, newName: p.newName })) },
  { id: "ACTIVATE_USER", description: "Activate a deactivated user account.", examples: ["re-enable Ravi"], roles: ADMIN, readOnly: false, risk: "medium", params: ["userReference"], required: ["userReference"], entities: { userReference: "user" }, route: act("activate_user", (p) => ({ user: p.userReference })) },
  { id: "DEACTIVATE_USER", description: "Deactivate a user account.", examples: ["disable Ravi's account"], roles: ADMIN, readOnly: false, risk: "high", params: ["userReference"], required: ["userReference"], entities: { userReference: "user" }, route: act("deactivate_user", (p) => ({ user: p.userReference })) },
  { id: "ASSIGN_ROLE", description: "Change a person's role to Manager, Team Lead or Employee.", examples: ["make Ravi a manager"], roles: ADMIN, readOnly: false, risk: "high", params: ["userReference", "roleName"], required: ["userReference", "roleName"], entities: { userReference: "user" }, route: act("change_user_role", (p) => ({ user: p.userReference, roleName: p.roleName })) },
  { id: "ASSIGN_USER_TO_DEPARTMENT", description: "Move a person to a department (their home department).", examples: ["add an employee to Finance", "move Ravi to Finance"], roles: ADMIN, readOnly: false, risk: "medium", params: ["userReference", "departmentReference"], required: ["userReference", "departmentReference"], entities: { userReference: "user", departmentReference: "department" }, route: act("move_user_department", (p) => ({ user: p.userReference, department: p.departmentReference })) },
  { id: "ASSIGN_MANAGER_TO_DEPARTMENT", description: "Make a Manager responsible for a department.", examples: ["assign Arun as the manager of Support"], roles: ADMIN, readOnly: false, risk: "high", params: ["userReference", "departmentReference"], required: ["userReference", "departmentReference"], entities: { userReference: "user", departmentReference: "department" }, route: act("grant_department_role", (p) => ({ user: p.userReference, department: p.departmentReference, role: "MANAGER" })) },
  { id: "ASSIGN_TEAM_LEAD_TO_DEPARTMENT", description: "Make a Team Lead responsible for a department.", examples: ["make Priya team lead of Finance"], roles: ADMIN, readOnly: false, risk: "high", params: ["userReference", "departmentReference"], required: ["userReference", "departmentReference"], entities: { userReference: "user", departmentReference: "department" }, route: act("grant_department_role", (p) => ({ user: p.userReference, department: p.departmentReference, role: "TEAMLEAD" })) },
  { id: "REMOVE_MANAGER_FROM_DEPARTMENT", description: "Remove a Manager's access to a department.", examples: ["Arun should no longer manage Support"], roles: ADMIN, readOnly: false, risk: "high", params: ["userReference", "departmentReference"], required: ["userReference", "departmentReference"], entities: { userReference: "user", departmentReference: "department" }, route: act("revoke_department_role", (p) => ({ user: p.userReference, department: p.departmentReference, role: "MANAGER" })) },
  { id: "REMOVE_TEAM_LEAD_FROM_DEPARTMENT", description: "Remove a Team Lead's access to a department.", examples: ["remove Priya as team lead of Finance"], roles: ADMIN, readOnly: false, risk: "high", params: ["userReference", "departmentReference"], required: ["userReference", "departmentReference"], entities: { userReference: "user", departmentReference: "department" }, route: act("revoke_department_role", (p) => ({ user: p.userReference, department: p.departmentReference, role: "TEAMLEAD" })) },
  { id: "CHANGE_TICKET_PRIORITY", description: "Change one ticket's priority.", examples: ["make ticket 2627001 critical"], roles: STAFF, readOnly: false, risk: "medium", params: ["ticketReference", "priorityReference"], required: ["ticketReference", "priorityReference"], entities: { ticketReference: "ticket", priorityReference: "priority" }, route: act("change_ticket_priority", (p) => ({ ticket: p.ticketReference, priority: p.priorityReference })) },
  { id: "CLOSE_TICKET", description: "Close one ticket (a reason is required).", examples: ["close ticket 2627001, it is a duplicate"], roles: ALL, readOnly: false, risk: "high", params: ["ticketReference", "reason"], required: ["ticketReference", "reason"], entities: { ticketReference: "ticket" }, route: act("close_ticket", (p) => ({ ticket: p.ticketReference, reason: p.reason })) },

  { id: "ADD_EMPLOYEE", description: "Add a new employee account to a department (no password is chosen or shown).", examples: ["onboard Jane Doe, jane@company.com, into Finance"], roles: ADMIN, readOnly: false, risk: "high", params: ["newName", "emailAddress", "departmentReference"], required: ["newName", "emailAddress", "departmentReference"], entities: { departmentReference: "department" }, route: act("add_employee", (p) => ({ name: p.newName, email: p.emailAddress, department: p.departmentReference })) },
  { id: "CREATE_TICKET", description: "Raise a new ticket in the caller's name.", examples: ["raise a ticket to Finance, the payroll report fails"], roles: ["MANAGER", "TEAMLEAD", "EMPLOYEE"], readOnly: true, params: [], required: [], route: () => ({ intent: "ticket_draft", params: {} }) },
  { id: "ASSIGN_TICKET", description: "Assign or reassign a ticket to a person in the caller's department.", examples: ["give ticket 2627001 to Bob"], roles: ["MANAGER", "TEAMLEAD"], readOnly: false, risk: "medium", params: ["ticketReference", "assigneeReference"], required: ["ticketReference", "assigneeReference"], entities: { ticketReference: "ticket", assigneeReference: "user" }, route: act("assign_ticket", (p) => ({ ticket: p.ticketReference, assignee: p.assigneeReference })) },
  { id: "CHANGE_TICKET_STATUS", description: "Set a ticket to In Progress, On Hold or Resolved (a note is needed for On Hold and Resolved).", examples: ["mark ticket 2627001 resolved, toner replaced"], roles: ALL, readOnly: false, risk: "medium", params: ["ticketReference", "statusValue", "reason"], required: ["ticketReference", "statusValue"], entities: { ticketReference: "ticket" }, route: act("change_ticket_status", (p) => ({ ticket: p.ticketReference, status: p.statusValue, reason: p.reason })) },
  { id: "REOPEN_TICKET", description: "Reopen a resolved or closed ticket (a reason is needed).", examples: ["the problem came back on ticket 2627001, reopen it"], roles: ALL, readOnly: false, risk: "medium", params: ["ticketReference", "reason"], required: ["ticketReference"], entities: { ticketReference: "ticket" }, route: act("reopen_ticket", (p) => ({ ticket: p.ticketReference, reason: p.reason })) },
  { id: "ADD_TICKET_COMMENT", description: "Add a public comment to a ticket the caller can access.", examples: ["tell them on ticket 2627001 that the part arrives Monday"], roles: ALL, readOnly: false, risk: "low", params: ["ticketReference", "comment"], required: ["ticketReference", "comment"], entities: { ticketReference: "ticket" }, route: act("add_ticket_comment", (p) => ({ ticket: p.ticketReference, comment: p.comment })) },

  // ---- requests the app does not support through chat (explained, never executed) ----
  { id: "CREATE_USER", description: "Create a new user account (not available in chat).", examples: ["add a new employee account"], roles: ADMIN, readOnly: false, risk: "high", params: [], route: redirect("create_user") },
  { id: "RESET_PASSWORD", description: "Reset someone's password (not available in chat).", examples: ["reset Ravi's password"], roles: ADMIN, readOnly: false, risk: "high", params: [], route: redirect("reset_password") },
  { id: "DELETE_DEPARTMENT", description: "Delete a department (not available in chat).", examples: ["remove the Legal department"], roles: ADMIN, readOnly: false, risk: "high", params: [], route: redirect("delete_department") },
  { id: "REASSIGN_TICKET", description: "Reassign a ticket (Admins cannot).", examples: ["reassign ticket 2627001 to Bob"], roles: ADMIN, readOnly: false, risk: "medium", params: [], route: redirect("reassign_ticket") },
  { id: "ESCALATE_TICKET", description: "Escalate a ticket (no such feature).", examples: ["escalate ticket 2627001"], roles: ADMIN, readOnly: false, risk: "medium", params: [], route: redirect("escalate_ticket") },
];

const REGISTRY = new Map(
  DEFS.map((d) => [
    d.id,
    Object.freeze({
      readOnly: true,
      risk: "low",
      required: [],
      entities: {},
      confirmation: d.readOnly === false ? "preview_confirm" : "none",
      rule: true,
      ai: true,
      ...d,
    }),
  ])
);

// Intents the AI interpreter may return for this role.
function aiIntentsFor(role) {
  return [...REGISTRY.values()].filter((d) => d.ai && d.roles.includes(role));
}

const getIntent = (id) => REGISTRY.get(id) || null;

module.exports = { REGISTRY, PARAMS, aiIntentsFor, getIntent };
