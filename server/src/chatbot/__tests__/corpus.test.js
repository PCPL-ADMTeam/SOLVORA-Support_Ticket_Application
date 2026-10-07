jest.mock("../../config/prisma", () => require("../testkit/prismaMock"));

// Phrasing corpus: real questions people typed, and what the rules must make of them.
// Every wrong answer found in use is added to corpus/phrasings.json, so a fix for one
// sentence can never quietly break another. Format:
//   { "role": "ADMIN", "text": "...", "expect": { "intent": "...", "params": { subset } } }
// Only the listed params are checked. See docs/chatbot-testing.md.
const { classify } = require("../intents/router");
const corpus = require("./corpus/phrasings.json");

describe("phrasing corpus", () => {
  test("is not empty and every case is well formed", () => {
    expect(corpus.length).toBeGreaterThan(0);
    for (const c of corpus) {
      expect(["ADMIN", "MANAGER", "TEAMLEAD", "EMPLOYEE"]).toContain(c.role);
      expect(typeof c.text).toBe("string");
      expect(typeof c.expect.intent).toBe("string");
    }
  });

  test.each(corpus.map((c) => [`${c.role}: ${c.text}`, c]))("%s", (_name, c) => {
    const r = classify(c.text, c.role);
    expect(r.intent).toBe(c.expect.intent);
    expect(r.params).toMatchObject(c.expect.params || {});
  });
});
