const { body, param } = require("express-validator");
const { FEEDBACK_RATINGS, MAX_MESSAGE_CHARS } = require("./chatbot.service");

// Request schemas. Note what is NOT here: no role, userId or portal field —
// identity always comes from the authenticated session.
const CUID = /^[a-z0-9]{20,40}$/i;

const sendMessageSchema = [
  body("message").isString().withMessage("message must be text").bail().trim().isLength({ min: 1, max: MAX_MESSAGE_CHARS }).withMessage(`message must be 1-${MAX_MESSAGE_CHARS} characters`),
  body("conversationId").optional({ nullable: true }).isString().matches(CUID).withMessage("invalid conversationId"),
  // The ticket page the user has open (an id from the page URL). Only used to say which ticket "this ticket" means.
  body("pageTicketId").optional({ nullable: true }).isString().matches(CUID).withMessage("invalid pageTicketId"),
];

const conversationIdSchema = [param("conversationId").matches(CUID).withMessage("invalid conversationId")];

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

module.exports = { sendMessageSchema, conversationIdSchema, feedbackSchema, actionIdSchema };
