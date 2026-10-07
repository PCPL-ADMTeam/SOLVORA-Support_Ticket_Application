const env = require("../../config/env");

// Decides whether AI interpretation may be used at all, from configuration
// alone (no network). Capability of the configured model is checked
// separately, on demand, by providers/modelCapabilityService (never per chat
// message). A false result is not an error for users: the rule engine keeps
// working and the assistant says AI interpretation is unavailable.

// The placeholder shipped in .env.example must never count as a real key.
const PLACEHOLDER_KEYS = new Set(["", "your_server_side_key", "changeme", "xxx"]);

function validateAiConfig(ai = env.ai) {
  const errors = [];
  const o = ai.openrouter;
  if (ai.enabled && ai.provider !== "openrouter" && ai.provider !== "mock" && ai.provider !== "disabled") {
    errors.push("AI_PROVIDER must be one of: openrouter, mock, disabled");
  }
  if (ai.enabled && ai.provider === "openrouter") {
    if (PLACEHOLDER_KEYS.has(String(o.apiKey).trim().toLowerCase())) errors.push("OPENROUTER_API_KEY is not set");
    if (!o.intentModel) errors.push("OPENROUTER_INTENT_MODEL is not set (choose one after running `npm run ai:check`)");
    if (!/^https:\/\//i.test(o.baseUrl)) errors.push("OPENROUTER_BASE_URL must be an https URL");
    if (!(o.timeoutMs >= 1000 && o.timeoutMs <= 60000)) errors.push("OPENROUTER_TIMEOUT_MS must be between 1000 and 60000");
    if (!(o.maxRetries >= 0 && o.maxRetries <= 3)) errors.push("OPENROUTER_MAX_RETRIES must be between 0 and 3");
    if (!(o.minConfidence > 0 && o.minConfidence <= 1)) errors.push("OPENROUTER_MIN_CONFIDENCE must be in (0, 1]");
    if (!(o.maxOutputTokens >= 50 && o.maxOutputTokens <= 4000)) errors.push("OPENROUTER_MAX_OUTPUT_TOKENS must be between 50 and 4000");
    if (!(o.temperature >= 0 && o.temperature <= 1)) errors.push("OPENROUTER_TEMPERATURE must be between 0 and 1");
    if (!["", "off", "low", "medium", "high"].includes(o.reasoningEffort || "")) errors.push("OPENROUTER_REASONING_EFFORT must be empty, off, low, medium or high");
  }
  return { ok: errors.length === 0, errors };
}

// "Usable" = enabled, provider chosen and the configuration above is valid.
function aiStatus(ai = env.ai) {
  if (!ai.enabled || ai.provider === "disabled") return { usable: false, reason: "disabled" };
  const v = validateAiConfig(ai);
  if (!v.ok) return { usable: false, reason: "not_configured", errors: v.errors };
  return { usable: true, provider: ai.provider };
}

// The summary model is independent of the intent model: it needs only AI on,
// OpenRouter selected, a real key and a summary model id.
function summaryUsable(ai = env.ai) {
  const o = ai.openrouter;
  return ai.enabled && ai.provider === "openrouter" && Boolean(o.summaryModel) && !PLACEHOLDER_KEYS.has(String(o.apiKey).trim().toLowerCase()) && /^https:\/\//i.test(o.baseUrl);
}

module.exports = { validateAiConfig, aiStatus, summaryUsable, PLACEHOLDER_KEYS };
