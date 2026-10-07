const prisma = require("../config/prisma");

const DAY_MS = 24 * 60 * 60 * 1000;

// Deletes chat data older than `days`: conversations (messages and feedback
// cascade via their foreign keys) by last activity, and chat audit events by
// age. Not scheduled automatically — see docs/chatbot-deployment.md.
async function purgeOldChatData(days) {
  if (!Number.isInteger(days) || days < 1) throw new Error("days must be a positive integer");
  const cutoff = new Date(Date.now() - days * DAY_MS);
  const conversations = await prisma.chatConversation.deleteMany({ where: { lastMessageAt: { lt: cutoff } } });
  // Abandoned ticket drafts (and their stored files) follow the same rule.
  await prisma.chatTicketDraft.deleteMany({ where: { updatedAt: { lt: cutoff } } });
  const auditEvents = await prisma.chatAuditEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return { conversationsDeleted: conversations.count, auditEventsDeleted: auditEvents.count, cutoff };
}

module.exports = { purgeOldChatData };
