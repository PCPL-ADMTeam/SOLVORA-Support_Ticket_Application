const env = require("../../config/env");
const MockChatModelProvider = require("./mock");
const AnthropicChatModelProvider = require("./anthropic");
const OpenRouterSummaryProvider = require("./openRouterSummaryProvider");
const ModelCapabilityService = require("./modelCapabilityService");
const { summaryUsable } = require("../interpretation/aiConfig");

// ChatModelProvider interface (duck-typed; JS project):
//   generateResponse(input): Promise<{ text: string }>
// input = {
//   systemPrompt: string,                  // common rules + role prompt
//   messages: [{ role, content }],         // prior turns (server-stored text)
//   draft: string,                         // server-built authoritative answer
//   context: object,                       // authorized, field-filtered DTOs
//   question: string,                      // the user's current message
//   tools: [{ name, description }],        // informational only
// }
// Timeouts, retries and response validation are handled by the provider /
// providers/validate.js — never by the caller trusting raw model output.

const SUPPORTED = ["mock", "anthropic"];

// Returns { ok, errors } — does not throw, so a bad chatbot config can never
// stop the whole helpdesk API from booting.
function validateChatbotConfig(cfg = env.chatbot, nodeEnv = env.nodeEnv) {
  const errors = [];
  if (!SUPPORTED.includes(cfg.provider)) errors.push(`CHATBOT_PROVIDER must be one of: ${SUPPORTED.join(", ")}`);
  if (cfg.provider === "anthropic") {
    if (!cfg.apiKey) errors.push("CHATBOT_API_KEY is required when CHATBOT_PROVIDER=anthropic");
    if (!cfg.model) errors.push("CHATBOT_MODEL is required when CHATBOT_PROVIDER=anthropic");
    if (cfg.endpoint && !/^https:\/\//i.test(cfg.endpoint)) errors.push("CHATBOT_ENDPOINT must be an https URL");
  }
  if (!(cfg.timeoutMs >= 1000 && cfg.timeoutMs <= 120000)) errors.push("CHATBOT_TIMEOUT_MS must be between 1000 and 120000");
  if (!(cfg.maxRetries >= 0 && cfg.maxRetries <= 3)) errors.push("CHATBOT_MAX_RETRIES must be between 0 and 3");
  if (!(cfg.rateLimitMax >= 1)) errors.push("CHATBOT_RATE_LIMIT_MAX must be at least 1");
  const warnings = [];
  if (nodeEnv === "production" && cfg.provider === "mock") warnings.push("CHATBOT_PROVIDER=mock in production: answers are template-only (no model).");
  return { ok: errors.length === 0, errors, warnings };
}

let cached;

// Builds the configured provider, or returns null when configuration is
// invalid (the service then answers from server-built drafts and records the
// degradation in the audit trail).
function getProvider() {
  if (cached !== undefined) return cached;
  // OpenRouter summary model, when AI is enabled and a summary model is configured.
  // Otherwise the original CHATBOT_PROVIDER (mock | anthropic) applies, unchanged.
  if (summaryUsable(env.ai)) {
    cached = new OpenRouterSummaryProvider({ config: env.ai, capability: new ModelCapabilityService({ config: env.ai }) });
    return cached;
  }
  const cfg = env.chatbot;
  const result = validateChatbotConfig(cfg);
  result.warnings.forEach((w) => console.warn(`[chatbot] ${w}`));
  if (!result.ok) {
    console.error(`[chatbot] invalid configuration, model disabled: ${result.errors.join("; ")}`);
    cached = null;
  } else if (cfg.provider === "anthropic") {
    cached = new AnthropicChatModelProvider(cfg);
  } else {
    cached = new MockChatModelProvider();
  }
  return cached;
}

// Test hook.
function setProviderForTests(provider) {
  cached = provider;
}

module.exports = { getProvider, validateChatbotConfig, setProviderForTests, SUPPORTED };
