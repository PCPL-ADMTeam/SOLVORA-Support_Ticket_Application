// Redaction helpers (AI_REDACT_SENSITIVE_DATA).
//
//  - forModel: removes SECRETS from the one message sent to the interpreter
//    (bearer tokens, JWTs, long hex/base64 secrets, "password is ..." phrases).
//    Emails and names are kept: an admin may legitimately identify a user by
//    email, and the interpreter must be able to copy it into a parameter.
//  - forLog: additionally masks emails and long digit runs, for the optional
//    prompt/response logging switches (off by default).

const SECRET_PATTERNS = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "[redacted-token]"],
  [/\b(?:sk|pk|or)-[A-Za-z0-9_-]{16,}/g, "[redacted-key]"],
  [/\b[A-Fa-f0-9]{32,}\b/g, "[redacted-hex]"],
  [/\b(password|passwd|pwd|secret|api[_ -]?key|token)\s*(?:is|=|:)\s*\S+/gi, "$1 [redacted]"],
];

function forModel(text, enabled = true) {
  if (!enabled) return String(text);
  return SECRET_PATTERNS.reduce((t, [re, to]) => t.replace(re, to), String(text));
}

function forLog(text) {
  return forModel(text, true)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b\d{6,}\b/g, "[number]");
}

module.exports = { forModel, forLog };
