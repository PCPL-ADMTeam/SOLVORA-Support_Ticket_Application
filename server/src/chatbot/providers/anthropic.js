const axios = require("axios");
const { ChatError, CODES } = require("../chatbot.errors");
const { buildModelUserTurn } = require("./promptBuilder");

const DEFAULT_ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Anthropic Messages API provider. Key/model/endpoint come from env (see
// config/env.js). The key is only ever placed in the x-api-key header — never
// logged, never returned. `tools` in the input are informational descriptors
// only: tool selection is done server-side by the intent router, so no
// tool_use is requested from the model.
class AnthropicChatModelProvider {
  constructor({ apiKey, model, endpoint, timeoutMs, maxRetries, http = axios }) {
    this.name = "anthropic";
    this.apiKey = apiKey;
    this.model = model;
    this.endpoint = endpoint || DEFAULT_ENDPOINT;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.http = http;
  }

  async generateResponse(input) {
    const history = (input.messages || []).filter((m) => m.content);
    // The API requires the first message to be from the user.
    while (history.length && history[0].role !== "user") history.shift();

    const body = {
      model: this.model,
      max_tokens: 600,
      system: input.systemPrompt,
      messages: [
        ...history,
        { role: "user", content: buildModelUserTurn({ draft: input.draft, context: input.context, question: input.question }) },
      ],
    };

    let lastErr;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const res = await this.http.post(this.endpoint, body, {
          timeout: this.timeoutMs,
          headers: { "x-api-key": this.apiKey, "anthropic-version": API_VERSION, "content-type": "application/json" },
        });
        const text = (res.data?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
        return { text };
      } catch (err) {
        lastErr = err;
        const status = err.response?.status;
        const timedOut = err.code === "ECONNABORTED" || err.code === "ETIMEDOUT";
        const retryable = timedOut || !status || RETRYABLE_STATUS.has(status);
        if (!retryable || attempt === this.maxRetries) break;
        await sleep(250 * 2 ** attempt);
      }
    }

    const timedOut = lastErr?.code === "ECONNABORTED" || lastErr?.code === "ETIMEDOUT";
    // Log provider status only — never the request body, headers or key.
    console.error(`[chatbot] provider failure status=${lastErr?.response?.status || "-"} code=${lastErr?.code || "-"}`);
    throw new ChatError(timedOut ? CODES.PROVIDER_TIMEOUT : CODES.PROVIDER_UNAVAILABLE);
  }
}

module.exports = AnthropicChatModelProvider;
