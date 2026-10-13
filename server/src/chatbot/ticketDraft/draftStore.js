const prisma = require("../../config/prisma");

// Storage for the ticket the user is raising through the assistant (see ChatTicketDraft in
// schema.prisma). Everything here is scoped by the authenticated user id; there is no way to
// read or change another user's draft. Files are not taken in the chat, so a draft holds only
// the ticket's fields.

const TTL_MS = 2 * 60 * 60 * 1000;

async function getActive(userId, conversationId) {
  const draft = await prisma.chatTicketDraft.findFirst({
    where: { userId, conversationId, status: "ACTIVE" },
    orderBy: { updatedAt: "desc" },
  });
  if (!draft) return null;
  if (draft.expiresAt.getTime() < Date.now()) {
    await prisma.chatTicketDraft.update({ where: { id: draft.id }, data: { status: "EXPIRED" } });
    return null;
  }
  return draft;
}

// One active draft per conversation: starting again replaces the old one.
async function create(userId, conversationId, fields) {
  await prisma.chatTicketDraft.updateMany({ where: { userId, conversationId, status: "ACTIVE" }, data: { status: "CANCELLED" } });
  return prisma.chatTicketDraft.create({
    data: { userId, conversationId, fields, step: "TITLE", expiresAt: new Date(Date.now() + TTL_MS) },
  });
}

async function save(id, { fields, step }) {
  return prisma.chatTicketDraft.update({
    where: { id },
    data: { ...(fields ? { fields } : {}), ...(step ? { step } : {}), expiresAt: new Date(Date.now() + TTL_MS) },
  });
}

const setStatus = (id, status) => prisma.chatTicketDraft.update({ where: { id }, data: { status } });

async function loadOwned(userId, draftId) {
  const draft = await prisma.chatTicketDraft.findFirst({ where: { id: draftId, userId } });
  return draft || null;
}

module.exports = { getActive, create, save, setStatus, loadOwned, TTL_MS };
