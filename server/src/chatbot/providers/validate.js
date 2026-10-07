const { ChatError, CODES } = require("../chatbot.errors");
const { PROMPT_CANARY } = require("../prompts/common");

const MAX_RESPONSE_CHARS = 2500;
// Phrases that only exist in our system prompt — seeing them in output means
// the model is echoing its instructions.
const PROMPT_FRAGMENTS = ["<authorized_data>", "UNTRUSTED DATA", "You receive a DRAFT answer", PROMPT_CANARY];
const TICKET_NUMBER_IN_TEXT = /\b\d{7}\b/g;

// Validates a model response BEFORE it can reach the user:
//  - must be a non-empty string of sane length
//  - must not echo the system prompt (leak detection)
//  - must not mention any 7-digit ticket number that isn't in the authorized
//    context for this turn (blocks cross-ticket leaks/injected references)
// Any failure throws PROVIDER_INVALID_RESPONSE and the caller falls back to
// the server-built draft.
function validateModelText(text, { allowedTicketNumbers = [] } = {}) {
  if (typeof text !== "string") throw new ChatError(CODES.PROVIDER_INVALID_RESPONSE, { internal: "non-string output" });
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_RESPONSE_CHARS) {
    throw new ChatError(CODES.PROVIDER_INVALID_RESPONSE, { internal: "empty or oversized output" });
  }
  if (PROMPT_FRAGMENTS.some((f) => trimmed.includes(f))) {
    throw new ChatError(CODES.PROVIDER_INVALID_RESPONSE, { internal: "prompt leak detected" });
  }
  const allowed = new Set(allowedTicketNumbers);
  for (const n of trimmed.match(TICKET_NUMBER_IN_TEXT) || []) {
    if (!allowed.has(n)) throw new ChatError(CODES.PROVIDER_INVALID_RESPONSE, { internal: "unauthorized ticket number in output" });
  }
  return trimmed;
}

module.exports = { validateModelText, MAX_RESPONSE_CHARS };
