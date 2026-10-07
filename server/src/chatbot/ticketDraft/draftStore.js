const prisma = require("../../config/prisma");
const ticketService = require("../../services/ticket.service");
const { ChatError, CODES } = require("../chatbot.errors");

// Storage for the ticket the user is raising through the assistant (see ChatTicketDraft in
// schema.prisma). Everything here is scoped by the authenticated user id; there is no way to
// read or change another user's draft.

const TTL_MS = 2 * 60 * 60 * 1000;
const invalid = (message) => new ChatError(CODES.ACTION_INVALID, { message });

const META = { select: { id: true, fileName: true, mimeType: true, size: true, createdAt: true } };

async function getActive(userId, conversationId) {
  const draft = await prisma.chatTicketDraft.findFirst({
    where: { userId, conversationId, status: "ACTIVE" },
    orderBy: { updatedAt: "desc" },
    include: { attachments: { ...META, orderBy: { createdAt: "asc" } } },
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
    include: { attachments: { ...META } },
  });
}

async function save(id, { fields, step }) {
  return prisma.chatTicketDraft.update({
    where: { id },
    data: { ...(fields ? { fields } : {}), ...(step ? { step } : {}), expiresAt: new Date(Date.now() + TTL_MS) },
    include: { attachments: { ...META, orderBy: { createdAt: "asc" } } },
  });
}

const setStatus = (id, status) => prisma.chatTicketDraft.update({ where: { id }, data: { status } });

// Attachment rules are the ticket service's own (5 files, 10 MB combined); the upload route has
// already applied multer's file-type filter and per-file size limit.
async function addFiles(draft, files) {
  const existing = draft.attachments || [];
  const MAX = ticketService.MAX_ATTACHMENTS_PER_TICKET;
  const MAX_BYTES = ticketService.MAX_ATTACHMENTS_TOTAL_SIZE_BYTES;
  if (existing.length + files.length > MAX) {
    throw invalid(`Maximum ${MAX} attachments are allowed per ticket. You already have ${existing.length}${existing.length ? ` and only ${Math.max(MAX - existing.length, 0)} more can be added` : ""}.`);
  }
  const total = existing.reduce((s, a) => s + a.size, 0) + files.reduce((s, f) => s + (f.size || 0), 0);
  if (total > MAX_BYTES) throw invalid(`Attachments cannot exceed ${ticketService.MAX_ATTACHMENTS_TOTAL_SIZE_MB} MB combined per ticket.`);
  for (const f of files) {
    await prisma.chatDraftAttachment.create({
      data: { draftId: draft.id, fileName: String(f.originalname || "attachment").slice(0, 200), mimeType: String(f.mimetype || "application/octet-stream").slice(0, 120), size: f.size || f.buffer?.length || 0, data: f.buffer },
    });
  }
  return prisma.chatTicketDraft.update({ where: { id: draft.id }, data: { expiresAt: new Date(Date.now() + TTL_MS) }, include: { attachments: { ...META, orderBy: { createdAt: "asc" } } } });
}

async function removeFile(draft, attachmentId) {
  const hit = (draft.attachments || []).find((a) => a.id === attachmentId);
  if (!hit) throw invalid("I couldn't find that attachment on your ticket.");
  await prisma.chatDraftAttachment.delete({ where: { id: attachmentId } });
  return hit;
}

// The files in the shape ticket.service.createTicket / addAttachment expect (multer memory files).
async function loadFiles(draftId) {
  const rows = await prisma.chatDraftAttachment.findMany({ where: { draftId }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ originalname: r.fileName, mimetype: r.mimeType, size: r.size, buffer: Buffer.from(r.data) }));
}

async function loadOwned(userId, draftId) {
  const draft = await prisma.chatTicketDraft.findFirst({ where: { id: draftId, userId }, include: { attachments: { ...META, orderBy: { createdAt: "asc" } } } });
  return draft || null;
}

// Drops the stored bytes once the ticket exists (or the draft is abandoned).
async function releaseFiles(draftId) {
  await prisma.chatDraftAttachment.deleteMany({ where: { draftId } });
}

module.exports = { getActive, create, save, setStatus, addFiles, removeFile, loadFiles, loadOwned, releaseFiles, TTL_MS };
