const prisma = require("../config/prisma");
const ApiError = require("../utils/ApiError");
const { recordAudit } = require("../utils/audit");

async function createIssue(actorId, { departmentId, name, isOther }) {
  const department = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!department) throw new ApiError(400, "Department not found");

  const issue = await prisma.issue.create({ data: { departmentId, name, isOther: Boolean(isOther) } });
  await recordAudit({ userId: actorId, action: "ISSUE_CREATED", entityType: "Issue", entityId: issue.id, newValues: { departmentId, name } });
  return issue;
}

async function updateIssue(actorId, id, { name, isActive }) {
  const existing = await prisma.issue.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "Issue not found");

  // The "Others" fallback must always stay selectable — never let it be
  // deactivated out of the ticket form's issue dropdown (name is fine to
  // rename, since createTicket's Others handling keys off isOther, not name).
  if (existing.isOther && isActive === false) {
    throw new ApiError(400, 'The "Others" fallback issue must always remain active.');
  }

  const data = {};
  if (name !== undefined) data.name = name;
  if (isActive !== undefined) data.isActive = isActive;

  const issue = await prisma.issue.update({ where: { id }, data });
  await recordAudit({ userId: actorId, action: "ISSUE_UPDATED", entityType: "Issue", entityId: id, newValues: { name, isActive } });
  return issue;
}

async function deleteIssue(actorId, id) {
  const existing = await prisma.issue.findUnique({ where: { id } });
  if (!existing) throw new ApiError(404, "Issue not found");
  if (existing.isOther) {
    throw new ApiError(400, 'The "Others" fallback issue cannot be deleted — every department must always have one.');
  }

  // Tickets no longer reference Issue at all (replaced by the free-text
  // Problem Summary field — see ticket.service.js#createTicket), so the
  // old "is this issue still in use by a ticket" guard no longer applies;
  // this model is now dormant/historical only (see schema.prisma).
  await prisma.issue.delete({ where: { id } });
  await recordAudit({ userId: actorId, action: "ISSUE_DELETED", entityType: "Issue", entityId: id });
}

module.exports = { createIssue, updateIssue, deleteIssue };
