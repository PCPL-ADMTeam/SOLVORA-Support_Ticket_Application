// IntentModelProvider interface (duck-typed; this project is plain JavaScript):
//
//   interpret(input): Promise<IntentInterpretationResult>
//
//   input  = { message, role, systemPrompt, jsonSchema }
//            - `message`      the current user message only
//            - `systemPrompt` built from the SERVER intent registry (no user data)
//            - `jsonSchema`   strict schema built from the same registry
//   result = { raw, model, usage: { inputTokens, outputTokens }, latencyMs }
//            `raw` is UNTRUSTED model output (object or string); the caller
//            validates it with intentSchemas.validateInterpretation.
//
// A provider only interprets. It never receives tools, database handles,
// tickets, people, or credentials other than its own API key.

// Failure kinds. They are safe to log and to show to admins in diagnostics.
const KINDS = {
  NOT_CONFIGURED: "not_configured",
  AUTH: "auth",
  RATE_LIMITED: "rate_limited",
  TIMEOUT: "timeout",
  UNAVAILABLE: "unavailable",
  INVALID_RESPONSE: "invalid_response",
  UNSUPPORTED_CAPABILITY: "unsupported_capability",
  BUDGET: "budget_exhausted",
};

class AiProviderError extends Error {
  constructor(kind, detail) {
    super(`AI provider error: ${kind}`);
    this.kind = kind;
    // Server-side diagnostics only (never contains keys, prompts or user text).
    this.detail = detail;
  }
}

module.exports = { AiProviderError, KINDS };
