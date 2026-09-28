const { Prisma } = require("@prisma/client");
const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const { scopeWhereForUser, scopeWhereForTab, resolveUserDepartmentIds, isManagementRole } = require("./ticket.service");

const STATUSES = ["OPEN", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED", "REOPENED"];

// Dashboard Department dropdown's own authorization check — separate from
// (and stricter than) scopeWhereForTab's AND-only narrowing below, which
// only ever prevents an unauthorized departmentId from EXPANDING what a
// caller sees, never from being echoed by an unscoped query. The Department/
// Employee Workload raw SQL below queries `departments`/`users` directly
// (not `tickets`), so it has no ticket-level scope filter to AND against —
// without this explicit check, a MANAGER could pass a departmentId they
// don't manage and enumerate that OTHER department's employee names/counts
// even though every ticket-count column would correctly come back zero.
// ADMIN may pass any departmentId; MANAGER/TEAMLEAD only one they currently
// hold UserDepartmentAccess to; EMPLOYEE (never management, never ADMIN) is
// rejected outright — their dashboard has no department concept at all.
function assertDepartmentAccessible(user, departmentId, userDepartmentIds) {
  if (!departmentId) return;
  if (user.role.name === "ADMIN") return;
  if (isManagementRole(user) && userDepartmentIds.includes(departmentId)) return;
  throw new ApiError(403, "You do not have access to this department");
}

// Builds a raw-SQL WHERE fragment mirroring scopeWhereForUser()'s Prisma
// `where`, for the queries below that need raw SQL (date bucketing, AVG()).
// Values are bound via Prisma.sql template params, never string-concatenated.
// userDepartmentIds is the caller's full UserDepartmentAccess set (see
// ticket.service.js#resolveUserDepartmentIds) — a MANAGER may have several,
// a TEAMLEAD always exactly one, so this is an `IN (...)`, not a single
// equality check, and works identically either way.
function scopeSqlForUser(user, userDepartmentIds = []) {
  if (user.role.name === "ADMIN") return Prisma.sql`TRUE`;
  if (isManagementRole(user)) {
    return userDepartmentIds.length ? Prisma.sql`"toDepartmentId" IN (${Prisma.join(userDepartmentIds)})` : Prisma.sql`FALSE`;
  }
  return Prisma.sql`("requesterId" = ${user.id} OR "assigneeId" = ${user.id})`;
}

// "My Tickets" (assigned to me) vs "My Requests" (raised by me) dashboard
// tabs — independent of role, driven purely by real assigneeId/requesterId
// columns so the numbers always reflect actual tickets, never hardcoded.
// scopeWhereForTab itself is now imported from ticket.service.js (single
// source of truth, shared with listTickets) instead of being redefined
// here — same logic, same result, just no longer duplicated.
function scopeSqlForTab(user, scope, userDepartmentIds = []) {
  if (scope === "assigned") return Prisma.sql`"assigneeId" = ${user.id}`;
  if (scope === "created") return Prisma.sql`"requesterId" = ${user.id}`;
  if (scope === "mine") return Prisma.sql`("requesterId" = ${user.id} OR "assigneeId" = ${user.id})`;
  return scopeSqlForUser(user, userDepartmentIds);
}

// departmentId here is the Dashboard/Tickets department-dropdown's
// selection — "All Departments" (omitted) shows every ticket across every
// department the caller currently has access to (userDepartmentIds, ANDed
// onto scope exactly like listTickets' own ?departmentId= filter, so
// selecting a department the caller doesn't actually have access to can
// only ever narrow the result to zero, never expand it).
async function getStats(user, { dateFrom, dateTo, days = 30, scope, departmentId, assigneeId, status } = {}) {
  const dateWhere = dateFrom || dateTo ? {
    createdAt: {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo ? { lte: new Date(dateTo) } : {}),
    },
  } : {};

  const userDepartmentIds = await resolveUserDepartmentIds(user);
  assertDepartmentAccessible(user, departmentId, userDepartmentIds);
  const departmentFilterWhere = departmentId ? { toDepartmentId: departmentId } : {};
  const departmentFilterSql = departmentId ? Prisma.sql`AND "toDepartmentId" = ${departmentId}` : Prisma.empty;

  // Dashboard cross-filtering (BI-style drill-down) — both are OPTIONAL,
  // ADDITIVE narrowing filters on top of the caller's own already-enforced
  // authorized scope below, exactly like departmentId above: a client
  // passing an assigneeId/status outside what scopeWhereForTab already
  // permits can only ever narrow the result to zero, never see anything
  // they couldn't already see. `assigneeId` selects one row from the
  // Employee Workload table (Team Lead/Manager Department Dashboard);
  // `status` mirrors a clicked Status pie slice.
  const assigneeFilterWhere = assigneeId ? { assigneeId } : {};
  const assigneeFilterSql = assigneeId ? Prisma.sql`AND "assigneeId" = ${assigneeId}` : Prisma.empty;
  // Deliberately NOT folded into `where` below — `where` backs the Status
  // pie/KPI counts, which must keep showing every status (including the
  // one currently selected) so the pie stays fully clickable/switchable
  // rather than collapsing to a single slice. `status` only narrows the
  // separate Priority breakdown (`priorityWhere`), matching "clicking a
  // status recalculates the Priority chart" — never the Status chart itself.
  const statusFilterWhere = status ? { status } : {};

  const where = { AND: [scopeWhereForTab(user, scope, userDepartmentIds), departmentFilterWhere, assigneeFilterWhere, dateWhere] };
  const priorityWhere = { AND: [...where.AND, statusFilterWhere] };

  const scopeSql = scopeSqlForTab(user, scope, userDepartmentIds);

  // "Raised by Me" and "Total Department Tickets" are fixed-definition
  // KPIs, independent of whatever `scope` the caller passed for the
  // status/priority breakdown above — so a request for e.g. `?scope=
  // assigned` can never silently redefine or blank out either number. Both
  // are derived only from the authenticated `user` (never a client-
  // supplied id), and both use the SAME date range as every other KPI here.
  //
  // raisedByMe: every ticket this user raised, regardless of which
  // department currently owns it (so a ticket transferred elsewhere after
  // being raised still counts here) — plain requesterId match, same
  // definition scopeWhereForTab's own "created" branch already uses.
  const raisedByMeWhere = { AND: [{ requesterId: user.id }, dateWhere] };
  // assignedToMe: mirrors raisedByMe exactly, for assigneeId instead of
  // requesterId — the Team Lead "My Dashboard"'s own "Assigned to Me" KPI
  // (Managers never have an "Assigned to Me" view — they're never assignees
  // — but the field itself stays harmlessly 0 for them, same precedent as
  // `unassignedCount` below being unused by roles that don't render it).
  const assignedToMeWhere = { AND: [{ assigneeId: user.id }, dateWhere] };
  // totalDepartmentTickets: reuses ticket.service.js's own
  // scopeWhereForUser — for a MANAGER/TEAMLEAD that's now "every ticket
  // currently routed to any department I have access to" (or just the
  // selected one, if the dropdown narrowed it), the SAME rule
  // assertCanView/listTickets already enforce for what they may even see,
  // so this can never become a second, conflicting notion of "department
  // ticket." For ADMIN/EMPLOYEE this mirrors their own normal visibility
  // (system-wide / own tickets) — an unused-but-harmless field for roles
  // whose dashboards don't render it.
  const departmentWhere = { AND: [scopeWhereForUser(user, userDepartmentIds), departmentFilterWhere, dateWhere] };

  const [
    statusGroups,
    priorityGroups,
    totalCount,
    unassignedCount,
    raisedByMe,
    assignedToMe,
    totalDepartmentTickets,
  ] = await Promise.all([
    prisma.ticket.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.ticket.groupBy({ by: ["priorityId"], where: priorityWhere, _count: { _all: true } }),
    prisma.ticket.count({ where }),
    // Used by the Manager/Team Lead department dashboard to surface tickets
    // nobody is working yet; harmless extra field for Admin/Employee, who
    // don't display it.
    prisma.ticket.count({ where: { AND: [...where.AND, { assigneeId: null }] } }),
    prisma.ticket.count({ where: raisedByMeWhere }),
    prisma.ticket.count({ where: assignedToMeWhere }),
    prisma.ticket.count({ where: departmentWhere }),
  ]);

  const priorities = await prisma.priority.findMany({ select: { id: true, name: true, color: true } });

  const kpis = {
    total: totalCount,
    unassigned: unassignedCount,
    raisedByMe,
    assignedToMe,
    totalDepartmentTickets,
    ...Object.fromEntries(STATUSES.map((s) => [s.toLowerCase(), 0])),
  };
  for (const g of statusGroups) kpis[g.status.toLowerCase()] = g._count._all;

  const byStatus = STATUSES.map((s) => ({
    status: s,
    count: statusGroups.find((g) => g.status === s)?._count._all || 0,
  }));

  const byPriority = priorities.map((p) => ({
    // `id` is additive — needed so a Priority bar click can drill into the
    // Tickets List with a real `?priorityId=` (a Priority's actual DB id),
    // never its display name. Every existing consumer that only read
    // `priority`/`color`/`count` is unaffected.
    id: p.id,
    priority: p.name,
    color: p.color,
    count: priorityGroups.find((g) => g.priorityId === p.id)?._count._all || 0,
  }));

  // Created-vs-resolved trend, bucketed by day via SQL date_trunc — a single
  // aggregate query rather than pulling every row into Node. Also respects
  // the selected employee (assigneeFilterSql) so the trend recalculates
  // alongside every other chart when an Employee Workload row is selected —
  // deliberately NOT status-filtered (a created-vs-resolved-over-time trend
  // narrowed to one status wouldn't compose meaningfully).
  const createdSeries = await prisma.$queryRaw`
    SELECT date_trunc('day', "createdAt")::date AS day, COUNT(*)::int AS count
    FROM tickets
    WHERE ${scopeSql} ${departmentFilterSql} ${assigneeFilterSql} AND "createdAt" >= NOW() - make_interval(days => ${days}::int)
    GROUP BY 1 ORDER BY 1`;

  const resolvedSeries = await prisma.$queryRaw`
    SELECT date_trunc('day', "resolvedAt")::date AS day, COUNT(*)::int AS count
    FROM tickets
    WHERE ${scopeSql} ${departmentFilterSql} ${assigneeFilterSql} AND "resolvedAt" IS NOT NULL AND "resolvedAt" >= NOW() - make_interval(days => ${days}::int)
    GROUP BY 1 ORDER BY 1`;

  const trend = mergeSeries(createdSeries, resolvedSeries, days);

  // Raw-SQL date bounds mirroring `dateWhere` above (same dateFrom/dateTo the
  // KPIs/status/priority breakdowns already use — deliberately NOT the
  // trend's separate rolling `days` window) for the two workload queries
  // below, which query `departments`/`users` directly rather than `tickets`.
  const dateFromSql = dateFrom ? Prisma.sql`AND t."createdAt" >= ${new Date(dateFrom)}` : Prisma.empty;
  const dateToSql = dateTo ? Prisma.sql`AND t."createdAt" <= ${new Date(dateTo)}` : Prisma.empty;
  const isPersonalScope = ["created", "assigned", "mine"].includes(scope);

  // Department Workload — the Admin "All Departments" / Manager "All
  // Accessible Departments" view (see DashboardPage.jsx/
  // AgentDashboardPage.jsx): one row per department the caller may see.
  // Never computed for TEAMLEAD (exactly one department — they go straight
  // to Employee Workload below, no "all departments" level exists for them),
  // for EMPLOYEE (no department concept on their dashboard at all), or once
  // a specific department is already selected (that's Employee Workload's
  // job instead). A LEFT JOIN from `departments` keeps a department with
  // zero matching tickets in the list at 0 rather than dropping the row.
  const showDepartmentWorkload = !isPersonalScope && !departmentId && (user.role.name === "ADMIN" || user.role.name === "MANAGER");
  let departmentWorkload = [];
  if (showDepartmentWorkload) {
    const departmentScopeSql = user.role.name === "ADMIN"
      ? Prisma.sql`TRUE`
      : (userDepartmentIds.length ? Prisma.sql`d.id IN (${Prisma.join(userDepartmentIds)})` : Prisma.sql`FALSE`);
    const rows = await prisma.$queryRaw`
      SELECT
        d.id AS "departmentId",
        d.name AS "departmentName",
        COUNT(t.id) FILTER (WHERE t.status = 'OPEN')::int AS "openTickets",
        COUNT(t.id) FILTER (WHERE t.status = 'IN_PROGRESS')::int AS "inProgressTickets",
        COUNT(t.id) FILTER (WHERE t.status = 'RESOLVED')::int AS "resolvedTickets",
        COUNT(t.id) FILTER (WHERE t.status = 'CLOSED')::int AS "closedTickets"
      FROM departments d
      LEFT JOIN tickets t ON t."toDepartmentId" = d.id ${dateFromSql} ${dateToSql}
      WHERE ${departmentScopeSql}
      GROUP BY d.id, d.name
      ORDER BY d.name`;
    departmentWorkload = rows.map((r) => ({
      departmentId: r.departmentId,
      departmentName: r.departmentName,
      openTickets: Number(r.openTickets),
      inProgressTickets: Number(r.inProgressTickets),
      resolvedTickets: Number(r.resolvedTickets),
      closedTickets: Number(r.closedTickets),
    }));
  }

  // Employee workload: tickets per EMPLOYEE (the people tickets are actually
  // assigned to), broken down by status. Computed once a specific department
  // is selected (Admin/Manager drilling in) or unconditionally for a
  // TEAMLEAD's own single department (no "all departments" state to drill
  // down FROM); skipped otherwise so Admin/Manager's "all departments" view
  // gets Department Workload above instead, never a mixed cross-department
  // employee list. `openTickets` keeps its original definition (any status
  // still not RESOLVED/CLOSED) for backward compatibility with existing
  // Team Lead behavior; `closedTickets` is a new, additive field alongside
  // it so `resolvedTickets` can now mean RESOLVED only, matching Department
  // Workload's own Open/In Progress/Resolved/Closed column split.
  const showEmployeeWorkload = !isPersonalScope && (Boolean(departmentId) || user.role.name === "TEAMLEAD");
  let workload = [];
  if (showEmployeeWorkload) {
    const workloadDepartmentFilter = departmentId
      ? Prisma.sql`AND u."departmentId" = ${departmentId}`
      : (userDepartmentIds.length ? Prisma.sql`AND u."departmentId" IN (${Prisma.join(userDepartmentIds)})` : Prisma.sql`AND FALSE`);

    const rows = await prisma.$queryRaw`
      SELECT
        u.id AS "agentId",
        u.name AS "agentName",
        COUNT(t.id) FILTER (WHERE t.status NOT IN ('RESOLVED', 'CLOSED'))::int AS "openTickets",
        COUNT(t.id) FILTER (WHERE t.status = 'IN_PROGRESS')::int AS "inProgressTickets",
        COUNT(t.id) FILTER (WHERE t.status = 'RESOLVED')::int AS "resolvedTickets",
        COUNT(t.id) FILTER (WHERE t.status = 'CLOSED')::int AS "closedTickets"
      FROM users u
      JOIN roles r ON r.id = u."roleId" AND r.name = 'EMPLOYEE'
      LEFT JOIN tickets t ON t."assigneeId" = u.id AND ${scopeSql}
      WHERE u."isActive" = TRUE ${workloadDepartmentFilter}
      GROUP BY u.id, u.name
      ORDER BY "openTickets" DESC`;
    workload = rows.map((w) => ({
      ...w,
      agentId: String(w.agentId),
      openTickets: Number(w.openTickets),
      inProgressTickets: Number(w.inProgressTickets),
      resolvedTickets: Number(w.resolvedTickets),
      closedTickets: Number(w.closedTickets),
    }));
  }

  return { kpis, byStatus, byPriority, trend, workload, departmentWorkload };
}

function mergeSeries(createdRows, resolvedRows, days) {
  const map = new Map();
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    map.set(key, { date: key, created: 0, resolved: 0 });
  }
  for (const row of createdRows) {
    const key = new Date(row.day).toISOString().slice(0, 10);
    if (map.has(key)) map.get(key).created = Number(row.count);
  }
  for (const row of resolvedRows) {
    const key = new Date(row.day).toISOString().slice(0, 10);
    if (map.has(key)) map.get(key).resolved = Number(row.count);
  }
  return Array.from(map.values());
}

module.exports = { getStats, STATUSES };
