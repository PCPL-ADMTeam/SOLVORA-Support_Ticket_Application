const { normalizeMessage } = require("./aliases");
const { departmentRef, STOP } = require("./departmentRef");
const { extractDateRange } = require("../entities/dates");

// The structured question layer for DATA questions about tickets and people.
//
//   message -> { intent, params }   where params are a small set of FILTERS:
//     tickets: relation to me (mine / raised by me / assigned to me), a named person, a
//              department or person ("subject"), status/priority/date (read later against real
//              values), list-or-count mode
//     people:  department (read later against real departments), role filters, list-or-count mode
//
// Same filters whatever the wording, so "tickets I raised", "what support requests did I
// create" and "show tickets raised by me" are one question, not three rules. This module reads
// ONLY the user's words. Nothing here reads data, decides authorization or resolves names to
// people: the handlers do that against the database, scoped to the signed-in user, and the
// ticket/people tools restrict rows to what that user may see.

const GUIDANCE = /^(how (do|can|to|does|should|would)|where|what is|what's|what does|explain|can i|tell me about|steps)/;
const TICKET_WORD = /\b(tickets?|requests?|cases?)\b/;
const PEOPLE_WORD = /\b(people|persons?|employees?|users?|staff|members?|managers?|team ?leads?|leads?)\b/;
const ASK = /\b(who|show|list|give|display|see|view|get|find|which|what|how many|count|number of|tell|names?|are there|do i have|have i|any)\b/;
// Questions other rules own (reports, history, guidance about features).
const OTHER_OWNER = /(department.?wise|which (?:department|dept)|\b(?:most|highest|fewest|least|lowest|largest|biggest|maximum)\b|summar|statistic|stats|metric|trend|breakdown|report|each department|per department|by department|overdue|\bsla\b|escalat|unassigned|stale|histor|timeline|assignments?\b|dashboard|password|profile|notification)/;

const ROLE_WORDS = [
  ["MANAGER", /\bmanagers?\b/],
  ["TEAMLEAD", /\bteam ?leads?\b|\bleads?\b/],
  ["EMPLOYEE", /\bemployees?\b|\bagents?\b/],
];
const VERBS = new Set(["show", "list", "give", "find", "get", "me", "all", "display", "see", "view", "what", "are", "is", "who", "whats", "the", "of", "for", "tell", "about", "details", "info", "on", "please", "any"]);

const rolesIn = (m) => ROLE_WORDS.filter(([, rx]) => rx.test(m)).map(([k]) => k);

// A person's name: 1-3 words, never a pronoun or a word that is part of the question itself.
function cleanName(raw) {
  if (!raw) return null;
  const words = raw.trim().replace(/[?.!,]+$/, "").replace(/'s$/, "").split(/\s+/).filter(Boolean);
  while (words.length && (VERBS.has(words[0]) || STOP.has(words[0]))) words.shift();
  while (words.length && (VERBS.has(words[words.length - 1]) || STOP.has(words[words.length - 1]))) words.pop();
  if (!words.length || words.length > 3) return null;
  if (words.some((w) => /^(me|my|mine|myself|i|us|we|you|them|him|her|someone|somebody|anyone|everyone|people)$/.test(w))) return null;
  return words.join(" ");
}

const NAME = "([a-z][a-z.'-]*(?:\\s+[a-z][a-z.'-]*){0,2}?)";
const END = "(?=\\s+(?:in|for|from|of|with|that|which|and|only|today|yesterday|this|last|having|who|where)\\b|\\s*[?.!]*$)";
const rx = (body) => new RegExp(body, "i");
const ASSIGNED_TO = rx(`\\b(?:assigned (?:to|for)|handled by|owned by|being handled by|worked on by|assignee is)\\s+(?:the\\s+)?${NAME}${END}`);
const RAISED_BY = rx(`\\b(?:raised|created|submitted|logged|reported|requested|opened|filed|sent|made)\\s+by\\s+(?:the\\s+)?${NAME}${END}`);
const POSSESSIVE = rx("((?:[a-z][a-z.-]*\\s+){0,3}[a-z][a-z.-]*)'s\\b");

// Relation to the signed-in user. Never reads a name: "me" means the authenticated user.
function relationToMe(raw) {
  // "my departments" / "my team" name a scope, not "my own tickets".
  const m = raw.replace(/\bmy (departments?|depts?|team)\b/g, "$1");
  if (/\b(?:raised|created|submitted|logged|reported|requested|opened|filed|made|sent)\s+by\s+(?:me|myself)\b/.test(m)) return "requester";
  if (/\b(?:i|i've|i have|we)\s+(?:have\s+)?(?:rais|creat|submit|logg?|report|request|open|fil|mad|mak|sen[dt])\w*\b/.test(m)) return "requester";
  if (/\bmy\s+(?:raised|created|submitted)\b/.test(m)) return "requester";
  // "the raised tickets" / "created tickets" on their own mean the ones I raised (unless a person is named).
  if (/\b(?:raised|created|submitted|logged|filed)\s+(?:tickets?|requests?)\b/.test(m) && !/\bby\s+(?!me\b|myself)\S/.test(m)) return "requester";
  if (/\bassigned\s+(?:tickets?|requests?)\b/.test(m) && !/\bassigned(?:\s+(?:tickets?|requests?))?\s+(?:to|for)\s+(?!me\b|myself|my\b)\S/.test(m)) return "assignee";
  if (/\bam i (?:handling|working|responsible)|\b(?:i need|do i need|i have|i must|i should) to (?:work|handle|look)|\bresponsible for|\bassigned\s+(?:to|for)\s+(?:me|myself)\b|\bassigned\s+to\s+my\b|\b(?:on|with)\s+me\b|\bmy\s+assigned\b|\bi\s+(?:am|'m|have been)\s+(?:assigned|handling|working)\b|\bi'm\s+(?:handling|working)\b/.test(m)) return "assignee";
  if (/\b(?:my|mine)\b|\b(?:i|i've)\s+have\b|\btickets?\s+i\b|\bdo\s+i\s+have\b|\bhave\s+i\b/.test(m)) return "either";
  return null;
}

const STATUS_OR_PRIORITY = /\b(open|resolved|solved|closed|reopened|re-opened|on hold|on-hold|waiting|paused|pending|in progress|ongoing|critical|urgent|high|medium|low)\b/;
const DATE_WORD = /\b(today|yesterday|this week|last week|this month|last month|last \d+ days)\b/;

function ticketFrame(m, role) {
  const mine = relationToMe(m);
  let person = null;
  let personRelation = null;
  let hit;
  if ((hit = m.match(ASSIGNED_TO)) && cleanName(hit[1])) (person = cleanName(hit[1])), (personRelation = "assignee");
  else if ((hit = m.match(RAISED_BY)) && cleanName(hit[1])) (person = cleanName(hit[1])), (personRelation = "requester");
  else if ((hit = m.match(POSSESSIVE)) && cleanName(hit[1])) (person = cleanName(hit[1])), (personRelation = "either");

  let department;
  let subject;
  // A date or date range in the question ("from Sep 15 to Sep 20") is a filter, never a department.
  const hasDate = Boolean(extractDateRange(m));
  if (!person) {
    const ref = departmentRef(m);
    if (ref && !(hasDate && !/\b(department|dept|team)\b/.test(m))) {
      if (/\b(department|dept|team)\b/.test(m)) department = ref;
      else subject = ref; // a department OR a person: the handler checks real departments first
    }
  }

  const mode = /\b(how many|count|number of|total number)\b/.test(m) ? "count" : "list";
  const tx = m.match(/\b(?:about|regarding|containing|mentioning|matching|with the word|named)\s+["']?([^"'?.!]+?)["']?\s*[?.!]*$/);
  const claims = Boolean(hasDate || tx || mine || person || department || subject || mode === "count" || STATUS_OR_PRIORITY.test(m) || DATE_WORD.test(m));
  if (!claims) return null;
  if (!ASK.test(m) && !/^(?:my\s+)?tickets?\b/.test(m) && !/^my\b/.test(m)) return null;

  let filter = "any";
  if (/\bpending\b/.test(m)) filter = "pending";
  else if (/\b(open|unresolved|active)\b/.test(m) && !/\b(in progress|on hold|resolved|closed|reopened)\b/.test(m)) filter = "open";

  const pr = m.match(/\b(low|medium|high|critical)\s+(?:priority\s+)?tickets?\b|\b(low|medium|high|critical)\s+priority\b|\bpriority\s+(low|medium|high|critical)\b/);
  const flag = mine && mine !== "either" ? mine : null; // requester | assignee
  const scope = role === "EMPLOYEE" || mine ? "mine" : "staff";
  const params = { scope, filter, mode, title: scope === "mine" ? "Your tickets" : "Tickets" };
  if (flag) params.mine = flag;
  // "show me the closed ticket reasons": the same list, with each ticket's recorded reason.
  if (/\b(reasons?|resolution notes?)\b/.test(m)) params.withReasons = true;
  if (tx) params.text = tx[1].trim().slice(0, 100);
  if (pr) params.priority = pr[1] || pr[2] || pr[3];
  if (person) Object.assign(params, { personText: person, personRelation });
  if (department) params.department = department;
  if (subject) params.subject = subject;
  return { intent: "list_tickets", params };
}

function peopleFrame(m) {
  const whoManages = /\bwho\s+(?:manages|runs|heads|looks after)\b/.test(m);
  if ((!PEOPLE_WORD.test(m) && !whoManages) || TICKET_WORD.test(m) || !ASK.test(m) || OTHER_OWNER.test(m)) return null;
  let roles = rolesIn(m);
  // "who manages X" / "who leads X" asks for the managers, whatever else was said.
  if (!roles.length && /\bwho\s+(?:manages|runs|heads|looks after)\b/.test(m)) roles = ["MANAGER"];
  const mode = /\b(how many|count|number of|total)\b/.test(m) ? "count" : "list";
  // "how many employees do we have" (no department) belongs to the headcount report.
  if (mode === "count" && !departmentRef(m) && !/\b(?:in|of|for|from)\s+\S+/.test(m)) return null;
  return { intent: "people_directory", params: { roleFilters: roles, mode, all: /\b(each|every|all)\b/.test(m) && /\bdepartments?\b/.test(m) } };
}

// A bare name ("show Manoj", "who is Manoj Kumar") that nothing else claimed.
function personLookup(m) {
  const hit = m.match(rx(`^(?:show|find|who is|who's|tell me about|about|details of|info on|details for)?\\s*${NAME}\\s*[?.!]*$`));
  const name = hit && cleanName(hit[1]);
  if (!name || PEOPLE_WORD.test(name) || TICKET_WORD.test(name) || /\b(ones?|those|them|these|only|same|more)\b/.test(name)) return null;
  if (name.split(" ").some((w) => STOP.has(w) || w.length < 2)) return null;
  return { intent: "person_lookup", params: { personText: name } };
}

// "My dashboard", "my ticket statistics", "how many tickets do I have" -> the user's own dashboard numbers.
function dashboardFrame(m, role) {
  const mine = /\b(my|me|mine|i|i've|i have)\b/.test(m);
  const summaryWords = /\b(dashboard|summary|statistics|stats|overview|breakdown|by priority|by status|numbers|totals?)\b/;
  const ticketish = /\b(tickets?|requests?|dashboard)\b/.test(m);
  if (!ticketish || /\b(department|team|everyone|overall|company|each|per)\b/.test(m)) return null;
  const rel = relationToMe(m);
  const view = /\b(how many|count|number of|total number)\b/.test(m) ? "count" : "summary";
  const relParam = rel === "requester" ? "created" : rel === "assignee" ? "assigned" : "both";
  if (view === "count" && (rel || role === "EMPLOYEE") && !personRef(m)) return { intent: "dashboard_summary", params: { view, rel: relParam } };
  if (mine && summaryWords.test(m)) return { intent: "dashboard_summary", params: { view: "summary", rel: relParam } };
  return null;
}
function personRef(m) {
  return [ASSIGNED_TO, RAISED_BY, POSSESSIVE].some((rxp) => {
    const hit = m.match(rxp);
    return Boolean(hit && cleanName(hit[1]));
  });
}

// The bell: list / unread / count / today / for one ticket. (Marking read and clearing are actions.)
function notificationFrame(m) {
  if (!/\bnotifications?\b/.test(m) || /(settings?|templates?|e-?mail|configure|preferences?)/.test(m)) return null;
  if (!/\b(show|list|see|view|get|give|any|unread|latest|new|recent|how many|count|number|do i have|have i|what|which)\b/.test(m)) return null;
  const ticket = m.match(/\b(\d{5,12})\b/);
  const count = /\b(how many|count|number of)\b|\b(do|did) i have (any|unread)\b|\bhave i (any|got)\b/.test(m);
  return { intent: "notifications", params: { mode: count ? "count" : "list", unreadOnly: /\bunread|\bnew\b/.test(m), today: /\btoday\b/.test(m), ...(ticket ? { ticketNumber: ticket[1] } : {}) } };
}

// Returns { intent, params } or null (another rule owns the message).
// The name as the user typed it (the matching above runs on a lower-cased copy).
function originalCase(message, lower) {
  const i = String(message).toLowerCase().indexOf(lower);
  return i >= 0 ? String(message).slice(i, i + lower.length) : lower;
}

function parseFrame(message, role) {
  const m = normalizeMessage(message).replace(/’/g, "'");
  // "What's new", "anything new", "catch me up", "what did I miss", "what changed": the digest.
  // (Checked before the guidance guard below, which also begins with "what's".)
  if (/^(?:what(?:'s| is)? new|whats new|anything new|any news|any updates?|updates?|what(?:'s| is) (?:been )?(?:happening|going on|changed|up)|what changed|what did i miss|catch me up|news)(?: (?:today|this week|since yesterday|lately|recently|for me|here))?[?.!]*$/.test(m)) return { intent: "whats_new", params: {} };
  if (GUIDANCE.test(m)) return null;
  // "Show tickets" with nothing else: which tickets? (Admins just get the list.)
  if (role !== "ADMIN" && /^(?:(?:show|list|display|give|get|see|view)(?: me)?(?: all| the)? )?tickets?[?.!]*$/.test(m)) return { intent: "ticket_scope_question", params: {} };
  const own = notificationFrame(m) || dashboardFrame(m, role);
  if (own) return own;
  const frame = TICKET_WORD.test(m) && !OTHER_OWNER.test(m) ? ticketFrame(m, role) : peopleFrame(m);
  if (frame?.params?.personText) frame.params.personText = originalCase(message, frame.params.personText);
  return frame;
}

// Role words in a short follow-up ("only managers"). Several are allowed.
const ROLE_WORDS_FOR_FOLLOWUP = (m) => rolesIn(m);

module.exports = { ROLE_WORDS_FOR_FOLLOWUP, parseFrame, personLookup, relationToMe, cleanName };
