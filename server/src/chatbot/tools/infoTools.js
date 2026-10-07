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
const MEMBER_CAP = 50;
const ROLE_LABELS = { MANAGER: "Manager", TEAMLEAD: "Team Lead", EMPLOYEE: "Employee" };
const getDepartmentMembers = {
  name: "get_department_members",
  description: "Active people (name and role only) in the authorized department(s) named in the question.",
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
        users: { where: { isActive: true }, select: { name: true, role: { select: { name: true } } } },
        userAccess: { where: { user: { isActive: true } }, select: { user: { select: { name: true, role: { select: { name: true } } } } } },
      },
      orderBy: { name: "asc" },
    });
    const allNames = rows.map((r) => r.name);
    const wanted = input.all ? allNames : matchDepartments(input.question || "", allNames);
    const only = input.roleFilter && input.roleFilter !== "ALL" ? input.roleFilter : null;

    const departments = rows
      .filter((r) => wanted.includes(r.name))
      .map((r) => {
        // Employees come from User.departmentId; Managers/Team Leads from
        // UserDepartmentAccess (the app's source of truth for those roles).
        const people = new Map();
        for (const u of r.users) if (u.role.name !== "ADMIN") people.set(`${u.role.name}:${u.name}`, { name: u.name, role: ROLE_LABELS[u.role.name] || u.role.name, key: u.role.name });
        for (const a of r.userAccess) people.set(`${a.user.role.name}:${a.user.name}`, { name: a.user.name, role: ROLE_LABELS[a.user.role.name] || a.user.role.name, key: a.user.role.name });
        const order = { Manager: 0, "Team Lead": 1, Employee: 2 };
        const members = [...people.values()]
          .filter((m) => !only || m.key === only)
          .sort((x, y) => (order[x.role] ?? 3) - (order[y.role] ?? 3) || x.name.localeCompare(y.name))
          .map(({ name, role }) => ({ name, role }));
        return { name: r.name, total: members.length, members: members.slice(0, MEMBER_CAP) };
      });

    await ctx.audit("TOOL_DEPARTMENT_MEMBERS", "Department", null, "SUCCESS");
    return { departments, availableDepartments: allNames };
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
  ],
  CAPABILITIES,
};
