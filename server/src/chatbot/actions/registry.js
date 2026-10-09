const crypto = require("crypto");
const prisma = require("../../config/prisma");
const { MAX_TEAMLEADS_PER_DEPARTMENT } = require("../../config/constants");
const { resolveDepartment, resolveUser, resolveUserArg, resolvePriority, invalid } = require("./resolvers");
const { toPlainText } = require("../text");
const { ChatError, CODES } = require("../chatbot.errors");
const { normalizeTicketNumber, TICKET_REF_PATTERN, loadAuthorizedTicket, OPEN_STATUSES } = require("../tools/ticketTools");
const { countWords, MAX_PROBLEM_SUMMARY_WORDS } = require("../../utils/wordCount");
const { actionRoles } = require("../permissions");

// The ONLY changes the chatbot can make. Each action has:
//   prepare(ctx, args) -> { params, summary, impact[] }   (read-only; validates and previews)
//   execute(ctx, params) -> string                        (calls the EXISTING service method)
// ctx = { actorId, user, scope, audit }. `params` is what gets stored with the
// pending action: resolved ids plus display names, nothing secret.
//
// WHO may run an action is decided by permissions.js#ACTION_POLICY (deny by
// default) and enforced in actionService at preview AND at confirmation. WHAT
// they may touch is enforced here: every ticket is loaded through the caller's
// authorized scope (an out-of-scope ticket gets the same neutral answer as a
// missing one) and every person is looked up only within the caller's
// departments. The existing services then apply their own business rules
// (valid assignee, status transitions, required notes, Team Lead cap, ...).
// There is deliberately no "delete", "reset password" or Admin-role grant.

const services = {
  department: () => require("../../services/department.service"),
  user: () => require("../../services/user.service"),
  access: () => require("../../services/userDepartmentAccess.service"),
  ticket: () => require("../../services/ticket.service"),
  auth: () => require("../../services/auth.service"),
  notification: () => require("../../services/notification.service"),
};

const draftStore = () => require("../ticketDraft/draftStore");
const NAME_MAX = 80;
const ROLE_LABEL = { MANAGER: "Manager", TEAMLEAD: "Team Lead", EMPLOYEE: "Employee", ADMIN: "Admin" };
const STATUS_LABEL = { OPEN: "Open", IN_PROGRESS: "In Progress", ON_HOLD: "On Hold", RESOLVED: "Resolved", CLOSED: "Closed", REOPENED: "Reopened" };
const an = (label) => (/^[AEIOU]/i.test(label) ? "an" : "a");

function cleanName(value, what) {
  // eslint-disable-next-line no-control-regex
  const v = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!v) throw invalid(`Please tell me the ${what}.`);
  if (v.length > NAME_MAX) throw invalid(`The ${what} must be ${NAME_MAX} characters or fewer.`);
  return v;
}

function cleanText(value, what, { min = 1, max = 2000 } = {}) {
  const v = toPlainText(value, max + 1);
  if (!v || v.length < min) throw invalid(`Please give the ${what}.`);
  if (v.length > max) throw invalid(`The ${what} must be ${max} characters or fewer.`);
  return v;
}

// Departments a non-admin may refer to (null = every department).
const scopedDeptIds = (ctx) => (ctx.scope.role === "ADMIN" ? null : ctx.scope.departmentIds);

const TICKET_SELECT = {
  id: true,
  ticketNumber: true,
  status: true,
  requesterId: true,
  assigneeId: true,
  toDepartmentId: true,
  priority: { select: { name: true } },
  assignee: { select: { name: true } },
  toDepartment: { select: { name: true } },
};

// The ticket, only if it is inside the caller's authorized scope. Anything else
// (missing, or exists but not theirs) throws the SAME neutral error.
async function loadTicket(ctx, ref) {
  if (!ref || !TICKET_REF_PATTERN.test(ref)) throw invalid("That doesn't look like a valid ticket number. Ticket numbers are digits only, for example 2627001.");
  return loadAuthorizedTicket(ctx, normalizeTicketNumber(ref), TICKET_SELECT);
}

function assertTransition(ticket, to) {
  const { VALID_TRANSITIONS } = services.ticket();
  if (!VALID_TRANSITIONS[ticket.status]?.includes(to)) {
    throw new ChatError(CODES.INVALID_TICKET_TRANSITION, { message: `Ticket ${ticket.ticketNumber} is ${STATUS_LABEL[ticket.status]}; it cannot go to ${STATUS_LABEL[to]} from there.` });
  }
}

const ACTIONS = {
  // ======================= departments & people (Admin) =======================
  // ---- the signed-in user's own notifications (the bell) --------------------
  // Always the actor's own rows: the existing service scopes every call by userId.
  mark_all_notifications_read: {
    title: "Mark notifications as read",
    async prepare(ctx) {
      const unread = await services.notification().countUnread(ctx.actorId);
      if (!unread) throw invalid("You have no unread notifications.");
      return {
        params: { unread },
        summary: `Mark your ${unread} unread notification${unread === 1 ? "" : "s"} as read.`,
        impact: ["Only your own notifications change.", "Nothing is deleted."],
      };
    },
    async execute(ctx) {
      const r = await services.notification().markAllRead(ctx.actorId);
      return `Marked ${r.count} notification${r.count === 1 ? "" : "s"} as read.`;
    },
  },

  mark_notification_read: {
    title: "Mark a notification as read",
    async prepare(ctx) {
      const [latest] = await services.notification().listForUser(ctx.actorId, { unreadOnly: true });
      if (!latest) throw invalid("You have no unread notifications.");
      return {
        params: { notificationId: latest.id, label: latest.title },
        summary: `Mark your latest unread notification as read: "${String(latest.title).slice(0, 80)}".`,
        impact: ["Only this notification changes.", "Nothing is deleted."],
      };
    },
    async execute(ctx, p) {
      const r = await services.notification().markRead(ctx.actorId, p.notificationId);
      return r.count ? "That notification was marked as read." : "That notification was already gone, so nothing changed.";
    },
  },

  clear_notifications: {
    title: "Clear notifications",
    async prepare(ctx) {
      const total = await prisma.notification.count({ where: { userId: ctx.actorId } });
      if (!total) throw invalid("You have no notifications to clear.");
      return {
        params: { total },
        summary: `Permanently delete all ${total} of your notifications.`,
        impact: ["This cannot be undone.", "Only your own notifications are deleted. Tickets, comments and other people's notifications are not touched."],
      };
    },
    async execute(ctx) {
      const r = await services.notification().clearAll(ctx.actorId);
      return `Cleared ${r.count} notification${r.count === 1 ? "" : "s"}.`;
    },
  },

  create_department: {
    title: "Create department",
    async prepare(_ctx, args) {
      const name = cleanName(args.name, "department name");
      const all = await prisma.department.findMany({ select: { name: true } });
      if (all.some((d) => d.name.toLowerCase() === name.toLowerCase())) throw invalid(`A department named "${name}" already exists.`);
      return {
        params: { name },
        summary: `Create the department "${name}".`,
        impact: ["A new department is added and appears on the ticket form.", 'It gets the default "Others" issue, as departments created on the Departments page do.', "It starts with no managers, team leads or employees."],
      };
    },
    async execute(ctx, p) {
      await services.department().createDepartment(ctx.actorId, { name: p.name });
      return `Department "${p.name}" was created.`;
    },
  },

  rename_department: {
    title: "Rename department",
    async prepare(_ctx, args) {
      const dept = await resolveDepartment(cleanName(args.department, "department"));
      const newName = cleanName(args.newName, "new department name");
      if (newName === dept.name) throw invalid(`The department is already called "${dept.name}".`);
      const all = await prisma.department.findMany({ select: { id: true, name: true } });
      if (all.some((d) => d.id !== dept.id && d.name.toLowerCase() === newName.toLowerCase())) throw invalid(`A department named "${newName}" already exists.`);
      return {
        params: { departmentId: dept.id, from: dept.name, to: newName },
        summary: `Rename the department "${dept.name}" to "${newName}".`,
        impact: ["The new name is shown everywhere the department appears, including on existing tickets.", "Ticket and access links to the department are unchanged."],
      };
    },
    async execute(ctx, p) {
      await services.department().updateDepartment(ctx.actorId, p.departmentId, { name: p.to });
      return `Department "${p.from}" was renamed to "${p.to}".`;
    },
  },

  rename_user: {
    title: "Rename user",
    async prepare(_ctx, args) {
      const typed = args.userId ? "" : cleanName(args.user, "user");
      // "rename Finance to Accounts" without the word "department": if the text is exactly a
      // department's name, do not guess that it means a person whose name merely contains it.
      const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
      const departments = await prisma.department.findMany({ select: { name: true } });
      const exactDept = departments.find((d) => norm(d.name) === norm(typed));
      if (exactDept && !args.userId) {
        throw invalid(`"${exactDept.name}" is a department, not a person. To rename it say: rename department ${exactDept.name} to <new name>.`);
      }
      const user = args.userId ? await resolveUserArg(args, "user", cleanName) : await resolveUser(typed);
      const newName = cleanName(args.newName, "new name");
      if (newName === user.name) throw invalid(`${user.name}'s name is already "${newName}".`);
      return {
        params: { userId: user.id, from: user.name, to: newName },
        summary: `Change the name of ${user.name} (${user.role.label}) to "${newName}".`,
        impact: ["The new name is shown everywhere this person appears, including on existing tickets and in history.", "Their email address, login, role and department do not change."],
      };
    },
    async execute(ctx, p) {
      await services.user().updateUser(ctx.actorId, p.userId, { name: p.to });
      return `${p.from}'s name was changed to "${p.to}".`;
    },
  },

  add_employee: {
    title: "Add employee",
    async prepare(_ctx, args) {
      const displayName = cleanName(args.name, "employee's name");
      if (displayName.length < 2) throw invalid("The employee's name is too short.");
      const email = String(args.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150) throw invalid("Please give a valid email address for the new employee.");
      const dept = await resolveDepartment(cleanName(args.department, "department"));
      const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) throw invalid("A user with that email address already exists.");
      return {
        params: { displayName, email, departmentId: dept.id, departmentName: dept.name },
        summary: `Add the employee ${displayName} (${email}) to ${dept.name}.`,
        impact: [
          "The account is created with the Employee role and this department.",
          "No password is shown or chosen here. A secure random password is set that nobody knows, and a password-setup email is requested so the employee sets their own.",
          "If email is not configured, the employee can use the Forgot Password link on the sign-in page.",
        ],
      };
    },
    async execute(ctx, p) {
      // A random, never-displayed password (the account is unusable until the employee sets one).
      const password = crypto.randomBytes(24).toString("base64url");
      await services.user().createUser(ctx.actorId, { name: p.displayName, email: p.email, password, roleName: "EMPLOYEE", departmentId: p.departmentId });
      let emailed = true;
      try {
        await services.auth().forgotPassword(p.email); // existing, secure password-setup flow
      } catch {
        emailed = false;
      }
      return `${p.displayName} was added to ${p.departmentName} as an Employee. ${emailed ? "A password-setup email was requested; the employee sets their own password." : "The password-setup email could not be requested; ask them to use Forgot Password on the sign-in page."}`;
    },
  },

  grant_department_role: {
    title: "Assign department role",
    async prepare(_ctx, args) {
      const user = await resolveUserArg(args, "user", cleanName);
      const dept = await resolveDepartment(cleanName(args.department, "department"));
      const label = ROLE_LABEL[args.role];
      if (!user.isActive) throw invalid(`${user.name}'s account is not active.`);
      if (user.role.name !== args.role) {
        throw invalid(`${user.name} is currently ${an(user.role.label)} ${user.role.label}, and only ${label} users can be assigned as ${label} of a department. You can first ask me to "change role of ${user.name} to ${label}".`);
      }
      const existing = await prisma.userDepartmentAccess.findUnique({ where: { userId_departmentId: { userId: user.id, departmentId: dept.id } } });
      if (existing) throw invalid(`${user.name} is already ${label} of ${dept.name}.`);

      const impact = [`${user.name} will be able to see and manage every ticket routed to ${dept.name}.`, `${user.name} will receive that department's ticket notifications as ${label}.`];
      if (args.role === "TEAMLEAD") {
        const current = await prisma.userDepartmentAccess.findFirst({ where: { userId: user.id }, include: { department: { select: { name: true } } } });
        if (current) throw invalid(`${user.name} is already Team Lead of ${current.department.name}. A Team Lead can hold only one department; remove that assignment first.`);
        const count = await prisma.userDepartmentAccess.count({ where: { departmentId: dept.id, user: { role: { name: "TEAMLEAD" } } } });
        if (count >= MAX_TEAMLEADS_PER_DEPARTMENT) throw invalid(`${dept.name} already has the maximum of ${MAX_TEAMLEADS_PER_DEPARTMENT} Team Leads.`);
      }
      return { params: { userId: user.id, userName: user.name, role: args.role, departmentId: dept.id, departmentName: dept.name }, summary: `Assign ${user.name} as ${label} of ${dept.name}.`, impact };
    },
    async execute(ctx, p) {
      if (p.role === "TEAMLEAD") await services.access().setTeamLeadDepartment(ctx.actorId, p.userId, p.departmentId);
      else await services.access().addManagerDepartmentAccess(ctx.actorId, p.userId, p.departmentId);
      return `${p.userName} is now ${ROLE_LABEL[p.role]} of ${p.departmentName}.`;
    },
  },

  revoke_department_role: {
    title: "Remove department role",
    async prepare(_ctx, args) {
      const user = await resolveUserArg(args, "user", cleanName);
      const dept = await resolveDepartment(cleanName(args.department, "department"));
      const label = ROLE_LABEL[args.role];
      if (user.role.name !== args.role) throw invalid(`${user.name} is ${an(user.role.label)} ${user.role.label}, not a ${label}.`);
      const existing = await prisma.userDepartmentAccess.findUnique({ where: { userId_departmentId: { userId: user.id, departmentId: dept.id } } });
      if (!existing) throw invalid(`${user.name} is not ${label} of ${dept.name}.`);
      return {
        params: { userId: user.id, userName: user.name, role: args.role, departmentId: dept.id, departmentName: dept.name },
        summary: `Remove ${user.name} as ${label} of ${dept.name}.`,
        impact: [`${user.name} will no longer see or manage tickets routed to ${dept.name} (unless they raised them).`, "Their account and role stay as they are."],
      };
    },
    async execute(ctx, p) {
      await services.access().removeUserDepartmentAccess(ctx.actorId, p.userId, p.departmentId);
      return `${p.userName} is no longer ${ROLE_LABEL[p.role]} of ${p.departmentName}.`;
    },
  },

  deactivate_user: {
    title: "Deactivate user",
    async prepare(ctx, args) {
      const user = await resolveUserArg(args, "user", cleanName);
      if (user.id === ctx.actorId) throw invalid("You can't deactivate your own account.");
      if (!user.isActive) throw invalid(`${user.name} is already deactivated.`);

      // Dependencies are shown and, where deactivating would leave work orphaned or the
      // system without an Administrator, the change is blocked until they are handled.
      const [openAssigned, accessRows, activeAdmins] = await Promise.all([
        prisma.ticket.count({ where: { assigneeId: user.id, status: { in: OPEN_STATUSES } } }),
        prisma.userDepartmentAccess.count({ where: { userId: user.id } }),
        prisma.user.count({ where: { isActive: true, role: { name: "ADMIN" } } }),
      ]);
      const blockers = [];
      if (user.role.name === "ADMIN" && activeAdmins <= 1) blockers.push("they are the last active Administrator");
      if (openAssigned) blockers.push(`${openAssigned} open ticket${openAssigned === 1 ? " is" : "s are"} assigned to them (a Manager or Team Lead must reassign ${openAssigned === 1 ? "it" : "them"} first)`);
      if (accessRows) blockers.push(`they are Manager or Team Lead of ${accessRows} department${accessRows === 1 ? "" : "s"} (remove that assignment first)`);
      if (blockers.length) {
        throw new ChatError(CODES.ACTION_BLOCKED_BY_DEPENDENCIES, { message: `I can't deactivate ${user.name} yet: ${blockers.join("; ")}.` });
      }
      return {
        params: { userId: user.id, userName: user.name },
        summary: `Deactivate ${user.name} (${user.role.label}).`,
        impact: [`${user.name} will be signed out and will not be able to log in.`, "No open tickets are assigned to them and they hold no department assignments.", "Their tickets, comments and history are kept.", "You can reactivate them later."],
      };
    },
    async execute(ctx, p) {
      await services.user().deactivateUser(ctx.actorId, p.userId);
      return `${p.userName} was deactivated.`;
    },
  },

  activate_user: {
    title: "Activate user",
    async prepare(_ctx, args) {
      const user = await resolveUserArg(args, "user", cleanName);
      if (user.isActive) throw invalid(`${user.name} is already active.`);
      return { params: { userId: user.id, userName: user.name }, summary: `Activate ${user.name} (${user.role.label}).`, impact: [`${user.name} will be able to log in again with their existing password.`] };
    },
    async execute(ctx, p) {
      await services.user().updateUser(ctx.actorId, p.userId, { isActive: true });
      return `${p.userName} was activated.`;
    },
  },

  change_user_role: {
    title: "Change user role",
    async prepare(ctx, args) {
      const user = await resolveUserArg(args, "user", cleanName);
      const target = args.roleName;
      if (!["MANAGER", "TEAMLEAD", "EMPLOYEE"].includes(target)) throw new ChatError(CODES.INVALID_ROLE_OPERATION, { message: "I can't grant the Admin role through chat. Use the Users page for that." });
      if (user.role.name === "ADMIN") throw new ChatError(CODES.INVALID_ROLE_OPERATION, { message: `${user.name} is an Admin. I can't change an Admin's role through chat; use the Users page.` });
      if (user.id === ctx.actorId) throw new ChatError(CODES.INVALID_ROLE_OPERATION, { message: "You can't change your own role." });
      if (user.role.name === target) throw invalid(`${user.name} is already ${an(ROLE_LABEL[target])} ${ROLE_LABEL[target]}.`);
      return {
        params: { userId: user.id, userName: user.name, from: user.role.name, roleName: target },
        summary: `Change ${user.name}'s role from ${user.role.label} to ${ROLE_LABEL[target]}.`,
        impact: [
          `${user.name}'s permissions change immediately to those of a ${ROLE_LABEL[target]}.`,
          "Existing department-access grants are not changed automatically; review them on the Users page if needed.",
        ],
      };
    },
    async execute(ctx, p) {
      await services.user().updateUser(ctx.actorId, p.userId, { roleName: p.roleName });
      return `${p.userName}'s role was changed to ${ROLE_LABEL[p.roleName]}.`;
    },
  },

  move_user_department: {
    title: "Move user to department",
    async prepare(_ctx, args) {
      const user = await resolveUserArg(args, "user", cleanName);
      const dept = await resolveDepartment(cleanName(args.department, "department"));
      if (user.departmentId === dept.id) throw invalid(`${user.name} is already in ${dept.name}.`);
      return {
        params: { userId: user.id, userName: user.name, departmentId: dept.id, departmentName: dept.name },
        summary: `Move ${user.name} to the ${dept.name} department.`,
        impact: [`${user.name}'s home department becomes ${dept.name}.`, "This does not grant Manager or Team Lead access; use the department-role commands for that."],
      };
    },
    async execute(ctx, p) {
      await services.user().updateUser(ctx.actorId, p.userId, { departmentId: p.departmentId });
      return `${p.userName} was moved to ${p.departmentName}.`;
    },
  },

  // ============================ tickets (role + scope) ============================
  // The conversational Raise a Ticket (see ticketDraft/flow.js). The details were collected in a
  // server-side draft; this action re-validates them and calls ticket.service.createTicket, the same
  // function the Raise a Ticket page uses: ticket number, history, CC, attachments, notifications and
  // emails are all done there, nothing is duplicated here.
  raise_ticket_from_draft: {
    title: "Raise ticket",
    failurePrefix: "No ticket was created. ",
    async prepare(ctx, args) {
      const draft = await draftStore().loadOwned(ctx.actorId, args.draftId);
      if (!draft || draft.status !== "ACTIVE") throw invalid('That ticket draft is no longer available. Say "raise a ticket" to start again.');
      const f = draft.fields;
      if (!f.title) throw invalid("The ticket needs a title.");
      if (!f.priorityId) throw invalid("The ticket needs a priority.");
      if (!f.toDepartmentId) throw invalid("The ticket needs a department.");
      if (!f.problemSummary) throw invalid("The ticket needs a problem summary.");
      if (countWords(f.problemSummary) > MAX_PROBLEM_SUMMARY_WORDS) throw invalid(`The problem summary is limited to ${MAX_PROBLEM_SUMMARY_WORDS} words. Please shorten it.`);
      const [priority, dept] = await Promise.all([prisma.priority.findUnique({ where: { id: f.priorityId } }), prisma.department.findUnique({ where: { id: f.toDepartmentId } })]);
      if (!priority) throw invalid("The selected priority is no longer available.");
      if (!dept) throw invalid("Ticket could not be created because the selected department is unavailable.");
      // The From Department comes from the ticket service's own rule for this user's role.
      try {
        await services.ticket().resolveFromDepartmentId(ctx.user, undefined, f.toDepartmentId);
      } catch (err) {
        throw invalid(err.message);
      }
      const cc = f.ccUsers || [];
      if (cc.length) {
        const live = await prisma.user.findMany({ where: { id: { in: cc.map((u) => u.id) }, isActive: true }, select: { id: true } });
        if (live.length !== cc.length) throw invalid("One or more of the people you chose for CC are no longer active. Please change the CC list.");
      }
      const n = draft.attachments.length;
      return {
        params: { draftId: draft.id },
        summary: `Raise the ticket "${f.title}" to ${dept.name} with ${priority.name} priority${cc.length ? `, CC ${cc.map((u) => u.name).join(", ")}` : ""}${n ? `, with ${n} attachment${n === 1 ? "" : "s"}` : ""}.`,
        impact: ["The ticket is raised in your name, exactly as from the Raise a Ticket page.", `The ${dept.name} department's Team Leads and Managers are notified, as for any new ticket.`, ...(cc.length ? [`${cc.map((u) => u.name).join(", ")} will be copied on its emails.`] : [])],
      };
    },
    async execute(ctx, p) {
      const store = draftStore();
      const draft = await store.loadOwned(ctx.actorId, p.draftId);
      if (!draft || draft.status !== "ACTIVE") throw invalid("That ticket draft is no longer available.");
      const f = draft.fields;
      const files = await store.loadFiles(draft.id);
      const t = await services.ticket().createTicket(ctx.user, { title: f.title, problemSummary: f.problemSummary, priorityId: f.priorityId, toDepartmentId: f.toDepartmentId, ccUserIds: (f.ccUsers || []).map((u) => u.id) }, files);
      await store.setStatus(draft.id, "CREATED");
      await store.releaseFiles(draft.id);
      // The ticket service saves each file best-effort (a storage failure never undoes the ticket),
      // so check what actually reached the ticket and say so plainly if any file did not.
      let warning = "";
      if (files.length) {
        const saved = await prisma.ticketAttachment.count({ where: { ticketId: t.id } });
        if (saved < files.length) {
          warning = `\n\n⚠ ${saved === 0 ? "None of your" : `Only ${saved} of your`} ${files.length} attachment${files.length === 1 ? "" : "s"} could be saved to the ticket (file storage is unavailable). Please add ${saved === 0 ? "them" : "the rest"} again from the ticket page once it is fixed.`;
        }
      }
      return {
        message: `Your ticket has been raised successfully. Ticket number: ${t.ticketNumber}.

Title: ${f.title}
Department: ${f.toDepartmentName}
Priority: ${f.priorityName}
Status: ${STATUS_LABEL[t.status] || t.status}${warning}`,
        ticketId: t.id,
        ticketNumber: t.ticketNumber,
      };
    },
  },

  change_ticket_priority: {
    title: "Change ticket priority",
    async prepare(ctx, args) {
      const ticket = await loadTicket(ctx, args.ticket);
      const priority = await resolvePriority(cleanName(args.priority, "priority"));
      if (ticket.priority?.name === priority.name) throw invalid(`Ticket ${ticket.ticketNumber} already has ${priority.name} priority.`);
      return {
        params: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, priorityId: priority.id, priorityName: priority.name, from: ticket.priority?.name || null },
        summary: `Change the priority of ticket ${ticket.ticketNumber} from ${ticket.priority?.name || "none"} to ${priority.name}.`,
        impact: ["The change is recorded in the ticket's activity history.", "Priority is used for filtering and display; it does not start any timer."],
      };
    },
    async execute(ctx, p) {
      await services.ticket().updateTicket(ctx.user, p.ticketId, { priorityId: p.priorityId });
      return `Ticket ${p.ticketNumber} priority was changed to ${p.priorityName}.`;
    },
  },

  change_ticket_status: {
    title: "Change ticket status",
    async prepare(ctx, args) {
      const ticket = await loadTicket(ctx, args.ticket);
      const status = String(args.status || "").toUpperCase().replace(/\s+/g, "_");
      if (!["IN_PROGRESS", "ON_HOLD", "RESOLVED", "OPEN"].includes(status)) throw invalid('I can set a ticket to In Progress, On Hold, Resolved or Open. To close or reopen one, say "close ticket" or "reopen ticket".');
      if (ctx.scope.role === "EMPLOYEE" && ticket.assigneeId !== ctx.actorId) {
        throw new ChatError(CODES.INVALID_ROLE_OPERATION, { message: "Only the person a ticket is assigned to can change its status." });
      }
      if (ticket.status === status) throw invalid(`Ticket ${ticket.ticketNumber} is already ${STATUS_LABEL[status]}.`);
      assertTransition(ticket, status);
      const needsNote = status === "RESOLVED" || status === "ON_HOLD";
      const note = args.reason ? cleanText(args.reason, "note", { max: 1000 }) : null;
      if (needsNote && !note) {
        throw invalid(`${status === "RESOLVED" ? "Resolving" : "Putting a ticket on hold"} needs ${status === "RESOLVED" ? "resolution notes" : "a reason"}. Say, for example: "set ticket ${ticket.ticketNumber} to ${STATUS_LABEL[status].toLowerCase()} because <text>".`);
      }
      return {
        params: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, status, note, from: ticket.status },
        summary: `Change ticket ${ticket.ticketNumber} from ${STATUS_LABEL[ticket.status]} to ${STATUS_LABEL[status]}${note ? ` ("${note}")` : ""}.`,
        impact: ["The change is recorded in the ticket's activity history.", "The people on the ticket receive the usual status notification email."],
      };
    },
    async execute(ctx, p) {
      const payload = { status: p.status };
      if (p.status === "RESOLVED") payload.resolutionNotes = p.note;
      if (p.status === "ON_HOLD") payload.onHoldReason = p.note;
      await services.ticket().updateTicket(ctx.user, p.ticketId, payload);
      return `Ticket ${p.ticketNumber} is now ${STATUS_LABEL[p.status]}.`;
    },
  },

  assign_ticket: {
    title: "Assign ticket",
    async prepare(ctx, args) {
      const ticket = await loadTicket(ctx, args.ticket);
      if (ticket.status === "CLOSED") throw new ChatError(CODES.INVALID_TICKET_TRANSITION, { message: `Ticket ${ticket.ticketNumber} is closed. Reopen it before assigning it.` });
      // People are found only inside the caller's departments; a name elsewhere looks like no name at all.
      const assignee = await resolveUserArg(args, "assignee", cleanName, scopedDeptIds(ctx));
      if (!assignee.isActive) throw new ChatError(CODES.INVALID_ASSIGNEE, { message: `${assignee.name}'s account is not active, so they can't be assigned tickets.` });
      if (assignee.id === ctx.actorId) throw new ChatError(CODES.INVALID_ASSIGNEE, { message: "I can't assign a ticket to you. Use the Assign Ticket button on the ticket page for that." });
      let eligible = assignee.role.name === "EMPLOYEE" && assignee.departmentId === ticket.toDepartmentId;
      if (!eligible && ctx.scope.role === "TEAMLEAD" && assignee.role.name === "TEAMLEAD") {
        eligible = await services.access().hasAccess(assignee.id, ticket.toDepartmentId);
      }
      if (!eligible) {
        throw new ChatError(CODES.INVALID_ASSIGNEE, { message: `${assignee.name} can't be assigned this ticket: only active employees of ${ticket.toDepartment?.name || "the ticket's department"}${ctx.scope.role === "TEAMLEAD" ? " (or another Team Lead of that department)" : ""} are eligible.` });
      }
      if (ticket.assigneeId === assignee.id) throw invalid(`Ticket ${ticket.ticketNumber} is already assigned to ${assignee.name}.`);
      return {
        params: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, assigneeId: assignee.id, assigneeName: assignee.name, from: ticket.assignee?.name || null },
        summary: `${ticket.assignee ? "Reassign" : "Assign"} ticket ${ticket.ticketNumber} ${ticket.assignee ? `from ${ticket.assignee.name} ` : ""}to ${assignee.name}.`,
        impact: [`${assignee.name} becomes responsible for the ticket and is notified.`, ticket.assignee ? `${ticket.assignee.name} is no longer the assignee.` : "The ticket currently has no assignee.", "The change is recorded in the ticket's activity history."],
      };
    },
    async execute(ctx, p) {
      await services.ticket().updateTicket(ctx.user, p.ticketId, { assigneeId: p.assigneeId });
      return `Ticket ${p.ticketNumber} was assigned to ${p.assigneeName}.`;
    },
  },

  close_ticket: {
    title: "Close ticket",
    async prepare(ctx, args) {
      const ticket = await loadTicket(ctx, args.ticket);
      const reason = args.reason ? toPlainText(args.reason, 300) : null;
      if (!reason) {
        throw invalid(`Closing a ticket requires a reason. Say, for example: "Close ticket ${ticket.ticketNumber} reason: duplicate of an earlier request".`);
      }
      if (ticket.status === "CLOSED") throw invalid(`Ticket ${ticket.ticketNumber} is already closed.`);
      if (ctx.scope.role === "EMPLOYEE" && ticket.assigneeId !== ctx.actorId) {
        throw new ChatError(CODES.INVALID_ROLE_OPERATION, { message: "Only the person a ticket is assigned to can close it." });
      }
      assertTransition(ticket, "CLOSED");
      return {
        params: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, reason, from: ticket.status },
        summary: `Close ticket ${ticket.ticketNumber} (currently ${STATUS_LABEL[ticket.status]}) with the reason: "${reason}".`,
        impact: ["The reason is saved on the ticket and in its history.", "The people on the ticket receive the usual 'closed' notification email.", "The ticket can be reopened later."],
      };
    },
    async execute(ctx, p) {
      await services.ticket().updateTicket(ctx.user, p.ticketId, { status: "CLOSED", closedReason: p.reason });
      return `Ticket ${p.ticketNumber} was closed.`;
    },
  },

  transfer_ticket: {
    title: "Transfer ticket",
    async prepare(ctx, args) {
      const ticket = await loadTicket(ctx, args.ticket);
      // The department the ticket moves to may be any department (as on the ticket page).
      const dest = await resolveDepartment(cleanName(args.department, "department"));
      const reason = args.reason ? cleanText(args.reason, "reason", { max: 1000 }) : null;
      if (!reason) throw invalid(`A transfer needs a reason. Say, for example: "Transfer ticket ${ticket.ticketNumber} to ${dest.name} because it needs their team".`);
      if (ctx.scope.role === "EMPLOYEE" && ticket.assigneeId !== ctx.actorId) {
        throw new ChatError(CODES.INVALID_ROLE_OPERATION, { message: "Only the employee the ticket is assigned to (or a Manager / Team Lead of its department) can transfer it." });
      }
      if (dest.id === ticket.toDepartmentId) throw invalid(`Ticket ${ticket.ticketNumber} is already routed to ${dest.name}.`);
      return {
        params: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, departmentId: dest.id, departmentName: dest.name, reason },
        summary: `Transfer ticket ${ticket.ticketNumber} to ${dest.name} because: "${reason}".`,
        impact: [`The ticket moves to ${dest.name}; that department's Managers and Team Leads are notified as for any transfer.`, "Your reason is sent with the transfer notification."],
      };
    },
    async execute(ctx, p) {
      await services.ticket().transferDepartment(ctx.user, p.ticketId, { toDepartmentId: p.departmentId, transferReason: p.reason });
      return `Ticket ${p.ticketNumber} was transferred to ${p.departmentName}.`;
    },
  },

  reopen_ticket: {
    title: "Reopen ticket",
    async prepare(ctx, args) {
      const ticket = await loadTicket(ctx, args.ticket);
      const reason = args.reason ? cleanText(args.reason, "reason", { max: 1000 }) : null;
      if (!reason) throw invalid(`Reopening a ticket needs a reason. Say, for example: "Reopen ticket ${ticket.ticketNumber} because the problem came back".`);
      // ticket.service allows the requester to reopen their own RESOLVED/CLOSED ticket and the
      // assignee / Manager / Team Lead / Admin to drive the workflow; anyone else is refused there
      // at confirmation, and we refuse early for people who have no link to the ticket.
      if (ctx.scope.role === "EMPLOYEE" && ticket.requesterId !== ctx.actorId && ticket.assigneeId !== ctx.actorId) {
        throw new ChatError(CODES.INVALID_ROLE_OPERATION, { message: "Only the person who raised the ticket or the person it is assigned to can reopen it." });
      }
      assertTransition(ticket, "REOPENED");
      return {
        params: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, reason, from: ticket.status },
        summary: `Reopen ticket ${ticket.ticketNumber} (currently ${STATUS_LABEL[ticket.status]}) because: "${reason}".`,
        impact: ["The ticket becomes active again.", "Your reason is saved on the ticket and in its history.", "The people on the ticket receive the usual 'reopened' notification email."],
      };
    },
    async execute(ctx, p) {
      // The reason is stored on the ticket (and in its history) by the ticket service, as from the ticket page.
      await services.ticket().updateTicket(ctx.user, p.ticketId, { status: "REOPENED", reopenedReason: p.reason });
      return `Ticket ${p.ticketNumber} was reopened.`;
    },
  },

  add_ticket_comment: {
    title: "Add comment",
    async prepare(ctx, args) {
      const ticket = await loadTicket(ctx, args.ticket);
      const body = cleanText(args.comment, "comment", { max: 2000 });
      return {
        params: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, body },
        summary: `Add this comment to ticket ${ticket.ticketNumber}: "${body}".`,
        impact: ["The comment is visible to everyone who can see the ticket (it is not an internal note).", "The people on the ticket receive the usual new-comment notification."],
      };
    },
    async execute(ctx, p) {
      await services.ticket().addComment(ctx.user, p.ticketId, { body: p.body, isInternal: false });
      return `Your comment was added to ticket ${p.ticketNumber}.`;
    },
  },
};

// Explanations for requests the application does not allow through chat (or at all).
const REDIRECTS = {
  create_user: { message: "I can't create a user from that. To add an employee say, for example: \"add employee Jane Doe jane@company.com to Finance\". For other roles use the Users page.", path: "/admin/users", label: "Open Users" },
  reset_password: { message: "I don't reset passwords from chat. Users can use the Forgot Password link on the sign-in page, which emails them a one-time reset link.", path: "/admin/users", label: "Open Users" },
  delete_department: { message: "I don't delete departments from chat because it is destructive and has dependency checks. Use the Departments page.", path: "/admin/departments", label: "Open Departments" },
  delete_user: { message: "I don't delete users from chat. I can deactivate a user instead (\"deactivate <name>\"), which keeps their ticket history.", path: "/admin/users", label: "Open Users" },
  reassign_ticket: { message: "Admins can't assign or reassign tickets in this application; a Manager or Team Lead of the ticket's department does that.", path: null, label: null },
  escalate_ticket: { message: "This application has no escalation feature. I can change a ticket's priority if that helps (\"change priority of ticket <number> to High\").", path: null, label: null },
  admin_raise_ticket: { message: "Administrators can't raise tickets in this application. Ask an employee, Team Lead or Manager to raise it.", path: null, label: null },
};

// Roles that may attempt an action (from the deny-by-default policy).
for (const [name, def] of Object.entries(ACTIONS)) def.roles = actionRoles(name);

module.exports = { ACTIONS, REDIRECTS, MAX_NAME: NAME_MAX, STATUS_LABEL };
