// Deterministic stand-in for tests and local development: it performs NO
// network I/O. `handler(input)` returns the structured object a model would
// have returned (or throws an AiProviderError). By default it answers
// UNSUPPORTED, so enabling it never invents behavior.
class MockIntentProvider {
  constructor(handler) {
    this.name = "mock";
    this.handler = handler || (() => ({ intent: "UNSUPPORTED", confidence: 1, parameters: {}, missingFields: [], requiresClarification: false }));
    this.calls = [];
  }

  async interpret(input) {
    this.calls.push(input);
    const raw = await this.handler(input);
    return { raw, model: "mock-intent-model", usage: { inputTokens: 0, outputTokens: 0 }, latencyMs: 0 };
  }
}

module.exports = MockIntentProvider;
