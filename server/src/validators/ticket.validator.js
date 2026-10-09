const { body, param, query } = require("express-validator");
const { countWords, MAX_PROBLEM_SUMMARY_WORDS } = require("../utils/wordCount");

// Shared by createTicketValidator/updateTicketValidator — rejects (never
// truncates) a Problem Summary over the word limit, using the exact same
// word-counting rule ticket.service.js re-checks authoritatively.
function problemSummaryWordLimit(value) {
  if (countWords(value) > MAX_PROBLEM_SUMMARY_WORDS) {
    throw new Error(`Problem Summary must be ${MAX_PROBLEM_SUMMARY_WORDS} words or fewer`);
  }
  return true;
}

// A rich-text editor's "empty" state isn't an empty STRING — Quill sends
// "<p><br></p>" for a blank editor, which `.notEmpty()` would wrongly accept
// as present content. Checking the (HTML-stripped) word count instead — the
// same countWords() the limit check above already uses — catches both an
// actually-empty value and a formatting-only one with no real text.
function problemSummaryRequired(value) {
  if (countWords(value) === 0) {
    throw new Error("Problem Summary is required");
  }
  return true;
}

const createTicketValidator = [
  body("title").trim().notEmpty().withMessage("Title is required").isLength({ max: 200 }),
  body("problemSummary")
    .trim()
    .custom(problemSummaryRequired)
    .custom(problemSummaryWordLimit),
  body("categoryId").optional({ nullable: true }).isString(),
  body("priorityId").notEmpty().withMessage("Priority is required"),
  body("toDepartmentId").notEmpty().withMessage("Department is required"),
  // managerId is never taken from the client — it's derived server-side from
  // the selected department's active Team Lead/Manager (see
  // ticket.service#createTicket).
  body("assigneeId").optional({ nullable: true }).isString(),
  body("teamId").optional({ nullable: true }).isString(),
  // MANAGER-only: which of their several UserDepartmentAccess departments
  // this ticket is raised "from" (Raise Ticket's From Department dropdown —
  // see ticket.service.js#resolveFromDepartmentId). Type-checked here only;
  // ignored entirely for EMPLOYEE/TEAMLEAD (server-derived for them), and
  // validated against the caller's actual UserDepartmentAccess for MANAGER.
  body("fromDepartmentId").optional({ nullable: true }).isString(),
];

const updateTicketValidator = [
  param("id").notEmpty(),
  body("status").optional().isIn(["OPEN", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED", "REOPENED"]),
  body("assigneeId").optional({ nullable: true }).isString(),
  // "Assign to Me" — see ticket.service.js#updateTicket; when true, the
  // server derives the assignee from the authenticated caller and ignores
  // whatever assigneeId (if any) was also sent, so this is type-checked
  // only, never trusted as "who" to assign to.
  body("assignToMe").optional().isBoolean(),
  // Optional instructions shown to the assigned employee — never required
  // to complete an assignment (see ticket.service.js#updateTicket, which
  // trims this and treats a whitespace-only value identically to absent).
  body("assignmentComment").optional({ nullable: true }).isString(),
  body("teamId").optional({ nullable: true }).isString(),
  body("priorityId").optional().isString(),
  body("categoryId").optional().isString(),
  body("toDepartmentId").optional({ nullable: true }).isString(),
  body("managerId").optional({ nullable: true }).isString(),
  // Requester-edit fields (ticket.service.js#updateTicket's
  // canRequesterEditDetails path) — title/Problem Summary of a ticket the
  // caller raised themselves.
  body("title").optional().trim().notEmpty().isLength({ max: 200 }),
  body("problemSummary").optional().trim().custom(problemSummaryRequired).custom(problemSummaryWordLimit),
  // Type-checked here; the actual "required when status is
  // RESOLVED/ON_HOLD/CLOSED" cross-field rule lives in
  // ticket.service.js#updateTicket, alongside the other business rules
  // that already depend on more than one payload field at once.
  body("resolutionNotes").optional().isString(),
  body("onHoldReason").optional().isString(),
  body("closedReason").optional().isString(),
  body("reopenedReason").optional().isString(),
];

const transferDepartmentValidator = [
  param("id").notEmpty(),
  body("toDepartmentId").notEmpty().withMessage("Destination department is required"),
  body("transferReason").trim().notEmpty().withMessage("Transfer reason is required"),
];

const commentValidator = [
  param("id").notEmpty(),
  // A comment is valid with text, attachments, or both — only rejected
  // when BOTH are absent. customSanitizer/custom (unlike .optional()) always
  // run regardless of whether `body` was sent at all, which an attachment-
  // only submission may not — an .optional() chain would silently skip this
  // check for exactly that case. req.files comes from multer (see
  // ticket.routes.js), which runs before this validator. This is the
  // fast-fail layer; ticket.service.js#addComment enforces the same rule
  // authoritatively.
  body("body")
    .customSanitizer((value) => (typeof value === "string" ? value.trim() : ""))
    .custom((value, { req }) => {
      const hasText = Boolean(value);
      const hasFiles = Boolean(req.files && req.files.length);
      if (!hasText && !hasFiles) {
        throw new Error("Comment must include text or at least one attachment");
      }
      return true;
    }),
  body("isInternal").optional().isBoolean(),
];

const bulkUpdateValidator = [
  body("ticketIds").isArray({ min: 1 }).withMessage("ticketIds must be a non-empty array"),
  body("status").optional().isIn(["OPEN", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED", "REOPENED"]),
  body("priorityId").optional().isString(),
  body("assigneeId").optional({ nullable: true }).isString(),
  body("teamId").optional({ nullable: true }).isString(),
];

const listTicketsValidator = [
  query("page").optional().isInt({ min: 1 }),
  query("limit").optional().isInt({ min: 1, max: 100 }),
  query("departmentId").optional().isString(),
  query("scope").optional().isIn(["created", "assigned", "authorized", "department"]),
];

module.exports = {
  createTicketValidator,
  updateTicketValidator,
  transferDepartmentValidator,
  commentValidator,
  bulkUpdateValidator,
  listTicketsValidator,
};
