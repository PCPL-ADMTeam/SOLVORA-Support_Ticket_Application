// Everyday ways of changing a ticket's status, turned into the one canonical sentence the action
// rules understand ("close ticket N because ...", "set ticket N to resolved because ..."). This only
// rewrites the user's words; the action itself is still previewed, permission-checked by the role
// policy and the ticket service, and confirmed.
//
//   "close the status of ticket 2600008"       -> "close ticket 2600008"
//   "set the status of ticket 2600008 to closed because dup" -> "close ticket 2600008 because dup"
//   "change the status of ticket 2600008 to resolved"        -> "set ticket 2600008 to resolved"
//   "put ticket 2600008 on hold since waiting for vendor"    -> "set ticket 2600008 to on hold because waiting for vendor"

const TICKET = "(?:the\\s+)?(?:status\\s+of\\s+)?(?:the\\s+)?ticket\\s+#?(?:number\\s+)?([a-z0-9-]+?)";
const TAIL = "(?:\\s*[:\\-]\\s*|\\s+(?:because|since|due to|reason|with reason|as|saying|note|notes)\\s*[:\\-]?\\s*)";
const rx = (body) => new RegExp(body, "i");

const CLOSE = rx(`^(?:please\\s+)?close\\s+${TICKET}(?:${TAIL}(.+?))?[.!?\\s]*$`);
const TO_CLOSED = rx(`^(?:please\\s+)?(?:set|change|mark|move|update|put|turn)\\s+${TICKET}\\s+(?:status\\s+)?(?:to|as|into)\\s+closed?(?:${TAIL}(.+?))?[.!?\\s]*$`);
const TO_STATUS = rx(`^(?:please\\s+)?(?:set|change|mark|move|update|put|turn)\\s+${TICKET}\\s+(?:status\\s+)?(?:to|as|into)\\s+(in progress|on hold|resolved|open|in-progress)(?:${TAIL}(.+?))?[.!?\\s]*$`);
const HOLD = rx(`^(?:please\\s+)?(?:put|place|keep)\\s+${TICKET}\\s+on\\s+hold(?:${TAIL}(.+?))?[.!?\\s]*$`);
const STARTED = rx(`^(?:please\\s+)?(?:start|begin)\\s+(?:working\\s+on\\s+)?${TICKET}[.!?\\s]*$`);

function normalizeStatusPhrases(text) {
  let m = text.match(CLOSE) || text.match(TO_CLOSED);
  if (m) return `close ticket ${m[1]}${m[2] ? ` because ${m[2]}` : ""}`;
  if ((m = text.match(HOLD))) return `set ticket ${m[1]} to on hold${m[2] ? ` because ${m[2]}` : ""}`;
  if ((m = text.match(TO_STATUS))) return `set ticket ${m[1]} to ${m[2].replace("-", " ")}${m[3] ? ` because ${m[3]}` : ""}`;
  if ((m = text.match(STARTED))) return `set ticket ${m[1]} to in progress`;
  return text;
}

// The status actions that must carry an explanation (the ticket service refuses them without one).
function needsReason(action, args) {
  if (action === "close_ticket" || action === "reopen_ticket") return true;
  if (action === "change_ticket_status") return /^(resolved|on hold)$/i.test(String(args.status || "").trim());
  return false;
}

module.exports = { normalizeStatusPhrases, needsReason };
