const { AiProviderError, KINDS } = require("./intentModelProvider");

// Used whenever AI interpretation is off or not configured. Every call fails
// the same safe way, so callers fall back to the rule engine.
class DisabledIntentProvider {
  constructor(reason = "disabled") {
    this.name = "disabled";
    this.reason = reason;
  }

  async interpret() {
    throw new AiProviderError(KINDS.NOT_CONFIGURED, this.reason);
  }
}

module.exports = DisabledIntentProvider;
