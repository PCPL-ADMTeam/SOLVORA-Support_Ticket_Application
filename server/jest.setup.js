// Test-only environment. No real secrets; CHATBOT_PROVIDER=mock means no
// network calls are ever made from tests.
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.CHATBOT_PROVIDER = "mock";
// Tests must NEVER reach a real model, whatever is in server/.env or the machine's
// environment (dotenv does not override variables that are already set). AI tests
// inject a mock provider explicitly.
for (const k of Object.keys(process.env)) if (k.startsWith("OPENROUTER_")) process.env[k] = "";
process.env.AI_INTERPRETATION_ENABLED = "false";
process.env.AI_PROVIDER = "disabled";
process.env.CHATBOT_RATE_LIMIT_MAX = "5";
process.env.CHATBOT_RATE_LIMIT_WINDOW_MS = "60000";
// Expected denials are logged with console.warn; keep test output readable.
global.console = { ...console, warn: () => {}, info: () => {} };
