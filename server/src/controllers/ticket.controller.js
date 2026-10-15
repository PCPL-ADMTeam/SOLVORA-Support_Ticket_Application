const ticketService = require("../services/ticket.service");
const ApiError = require("../utils/ApiError");

async function list(req, res) {
  res.json({ success: true, ...(await ticketService.listTickets(req.user, req.query)) });
}

async function getById(req, res) {
  res.json({ success: true, data: await ticketService.getTicketById(req.user, req.params.id) });
}

async function create(req, res) {
  const ticket = await ticketService.createTicket(req.user, req.body, req.files || []);
  res.status(201).json({ success: true, data: ticket });
}

async function update(req, res) {
  const ticket = await ticketService.updateTicket(req.user, req.params.id, req.body);
  res.json({ success: true, data: ticket });
}

async function transferDepartment(req, res) {
  const ticket = await ticketService.transferDepartment(req.user, req.params.id, req.body);
  res.json({ success: true, data: ticket });
}

async function addComment(req, res) {
  const comment = await ticketService.addComment(req.user, req.params.id, req.body, req.files || []);
  res.status(201).json({ success: true, data: comment });
}

async function bulkUpdate(req, res) {
  res.json({ success: true, data: await ticketService.bulkUpdate(req.user, req.body) });
}

async function uploadAttachment(req, res) {
  if (!req.file) throw new ApiError(400, "No file uploaded");
  const attachment = await ticketService.addAttachment(req.user, req.params.id, req.file, req.body.commentId || null);
  res.status(201).json({ success: true, data: attachment });
}

async function downloadAttachment(req, res) {
  await ticketService.streamAttachment(req.user, req.params.id, req.params.attachmentId, res);
}

async function updateComment(req, res) {
  const comment = await ticketService.updateComment(req.user, req.params.id, req.params.commentId, req.body);
  res.json({ success: true, data: comment });
}

async function deleteComment(req, res) {
  await ticketService.deleteComment(req.user, req.params.id, req.params.commentId);
  res.json({ success: true, message: "Comment deleted" });
}

async function deleteAttachment(req, res) {
  await ticketService.deleteAttachment(req.user, req.params.id, req.params.attachmentId);
  res.json({ success: true, message: "Attachment deleted" });
}

module.exports = { list, getById, create, update, transferDepartment, addComment, updateComment, deleteComment, bulkUpdate, uploadAttachment, downloadAttachment, deleteAttachment };
