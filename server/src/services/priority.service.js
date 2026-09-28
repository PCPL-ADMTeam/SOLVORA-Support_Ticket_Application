const prisma = require("../config/prisma");
const { recordAudit } = require("../utils/audit");

const prioritySelect = {
  id: true,
  name: true,
  level: true,
  color: true,
};

async function listPriorities() {
  return prisma.priority.findMany({ select: prioritySelect, orderBy: { level: "asc" } });
}

async function createPriority(actorId, { name, level, color }) {
  const priority = await prisma.priority.create({ data: { name, level, color }, select: prioritySelect });
  await recordAudit({ userId: actorId, action: "PRIORITY_CREATED", entityType: "Priority", entityId: priority.id, newValues: { name, level } });
  return priority;
}

async function updatePriority(actorId, id, { name, level, color }) {
  const data = {};
  if (name !== undefined) data.name = name;
  if (level !== undefined) data.level = level;
  if (color !== undefined) data.color = color;
  const priority = await prisma.priority.update({ where: { id }, data, select: prioritySelect });
  await recordAudit({ userId: actorId, action: "PRIORITY_UPDATED", entityType: "Priority", entityId: id, newValues: { name, level, color } });
  return priority;
}

module.exports = { listPriorities, createPriority, updatePriority };
