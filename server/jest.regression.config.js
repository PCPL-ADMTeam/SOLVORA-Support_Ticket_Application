// Chatbot regression suite: separate from `npm test` so the regular run is unchanged.
// Same environment and stubs as jest.config.js; only the files it looks for differ.
const base = require("./jest.config");

module.exports = {
  ...base,
  testMatch: ["<rootDir>/src/chatbot/regression/**/*.regression.js"],
};
