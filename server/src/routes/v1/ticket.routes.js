const { Router } = require("express");
const ticketController = require("../../controllers/ticket.controller");
const authenticate = require("../../middleware/auth");
const requireRole = require("../../middleware/rbac");
const validate = require("../../middleware/validate");
const { upload } = require("../../config/multer");
const {
  createTicketValidator,
  updateTicketValidator,
  transferDepartmentValidator,
  commentValidator,
  updateCommentValidator,
  deleteCommentValidator,
  bulkUpdateValidator,
  listTicketsValidator,
} = require("../../validators/ticket.validator");

const router = Router();
router.use(authenticate);

router.get("/", listTicketsValidator, validate, ticketController.list);
// maxCount here is a generous outer ceiling (resource-exhaustion guard
// only) — the real "5 attachments per ticket" business rule is enforced in
// ticket.service.js#createTicket, which runs after this and produces the
// specific, user-facing message. It's set well above 5 so a request with
// e.g. 6-20 files reaches that check (and its message) instead of being
// cut off here first with Multer's own generic "too many files" error.
router.post("/", upload.array("attachments", 20), createTicketValidator, validate, ticketController.create);
router.post("/bulk", requireRole("ADMIN"), bulkUpdateValidator, validate, ticketController.bulkUpdate);
router.get("/:id", ticketController.getById);
router.patch("/:id", updateTicketValidator, validate, ticketController.update);
// Dedicated endpoint (not the generic PATCH above) — department transfer has
// its own permission matrix (a Manager/Team Lead with access, or the
// assigned EMPLOYEE, may transfer; an ADMIN may not) and side effects
// (manager re-derived, assignee cleared) that don't belong in updateTicket's
// staff-only toDepartmentId field.
router.patch("/:id/transfer-department", transferDepartmentValidator, validate, ticketController.transferDepartment);

// Same "generous outer ceiling, real 5-per-ticket limit enforced in the
// service" pattern as ticket creation above — multer here just needs to not
// truncate a batch before ticket.service.js#addComment can produce its own
// specific, user-facing message.
router.post("/:id/comments", upload.array("attachments", 20), commentValidator, validate, ticketController.addComment);
// Author-only edit/delete of an existing comment (ticket.service.js#updateComment/deleteComment).
router.patch("/:id/comments/:commentId", updateCommentValidator, validate, ticketController.updateComment);
router.delete("/:id/comments/:commentId", deleteCommentValidator, validate, ticketController.deleteComment);
router.post("/:id/attachments", upload.single("file"), ticketController.uploadAttachment);
router.get("/:id/attachments/:attachmentId/download", ticketController.downloadAttachment);
router.delete("/:id/attachments/:attachmentId", ticketController.deleteAttachment);

module.exports = router;
