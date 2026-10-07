const { ChatError, CODES } = require("../chatbot.errors");

// Tiny declarative input validator for tool inputs. Tool inputs are produced
// by OUR intent router (never by the language model or the HTTP body
// directly), but every tool still validates so the contract is enforced
// regardless of caller.
//
// schema: { field: { type: "string"|"int"|"enum", required?, max?, min?, values?, pattern? } }
function validateInput(schema, input = {}) {
  // Unknown fields are rejected, not ignored: a caller (or a model-influenced route)
  // cannot smuggle extra parameters into a tool.
  for (const key of Object.keys(input || {})) {
    if (!(key in schema)) throw new ChatError(CODES.INVALID_INPUT, { internal: `unknown field ${key}` });
  }
  const out = {};
  for (const [key, rule] of Object.entries(schema)) {
    const v = input[key];
    if (v === undefined || v === null || v === "") {
      if (rule.required) throw new ChatError(CODES.INVALID_INPUT, { internal: `missing ${key}` });
      continue;
    }
    if (rule.type === "string") {
      if (typeof v !== "string" || v.length > (rule.max || 200)) throw new ChatError(CODES.INVALID_INPUT, { internal: `bad ${key}` });
      if (rule.pattern && !rule.pattern.test(v)) throw new ChatError(rule.errorCode || CODES.INVALID_INPUT, { internal: `pattern ${key}` });
      out[key] = v;
    } else if (rule.type === "int") {
      const n = Number(v);
      if (!Number.isInteger(n) || n < (rule.min ?? 0) || n > (rule.max ?? 1000)) throw new ChatError(CODES.INVALID_INPUT, { internal: `bad ${key}` });
      out[key] = n;
    } else if (rule.type === "enum") {
      if (!rule.values.includes(v)) throw new ChatError(CODES.INVALID_INPUT, { internal: `bad ${key}` });
      out[key] = v;
    }
  }
  return out;
}

module.exports = { validateInput };
