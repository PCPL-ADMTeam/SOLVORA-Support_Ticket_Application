require("dotenv").config();

// Centralised, fail-fast config. Anything the app needs from process.env
// is read here once, so a missing var surfaces at boot instead of deep in
// a request handler.
function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "5000", 10),
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",

  jwt: {
    accessSecret: required("JWT_ACCESS_SECRET"),
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    refreshSecret: required("JWT_REFRESH_SECRET"),
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  },

  seedAdmin: {
    email: process.env.SEED_ADMIN_EMAIL || "admin@helpdesk.local",
    password: process.env.SEED_ADMIN_PASSWORD || "Admin@12345",
  },

  smtp: {
    host: process.env.SMTP_HOST || "",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER || "",
    password: process.env.SMTP_PASSWORD || "",
    from: process.env.SMTP_FROM || "Helpdesk <no-reply@helpdesk.local>",
  },

  // CloudReady Microsoft Entra ID (Graph) — client-credentials app used both
  // to look up corporate directory users and to send ticket emails via
  // Graph /sendMail. All three must be set for either feature to work;
  // never hardcode these — see server/.env.example. CLOUDREADY_MAILBOX is
  // the one support mailbox Graph sends "from"; it's never client-supplied.
  cloudready: {
    tenantId: process.env.CLOUDREADY_TENANT_ID || "",
    clientId: process.env.CLOUDREADY_CLIENT_ID || "",
    clientSecret: process.env.CLOUDREADY_CLIENT_SECRET || "",
    mailbox: process.env.CLOUDREADY_MAILBOX || "",
  },

  upload: {
    dir: process.env.UPLOAD_DIR || "uploads",
    maxSizeMb: parseInt(process.env.MAX_UPLOAD_SIZE_MB || "10", 10),
  },

  // Azure Blob Storage — where new ticket attachments are stored (see
  // blobStorage.service.js). Never hardcode these — see
  // server/.env.example. The connection string embeds the storage account
  // key; never log it or send it to the frontend.
  azure: {
    storageAccountName: process.env.AZURE_STORAGE_ACCOUNT_NAME || "",
    storageConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || "",
    storageContainerName: process.env.AZURE_STORAGE_CONTAINER_NAME || "",
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || "300", 10),
  },

  // AI interpretation (OpenRouter). Read here once; validated by
  // chatbot/interpretation/aiConfig.js, which also decides whether AI is
  // usable. Never log or return openrouter.apiKey. Model ids are supplied
  // through configuration after checking the current OpenRouter catalog
  // (`npm run ai:check`); none are hard-coded.
  ai: {
    enabled: String(process.env.AI_INTERPRETATION_ENABLED || "false").toLowerCase() === "true",
    provider: (process.env.AI_PROVIDER || "disabled").toLowerCase(),
    logPrompts: String(process.env.AI_LOG_PROMPTS || "false").toLowerCase() === "true",
    logResponses: String(process.env.AI_LOG_RESPONSES || "false").toLowerCase() === "true",
    redactSensitive: String(process.env.AI_REDACT_SENSITIVE_DATA || "true").toLowerCase() !== "false",
    maxInputChars: parseInt(process.env.AI_MAX_INPUT_CHARS || "1000", 10),
    maxCallsPerUserPerDay: parseInt(process.env.AI_MAX_CALLS_PER_USER_PER_DAY || "200", 10),
    breakerFailures: parseInt(process.env.AI_CIRCUIT_BREAKER_FAILURES || "3", 10),
    breakerCooldownMs: parseInt(process.env.AI_CIRCUIT_BREAKER_COOLDOWN_MS || "60000", 10),
    capabilityCacheMs: parseInt(process.env.AI_CAPABILITY_CACHE_MS || "3600000", 10),
    exposeModelMetadata: String(process.env.AI_EXPOSE_MODEL_METADATA || (process.env.NODE_ENV === "production" ? "false" : "true")).toLowerCase() === "true",
    openrouter: {
      baseUrl: (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
      apiKey: process.env.OPENROUTER_API_KEY || "",
      intentModel: (process.env.OPENROUTER_INTENT_MODEL || "").trim(),
      intentFallbackModels: (process.env.OPENROUTER_INTENT_FALLBACK_MODELS || "").split(",").map((m) => m.trim()).filter(Boolean),
      summaryModel: (process.env.OPENROUTER_SUMMARY_MODEL || "").trim(),
      summaryFallbackModels: (process.env.OPENROUTER_SUMMARY_FALLBACK_MODELS || "").split(",").map((m) => m.trim()).filter(Boolean),
      timeoutMs: parseInt(process.env.OPENROUTER_TIMEOUT_MS || "10000", 10),
      maxRetries: parseInt(process.env.OPENROUTER_MAX_RETRIES || "1", 10),
      minConfidence: parseFloat(process.env.OPENROUTER_MIN_CONFIDENCE || "0.80"),
      temperature: parseFloat(process.env.OPENROUTER_TEMPERATURE || "0"),
      // "" (send nothing) | off | low | medium | high. Reasoning models can spend the whole
      // output budget thinking; for classification "off" or "low" is usually right.
      reasoningEffort: (process.env.OPENROUTER_REASONING_EFFORT || "").trim().toLowerCase(),
      maxOutputTokens: parseInt(process.env.OPENROUTER_MAX_OUTPUT_TOKENS || "500", 10),
      requireStructuredOutput: String(process.env.OPENROUTER_REQUIRE_STRUCTURED_OUTPUT || "true").toLowerCase() !== "false",
      requireSupportedParameters: String(process.env.OPENROUTER_REQUIRE_SUPPORTED_PARAMETERS || "true").toLowerCase() !== "false",
      appName: process.env.OPENROUTER_APP_NAME || "Solvora Support Assistant",
      appUrl: process.env.OPENROUTER_APP_URL || "",
      // Optional data-handling controls, passed to OpenRouter's provider routing.
      // OPENROUTER_ALLOWED_PROVIDERS: comma list of approved upstream providers (only these are used).
      allowedProviders: (process.env.OPENROUTER_ALLOWED_PROVIDERS || "").split(",").map((m) => m.trim()).filter(Boolean),
      // "deny" asks OpenRouter to route only to providers that do not store/train on prompts.
      dataCollection: (process.env.OPENROUTER_DATA_COLLECTION || "deny").toLowerCase() === "allow" ? "allow" : "deny",
    },
  },

  // Chatbot — validated at startup by chatbot/providers/index.js#validateChatbotConfig
  // (provider choice vs. required key/model). The API key is server-side only;
  // never log it or send it to the frontend. See server/.env.example.
  chatbot: {
    provider: (process.env.CHATBOT_PROVIDER || "mock").toLowerCase(),
    model: process.env.CHATBOT_MODEL || "",
    endpoint: process.env.CHATBOT_ENDPOINT || "",
    apiKey: process.env.CHATBOT_API_KEY || "",
    timeoutMs: parseInt(process.env.CHATBOT_TIMEOUT_MS || "15000", 10),
    maxRetries: parseInt(process.env.CHATBOT_MAX_RETRIES || "1", 10),
    rateLimitWindowMs: parseInt(process.env.CHATBOT_RATE_LIMIT_WINDOW_MS || "60000", 10),
    rateLimitMax: parseInt(process.env.CHATBOT_RATE_LIMIT_MAX || "20", 10),
  },
};
