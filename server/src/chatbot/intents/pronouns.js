// "Who is handling it?", "What priority is it?", "Add a comment saying ...", "Change it to high
// priority": the ticket the user is talking about is the last single ticket the assistant showed in
// this conversation. The phrase is rewritten into the same sentence with that ticket's NUMBER and then
// goes through exactly the same rules, access checks and previews as if the user had typed the number.
// Nothing here reads data or decides access, and a message that already names a ticket is left alone.

const PRONOUN = "(?:it|its|this ticket|that ticket|the ticket|this one|that one|this issue|that issue)";
const HAS_NUMBER = /\b\d{5,12}\b|#\s?\d{3,}/;

// Words that make a sentence about a ticket (so a stray "it" elsewhere is not rewritten).
const TICKET_CUES = /\b(reasons?|notes?|handl\w*|assign\w*|priority|status|state|comment\w*|rais\w*|creat\w*|updat\w*|histor\w*|attach\w*|resolv\w*|clos\w*|re-?open\w*|transfer\w*|escalat\w*|who|when|why|owner|working|mark|set|change|make|move|put|pending|latest|summar\w*|details?)\b/i;

const PRIORITY_WORD = "(low|medium|normal|high|critical|urgent)";

function resolveLastTicket(message, lastShown, page) {
  const text = String(message || "").trim();
  // "this ticket" / "the ticket": the ticket page that is open, else the last one shown. "it" / "that": the reverse.
  const wantsPage = /\b(?:this|the) ticket\b/i.test(text);
  const last = wantsPage ? page || lastShown : lastShown || page;
  if (!last || HAS_NUMBER.test(text)) return message;
  // Questions about how to do something are guidance, not about the ticket in view.
  if (/^(?:how (?:do|can|to|does|should|would)|explain|steps|can i)\b/i.test(text)) return message;
  const n = `ticket ${last}`;
  let m;

  // "Add a comment" / "add a comment in the ticket": the ticket in view; the assistant then asks what to say.
  if (/^(?:please\s+)?(?:add|post|write|leave|put)\s+(?:a\s+|the\s+)?(?:new\s+)?comment(?:\s+(?:on|to|in|for)\s+(?:the\s+|this\s+|that\s+)?ticket)?\s*[.!?]*$/i.test(text)) return `add a comment on ${n}`;

  // "Add a comment saying X" / "add comment: X" (no ticket named).
  m = text.match(/^(?:please\s+)?(?:add|post|write|leave|put)\s+(?:a\s+|the\s+)?(?:new\s+)?comment(?:\s*[:\-]\s*|\s+(?:saying|that says|which says|says)\s*[:\-]?\s*|\s+)(.+)$/is);
  if (m && !/\bticket\b/i.test(text)) {
    let comment = m[1].trim();
    const quoted = comment.match(/^["“'](.*)["”']\s*[.!]?$/s);
    if (quoted) comment = quoted[1].trim();
    if (comment) return `add a comment on ${n}: ${comment}`;
  }

  // "Change it to high priority" / "make it high priority" / "set the priority to high".
  m = text.match(new RegExp(`^(?:please\\s+)?(?:change|set|make|update|switch|mark)\\s+${PRONOUN}\\s+(?:to|as)?\\s*${PRIORITY_WORD}(?:\\s+priority)?[.!?]*$`, "i"));
  if (m) return `change priority of ${n} to ${m[1]}`;
  m = text.match(new RegExp(`^(?:please\\s+)?(?:change|set|update|switch)\\s+(?:the\\s+|its\\s+)?priority\\s+(?:to|as)\\s+${PRIORITY_WORD}[.!?]*$`, "i"));
  if (m) return `change priority of ${n} to ${m[1]}`;
  m = text.match(new RegExp(`^(?:please\\s+)?(?:change|set|make|update)\\s+${PRIORITY_WORD}\\s+priority[.!?]*$`, "i"));
  if (m) return `change priority of ${n} to ${m[1]}`;

  // "Set the status to closed because ..." (no ticket named): the ticket in view.
  m = text.match(/^(?:please\s+)?(?:set|change|update|move|mark|turn)\s+(?:the\s+)?status\s+(?:to|as|into)\s+(.+)$/i);
  if (m) return `set ${n} to ${m[1]}`;

  // "Close the status of the ticket" means close it.
  const verbs = text.replace(/\b(close|resolve|re-?open)\s+the status of\b/i, "$1");

  // Everything else: replace the pronoun, but only in a sentence that is about a ticket.
  if (new RegExp(`\\b${PRONOUN}\\b`, "i").test(text) && TICKET_CUES.test(text)) {
    return text.replace(new RegExp(`\\b${PRONOUN}\\b`, "i"), (hit) => (/^its$/i.test(hit) ? `${n}'s` : n));
  }
  return message;
}

module.exports = { resolveLastTicket };
