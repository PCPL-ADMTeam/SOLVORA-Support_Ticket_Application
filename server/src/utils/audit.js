const prisma = require("../config/prisma");

// Records an entry in the system-wide audit log. Call this from services
// for administrative/sensitive actions (user management, priority changes,
// bulk ticket operations, role changes) — NOT for routine per-ticket
// activity, which belongs in TicketHistory instead (see
// services/ticket.service.js).
async function recordAudit({ userId, action, entityType, entityId, oldValues, newValues, ipAddress }) {
  await prisma.auditLog.create({
    data: {
      userId: userId || null,
      action,
      entityType,
      entityId: entityId ? String(entityId) : null,
      oldValues: oldValues ?? undefined,
      newValues: newValues ?? undefined,
      ipAddress: ipAddress || null,
    },
  });
}

module.exports = { recordAudit };
