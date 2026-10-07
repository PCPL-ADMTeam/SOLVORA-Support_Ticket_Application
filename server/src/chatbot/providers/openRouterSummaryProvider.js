const axios = require("axios");
const { ChatError, CODES } = require("../chatbot.errors");
const { buildModelUserTurn } = require("./promptBuilder");
const { reasoningField } = require("./reasoning");

const MAX_MODELS = 3;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// OpenRouter as the SUMMARY / phrasing model (implements the existing
// ChatModelProvider interface, so the existing safeguards apply unchanged):
//   * it receives the server-built draft + the already-authorized, minimized DTOs
//     fenced as untrusted data (promptBuilder), never raw rows or credentials
//   * it never calculates counts, SLAs, rankings or permissions: those are in the draft
//   * its text is validated by providers/validate.js (no prompt echo, no unknown
//     ticket numbers) and any failure falls back to the server draft
//   * ordered fallback models under one time budget; key only in the header
class OpenRouterSummaryProvider {
  constructor({ config, capability, http = axios, now = () => Date.now(), log = console }) {
    this.name = "openrouter-summary";
    this.config = config;
    this.capability = capability;
    this.http = http;
    this.now = now;
    this.log = log;
  }

  models() {
    const o = this.config.openrouter;
    return [o.summaryModel, ...o.summaryFallbackModels].filter(Boolean).slice(0, MAX_MODELS);
  }

  async generateResponse(input) {
    const o = this.config.openrouter;
    const history = (input.messages || []).filter((m) => m.content);
    while (history.length && history[0].role !== "user") history.shift();
    const messages = [
      { role: "system", content: input.systemPrompt },
      ...history,
      { role: "user", content: buildModelUserTurn({ draft: input.draft, context: input.context, question: input.question }) },
    ];

    const deadline = this.now() + o.timeoutMs;
    let timedOut = false;
    for (const model of this.models()) {
      const usable = this.capability ? await this.capability.isUsable(model, { requireStructured: false }).catch(() => null) : null;
      if (usable === false) continue;
      for (let attempt = 0; attempt <= o.maxRetries; attempt += 1) {
        const remaining = deadline - this.now();
        if (remaining <= 250) throw new ChatError(CODES.PROVIDER_TIMEOUT);
        try {
          const provider = { data_collection: o.dataCollection };
          if (o.requireSupportedParameters) provider.require_parameters = true;
          if (o.allowedProviders.length) Object.assign(provider, { only: o.allowedProviders, allow_fallbacks: false });
          const headers = { Authorization: `Bearer ${o.apiKey}`, "Content-Type": "application/json", "X-Title": o.appName };
          if (o.appUrl) headers["HTTP-Referer"] = o.appUrl;
          const res = await this.http.post(
            `${o.baseUrl}/chat/completions`,
            { model, messages, temperature: o.temperature, max_tokens: Math.max(o.maxOutputTokens, 400), provider, ...(reasoningField(o.reasoningEffort) ? { reasoning: reasoningField(o.reasoningEffort) } : {}) },
            { timeout: remaining, headers }
          );
          const text = res.data?.choices?.[0]?.message?.content;
          if (typeof text === "string" && text.trim()) return { text };
          break; // empty answer: next model
        } catch (err) {
          const status = err.response?.status;
          timedOut = err.code === "ECONNABORTED" || err.code === "ETIMEDOUT";
          if (status === 401 || status === 403) throw new ChatError(CODES.PROVIDER_UNAVAILABLE);
          if (status === 400 || status === 404) break;
          const retryable = timedOut || !status || RETRYABLE.has(status);
          if (!retryable || attempt === o.maxRetries) break;
          await sleep(Math.min(250 * 2 ** attempt, Math.max(0, deadline - this.now() - 300)));
        }
      }
    }
    this.log.error(`[ai] openrouter summary failed timeout=${timedOut}`);
    throw new ChatError(timedOut ? CODES.PROVIDER_TIMEOUT : CODES.PROVIDER_UNAVAILABLE);
  }
}

module.exports = OpenRouterSummaryProvider;
