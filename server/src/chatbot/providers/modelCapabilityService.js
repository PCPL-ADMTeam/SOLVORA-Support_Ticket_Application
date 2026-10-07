const axios = require("axios");
const env = require("../../config/env");

// Checks configured OpenRouter model ids against the CURRENT model catalog
// (GET {base}/models, which needs no credentials, so no key is sent).
//
// * Runs from the protected diagnostics endpoint, `npm run ai:check`, and — at
//   most once per cache window — lazily before a model is first used. Never
//   once per chat message.
// * Caches only non-secret capability metadata for the configured models.
// * A model that fails the checks is reported unusable; nothing silently
//   switches to a different model.

const MIN_CONTEXT = 8000; // the role-filtered intent list + schema must fit comfortably

function metaFor(entry) {
  const arch = entry.architecture || {};
  const params = entry.supported_parameters || [];
  const expiry = entry.expiration_date ? new Date(entry.expiration_date) : null;
  return {
    id: entry.id,
    found: true,
    contextLength: entry.context_length ?? entry.top_provider?.context_length ?? null,
    maxCompletionTokens: entry.top_provider?.max_completion_tokens ?? null,
    textInput: (arch.input_modalities || []).includes("text"),
    textOutput: (arch.output_modalities || []).includes("text"),
    structuredOutputs: params.includes("structured_outputs"),
    responseFormat: params.includes("response_format"),
    tools: params.includes("tools"),
    temperature: params.includes("temperature"),
    expired: Boolean(expiry && expiry.getTime() <= Date.now()),
  };
}

function evaluate(meta, { requireStructured = true, maxOutputTokens = 500 } = {}) {
  const problems = [];
  if (!meta.found) return { ...meta, usable: false, problems: ["not_in_catalog"] };
  if (meta.expired) problems.push("expired");
  if (!meta.textInput) problems.push("no_text_input");
  if (!meta.textOutput) problems.push("no_text_output");
  if (requireStructured && !meta.structuredOutputs) problems.push("no_structured_outputs");
  if (meta.contextLength !== null && meta.contextLength < MIN_CONTEXT) problems.push("context_too_small");
  if (meta.maxCompletionTokens !== null && meta.maxCompletionTokens < maxOutputTokens) problems.push("max_output_below_configured");
  return { ...meta, usable: problems.length === 0, problems };
}

class ModelCapabilityService {
  constructor({ http = axios, config = env.ai, now = () => Date.now() } = {}) {
    this.http = http;
    this.config = config;
    this.now = now;
    this.cache = new Map(); // `${id}|${structured}` -> { at, result }
    this.inflight = null;
    this.lastCatalogError = null;
  }

  clearCache() {
    this.cache.clear();
  }

  async fetchCatalog() {
    const res = await this.http.get(`${this.config.openrouter.baseUrl}/models`, { timeout: 15000 });
    const list = res.data?.data;
    if (!Array.isArray(list)) throw new Error("unexpected catalog response");
    return list;
  }

  // Full report for diagnostics / CLI. `kind` is "intent" or "summary".
  async check({ force = false } = {}) {
    const o = this.config.openrouter;
    let catalog;
    try {
      catalog = await this.fetchCatalog();
      this.lastCatalogError = null;
    } catch (err) {
      this.lastCatalogError = err.code || err.message;
      return { catalogReachable: false, error: "Could not read the OpenRouter model catalog", intent: [], summary: [] };
    }
    const byId = new Map(catalog.map((m) => [m.id, m]));
    const one = (id, requireStructured) => {
      const entry = byId.get(id);
      const result = evaluate(entry ? metaFor(entry) : { id, found: false }, { requireStructured, maxOutputTokens: o.maxOutputTokens });
      this.cache.set(`${id}|${requireStructured}`, { at: this.now(), result });
      return result;
    };
    const requireStructured = o.requireStructuredOutput;
    return {
      catalogReachable: true,
      catalogSize: catalog.length,
      // Intent model + every fallback must meet the SAME requirements.
      intent: [o.intentModel, ...o.intentFallbackModels].filter(Boolean).map((id) => one(id, requireStructured)),
      summary: [o.summaryModel, ...o.summaryFallbackModels].filter(Boolean).map((id) => one(id, false)),
      forced: force,
    };
  }

  // Cheap runtime gate. true / false / null (null = could not be verified;
  // callers rely on provider.require_parameters in that case).
  async isUsable(id, { requireStructured = true } = {}) {
    const key = `${id}|${requireStructured}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.config.capabilityCacheMs) return hit.result.usable;
    if (!this.inflight) {
      this.inflight = this.check().finally(() => {
        this.inflight = null;
      });
    }
    await this.inflight;
    const fresh = this.cache.get(key);
    if (fresh) return fresh.result.usable;
    return hit ? hit.result.usable : null;
  }
}

module.exports = ModelCapabilityService;
module.exports.evaluate = evaluate;
module.exports.metaFor = metaFor;
