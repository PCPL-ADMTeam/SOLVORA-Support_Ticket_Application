const axios = require("axios");
const { AiProviderError, KINDS } = require("./intentModelProvider");
const { reasoningField } = require("./reasoning");

const MAX_MODELS = 3; // primary + at most two fallbacks
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// OpenRouter Chat Completions as an INTENT interpreter.
//   * strict JSON-schema structured output, temperature 0, short output
//   * provider.require_parameters so an endpoint that cannot honor the schema
//     is refused by OpenRouter instead of silently ignoring it
//   * ordered fallback models under ONE overall time budget
//   * the API key lives only in the Authorization header: never logged,
//     never returned, never part of an error
class OpenRouterIntentProvider {
  constructor({ config, capability, http = axios, now = () => Date.now(), log = console }) {
    this.name = "openrouter";
    this.config = config;
    this.capability = capability;
    this.http = http;
    this.now = now;
    this.log = log;
  }

  models() {
    const o = this.config.openrouter;
    return [o.intentModel, ...o.intentFallbackModels].filter(Boolean).slice(0, MAX_MODELS);
  }

  buildBody(model, input) {
    const o = this.config.openrouter;
    const body = {
      model,
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.message },
      ],
      temperature: o.temperature,
      max_tokens: o.maxOutputTokens,
    };
    const reasoning = reasoningField(o.reasoningEffort);
    if (reasoning) body.reasoning = reasoning;
    if (o.requireStructuredOutput) {
      body.response_format = { type: "json_schema", json_schema: { name: "solvora_intent", strict: true, schema: input.jsonSchema } };
    }
    const provider = { data_collection: o.dataCollection };
    if (o.requireSupportedParameters) provider.require_parameters = true;
    if (o.allowedProviders.length) {
      provider.only = o.allowedProviders;
      provider.allow_fallbacks = false;
    }
    body.provider = provider;
    return body;
  }

  headers() {
    const o = this.config.openrouter;
    const h = { Authorization: `Bearer ${o.apiKey}`, "Content-Type": "application/json", "X-Title": o.appName };
    if (o.appUrl) h["HTTP-Referer"] = o.appUrl;
    return h;
  }

  async interpret(input) {
    const o = this.config.openrouter;
    const started = this.now();
    const deadline = started + o.timeoutMs; // one overall budget for every attempt
    let lastKind = KINDS.UNAVAILABLE;

    for (const model of this.models()) {
      // Capability gate: a model known NOT to meet the requirements is skipped
      // (null = unverifiable; require_parameters then protects the call).
      const usable = this.capability ? await this.capability.isUsable(model, { requireStructured: o.requireStructuredOutput }).catch(() => null) : null;
      if (usable === false) {
        lastKind = KINDS.UNSUPPORTED_CAPABILITY;
        continue;
      }

      for (let attempt = 0; attempt <= o.maxRetries; attempt += 1) {
        const remaining = deadline - this.now();
        if (remaining <= 250) throw new AiProviderError(KINDS.BUDGET, "time budget exhausted");
        try {
          const res = await this.http.post(`${o.baseUrl}/chat/completions`, this.buildBody(model, input), { timeout: remaining, headers: this.headers() });
          const parsed = this.parse(res.data, model);
          return { ...parsed, model, latencyMs: this.now() - started };
        } catch (err) {
          if (err instanceof AiProviderError) {
            lastKind = err.kind;
            break; // malformed answer: try the next model, do not retry the same one
          }
          const status = err.response?.status;
          const timedOut = err.code === "ECONNABORTED" || err.code === "ETIMEDOUT";
          if (status === 401 || status === 403) throw new AiProviderError(KINDS.AUTH, `http ${status}`); // a bad key will not improve with another model
          if (status === 402) throw new AiProviderError(KINDS.UNAVAILABLE, "credits exhausted");
          lastKind = timedOut ? KINDS.TIMEOUT : status === 429 ? KINDS.RATE_LIMITED : KINDS.UNAVAILABLE;
          if (status === 400 || status === 404) {
            // Unknown model or no endpoint supports the required parameters.
            lastKind = KINDS.UNSUPPORTED_CAPABILITY;
            break;
          }
          const retryable = timedOut || !status || RETRYABLE.has(status);
          if (!retryable || attempt === o.maxRetries) break;
          await sleep(Math.min(250 * 2 ** attempt, Math.max(0, deadline - this.now() - 300)));
        }
      }
    }
    // Safe diagnostics only: status class, never request/response bodies.
    this.log.error(`[ai] openrouter interpretation failed kind=${lastKind}`);
    throw new AiProviderError(lastKind);
  }

  parse(data, model) {
    const choice = data?.choices?.[0];
    const content = choice?.message?.content;
    if (!choice || typeof content !== "string" || !content.trim()) throw new AiProviderError(KINDS.INVALID_RESPONSE, "empty completion");
    if (data.model && typeof data.model !== "string") throw new AiProviderError(KINDS.INVALID_RESPONSE, "bad model field");
    let raw = content.trim();
    // Some endpoints wrap JSON in a Markdown fence even with a schema; accept only that exact wrapper.
    const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (fenced) raw = fenced[1];
    return {
      raw, // still a string: validated and parsed by validateInterpretation
      usage: { inputTokens: data.usage?.prompt_tokens ?? null, outputTokens: data.usage?.completion_tokens ?? null },
      respondedModel: typeof data.model === "string" ? data.model : model,
    };
  }
}

module.exports = OpenRouterIntentProvider;
