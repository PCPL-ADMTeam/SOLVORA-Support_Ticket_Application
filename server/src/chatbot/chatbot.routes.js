const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const { validationResult } = require("express-validator");
const authenticate = require("../middleware/auth");
const ApiError = require("../utils/ApiError");
const env = require("../config/env");
const { upload } = require("../config/multer");
const controller = require("./chatbot.controller");
const { sendMessageSchema, conversationIdSchema, conversationListSchema, bulkDeleteSchema, deleteAllSchema, feedbackSchema, actionIdSchema, draftReviewSchema } = require("./chatbot.schemas");
const { ChatError, CODES, toErrorPayload, USER_MESSAGES } = require("./chatbot.errors");
const { recordChatAudit } = require("./chatbot.audit");
const { getProvider } = require("./providers");

const router = Router();

// 1) Authenticate every chatbot request (verified JWT + fresh DB user).
router.use(authenticate);

// 2) Per-USER rate limit (not per IP: users behind one corporate NAT must not
// throttle each other). Runs after authenticate, so req.user is trusted.
const chatLimiter = rateLimit({
  windowMs: env.chatbot.rateLimitWindowMs,
  max: env.chatbot.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `chatbot:${req.user.id}`,
  handler: (req, res) => {
    recordChatAudit({ userId: req.user.id, action: "RATE_LIMITED", resourceType: "Chatbot", resourceId: req.path, result: "DENIED" });
    res.status(429).json({ success: false, error: toErrorPayload(new ChatError(CODES.RATE_LIMITED)) });
  },
});

// The CC people search runs as the user types, so it has its own, roomier per-user limit.
const searchLimiter = rateLimit({
  windowMs: env.chatbot.rateLimitWindowMs,
  max: env.chatbot.rateLimitMax * 6,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `chatbot-search:${req.user.id}`,
  handler: (req, res) => res.status(429).json({ success: false, error: toErrorPayload(new ChatError(CODES.RATE_LIMITED)) }),
});

function validateRequest(req, _res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw new ChatError(CODES.INVALID_INPUT, { internal: errors.array().map((e) => e.path).join(",") });
  next();
}

// Warm provider/config validation at mount time so misconfiguration is logged
// at boot instead of on the first user message.
getProvider();

router.get("/suggestions", controller.suggestions);
router.post("/messages", chatLimiter, sendMessageSchema, validateRequest, controller.sendMessage);
router.post("/messages/:messageId/feedback", chatLimiter, feedbackSchema, validateRequest, controller.feedback);
router.get("/conversations", conversationListSchema, validateRequest, controller.listConversations);
// Bulk delete (the ids you pick) and delete-all (everything you have). Both only ever act on the
// signed-in user's own conversations.
router.post("/conversations/bulk-delete", chatLimiter, bulkDeleteSchema, validateRequest, controller.deleteConversations);
router.post("/conversations/delete-all", chatLimiter, deleteAllSchema, validateRequest, controller.deleteAllConversations);
router.post("/conversations/:conversationId/resume", chatLimiter, conversationIdSchema, validateRequest, controller.resumeConversation);
router.delete("/conversations/:conversationId", chatLimiter, conversationIdSchema, validateRequest, controller.deleteConversation);
router.get("/conversations/:conversationId", conversationIdSchema, validateRequest, controller.getConversation);
router.post("/conversations/:conversationId/reset", chatLimiter, conversationIdSchema, validateRequest, controller.resetConversation);

// Files for the ticket being raised through the assistant. The SAME multer instance as the Raise a
// Ticket route (file-type denylist, per-file size limit, memory storage); the 5-file / 10 MB budget
// is the ticket service's own and is applied when the files are added.
router.post("/drafts/attachments", chatLimiter, upload.array("files", 20), controller.uploadDraftFiles);
router.delete("/drafts/attachments/:attachmentId", chatLimiter, controller.removeDraftFile);
router.get("/drafts/attachments/:attachmentId", chatLimiter, controller.getDraftFile);
// The form's "Review Ticket" (all fields) and its CC people search; both only while a ticket is being raised.
router.post("/drafts/review", chatLimiter, draftReviewSchema, validateRequest, controller.reviewDraft);
router.get("/drafts/cc-search", searchLimiter, controller.searchDraftCc);

// Protected AI configuration/capability check (Admin only; never returns secrets).
router.get("/diagnostics/ai", chatLimiter, controller.aiDiagnostics);
router.get("/diagnostics/misses", chatLimiter, controller.missesReport);

// Admin changes proposed in chat are executed ONLY through these two calls
// (authenticated, same admin, one time). See actions/actionService.js.
router.post("/actions/:actionId/confirm", chatLimiter, actionIdSchema, validateRequest, controller.confirmAction);
router.post("/actions/:actionId/cancel", chatLimiter, actionIdSchema, validateRequest, controller.cancelAction);

// Chatbot-local error handler: standardized { success:false, error:{code,message} }
// payloads, never stack traces or internal details. Anything it doesn't
// recognize is passed on to the app-wide handler (which hides details in prod).
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err instanceof ChatError) {
    return res.status(err.statusCode).json({ success: false, error: toErrorPayload(err) });
  }
  if (err instanceof ApiError && err.statusCode === 401) {
    return res.status(401).json({ success: false, error: { code: CODES.AUTH_REQUIRED, message: USER_MESSAGES[CODES.AUTH_REQUIRED] } });
  }
  return next(err);
});

module.exports = router;
