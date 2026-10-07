const { defang } = require("../text");

// Builds the final user turn sent to a model: the server-built draft, the
// authorized context as JSON inside delimiters (untrusted data), and the
// user's question last. Context is JSON-encoded so ticket text can only ever
// appear as string values, and our delimiter is defanged inside it.
function buildModelUserTurn({ draft, context, question }) {
  const data = defang(JSON.stringify(context ?? {}));
  return [
    "DRAFT ANSWER (server-built, authoritative):",
    draft,
    "",
    "<authorized_data>",
    data,
    "</authorized_data>",
    "",
    `USER QUESTION: ${defang(question)}`,
  ].join("\n");
}

module.exports = { buildModelUserTurn };
