const { extractTicketRef } = require("../intents/router");
const { getIntent } = require("./intentRegistry");
const { cleanUserMessage } = require("../text");

// Short-lived, SERVER-side conversation state, carried on the previous
// assistant message (structuredPayload._state). Only the immediately preceding
// assistant message counts, and only for STATE_TTL_MS. State holds resolved ids
// and already-validated parameters, never anything from the model's raw output.
//
//   selection     { options:[{id,label}], resume:{intent, params}, at }
//   clarification { kind:"action"|"ai", ... , field, at }

const STATE_TTL_MS = 10 * 60 * 1000;
const fresh = (s) => s && typeof s.at === "number" && Date.now() - s.at < STATE_TTL_MS;

const CONFIRM_WORDS = /^(yes|yep|yeah|y|ok|okay|sure|confirm|confirmed|go ahead|do it|proceed|approve|please do)[.!]*$/i;
const CANCEL_WORDS = /^(cancel|never ?mind|nevermind|stop|abort|no|nope|forget it|don'?t)[.!]*$/i;

const isConfirmWord = (m) => CONFIRM_WORDS.test(m.trim());
const isCancelWord = (m) => CANCEL_WORDS.test(m.trim());

// "2", "2.", "option 2", or the option's label (case-insensitive).
function pickOption(message, options) {
  const m = cleanUserMessage(message).toLowerCase();
  const num = m.match(/^(?:option\s*|number\s*|#)?(\d{1,2})\.?$/);
  if (num) return options[Number(num[1]) - 1] || null;
  return options.find((o) => o.label.toLowerCase() === m) || options.find((o) => m.length >= 3 && o.label.toLowerCase().startsWith(m)) || null;
}

// Resume the intent that was waiting for a choice, with the SERVER-held id.
function applySelection(message, selection) {
  if (!fresh(selection)) return null;
  const option = pickOption(message, selection.options);
  if (!option) return null;
  const resume = JSON.parse(JSON.stringify(selection.resume));
  if (resume.intent === "admin_action") resume.params.parsed.args.userId = option.id;
  else resume.params.userId = option.id;
  return { intent: resume.intent, params: resume.params, chosen: option.label };
}

// What each missing field is called in the user's terms, and how to read a free-text answer.
const READERS = {
  roleName: (text) => {
    const t = text.toLowerCase();
    if (/team\s?lead/.test(t)) return "TEAMLEAD";
    if (/manager/.test(t)) return "MANAGER";
    if (/employee|staff/.test(t)) return "EMPLOYEE";
    return null;
  },
  ticketReference: (text) => {
    const ref = extractTicketRef(text);
    if (ref.kind === "valid") return ref.value;
    const digits = text.match(/\b\d{3,12}\b/);
    return digits ? digits[0] : null;
  },
  ticket: (text) => READERS.ticketReference(text),
  emailAddress: (text) => READERS.email(text),
  statusValue: (text) => READERS.status(text),
  email: (text) => (text.match(/[^\s@()<>]+@[^\s@()<>]+\.[^\s@()<>]+/) || [null])[0],
  status: (text) => (/in progress/i.test(text) ? "in progress" : /on hold/i.test(text) ? "on hold" : /resolved?/i.test(text) ? "resolved" : null),
};

function readAnswer(field, message) {
  const text = cleanUserMessage(message).replace(/^["']|["']$/g, "").trim();
  const max = field === "description" || field === "comment" || field === "reason" ? 600 : 120;
  if (!text || text.length > max) return null;
  return READERS[field] ? READERS[field](text) : text;
}

// Continue a request that asked a question. Returns {intent, params} or null.
function applyClarification(message, clarification) {
  if (!fresh(clarification)) return null;
  const value = readAnswer(clarification.field, message);
  if (!value) return null;

  if (clarification.kind === "action") {
    // Keep `required` so the NEXT missing detail (if any) is asked for too.
    const parsed = { action: clarification.parsed.action, args: { ...clarification.parsed.args, [clarification.field]: value }, required: clarification.required };
    return { intent: "admin_action", params: { parsed: stillMissing(parsed, clarification.required) } };
  }

  // AI-originated: fill the parameter, then let the registry route/ask again.
  const def = getIntent(clarification.intentId);
  if (!def) return null;
  return { aiIntentId: def.id, parameters: { ...clarification.parameters, [clarification.field]: value } };
}

function stillMissing(parsed, required = []) {
  const missing = required.filter((f) => !parsed.args[f]);
  return missing.length ? { ...parsed, missing } : parsed;
}

module.exports = { applySelection, applyClarification, isConfirmWord, isCancelWord, pickOption, STATE_TTL_MS, fresh };
