const prisma = require("../../config/prisma");
const { ChatError, CODES } = require("../chatbot.errors");
const { staffScopeWhere } = require("../roleScope");
const { resolveUser } = require("../actions/resolvers");

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_STATUSES = ["OPEN", "IN_PROGRESS", "ON_HOLD", "REOPENED"];

async function deny(ctx, action, reason) {
  await ctx.audit(action, "Report", null, "DENIED");
  throw new ChatError(CODES.ACCESS_DENIED, { internal: reason });
}

const adminOnly = async (ctx, name) => {
  if (ctx.scope.role !== "ADMIN") await deny(ctx, "REPORT_DENIED", `${name} requested by non-admin`);
};

// Staff scope: ADMIN everything, MANAGER/TEAMLEAD their departments (the same
// scopeWhereForTab the portal uses). Employees have no department reports.
const staffWhere = async (ctx, name) => {
  if (ctx.scope.role === "EMPLOYEE") await deny(ctx, "REPORT_DENIED", `${name} requested by employee`);
  return staffScopeWhere(ctx.scope);
};

const departmentHeadcount = {
  name: "get_department_headcount",
  description: "Active employees, managers and team leads per department (counts only). Admin only.",
  inputSchema: {},
  async run(ctx) {
    await adminOnly(ctx, "headcount");
    const rows = await prisma.department.findMany({
      select: {
        name: true,
        users: { where: { isActive: true }, select: { role: { select: { name: true } } } },
        userAccess: { where: { user: { isActive: true } }, select: { user: { select: { role: { select: { name: true } } } } } },
      },
      orderBy: { name: "asc" },
    });
    const departments = rows.map((r) => ({
      name: r.name,
      employees: r.users.filter((u) => u.role.name === "EMPLOYEE").length,
      managers: r.userAccess.filter((a) => a.user.role.name === "MANAGER").length,
      teamLeads: r.userAccess.filter((a) => a.user.role.name === "TEAMLEAD").length,
    }));
    await ctx.audit("TOOL_DEPARTMENT_HEADCOUNT", "Department", null, "SUCCESS");
    return { departments };
  },
};

const managerAssignments = {
  name: "get_manager_assignments",
  description: "Which Managers and Team Leads hold access to each department (names only). Admin only.",
  inputSchema: {},
  async run(ctx) {
    await adminOnly(ctx, "manager assignments");
    const rows = await prisma.department.findMany({
      select: { name: true, userAccess: { where: { user: { isActive: true } }, select: { user: { select: { name: true, role: { select: { name: true } } } } } } },
      orderBy: { name: "asc" },
    });
    const departments = rows.map((r) => ({
      name: r.name,
      managers: r.userAccess.filter((a) => a.user.role.name === "MANAGER").map((a) => a.user.name).sort(),
      teamLeads: r.userAccess.filter((a) => a.user.role.name === "TEAMLEAD").map((a) => a.user.name).sort(),
    }));
    await ctx.audit("TOOL_MANAGER_ASSIGNMENTS", "Department", null, "SUCCESS");
    return { departments };
  },
};

const usersByRole = {
  name: "get_users_by_role",
  description: "Active user counts per role. Admin only.",
  inputSchema: {},
  async run(ctx) {
    await adminOnly(ctx, "users by role");
    const [groups, roles] = await Promise.all([
      prisma.user.groupBy({ by: ["roleId"], where: { isActive: true }, _count: { _all: true } }),
      prisma.role.findMany({ select: { id: true, name: true, label: true } }),
    ]);
    const counts = new Map(groups.map((g) => [g.roleId, g._count._all]));
    await ctx.audit("TOOL_USERS_BY_ROLE", "User", null, "SUCCESS");
    return { roles: roles.map((r) => ({ role: r.label, count: counts.get(r.id) || 0 })).sort((a, b) => b.count - a.count) };
  },
};

async function departmentNames(ids) {
  const rows = await prisma.department.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

const ticketsByDepartment = {
  name: "get_tickets_by_department",
  description: "Ticket counts per department inside the caller's authorized scope.",
  inputSchema: {},
  async run(ctx) {
    const base = await staffWhere(ctx, "tickets by department");
    const groups = await prisma.ticket.groupBy({ by: ["toDepartmentId"], where: base, _count: { _all: true } });
    const open = await prisma.ticket.groupBy({ by: ["toDepartmentId"], where: { AND: [base, { status: { in: OPEN_STATUSES } }] }, _count: { _all: true } });
    const names = await departmentNames(groups.map((g) => g.toDepartmentId).filter(Boolean));
    const openBy = new Map(open.map((g) => [g.toDepartmentId, g._count._all]));
    const departments = groups
      .map((g) => ({ name: names.get(g.toDepartmentId) || "No department", total: g._count._all, open: openBy.get(g.toDepartmentId) || 0 }))
      .sort((a, b) => b.total - a.total);
    await ctx.audit("TOOL_TICKETS_BY_DEPARTMENT", "Ticket", null, "SUCCESS");
    return { departments };
  },
};

const weeklyReport = {
  name: "get_weekly_report",
  description: "Last-7-days ticket report inside the caller's authorized scope.",
  inputSchema: {},
  async run(ctx) {
    const base = await staffWhere(ctx, "weekly report");
    const from = new Date(Date.now() - 7 * DAY_MS);
    const [created, resolved, closed, openNow, byStatus, createdByDept, createdByPriority] = await Promise.all([
      prisma.ticket.count({ where: { AND: [base, { createdAt: { gte: from } }] } }),
      prisma.ticket.count({ where: { AND: [base, { resolvedAt: { gte: from } }] } }),
      prisma.ticket.count({ where: { AND: [base, { closedAt: { gte: from } }] } }),
      prisma.ticket.count({ where: { AND: [base, { status: { in: OPEN_STATUSES } }] } }),
      prisma.ticket.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
      prisma.ticket.groupBy({ by: ["toDepartmentId"], where: { AND: [base, { createdAt: { gte: from } }] }, _count: { _all: true } }),
      prisma.ticket.groupBy({ by: ["priorityId"], where: { AND: [base, { createdAt: { gte: from } }] }, _count: { _all: true } }),
    ]);
    const deptNames = await departmentNames(createdByDept.map((g) => g.toDepartmentId).filter(Boolean));
    const priorities = await prisma.priority.findMany({ select: { id: true, name: true } });
    const pName = new Map(priorities.map((p) => [p.id, p.name]));
    await ctx.audit("TOOL_WEEKLY_REPORT", "Ticket", null, "SUCCESS");
    return {
      from: from.toISOString(),
      to: new Date().toISOString(),
      created,
      resolved,
      closed,
      openNow,
      byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
      createdByDepartment: createdByDept.map((g) => ({ name: deptNames.get(g.toDepartmentId) || "No department", count: g._count._all })).sort((a, b) => b.count - a.count),
      createdByPriority: createdByPriority.map((g) => ({ name: pName.get(g.priorityId) || "Unknown", count: g._count._all })).sort((a, b) => b.count - a.count),
    };
  },
};

const getUserSummary = {
  name: "get_user_summary",
  description: "Role, department(s) and active status of one person (no contact details). Admin only.",
  inputSchema: { user: { type: "string", max: 80 }, userId: { type: "string", max: 40 } },
  async run(ctx, input) {
    await adminOnly(ctx, "user summary");
    // `userId` is only ever set by the server after an entity-selection step.
    const found = input.userId
      ? await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, name: true, isActive: true, role: { select: { label: true } }, department: { select: { name: true } } } })
      : await resolveUser(input.user || "");
    if (!found) throw new ChatError(CODES.ACTION_INVALID, { message: "I couldn't find that user." });
    const access = await prisma.userDepartmentAccess.findMany({ where: { userId: found.id }, select: { departmentId: true } });
    const ids = access.map((a) => a.departmentId);
    const names = ids.length ? (await prisma.department.findMany({ where: { id: { in: ids } }, select: { name: true } })).map((d) => d.name) : [];
    const departments = names.length ? names : found.department?.name ? [found.department.name] : [];
    await ctx.audit("TOOL_USER_SUMMARY", "User", null, "SUCCESS");
    return { user: { name: found.name, role: found.role.label, departments: departments.sort(), active: Boolean(found.isActive) } };
  },
};

module.exports = { tools: [departmentHeadcount, managerAssignments, usersByRole, ticketsByDepartment, weeklyReport, getUserSummary] };
