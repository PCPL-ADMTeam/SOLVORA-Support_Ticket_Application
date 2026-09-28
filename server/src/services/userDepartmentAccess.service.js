// The source of truth for "which departments can this MANAGER/TEAMLEAD
// manage" — see UserDepartmentAccess in schema.prisma (renamed/generalized
// from the old AGENT-only AgentDepartmentAccess once MANAGER was added
// alongside the AGENT->TEAMLEAD rename). User.departmentId/isManager and
// Ticket.managerId are left untouched elsewhere and are no longer read for
// this decision anywhere in the codebase.
//
// The two roles that use this table have DIFFERENT multiplicity rules:
//   MANAGER  — may hold several rows (multi-department), no per-department cap.
//   TEAMLEAD — holds EXACTLY ONE row; a department may hold at most
//              MAX_TEAMLEADS_PER_DEPARTMENT such rows across all its TEAMLEADs.
// Every mutating function below enforces the calling/target user's actual
// role — never a client-supplied assumption of which rule should apply.
const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const { recordAudit } = require("../utils/audit");
const { MAX_TEAMLEADS_PER_DEPARTMENT } = require("../config/constants");

const userSelect = { id: true, name: true, email: true, isActive: true };

async function getUserDepartments(userId) {
  const rows = await prisma.userDepartmentAccess.findMany({
    where: { userId },
    select: { departmentId: true, department: { select: { id: true, name: true } } },
    orderBy: { department: { name: "asc" } },
  });
  return rows.map((r) => r.department);
}

// Convenience used throughout ticket.service.js/dashboard.service.js for
// authorization/scoping — just the bare id list, cheap to compute inline
// wherever a Prisma `in` filter is needed.
async function getUserDepartmentIds(userId) {
  const rows = await prisma.userDepartmentAccess.findMany({ where: { userId }, select: { departmentId: true } });
  return rows.map((r) => r.departmentId);
}

async function hasAccess(userId, departmentId) {
  if (!userId || !departmentId) return false;
  const row = await prisma.userDepartmentAccess.findUnique({
    where: { userId_departmentId: { userId, departmentId } },
  });
  return Boolean(row);
}

// THE one shared "what department(s) does this user currently belong to,
// right now" resolver — role-aware, so every screen that needs to show or
// derive a user's department (Users page, /auth/login, /auth/refresh,
// /auth/me, Profile, Raise Ticket) reads the exact same answer instead of
// each picking its own source. This replaces the legacy assumption of
// reading `User.departmentId` unconditionally, which is only ever correct
// for an EMPLOYEE now:
//   EMPLOYEE -> User.departmentId (the legacy field itself, passed in as
//               `user.department`, already the right source and untouched
//               here)
//   TEAMLEAD -> their one UserDepartmentAccess department (never more than
//               one, enforced elsewhere) — surfaced as BOTH a singular
//               `department` (for screens that expect one) and a
//               single-element `departmentAccess` array
//   MANAGER  -> ALL their UserDepartmentAccess departments — surfaced only
//               as `departmentAccess` (plural); `department` is
//               deliberately left null rather than misrepresenting one of
//               several as "the" department
//   ADMIN    -> no department restriction; both fields empty/null
// `user` must include `role: { name }` and (for the EMPLOYEE branch) the
// legacy `department` relation already loaded by the caller — this
// function never re-fetches those, only the UserDepartmentAccess side.
async function resolveUserDepartmentInfo(user) {
  const roleName = user.role?.name;

  if (roleName === "TEAMLEAD") {
    const departments = await getUserDepartments(user.id);
    return { department: departments[0] || null, departmentAccess: departments };
  }

  if (roleName === "MANAGER") {
    const departments = await getUserDepartments(user.id);
    return { department: null, departmentAccess: departments };
  }

  // EMPLOYEE and ADMIN — legacy field remains the correct (and, for ADMIN,
  // simply absent) source; no UserDepartmentAccess involvement.
  return { department: user.department || null, departmentAccess: [] };
}

// Active MANAGERs currently authorized for a department — used for the
// email CC group (see utils/recipientBuilder.js) and the Department Details
// "Managers" section. Inactive/deactivated users are excluded so a stale
// access grant for a deactivated account never becomes an email recipient
// or an authorization bypass.
async function getActiveDepartmentManagers(departmentId) {
  const rows = await prisma.userDepartmentAccess.findMany({
    where: { departmentId, user: { isActive: true, role: { name: "MANAGER" } } },
    select: { user: { select: userSelect } },
    orderBy: { user: { name: "asc" } },
  });
  return rows.map((r) => r.user);
}

// Active TEAMLEADs currently authorized for a department — the TO group for
// TICKET_CREATED and the primary department-management authorization set
// (see ticket.service.js). Same active-only exclusion as above.
async function getActiveDepartmentTeamLeads(departmentId) {
  const rows = await prisma.userDepartmentAccess.findMany({
    where: { departmentId, user: { isActive: true, role: { name: "TEAMLEAD" } } },
    select: { user: { select: userSelect } },
    orderBy: { user: { name: "asc" } },
  });
  return rows.map((r) => r.user);
}

async function assertManagementUser(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!user) throw new ApiError(404, "User not found");
  if (user.role.name !== "MANAGER" && user.role.name !== "TEAMLEAD") {
    throw new ApiError(400, "Only MANAGER or TEAMLEAD users can be granted department access");
  }
  return user;
}

async function addManagerDepartmentAccess(actorId, managerId, departmentId) {
  const user = await prisma.user.findUnique({ where: { id: managerId }, include: { role: true } });
  if (!user) throw new ApiError(404, "User not found");
  if (user.role.name !== "MANAGER") throw new ApiError(400, "Only MANAGER users can be granted multi-department access");
  if (!user.isActive) throw new ApiError(400, "This Manager account is not active.");

  const department = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!department) throw new ApiError(404, "Department not found");

  const existing = await prisma.userDepartmentAccess.findUnique({
    where: { userId_departmentId: { userId: managerId, departmentId } },
  });
  if (existing) return existing; // already granted — idempotent, not an error

  const created = await prisma.userDepartmentAccess.create({
    data: { userId: managerId, departmentId, createdBy: actorId || null },
  });

  await recordAudit({
    userId: actorId,
    action: "MANAGER_DEPARTMENT_ACCESS_GRANTED",
    entityType: "UserDepartmentAccess",
    entityId: created.id,
    newValues: { managerId, departmentId },
  });

  return created;
}

// Sets a TEAMLEAD's single department. Because TEAMLEAD is strictly
// single-department, this REJECTS the request outright if the Team Lead
// already holds a DIFFERENT department — it never silently moves/
// reassigns them. An Admin must explicitly remove the existing assignment
// first (see removeUserDepartmentAccess) before this Team Lead becomes
// eligible for a different department. Re-selecting the SAME department
// they already have is a harmless no-op. Also enforces
// MAX_TEAMLEADS_PER_DEPARTMENT on the destination department.
async function setTeamLeadDepartment(actorId, teamLeadId, departmentId) {
  const user = await prisma.user.findUnique({ where: { id: teamLeadId }, include: { role: true } });
  if (!user) throw new ApiError(404, "User not found");
  if (user.role.name !== "TEAMLEAD") throw new ApiError(400, "Only TEAMLEAD users can be assigned a single department this way");
  if (!user.isActive) throw new ApiError(400, "This Team Lead account is not active.");

  const department = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!department) throw new ApiError(404, "Department not found");

  const current = await prisma.userDepartmentAccess.findFirst({ where: { userId: teamLeadId }, include: { department: { select: { name: true } } } });
  if (current) {
    if (current.departmentId === departmentId) return current; // no-op, already there
    throw new ApiError(
      400,
      `This Team Lead is already assigned to the ${current.department.name} department. Remove that assignment before assigning another department.`
    );
  }

  const currentCount = await prisma.userDepartmentAccess.count({
    where: { departmentId, user: { role: { name: "TEAMLEAD" } } },
  });
  if (currentCount >= MAX_TEAMLEADS_PER_DEPARTMENT) {
    throw new ApiError(400, "This department has reached the maximum number of Team Leads.");
  }

  const created = await prisma.userDepartmentAccess.create({
    data: { userId: teamLeadId, departmentId, createdBy: actorId || null },
  });

  await recordAudit({
    userId: actorId,
    action: "TEAMLEAD_DEPARTMENT_SET",
    entityType: "UserDepartmentAccess",
    entityId: created.id,
    newValues: { teamLeadId, departmentId },
  });

  return created;
}

async function removeUserDepartmentAccess(actorId, userId, departmentId) {
  const existing = await prisma.userDepartmentAccess.findUnique({
    where: { userId_departmentId: { userId, departmentId } },
  });
  if (!existing) throw new ApiError(404, "This user does not have access to this department");

  await prisma.userDepartmentAccess.delete({ where: { id: existing.id } });

  await recordAudit({
    userId: actorId,
    action: "USER_DEPARTMENT_ACCESS_REVOKED",
    entityType: "UserDepartmentAccess",
    entityId: existing.id,
    oldValues: { userId, departmentId },
  });
}

// Bulk replace — used by the Admin Users "Department Access" dialog.
// Role-aware: a MANAGER may pass any number of department ids (diffed
// against their current set, same as before); a TEAMLEAD may pass AT MOST
// ONE — passing more than one is rejected outright rather than silently
// truncated, since that would otherwise silently violate "exactly one
// department for TEAMLEAD" from the API layer.
async function replaceUserDepartmentAccess(actorId, userId, departmentIds) {
  const user = await assertManagementUser(userId);
  const uniqueIds = [...new Set(departmentIds)];

  if (user.role.name === "TEAMLEAD") {
    if (uniqueIds.length > 1) {
      throw new ApiError(400, "A Team Lead can only be assigned to exactly one department.");
    }
    if (uniqueIds.length === 0) {
      const current = await prisma.userDepartmentAccess.findFirst({ where: { userId } });
      if (current) await removeUserDepartmentAccess(actorId, userId, current.departmentId);
      return [];
    }
    await setTeamLeadDepartment(actorId, userId, uniqueIds[0]);
    return getUserDepartments(userId);
  }

  // MANAGER — unlimited multi-department, diff-based bulk replace so
  // re-selecting an existing department keeps its original createdAt/
  // createdBy rather than being deleted and recreated.
  if (uniqueIds.length) {
    const found = await prisma.department.count({ where: { id: { in: uniqueIds } } });
    if (found !== uniqueIds.length) throw new ApiError(400, "One or more departments are invalid");
  }

  const current = await prisma.userDepartmentAccess.findMany({ where: { userId }, select: { departmentId: true } });
  const currentIds = new Set(current.map((r) => r.departmentId));
  const toAdd = uniqueIds.filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !uniqueIds.includes(id));

  await prisma.$transaction(async (tx) => {
    if (toRemove.length) {
      await tx.userDepartmentAccess.deleteMany({ where: { userId, departmentId: { in: toRemove } } });
    }
    for (const departmentId of toAdd) {
      await tx.userDepartmentAccess.create({ data: { userId, departmentId, createdBy: actorId || null } });
    }
  });

  await recordAudit({
    userId: actorId,
    action: "MANAGER_DEPARTMENT_ACCESS_REPLACED",
    entityType: "User",
    entityId: userId,
    oldValues: { departmentIds: [...currentIds] },
    newValues: { departmentIds: uniqueIds },
  });

  return getUserDepartments(userId);
}

module.exports = {
  getUserDepartments,
  getUserDepartmentIds,
  resolveUserDepartmentInfo,
  hasAccess,
  getActiveDepartmentManagers,
  getActiveDepartmentTeamLeads,
  addManagerDepartmentAccess,
  setTeamLeadDepartment,
  removeUserDepartmentAccess,
  replaceUserDepartmentAccess,
};
