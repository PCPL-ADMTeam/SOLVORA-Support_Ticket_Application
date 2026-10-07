const { parseAction } = require("../intents/actionParser");
const { extractEntities } = require("../entities/extract");

// Reads the ticket details a person gave in ONE message, from their own words only:
//   title, priority, department, custom CC names, problem summary, and "no CC" / "no files".
// Nothing here looks anything up or decides anything: the flow resolves each value against the
// real priorities / departments / users and the ticket service validates the lot at creation.

const DEPT = "([a-z0-9&/\\-]+(?:\\s+[a-z0-9&/\\-]+){0,2}?)";
const STOPS = "(?=\\s*(?:[.,;:!?]|$)|\\s+(?:with|and|priority|title|titled|cc|about|that|because|my|the|problem|issue|description|summary)\\b)";

const DEPARTMENT_PATTERNS = [
  new RegExp(`\\b(?:for|to|towards)\\s+(?:the\\s+)?${DEPT}\\s+(?:department|dept|team)\\b`, "i"),
  new RegExp(`\\bdepartment\\s*(?:should be|must be|is|to be|:|=|to)?\\s*[:\\-]?\\s*${DEPT}${STOPS}`, "i"),
  new RegExp(`\\bsend (?:it|this)\\s+to\\s+(?:the\\s+)?${DEPT}${STOPS}`, "i"),
  new RegExp(`\\b(?:i want|i need|i'd like|choose|select|use)\\s+(?:the\\s+)?${DEPT}\\s*(?:department|dept|team)?${STOPS}`, "i"),
  new RegExp(`\\bticket\\s+(?:for|to)\\s+(?:the\\s+)?${DEPT}${STOPS}`, "i"),
];

const NOT_A_DEPARTMENT = /^(me|my|myself|us|you|it|this|that|a|an|the|someone|somebody|everyone|help|the problem|problem)$/i;

function title(text) {
  const m = text.match(/(?:\btitled\b|\btitle\s*(?:is|should be|will be|:)|\bsubject\s*(?:is|:)|\bcalled\b)\s*[:\-]?\s*["“']?(.+?)["”']?(?=\s*(?:$|[.;\n]|,\s)|\s+(?:with|and|priority|department|dept|team|cc|problem|description|summary|details)\b)/i);
  return m ? m[1].trim() : null;
}

function department(text) {
  for (const re of DEPARTMENT_PATTERNS) {
    const m = text.match(re);
    if (m && m[1] && !NOT_A_DEPARTMENT.test(m[1].trim())) return m[1].trim();
  }
  return null;
}

// "CC Manoj and Jamie", "cc these people: Manoj, Jamie", "add Manoj to CC"
function splitNames(raw) {
  return String(raw)
    .split(/\s*[,;]\s*|\s+and\s+|\s*&\s*|\s+(?=[^\s@,;]+@)/i)
    .map((n) => n.replace(/^(?:these people|the people|the following|people|please)\s*[:\-]?\s*/i, "").replace(/[.;!?]+$/, "").trim())
    .filter((n) => n && !/^(no one|nobody|none|nothing)$/i.test(n));
}
function ccAdd(text) {
  let m = text.match(/\badd\s+(.+?)\s+(?:to|in|into)\s+(?:the\s+)?cc\b/i);
  if (m) return splitNames(m[1]);
  m = text.match(/\b(?:cc|c\.c\.)\s*(?:these people|the following|the people)?\s*[:\-]?\s*(.+?)(?=\.(?:\s|$)|\n|\s+(?:with|priority|title|titled|department|problem|description)\b|$)/i);
  return m ? splitNames(m[1]) : [];
}
function ccRemove(text) {
  const m = text.match(/\b(?:remove|delete|drop|take off)\s+(.+?)\s+from\s+(?:the\s+)?cc\b/i);
  return m ? splitNames(m[1]) : [];
}

function description(text) {
  const m = text.match(/(?:\bproblem\s*(?:summary)?\s*(?:is|are|:)|\bissue\s*(?:is|:)|\bdescription\s*(?:is|:)|\bsummary\s*(?:is|:)|\bdetails?\s*(?:is|are|:))\s*[:\-]?\s*([\s\S]+)$/i);
  if (m) return m[1].trim();
  // Otherwise: sentences that are not the request itself (command, title, priority, department, CC).
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const isCommand = (s) => /^(?:please\s+)?(?:can you\s+|could you\s+)?(?:(?:i\s+)?(?:want|need|would like)\s+to\s+)?(?:raise|create|open|log|submit|file)\b.*\b(?:ticket|issue|request)\b/i.test(s) || /^(?:title|subject|priority|department|dept|cc)\b/i.test(s) || /^(?:cc|add .+ to cc|the title is|titled)\b/i.test(s);
  const rest = sentences.filter((s) => !isCommand(s));
  return rest.length && rest.length < sentences.length ? rest.join(" ") : null;
}

async function parseSlots(message, { requirePriorityWord = true } = {}) {
  const text = String(message || "").trim();
  const out = { title: null, priority: null, departmentText: null, ccAdd: [], ccRemove: [], noCc: false, noFiles: false, description: null };

  // Phrasings the action parser already understands ("for Demo laptop to hardware team", "to hardware dept that ...").
  const act = parseAction(text);
  if (act?.action === "create_ticket") {
    out.title = act.args.title || null;
    out.departmentText = act.args.department || null;
    out.description = act.args.description || null;
  }
  out.title = title(text) || out.title;
  out.departmentText = out.departmentText || department(text);
  out.description = description(text) || out.description;
  out.ccAdd = ccAdd(text);
  out.ccRemove = ccRemove(text);
  out.noCc = /\b(?:no|without|none|skip|don'?t need|do not need)\b[^.]*\bcc\b/i.test(text) || /^\s*(?:no cc|no one|nobody)\s*[.!]*$/i.test(text);
  out.noFiles = /\b(?:no|without|none|skip)\b[^.]*\b(?:attachments?|files?|screenshots?)\b/i.test(text);

  // Priority words count when the sentence says "priority" or uses an everyday urgency word.
  const hasPriorityWord = /\bpriority\b|\b(?:urgent|emergency|asap|critical|blocker|showstopper)\b/i.test(text);
  if (hasPriorityWord || !requirePriorityWord) {
    const found = await extractEntities(text, { visibleDepartments: [] });
    out.priority = found.priority;
  }
  return out;
}

module.exports = { parseSlots, splitNames, ccAdd, ccRemove, title, department, description };
