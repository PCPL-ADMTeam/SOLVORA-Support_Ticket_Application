const prisma = require("../config/prisma");
const { normalizeMessage } = require("./intents/aliases");
const { forLog } = require("./interpretation/dataRedactor");

// "Misses": questions the assistant could not answer well. Nothing extra is
// stored for this. It is built on demand from data the chat already keeps:
//   - assistant replies that ended as "unsupported" or "no results", and
//   - replies a user rated not helpful / incorrect / other.
// Each is paired with the user's question that came right before it. Text is
// redacted (emails and long numbers masked) and grouped, so the report is a
// to-do list of phrasings to teach the rules, not a transcript of anyone's chats.

const REASONS = {
  CHAT_UNSUPPORTED_INTENT: "not understood",
  CHAT_NO_RESULTS: "no results",
};
const BAD_RATINGS = ["not_helpful", "incorrect", "other"];

async function questionBefore(message) {
  return prisma.chatMessage.findFirst({
    where: { conversationId: message.conversationId, senderType: "USER", createdAt: { lt: message.createdAt } },
    orderBy: { createdAt: "desc" },
  });
}

// Pure: rows [{ text, reason, intent, role, at }] -> grouped, most frequent first.
function groupMisses(rows, limit = 50) {
  const groups = new Map();
  for (const r of rows) {
    const key = normalizeMessage(r.text).replace(/\b\d{4,}\b/g, "#");
    const g = groups.get(key) || { text: r.text, count: 0, reasons: new Set(), intents: new Set(), roles: new Set(), lastSeen: r.at };
    g.count += 1;
    g.reasons.add(r.reason);
    if (r.intent) g.intents.add(r.intent);
    if (r.role) g.roles.add(r.role);
    if (r.at > g.lastSeen) g.lastSeen = r.at;
    groups.set(key, g);
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen)
    .slice(0, limit)
    .map((g) => ({ text: g.text, count: g.count, reasons: [...g.reasons], intents: [...g.intents], roles: [...g.roles], lastSeen: g.lastSeen }));
}

async function collectMisses({ days = 30, limit = 50, now = new Date() } = {}) {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const rows = [];

  const failed = await prisma.chatMessage.findMany({
    where: { senderType: "ASSISTANT", errorCode: { in: Object.keys(REASONS) }, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const rated = await prisma.chatFeedback.findMany({ where: { rating: { in: BAD_RATINGS }, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 500 });
  const ratedMessages = await Promise.all(rated.map((f) => prisma.chatMessage.findUnique({ where: { id: f.messageId } })));

  const jobs = [
    ...failed.map((m) => ({ m, reason: REASONS[m.errorCode] })),
    ...ratedMessages.filter(Boolean).map((m, i) => ({ m, reason: `rated ${rated[i].rating.replace("_", " ")}` })),
  ];
  for (const { m, reason } of jobs) {
    const q = await questionBefore(m);
    if (!q) continue;
    const convo = await prisma.chatConversation.findUnique({ where: { id: m.conversationId } });
    rows.push({ text: forLog(q.messageText).slice(0, 300), reason, intent: m.intent, role: convo?.portalRole, at: m.createdAt });
  }
  return { days, misses: groupMisses(rows, limit) };
}

module.exports = { collectMisses, groupMisses };
