// Finds a department the user mentioned while asking about tickets, from the
// user's own words only (no data is read here). The handler later resolves the
// text against the departments THIS user may see, so a name outside their scope
// resolves to nothing, exactly like an unknown name.
//
// Applied to every ticket list/search question, so "show me the hardware
// department ticket", "tickets in hardware", "open tickets for the Finance team"
// all narrow the list the same way, instead of each phrasing needing its own rule.

const STOP = new Set([
  "show", "me", "the", "a", "an", "all", "any", "my", "our", "your", "find", "list", "get", "display", "give", "see", "view", "open",
  "closed", "pending", "tickets", "ticket", "of", "in", "for", "from", "to", "under", "department", "departments", "dept", "team", "this",
  "that", "please", "only", "just", "every", "each", "recent", "latest", "new", "old", "raised", "assigned", "unassigned", "resolved", "status",
  "low", "medium", "high", "critical", "priority", "with", "and", "or", "by", "on", "is", "are", "there", "what", "which", "who", "whose",
]);

const GENERIC_TOPIC = new Set(["support", "help", "helpdesk", "service", "services", "request", "requests", "issue", "issues"]);

const WORD = "[a-z0-9][a-z0-9&/\\-]*";

// A date or a time word is never a department ("tickets from 2026-09-30 to 2026-10-07", "tickets of last week").
const DATE_LIKE = /(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?![a-z])\.?\s*\d|\d\s*(?:st|nd|rd|th)?\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\b(?:today|yesterday|week|month|year|days?)\b)/i;

function clean(raw) {
  if (!raw || DATE_LIKE.test(raw)) return null;
  const words = raw.trim().split(/\s+/).filter((w) => w && !STOP.has(w));
  if (!words.length || words.length > 3) return null;
  return words.join(" ");
}

// m: lower-cased, normalized message. Returns department text or null.
function departmentRef(m) {
  // "... in/of/for/from the <name> department|team"
  let hit = m.match(new RegExp(`\\b(?:in|of|for|from|under|to)\\s+(?:the\\s+)?((?:${WORD}\\s+){0,2}${WORD})\\s+(?:department|dept|team)\\b`));
  let name = hit && clean(hit[1]);
  if (name) return name;
  // "<name> department tickets" / "<name> dept ticket"
  hit = m.match(new RegExp(`((?:${WORD}\\s+){0,3}${WORD})\\s+(?:department|dept)\\s+tickets?\\b`));
  name = hit && clean(hit[1]);
  if (name) return name;
  // "tickets in/of/for/from <name>" (no trailing "department")
  hit = m.match(new RegExp(`\\btickets?\\s+(?:(?:are|is|were|do we have|does|did)\\s+)?(?:in|of|for|from|under|to)\\s+(?:the\\s+)?((?:${WORD}\\s+){0,2}${WORD})\\s*[?.!]*$`));
  name = hit && clean(hit[1]);
  return name || null;
}

// "hardware tickets", "show me the printer tickets": one or two leftover words
// before "tickets". Could be a department or a topic, so the handler decides.
function topicBeforeTickets(m) {
  const hit = m.match(new RegExp(`^(?:(?:show|list|find|get|display|give|see|view)\\s+)?(?:me\\s+)?(?:all\\s+)?(?:the\\s+)?((?:${WORD}\\s+)?${WORD})\\s+tickets?\\s*[?.!]*$`));
  const topic = hit ? clean(hit[1]) : null;
  // "support tickets" / "open helpdesk tickets" describe the kind of ticket, not the "IT Support" department.
  return topic && GENERIC_TOPIC.has(topic) ? null : topic;
}

module.exports = { departmentRef, topicBeforeTickets, STOP };
