const prisma = require("../../config/prisma");
const { ChatError, CODES } = require("../chatbot.errors");
const { portalFor } = require("../roleScope");
const { STATUS_LABELS } = require("../dto");
const knowledge = require("../knowledge");
const { matchDepartments } = require("../departmentMatch");

// What each role may do THROUGH THE CHATBOT / which guidance it can get. This
// mirrors the existing permission model (ticket.service.js) — it describes it,
// it does not grant anything.
const CAPABILITIES = {
  EMPLOYEE: [
    "View, search and summarize tickets you raised or are assigned to",
    "See recorded history and the latest update of those tickets",
    "Guidance: raise a ticket, attach files, comment, profile, password, notifications",
  ],
  TEAMLEAD: [
    "View, search and summarize tickets in the department you have access to",
    "See department ticket counts, unassigned tickets and tickets with no recent activity",
    "Guidance: assign/reassign, transfer, status changes, dashboard, profile, password",
  ],
  MANAGER: [
    "View, search and summarize tickets in the departments you have access to",
    "See department ticket counts, trends, unassigned tickets and tickets with no recent activity",
    "Guidance: assign/reassign, transfer, status changes, dashboard, profile, password",
  ],
  ADMIN: [
    "View, search and summarize tickets across the system (view only)",
    "See system-wide ticket counts and trends",
    "Guidance: users and roles, departments, priorities, email templates, audit logs, settings",
  ],
};

const getCurrentUser = {
  name: "get_current_user",
  description: "The authenticated user's name and role (from the server session).",
  inputSchema: {},
  async run(ctx) {
    const u = ctx.scope.user;
    return { name: u.name, role: u.role.name, roleLabel: u.role.label, portal: portalFor(u.role.name)?.name ?? null };
  },
};

const getPortalCapabilities = {
  name: "get_portal_capabilities",
  description: "What the chatbot can do for the authenticated role.",
  inputSchema: {},
  async run(ctx) {
    const role = ctx.scope.role;
    return { portal: portalFor(role)?.name ?? null, capabilities: CAPABILITIES[role] || [] };
  },
};

const getProfileSummary = {
  name: "get_profile_summary",
  description: "The caller's own profile fields (never another user's).",
  inputSchema: {},
  async run(ctx) {
    const u = ctx.scope.user;
    let departments = [];
    if (ctx.scope.departmentIds.length) {
      const rows = await prisma.department.findMany({ where: { id: { in: ctx.scope.departmentIds } }, select: { name: true } });
      departments = rows.map((r) => r.name).sort();
    } else if (u.department?.name) {
      departments = [u.department.name];
    }
    const profile = {
      name: u.name || null,
      email: u.email || null,
      role: u.role.label,
      departments,
      active: Boolean(u.isActive),
      memberSince: u.createdAt ? new Date(u.createdAt).toISOString() : null,
    };
    const unavailable = [];
    if (!profile.name) unavailable.push("name");
    if (!departments.length) unavailable.push("department");
    await ctx.audit("TOOL_PROFILE_SUMMARY", "User", null, "SUCCESS");
    return { profile: { ...profile, unavailableFields: unavailable } };
  },
};

const getKnowledgeArticle = {
  name: "get_knowledge_article",
  description: "Role-filtered guidance article by id or by free-text query.",
  inputSchema: { id: { type: "string", max: 80 }, query: { type: "string", max: 300 } },
  async run(ctx, input) {
    const role = ctx.scope.role;
    const article = input.id ? knowledge.getArticle(input.id, role) : knowledge.searchArticles(input.query, role, 1)[0];
    if (!article) return { article: null };
    return { article };
  },
};

const getNavigationSteps = {
  name: "get_navigation_steps",
  description: "Numbered steps and a permitted navigation target for a portal feature.",
  inputSchema: { id: { type: "string", max: 80 }, query: { type: "string", max: 300 } },
  async run(ctx, input) {
    const { article } = await getKnowledgeArticle.run(ctx, input);
    if (!article) return { article: null };
    return { article };
  },
};

// Departments visible to the caller. ADMIN: all. MANAGER/TEAMLEAD: only the
// departments they have access to. EMPLOYEE: only their own. Names only (no
// people, no contact details).
const listDepartments = {
  name: "list_departments",
  description: "Names of the departments the caller may see (no people or contact details).",
  inputSchema: {},
  async run(ctx) {
    const { scope } = ctx;
    if (scope.role === "ADMIN") {
      const rows = await prisma.department.findMany({ select: { name: true }, orderBy: { name: "asc" } });
      return { departments: rows.map((r) => r.name), scope: "all" };
    }
    if (scope.role === "EMPLOYEE") {
      const own = scope.user.department?.name;
      return { departments: own ? [own] : [], scope: "own" };
    }
    if (!scope.departmentIds.length) return { departments: [], scope: "allocated" };
    const rows = await prisma.department.findMany({ where: { id: { in: scope.departmentIds } }, select: { name: true }, orderBy: { name: "asc" } });
    return { departments: rows.map((r) => r.name), scope: "allocated" };
  },
};

// Names and role labels of ACTIVE people in departments the caller may see:
// ADMIN every department; MANAGER/TEAMLEAD only departments they have access to;
// EMPLOYEE is denied by the tool policy. Never emails, ids or anything else.
//
// Who belongs to a department is the application's own rule (department.service#toDepartmentShape):
// Managers and Team Leads through their department access, Employees through their home department
// (an Admin belongs to no department). Each person is counted ONCE, by user id, so a person reached
// through two relations never inflates a count. `counts` are the exact numbers per role and `total` is
// the exact number for the requested role(s); `members` is the list to show, shortened to MEMBER_CAP,
// so a shortened list is never mistaken for the total.
const MEMBER_CAP = 100;
const ROLE_LABELS = { MANAGER: "Manager", TEAMLEAD: "Team Lead", EMPLOYEE: "Employee", ADMIN: "Admin" };
const getDepartmentMembers = {
  name: "get_department_members",
  description: "Active people (name and role only) in the authorized department(s) named in the question, with exact counts per role.",
  inputSchema: {
    question: { type: "string", max: 300 },
    all: { type: "enum", values: ["yes"] },
    roleFilter: { type: "enum", values: ["EMPLOYEE", "TEAMLEAD", "MANAGER", "ALL"] },
  },
  async run(ctx, input) {
    const { scope } = ctx;
    // Scope is forced here, whatever the question says: staff only ever see their own departments.
    const where = scope.role === "ADMIN" ? undefined : { id: { in: scope.departmentIds } };
    const rows = await prisma.department.findMany({
      where,
      select: {
        name: true,
        users: { where: { isActive: true }, select: { id: true, name: true, role: { select: { name: true } } } },
        userAccess: { where: { user: { isActive: true } }, select: { user: { select: { id: true, name: true, role: { select: { name: true } } } } } },
      },
      orderBy: { name: "asc" },
    });
    const allNames = rows.map((r) => r.name);
    const wanted = input.all ? allNames : matchDepartments(input.question || "", allNames);
    const only = input.roleFilter && input.roleFilter !== "ALL" ? input.roleFilter : null;
    const order = { MANAGER: 0, TEAMLEAD: 1, EMPLOYEE: 2 };

    const departments = rows
      .filter((r) => wanted.includes(r.name))
      .map((r) => {
        const people = new Map();
        const add = (u, key) => {
          const id = u.id || `${key}:${u.name}`;
          if (!people.has(id)) people.set(id, { name: u.name, role: ROLE_LABELS[key], key });
        };
        for (const a of r.userAccess) if (a.user.role.name === "MANAGER" || a.user.role.name === "TEAMLEAD") add(a.user, a.user.role.name);
        for (const u of r.users) if (u.role.name === "EMPLOYEE") add(u, "EMPLOYEE");
        const everyone = [...people.values()];
        const counts = { MANAGER: 0, TEAMLEAD: 0, EMPLOYEE: 0 };
        for (const p of everyone) counts[p.key] += 1;
        const members = everyone
          .filter((m) => !only || m.key === only)
          .sort((x, y) => order[x.key] - order[y.key] || x.name.localeCompare(y.name))
          .map(({ name, role }) => ({ name, role }));
        return { name: r.name, total: members.length, counts, members: members.slice(0, MEMBER_CAP) };
      });

    await ctx.audit("TOOL_DEPARTMENT_MEMBERS", "Department", null, "SUCCESS");
    return { departments, availableDepartments: allNames };
  },
};

// Active Administrator accounts (names only). Administrators belong to no department, so they are never in
// a department list; only an Administrator may list them (tool policy).
const getAdminUsers = {
  name: "get_admin_users",
  description: "Active Administrator accounts (names only). Admin only.",
  inputSchema: {},
  async run(ctx) {
    const rows = await prisma.user.findMany({ where: { isActive: true, role: { name: "ADMIN" } }, select: { id: true, name: true } });
    const admins = rows.map((r) => ({ name: r.name, role: ROLE_LABELS.ADMIN })).sort((a, b) => a.name.localeCompare(b.name));
    await ctx.audit("TOOL_ADMIN_USERS", "User", null, "SUCCESS");
    return { total: admins.length, admins: admins.slice(0, MEMBER_CAP) };
  },
};

const getStatusDefinition = {
  name: "get_status_definition",
  description: "Meaning of the ticket statuses used by this application.",
  inputSchema: {},
  async run() {
    return { statuses: Object.entries(STATUS_LABELS).map(([key, label]) => ({ key, label })) };
  },
};

const getPriorityDefinition = {
  name: "get_priority_definition",
  description: "The configured ticket priorities, lowest level first.",
  inputSchema: {},
  async run() {
    try {
      const rows = await prisma.priority.findMany({ select: { name: true, level: true, color: true }, orderBy: { level: "asc" } });
      return { priorities: rows };
    } catch (err) {
      throw new ChatError(CODES.DATABASE_ERROR, { internal: err.message });
    }
  },
};

const getSlaInformation = {
  name: "get_sla_information",
  description: "SLA availability: this application no longer tracks SLAs.",
  inputSchema: {},
  async run() {
    return { slaTracked: false, note: "SLA targets, due dates and breaches are not recorded in this application." };
  },
};

module.exports = {
  tools: [
    getCurrentUser,
    getPortalCapabilities,
    getProfileSummary,
    getNavigationSteps,
    getKnowledgeArticle,
    getStatusDefinition,
    getPriorityDefinition,
    getSlaInformation,
    listDepartments,
    getDepartmentMembers,
    getAdminUsers,
  ],
  CAPABILITIES,
};
