const prisma = require("../config/prisma");

// Chatbot audit trail (ChatAuditEvent). Records WHO did WHAT to WHICH
// resource with WHAT result — never message text, ticket content, tokens, or
// AI context. Failures to write an audit row never break the user's request,
// but are surfaced on the server log (without payload).
async function recordChatAudit({ userId, conversationId, action, resourceType, resourceId, result }) {
  if (result === "DENIED") {
    // Operational log line for access denials, in addition to the DB row.
    console.warn(`[chatbot] denied user=${userId || "-"} action=${action} resource=${resourceType || "-"}:${resourceId || "-"}`);
  }
  try {
    await prisma.chatAuditEvent.create({
      data: {
        userId: userId || null,
        conversationId: conversationId || null,
        action,
        resourceType: resourceType || null,
        resourceId: resourceId ? String(resourceId).slice(0, 100) : null,
        result,
      },
    });
  } catch (err) {
    console.error(`[chatbot] audit write failed action=${action}: ${err.code || err.name}`);
  }
}

module.exports = { recordChatAudit };
