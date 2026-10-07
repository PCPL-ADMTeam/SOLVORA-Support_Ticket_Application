// Standardized chatbot error codes. User-facing messages here are
// intentionally generic — never include stack traces, SQL, ids belonging to
// other users, or provider details.
const CODES = {
  INVALID_INPUT: "CHAT_INVALID_INPUT",
  UNSUPPORTED_INTENT: "CHAT_UNSUPPORTED_INTENT",
  INVALID_TICKET_ID: "CHAT_INVALID_TICKET_ID",
  TICKET_NOT_FOUND: "CHAT_TICKET_NOT_FOUND",
  ACCESS_DENIED: "CHAT_ACCESS_DENIED",
  NO_RESULTS: "CHAT_NO_RESULTS",
  PROFILE_UNAVAILABLE: "CHAT_PROFILE_UNAVAILABLE",
  PROVIDER_UNAVAILABLE: "CHAT_PROVIDER_UNAVAILABLE",
  PROVIDER_TIMEOUT: "CHAT_PROVIDER_TIMEOUT",
  PROVIDER_INVALID_RESPONSE: "CHAT_PROVIDER_INVALID_RESPONSE",
  DATABASE_ERROR: "CHAT_DATABASE_ERROR",
  RATE_LIMITED: "CHAT_RATE_LIMITED",
  AUTH_REQUIRED: "CHAT_AUTH_REQUIRED",
  CONVERSATION_NOT_FOUND: "CHAT_CONVERSATION_NOT_FOUND",
  MESSAGE_NOT_FOUND: "CHAT_MESSAGE_NOT_FOUND",
  ACTION_INVALID: "CHAT_ACTION_INVALID",
  ACTION_NOT_FOUND: "CHAT_ACTION_NOT_FOUND",
  INVALID_ROLE_OPERATION: "CHAT_INVALID_ROLE_OPERATION",
  INVALID_TICKET_TRANSITION: "CHAT_INVALID_TICKET_TRANSITION",
  INVALID_ASSIGNEE: "CHAT_INVALID_ASSIGNEE",
  ACTION_BLOCKED_BY_DEPENDENCIES: "CHAT_ACTION_BLOCKED_BY_DEPENDENCIES",
  RESOURCE_VERSION_CONFLICT: "CHAT_RESOURCE_VERSION_CONFLICT",
};

const USER_MESSAGES = {
  [CODES.INVALID_INPUT]: "Please enter a message of up to 1000 characters.",
  [CODES.UNSUPPORTED_INTENT]: "I can't help with that here. I can answer questions about using this portal and about tickets you have access to.",
  [CODES.INVALID_TICKET_ID]: "That doesn't look like a valid ticket number. Ticket numbers are digits only, for example 2627001.",
  [CODES.TICKET_NOT_FOUND]: "You do not have permission to access this ticket, or the ticket could not be found.",
  [CODES.ACCESS_DENIED]: "Your role doesn't have access to that information.",
  [CODES.NO_RESULTS]: "I didn't find any matching tickets.",
  [CODES.PROFILE_UNAVAILABLE]: "Some of your profile details are not available.",
  [CODES.PROVIDER_UNAVAILABLE]: "The assistant is temporarily unavailable. Please try again shortly.",
  [CODES.PROVIDER_TIMEOUT]: "The assistant took too long to respond. Please try again.",
  [CODES.PROVIDER_INVALID_RESPONSE]: "The assistant returned an unusable response. Please try again.",
  [CODES.DATABASE_ERROR]: "Something went wrong while looking that up. Please try again.",
  [CODES.RATE_LIMITED]: "You're sending messages too quickly. Please wait a moment and try again.",
  [CODES.AUTH_REQUIRED]: "Your session has expired. Please sign in again.",
  [CODES.CONVERSATION_NOT_FOUND]: "I couldn't find that conversation.",
  [CODES.MESSAGE_NOT_FOUND]: "I couldn't find that message.",
  [CODES.ACTION_INVALID]: "I couldn't prepare that change.",
  [CODES.ACTION_NOT_FOUND]: "I couldn't find that pending change.",
  [CODES.INVALID_ROLE_OPERATION]: "That operation is not allowed for that role.",
  [CODES.INVALID_TICKET_TRANSITION]: "That status change is not allowed for this ticket.",
  [CODES.INVALID_ASSIGNEE]: "That person cannot be assigned this ticket.",
  [CODES.ACTION_BLOCKED_BY_DEPENDENCIES]: "That change is blocked by existing dependencies.",
  [CODES.RESOURCE_VERSION_CONFLICT]: "Something changed after the preview.",
};

const STATUS = {
  [CODES.INVALID_INPUT]: 400,
  [CODES.INVALID_TICKET_ID]: 400,
  [CODES.UNSUPPORTED_INTENT]: 422,
  [CODES.TICKET_NOT_FOUND]: 404,
  [CODES.CONVERSATION_NOT_FOUND]: 404,
  [CODES.MESSAGE_NOT_FOUND]: 404,
  [CODES.ACTION_NOT_FOUND]: 404,
  [CODES.ACTION_INVALID]: 422,
  [CODES.INVALID_ROLE_OPERATION]: 422,
  [CODES.INVALID_TICKET_TRANSITION]: 422,
  [CODES.INVALID_ASSIGNEE]: 422,
  [CODES.ACTION_BLOCKED_BY_DEPENDENCIES]: 422,
  [CODES.RESOURCE_VERSION_CONFLICT]: 409,
  [CODES.ACCESS_DENIED]: 403,
  [CODES.RATE_LIMITED]: 429,
  [CODES.AUTH_REQUIRED]: 401,
  [CODES.PROVIDER_UNAVAILABLE]: 503,
  [CODES.PROVIDER_TIMEOUT]: 504,
  [CODES.PROVIDER_INVALID_RESPONSE]: 502,
  [CODES.DATABASE_ERROR]: 500,
};

class ChatError extends Error {
  // `message` lets a caller give a specific, user-safe explanation (e.g. which
  // name was ambiguous). It must never contain internals.
  constructor(code, { internal, message, choices, suggestions } = {}) {
    super(message || USER_MESSAGES[code] || "Something went wrong.");
    this.code = code;
    this.statusCode = STATUS[code] || 400;
    // Server-side diagnostic only — never serialized to the client.
    this.internal = internal;
    // Server-resolved candidates (ids stay server-side in conversation state) for entity selection.
    this.choices = choices;
    // One-click follow-up questions offered with the explanation: [{ label, prompt }].
    this.suggestions = suggestions;
  }
}

function toErrorPayload(err) {
  return { code: err.code, message: err.message };
}

module.exports = { CODES, ChatError, toErrorPayload, USER_MESSAGES };
