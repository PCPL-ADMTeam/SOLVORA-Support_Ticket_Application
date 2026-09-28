const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const { recordAudit } = require("../utils/audit");
const { MAX_TEAMLEADS_PER_DEPARTMENT } = require("../config/constants");

// Department = the organizational group (multiple MANAGERs + up to
// MAX_TEAMLEADS_PER_DEPARTMENT TEAMLEADs via UserDepartmentAccess + its
// EMPLOYEE staff via User.departmentId — no separate Team/TeamMember
// layer). `managers`/`teamLeads` replace the old single `managers` (Agent)
// field: every ACTIVE user of the matching role with a UserDepartmentAccess
// row for this department — never derived from the legacy
// User.isManager/departmentId fields, which are kept only for backward
// compatibility and are no longer read here.
function toDepartmentShape(department) {
  const { users, userAccess, ...rest } = department;
  const activeAccess = userAccess.filter((a) => a.user.isActive);
  return {
    ...rest,
    managers: activeAccess.filter((a) => a.user.role.name === "MANAGER").map((a) => a.user),
    teamLeads: activeAccess.filter((a) => a.user.role.name === "TEAMLEAD").map((a) => a.user),
    maxTeamLeads: MAX_TEAMLEADS_PER_DEPARTMENT,
    employees: users.filter((u) => u.role.name === "EMPLOYEE"),
  };
}

async function listDepartments() {
  const departments = await prisma.department.findMany({
    select: {
      id: true,
      name: true,
      createdAt: true,
      users: {
        select: { id: true, name: true, email: true, isActive: true, isManager: true, role: { select: { name: true } } },
        orderBy: { name: "asc" },
      },
      userAccess: {
        select: { user: { select: { id: true, name: true, email: true, isActive: true, role: { select: { name: true } } } } },
        orderBy: { user: { name: "asc" } },
      },
    },
    orderBy: { name: "asc" },
  });
  return departments.map(toDepartmentShape);
}

async function createDepartment(actorId, { name }) {
  // Every department must always have the "Others" fallback issue — create
  // it in the same transaction so a brand-new department is immediately
  // usable on the ticket form, not left with an empty issue list.
  const department = await prisma.$transaction(async (tx) => {
    const created = await tx.department.create({ data: { name } });
    await tx.issue.create({ data: { departmentId: created.id, name: "Others", isOther: true } });
    return created;
  });
  await recordAudit({ userId: actorId, action: "DEPARTMENT_CREATED", entityType: "Department", entityId: department.id, newValues: { name } });
  return department;
}

async function updateDepartment(actorId, id, { name }) {
  const data = {};
  if (name !== undefined) data.name = name;

  const department = await prisma.department.update({ where: { id }, data });
  await recordAudit({ userId: actorId, action: "DEPARTMENT_UPDATED", entityType: "Department", entityId: id, newValues: { name } });
  return department;
}

async function deleteDepartment(actorId, id) {
  const [ticketsFrom, ticketsTo, userCount] = await Promise.all([
    prisma.ticket.count({ where: { fromDepartmentId: id } }),
    prisma.ticket.count({ where: { toDepartmentId: id } }),
    prisma.user.count({ where: { departmentId: id } }),
  ]);
  if (ticketsFrom > 0 || ticketsTo > 0) {
    throw new ApiError(409, "Cannot delete a department that has tickets referencing it.");
  }
  if (userCount > 0) {
    throw new ApiError(409, "Cannot delete a department that still has users assigned to it. Reassign them first.");
  }

  await prisma.department.delete({ where: { id } });
  await recordAudit({ userId: actorId, action: "DEPARTMENT_DELETED", entityType: "Department", entityId: id });
}

module.exports = { listDepartments, createDepartment, updateDepartment, deleteDepartment };
