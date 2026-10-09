const service = require("./chatbot.service");
const { getSuggestions } = require("./suggestions");
const { ChatError, CODES } = require("./chatbot.errors");

// Responses follow the repo convention ({ success, data }) so the existing
// axios client can be reused unchanged.
async function sendMessage(req, res) {
  const { message, conversationId } = req.body;
  const result = await service.sendMessage(req.user, { message, conversationId, pageTicketId: req.body.pageTicketId, timeZone: req.body.timeZone });
  res.json({ success: true, data: result });
}

async function getConversation(req, res) {
  const data = await service.getConversation(req.user, req.params.conversationId);
  res.json({ success: true, data });
}

async function listConversations(req, res) {
  res.json({ success: true, data: await service.listConversations(req.user, { page: req.query.page, pageSize: req.query.pageSize }) });
}

// Bulk deletes: the scope is always the authenticated user's own conversations; the body only
// says WHICH of them (never whose).
async function deleteConversations(req, res) {
  res.json({ success: true, data: await service.deleteConversations(req.user, req.body.conversationIds) });
}

async function deleteAllConversations(req, res) {
  res.json({ success: true, data: await service.deleteAllConversations(req.user) });
}

async function resumeConversation(req, res) {
  res.json({ success: true, data: await service.resumeConversation(req.user, req.params.conversationId) });
}

async function deleteConversation(req, res) {
  res.json({ success: true, data: await service.deleteConversation(req.user, req.params.conversationId) });
}

async function resetConversation(req, res) {
  const data = await service.resetConversation(req.user, req.params.conversationId);
  res.json({ success: true, data });
}

async function suggestions(req, res) {
  const data = getSuggestions(req.user);
  if (!data) throw new ChatError(CODES.ACCESS_DENIED);
  // The number on the Notifications card: the user's own unread count (same service as the bell).
  const unread = await require("../services/notification.service").countUnread(req.user.id).catch(() => 0);
  res.json({ success: true, data: { ...data, unreadNotifications: unread } });
}

async function feedback(req, res) {
  const data = await service.submitFeedback(req.user, req.params.messageId, req.body);
  res.json({ success: true, data });
}

async function confirmAction(req, res) {
  res.json({ success: true, data: await service.confirmAction(req.user, req.params.actionId, { token: req.body.confirmationToken, conversationId: req.body.conversationId }) });
}

async function cancelAction(req, res) {
  res.json({ success: true, data: await service.cancelAction(req.user, req.params.actionId, { token: req.body.confirmationToken, conversationId: req.body.conversationId }) });
}

async function uploadDraftFiles(req, res) {
  res.json({ success: true, data: await service.addDraftFiles(req.user, { conversationId: req.body.conversationId, files: req.files || [], quiet: req.body.quiet === "1" }) });
}

async function removeDraftFile(req, res) {
  res.json({ success: true, data: await service.removeDraftFile(req.user, { conversationId: req.query.conversationId, attachmentId: req.params.attachmentId, quiet: req.query.quiet === "1" }) });
}

async function reviewDraft(req, res) {
  res.json({ success: true, data: await service.submitDraftForm(req.user, req.body) });
}

async function searchDraftCc(req, res) {
  res.json({ success: true, data: await service.searchDraftCc(req.user, { conversationId: req.query.conversationId, q: req.query.q }) });
}

// The owner's own file, shown inline only for images and PDFs; anything else downloads.
async function getDraftFile(req, res) {
  const f = await service.getDraftFile(req.user, { conversationId: req.query.conversationId, attachmentId: req.params.attachmentId });
  const inline = /^image\/(png|jpe?g|gif|webp)$/i.test(f.mimeType) || f.mimeType === "application/pdf";
  res.setHeader("Content-Type", inline ? f.mimeType : "application/octet-stream");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.fileName)}`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.send(f.buffer);
}

async function aiDiagnostics(req, res) {
  res.json({ success: true, data: await service.aiDiagnostics(req.user) });
}

async function missesReport(req, res) {
  res.json({ success: true, data: await service.missesReport(req.user, { days: req.query.days }) });
}

module.exports = { uploadDraftFiles, removeDraftFile, reviewDraft, searchDraftCc, getDraftFile, missesReport, sendMessage, getConversation, listConversations, resumeConversation, deleteConversation, deleteConversations, deleteAllConversations, resetConversation, suggestions, feedback, confirmAction, cancelAction, aiDiagnostics };
