const env = require("../../config/env");
const { aiStatus } = require("./aiConfig");
const CircuitBreaker = require("./circuitBreaker");
const DailyUsageLimiter = require("./usageLimiter");
const { buildJsonSchema, buildSystemPrompt, validateInterpretation } = require("./intentSchemas");
const { forModel, forLog } = require("./dataRedactor");
const OpenRouterIntentProvider = require("../providers/openRouterIntentProvider");
const MockIntentProvider = require("../providers/mockIntentProvider");
const DisabledIntentProvider = require("../providers/disabledIntentProvider");
const ModelCapabilityService = require("../providers/modelCapabilityService");

// Everything that talks to the interpreter model, behind one function:
//   interpretWithAi({ message, role, userId }) -> { ok:true, intent, parameters, ... }
//                                              | { ok:false, unavailable: "<safe reason>" }
// It NEVER throws for provider/validation problems: callers simply keep the
// rule engine's answer. Nothing here can read data or execute anything.

let runtime;

function buildRuntime(ai = env.ai) {
  const capability = new ModelCapabilityService({ config: ai });
  const status = aiStatus(ai);
  let provider;
  if (!status.usable) provider = new DisabledIntentProvider(status.reason);
  else if (ai.provider === "mock") provider = new MockIntentProvider();
  else provider = new OpenRouterIntentProvider({ config: ai, capability });
  return {
    config: ai,
    provider,
    capability,
    breaker: new CircuitBreaker({ threshold: ai.breakerFailures, cooldownMs: ai.breakerCooldownMs }),
    limiter: new DailyUsageLimiter({ maxPerDay: ai.maxCallsPerUserPerDay }),
  };
}

function getRuntime() {
  if (!runtime) runtime = buildRuntime();
  return runtime;
}

// Test hook: inject provider / breaker / limiter / config.
function setRuntimeForTests(overrides) {
  runtime = overrides ? { ...buildRuntime(overrides.config || env.ai), ...overrides } : undefined;
}

// Safe operational telemetry: no message content, no ticket data, no keys.
function telemetry(rt, fields) {
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${v ?? "-"}`);
  console.info(`[ai] ${parts.join(" ")}`);
}

async function interpretWithAi({ message, role, userId }) {
  const rt = getRuntime();
  const status = aiStatus(rt.config);
  if (!status.usable) return { ok: false, unavailable: status.reason };
  if (String(message).length > rt.config.maxInputChars) return { ok: false, unavailable: "input_too_long" };
  if (rt.breaker.isOpen) return { ok: false, unavailable: "circuit_open" };
  if (!rt.limiter.tryConsume(userId)) return { ok: false, unavailable: "usage_limit" };

  const outgoing = forModel(message, rt.config.redactSensitive);
  if (rt.config.logPrompts) console.info(`[ai] prompt ${forLog(outgoing)}`);

  let res;
  try {
    res = await rt.provider.interpret({ message: outgoing, role, systemPrompt: buildSystemPrompt(role), jsonSchema: buildJsonSchema(role) });
    rt.breaker.success();
  } catch (err) {
    const kind = err.kind || "unavailable";
    if (kind !== "not_configured") rt.breaker.failure();
    telemetry(rt, { method: "openrouter", status: "failed", kind });
    return { ok: false, unavailable: kind };
  }

  if (rt.config.logResponses) console.info(`[ai] response ${forLog(typeof res.raw === "string" ? res.raw : JSON.stringify(res.raw))}`);
  const v = validateInterpretation(res.raw, role, { minConfidence: rt.config.openrouter.minConfidence });
  telemetry(rt, {
    method: "openrouter",
    model: res.model,
    status: v.ok ? "ok" : "rejected",
    reason: v.ok ? undefined : v.reason,
    intent: v.ok ? v.intent : undefined,
    latencyMs: res.latencyMs,
    inputTokens: res.usage?.inputTokens,
    outputTokens: res.usage?.outputTokens,
  });
  if (!v.ok) return { ok: false, unavailable: `rejected:${v.reason}`, rejected: true };
  return { ok: true, ...v, model: res.model, latencyMs: res.latencyMs, usage: res.usage };
}

module.exports = { interpretWithAi, getRuntime, setRuntimeForTests, buildRuntime };
