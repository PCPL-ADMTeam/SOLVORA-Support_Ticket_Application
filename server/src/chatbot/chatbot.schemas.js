const { body, param, query } = require("express-validator");
const { FEEDBACK_RATINGS, MAX_MESSAGE_CHARS } = require("./chatbot.service");

// Request schemas. Note what is NOT here: no role, userId or portal field —
// identity always comes from the authenticated session.
const CUID = /^[a-z0-9]{20,40}$/i;

const sendMessageSchema = [
  body("message").isString().withMessage("message must be text").bail().trim().isLength({ min: 1, max: MAX_MESSAGE_CHARS }).withMessage(`message must be 1-${MAX_MESSAGE_CHARS} characters`),
  body("conversationId").optional({ nullable: true }).isString().matches(CUID).withMessage("invalid conversationId"),
  // The ticket page the user has open (an id from the page URL). Only used to say which ticket "this ticket" means.
  body("pageTicketId").optional({ nullable: true }).isString().matches(CUID).withMessage("invalid pageTicketId"),
  // The browser's IANA time zone, used only to decide where "today" starts (never for any access decision).
  // Checked against the runtime's zone database in the service; anything unknown means UTC.
  body("timeZone").optional({ nullable: true }).isString().isLength({ max: 64 }).withMessage("invalid timeZone"),
];

const conversationIdSchema = [param("conversationId").matches(CUID).withMessage("invalid conversationId")];

const conversationListSchema = [
  query("page").optional().isInt({ min: 1, max: 100000 }).withMessage("invalid page"),
  query("pageSize").optional().isInt({ min: 1, max: 50 }).withMessage("invalid pageSize"),
];

// Which of MY conversations to delete. There is no user id here: whose they are comes from the session.
const bulkDeleteSchema = [
  body("conversationIds").isArray({ min: 1, max: 50 }).withMessage("conversationIds must be a list of 1 to 50 ids"),
  body("conversationIds.*").isString().matches(CUID).withMessage("invalid conversation id"),
];

// "Delete all" must say so explicitly, so a stray or replayed request cannot wipe the history.
const deleteAllSchema = [body("confirm").custom((v) => v === true).withMessage("confirm must be true")];

const feedbackSchema = [
  param("messageId").matches(CUID).withMessage("invalid messageId"),
  body("rating").isIn(FEEDBACK_RATINGS).withMessage(`rating must be one of: ${FEEDBACK_RATINGS.join(", ")}`),
  body("reason").optional({ nullable: true }).isString().isLength({ max: 500 }).withMessage("reason must be at most 500 characters"),
];

// Confirm/cancel must present the one-time token shown with the preview AND the
// conversation it belongs to; the action id alone is not enough.
const actionIdSchema = [
  param("actionId").matches(CUID).withMessage("invalid actionId"),
  body("confirmationToken").isString().isLength({ min: 16, max: 128 }).withMessage("confirmationToken is required"),
  body("conversationId").isString().matches(CUID).withMessage("conversationId is required"),
];

// The ticket form. Only the details of the ticket: never a requester, role or source department.
const draftReviewSchema = [
  body("conversationId").isString().matches(CUID).withMessage("conversationId is required"),
  body("title").optional({ nullable: true }).isString().isLength({ max: 400 }),
  body("priority").optional({ nullable: true }).isString().isLength({ max: 60 }),
  body("department").optional({ nullable: true }).isString().isLength({ max: 120 }),
  body("problemSummary").optional({ nullable: true }).isString().isLength({ max: 5000 }),
  body("ccUserIds").optional({ nullable: true }).isArray({ max: 20 }).withMessage("ccUserIds must be a list"),
  body("ccUserIds.*").optional().isString().isLength({ max: 64 }),
];

module.exports = { sendMessageSchema, conversationIdSchema, conversationListSchema, bulkDeleteSchema, deleteAllSchema, feedbackSchema, actionIdSchema, draftReviewSchema };
