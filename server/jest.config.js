// sanitize-html (pulled in transitively by ticket.service.js) ships ESM-only
// dependencies Jest's CJS transform can't load — a pre-existing gap noted in
// services/__tests__/ticket.service.commentRecipients.test.js. It is stubbed
// for tests only; the chatbot never calls it (it reads, never writes tickets).
module.exports = {
  testEnvironment: "node",
  setupFiles: ["<rootDir>/jest.setup.js"],
  moduleNameMapper: {
    "^sanitize-html$": "<rootDir>/src/chatbot/testkit/sanitizeHtmlStub.js",
  },
};
