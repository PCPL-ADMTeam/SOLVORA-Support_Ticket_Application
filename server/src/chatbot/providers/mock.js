// Deterministic provider for tests and local development. It performs NO
// network I/O and invents nothing: it returns the server-built draft
// unchanged, so local runs show exactly what the authorized tools produced.
// (Never used with fabricated ticket data — it only echoes the draft it is
// given.)
class MockChatModelProvider {
  constructor() {
    this.name = "mock";
  }

  async generateResponse(input) {
    return { text: input.draft };
  }
}

module.exports = MockChatModelProvider;
