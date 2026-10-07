const { parseAction } = require("./actionParser");
const { normalizeMessage } = require("./aliases");
const { actionAllowed, permissionsFor } = require("../permissions");
const knowledge = require("../knowledge");
const { departmentRef, topicBeforeTickets, STOP } = require("./departmentRef");
const { parseFrame, personLookup } = require("./queryFrame");
const { TICKET_REF_PATTERN } = require("../tools/ticketTools");

// Deterministic, allow-listed intent router. It reads ONLY the user's own
// message and the server-derived role. It never reads ticket content, so text
// inside tickets/comments can never influence which intent or tool runs, and
// the language model is never asked to pick one.

const GREETING = /^(hi|hello|hey|good (morning|afternoon|evening))\b|what can you do|^help\s*[?!.]*$|\bcapabilit/;
const GUIDANCE_START = /^(how (do|can|to|does|should|would)|where|what is|what's|what does|explain|can i|tell me about|steps)/;
const DATA_VERBS = /\b(show|list|display|give me|get|which|how many|any|find|search|look for|view|see|summar\w*)\b/;

// ---- ticket reference extraction ------------------------------------------

function extractTicketRef(message) {
  const prefixed = message.match(/(?:\bticket(?:\s*(?:number|no\.?|id))?\s*[:#]?\s*|\btkt[-\s]?|#)([a-z0-9][a-z0-9-]{1,20})/i);
  if (prefixed) {
    const token = prefixed[1];
    if (TICKET_REF_PATTERN.test(token)) return { kind: "valid", value: token };
    if (/\d/.test(token)) return { kind: "invalid", value: token };
    // e.g. "ticket history" — a word, not an id.
  }
  const bare = message.match(/\b\d{5,12}\b/);
  if (bare) return { kind: "valid", value: bare[0] };
  return { kind: "none" };
}

// The one fact a question about a single ticket asks for.
function ticketFocus(m) {
  return /\bwho\b.*\b(raised|created|opened|submitted|logged|reported|requested)\b|\b(raised|created|submitted|reported|requested)\s+by\b|\brequester\b/.test(m) ? "raisedBy" : /\bwho\b.*\b(assigned|handling|working|owns|owner)\b|\bassignee\b|\bassigned\s+to\s+whom\b/.test(m) ? "assignedTo" : /\b(status|state)\b|\bis (it|this|that|the ticket|ticket \S+) (open|closed|resolved|on hold|in progress|reopened)\b/.test(m) ? "status" : /\bpriority\b/.test(m) ? "priority" : undefined;
}

// "when was ticket N created / last updated": the date questions about one ticket.
const DATE_Q = /\bwhen\b.*\b(created|raised|opened|submitted|logged|filed|updated|modified)\b|\b(created|raised|opened|submitted|logged|filed|updated|modified) (at|on|date|time)\b|\bcreation (date|time)\b|\blast updated\b|\bdate (created|raised|opened|updated)\b/;
const dateFocus = (m) => (/updated|modified/.test(m) ? "updated" : "created");

// Why a ticket was resolved / closed / put on hold / reopened.
const REASON_Q = /\b(reasons?|resolution notes?|closing notes?|closed note|resolved note)\b|\bwhy (?:was|is|did|has)\b.*\b(closed|resolved|re-?opened|put on hold|on hold)\b/;
const REASON_STATUS = /\b(closed?|closing|resolved?|resolution|re-?open\w*|on[- ]hold|hold)\b/;
function reasonWord(m) {
  const hit = m.match(REASON_STATUS);
  if (!hit) return undefined;
  const w = hit[1];
  return /^clos/.test(w) ? "closed" : /^resol/.test(w) ? "resolved" : /^re-?open/.test(w) ? "reopened" : "on_hold";
}

// Extra details a ticket sub-intent carries (the date asked for, the status whose reason is asked).
function subExtras(sub, m) {
  if (sub === "ticket_dates") return { focus: dateFocus(m) };
  if (sub === "ticket_reasons") return { statusWord: reasonWord(m) };
  return {};
}

function ticketSubIntent(m) {
  if (REASON_Q.test(m) && (REASON_STATUS.test(m) || /\bresolution notes?\b/.test(m))) return "ticket_reasons";
  if (DATE_Q.test(m)) return "ticket_dates";
  if (/\bcomments?\b|commented/.test(m)) return "ticket_comments";
  if (/\battach|\bfiles?\b|\bdocuments?\b/.test(m)) return "ticket_attachments";
  if (/\b(managers?|team ?leads?)\b/.test(m)) return "ticket_people";
  if (/summar|tl;?dr|overview|brief me/.test(m)) return "summarize_ticket";
  if (/histor|timeline|activity log|what changed|audit trail/.test(m)) return "ticket_history";
  if (/\blatest\b|last update|recent update|newest update|what happened|most recent/.test(m)) return "latest_update";
  if (/pending|next step|what.*(need|required)|action|to do|blocked|waiting/.test(m)) return "pending_actions";
  return null;
}

// ---- article -> intent naming ----------------------------------------------

const ARTICLE_INTENTS = {
  "common.view-profile": "view_profile",
  "common.update-profile": "update_profile",
  "common.change-password": "change_password",
  "common.ticket-status": "status_definition",
  "common.ticket-priority": "priority_definition",
  "common.sla": "sla_info",
  "common.escalation": "escalation_info",
  "common.notifications": "notifications_info",
  "common.ticket-history": "ticket_history_guidance",
  "common.attachments": "add_attachment",
  "common.add-comment": "add_comment",
  "employee.create-ticket": "create_ticket",
  "agent.create-ticket": "create_ticket",
  "employee.my-tickets": "view_tickets",
  "agent.tickets": "view_tickets",
  "admin.all-tickets": "view_tickets",
  "employee.close-reopen": "close_reopen_ticket",
  "agent.close-reopen": "close_reopen_ticket",
  "employee.assignment": "assign_ticket",
  "agent.assignment": "assign_ticket",
  "admin.assignment": "assign_ticket",
};

const intentForArticle = (id) => ARTICLE_INTENTS[id] || "navigate";

// ---- data-intent helpers ---------------------------------------------------

function wantsStaffScope(m, role) {
  if (/\b(team|department|dept|overall|system|company|organization|all tickets|everyone)\b/.test(m)) return true;
  if (/\b(my|mine)\b/.test(m)) return false;
  return role !== "EMPLOYEE";
}

function statsScopeWord(m, role) {
  if (/\b(my|mine)\b/.test(m)) return "mine";
  if (/\b(overall|system|company|organization|everything|all tickets)\b/.test(m)) return "overall";
  if (/\b(team|department|dept)\b/.test(m)) return "department";
  // No scope word: staff roles mean their whole authorized view.
  return role === "EMPLOYEE" ? "mine" : "department";
}

function extractSearchText(message) {
  const m = message.match(/(?:about|for|containing|matching|regarding|mentioning|with the word|named)\s+["']?([^"'?]+?)["']?\s*[?.!]*$/i);
  if (m) return m[1].trim().slice(0, 100);
  const s = message.match(/^(?:search|find|look for)\s+(?:for\s+)?(?:my\s+|the\s+)?(?:tickets?\s+)?["']?([^"'?]+?)["']?\s*[?.!]*$/i);
  if (s && !/^(tickets?|my tickets?)$/i.test(s[1].trim())) return s[1].trim().slice(0, 100);
  return null;
}

// ---- main ------------------------------------------------------------------

// Public entry. `confidence` tells the hybrid flow whether a RELIABLE rule
// matched ("high": the AI interpreter is not called), only a weak keyword guess
// ("low": the interpreter gets a chance, the guess is the fallback), or nothing
// ("none").
// Ticket questions can name a department in many phrasings. Instead of one rule per
// phrasing, every ticket list/search result is checked once for a department mention.
// Only the user's words are read here; the handler resolves the name against the
// departments this user may see.
function refineTicketScope(r, message, role) {
  const m = normalizeMessage(message);
  if ((r.intent === "list_tickets" || r.intent === "search_tickets") && !r.params.department && !r.params.subject && !r.params.personText) {
    const dep = departmentRef(m);
    if (dep) {
      const params = { ...r.params, department: dep };
      if (r.intent === "search_tickets") {
        const depWords = new Set(dep.split(" "));
        const left = String(r.params.text || "").toLowerCase().split(/\s+/).filter((w) => w && !STOP.has(w) && !depWords.has(w));
        if (!left.length) return { intent: "list_tickets", params: { scope: params.scope, filter: "any", department: dep, title: "Tickets" }, weak: r.weak };
        params.text = left.join(" ");
      }
      return { ...r, params };
    }
  }
  if (r.intent === "unsupported") {
    const topic = topicBeforeTickets(m);
    if (!topic && role !== "EMPLOYEE") {
      const who = personLookup(m);
      if (who) return { ...who, params: { personText: (() => { const i = message.toLowerCase().indexOf(who.params.personText); return i >= 0 ? message.slice(i, i + who.params.personText.length) : who.params.personText; })() }, weak: true };
    }
    if (topic) return { intent: "list_tickets", params: { scope: wantsStaffScope(m, role) ? "staff" : "mine", filter: "any", departmentOrText: topic, title: "Tickets" }, weak: true };
  }
  return r;
}

function classify(message, role) {
  const r = refineTicketScope(classifyRules(message, role), message, role);
  const confidence = r.intent === "unsupported" ? "none" : r.weak ? "low" : "high";
  const { weak, ...rest } = r;
  return { ...rest, confidence };
}

// "Raise a ticket" in any wording: the conversational Raise a Ticket (ticketDraft/flow.js).
const CREATE_TICKET_WORDS = /^(?:please\s+)?(?:(?:can|could|would) you\s+)?(?:help me\s+)?(?:(?:i\s+)?(?:want|need|would like|wish)\s+to\s+|i'd like to\s+)?(?:raise|create|open|log|submit|file|make|report|start)\s+(?:\w+\s+){0,4}?(?:ticket|issue|incident|problem|request)\b(?!\s+#?\d)|^(?:i\s+)?(?:have|am having|'m having|got|face|facing)\s+(?:a|an|some)\s+(?:\w+\s+){0,3}?(?:issue|problem|trouble|error)\b/i;

function classifyRules(message, role) {
  // Lower-cased, typo- and synonym-normalized copy for the keyword rules.
  const m = normalizeMessage(message);

  // "Do something" requests come first. They are recognized from the user's own
  // words only, and only ADMIN may use them (everyone else is refused here and
  // again in the action service). Recognition does not execute anything: it
  // leads to a preview that needs a separate authenticated confirmation.
  if (CREATE_TICKET_WORDS.test(m) && !GUIDANCE_START.test(m)) {
    if (role === "ADMIN") return { intent: "admin_redirect", params: { key: "admin_raise_ticket" } };
    if (!actionAllowed("create_ticket", role, permissionsFor(role))) return { intent: "restricted_feature", params: {} };
    return { intent: "ticket_draft", params: {} };
  }
  const act = parseAction(message);
  if (act) {
    if (act.redirect) return role === "ADMIN" ? { intent: "admin_redirect", params: { key: act.redirect } } : { intent: "restricted_feature", params: {} };
    // The application itself forbids these for Administrators; explain instead of refusing generically.
    if (role === "ADMIN" && act.action === "create_ticket") return { intent: "admin_redirect", params: { key: "admin_raise_ticket" } };
    if (act.action === "create_ticket") return actionAllowed("create_ticket", role, permissionsFor(role)) ? { intent: "ticket_draft", params: {} } : { intent: "restricted_feature", params: {} };
    if (role === "ADMIN" && act.action === "assign_ticket") return { intent: "admin_redirect", params: { key: "reassign_ticket" } };
    // Deny by default: the role's permissions must cover the action (enforced again at preview and at confirmation).
    if (!actionAllowed(act.action, role, permissionsFor(role))) return { intent: "restricted_feature", params: {} };
    return { intent: "admin_action", params: { parsed: act } };
  }

  const ref = extractTicketRef(message);

  if (ref.kind === "invalid") return { intent: "invalid_ticket_ref", params: {} };

  if (ref.kind === "valid" && !/\bnotifications?\b/.test(m)) {
    const sub = ticketSubIntent(m) || "find_ticket";
    // "who raised ticket N" / "who is assigned to ticket N": still the authorized ticket lookup, answered directly.
    const focus = sub !== "find_ticket" ? undefined : ticketFocus(m);
    const roleFilters = sub === "ticket_people" ? [/\bmanagers?\b/.test(m) ? "MANAGER" : null, /\bteam ?leads?\b/.test(m) ? "TEAMLEAD" : null].filter(Boolean) : undefined;
    return { intent: sub, params: { ticketNumber: ref.value, ...(focus ? { focus } : {}), ...(roleFilters ? { roleFilters } : {}), ...subExtras(sub, m) } };
  }

  if (GREETING.test(m)) return { intent: "help", params: {} };

  // Data questions about tickets and people become filters (see queryFrame.js).
  const frame = parseFrame(message, role);
  if (frame) return frame;

  // Follow-ups about "it"/"this ticket" reuse the previous turn's ticket
  // (re-authorized by the tool every time).
  const sub = ticketSubIntent(m);
  // "Show the closed reason" / "why was it resolved" with no ticket named: the ticket in view.
  if (sub === "ticket_reasons" && !/tickets/.test(m) && !GUIDANCE_START.test(m)) return { intent: sub, params: { useLastTicket: true, ...subExtras(sub, m) } };
  const focusOnly = ticketFocus(m);
  if (!sub && focusOnly && /\b(it|its|this ticket|that ticket|the ticket|this one|that one)\b/.test(m) && !/tickets/.test(m) && !GUIDANCE_START.test(m)) {
    return { intent: "find_ticket", params: { useLastTicket: true, focus: focusOnly } };
  }
  if (sub && /\b(it|its|this ticket|that ticket|the ticket|same ticket|previous ticket|last ticket)\b/.test(m) && !/tickets/.test(m)) {
    return { intent: sub, params: { useLastTicket: true, ...subExtras(sub, m) } };
  }
  if (sub && (/\b(a|an|the|this|that|one|my)\s+ticket\b/.test(m) || /^\w+\s+ticket\s*[?.!]*$/.test(m)) && !GUIDANCE_START.test(m)) {
    return { intent: sub, params: { askTicket: true, ...subExtras(sub, m) } };
  }

  if (/(approach|near|close to|about to).{0,20}(sla|due|deadline|breach)|sla (exception|breach|risk|violation)s?/.test(m)) {
    return { intent: "sla_approaching", params: {} };
  }
  if (/\b(overdue|past due|breached|late tickets)\b/.test(m)) return { intent: "overdue_tickets", params: {} };
  if (/escalat/.test(m) && DATA_VERBS.test(m) && !GUIDANCE_START.test(m)) return { intent: "escalated_tickets", params: {} };

  // Reports (read-only). Matched before the people rule because they mention
  // managers/employees too. Each tool enforces who may run it.
  if (/ticket/.test(m) === false && /(headcount|employee count|staff count|user count|(employees?|staff|people|users?) (count|total|number)|(count|number|how many|total).{0,25}(employees?|staff|people|users?))/.test(m)) {
    return { intent: /\brole/.test(m) ? "users_by_role" : "department_headcount", params: {} };
  }
  // "Who manages the Support department?" — a specific department.
  const whoManages = m.match(/^who (?:manages|leads|runs|is (?:the )?(?:manager|team ?lead)s? (?:of|for|in))\s+(?:the\s+)?(.+?)(?:\s+department)?\s*[?.!]*$/);
  if (whoManages && !/ticket/.test(m)) return { intent: "manager_assignments", params: { department: whoManages[1].trim() } };
  if (/(manager|team ?lead)s?.{0,20}(assignments?|assigned)|assignments?.{0,20}(manager|team ?lead)|who (manages|leads|runs)/.test(m) && !/ticket/.test(m)) {
    return { intent: "manager_assignments", params: {} };
  }
  // Ranking departments by tickets: "which department has the most open tickets".
  if (/department.{0,40}(most|highest|largest|biggest|maximum|fewest|least|lowest).{0,40}tickets?|(most|highest|fewest|least|lowest).{0,30}tickets?.{0,30}department/.test(m)) {
    const rank = /fewest|least|lowest/.test(m) ? "fewest_open" : /open/.test(m) ? "most_open" : "most_total";
    return { intent: "tickets_by_department", params: { rank } };
  }
  if (
    /tickets?.{0,40}(each|every|per|by|all)\s+departments?|department.?wise|tickets? (raised|routed|sent|submitted|assigned) to (each|every|all|the)\b.{0,20}department|departments?.{0,20}(breakdown|split|distribution)|(breakdown|split|distribution).{0,25}departments?|group.{0,15}by departments?/.test(m)
  ) {
    return { intent: "tickets_by_department", params: {} };
  }
  // "display critical tickets assigned to Finance" — priority + department filter.
  const prioDept = m.match(/^(?:show|list|find|get|give me)\s+(?:me\s+)?(?:all\s+)?(low|medium|high|critical)\s+(?:priority\s+)?tickets?(?:\s+(?:assigned to|for|in|of|belonging to|raised (?:to|for))\s+(?:the\s+)?(.+?)(?:\s+department)?)?\s*[?.!]*$/);
  if (prioDept) {
    return { intent: "search_tickets", params: { scope: role === "EMPLOYEE" ? "mine" : "staff", filter: "any", priority: prioDept[1], department: prioDept[2] ? prioDept[2].trim() : undefined, title: `${prioDept[1][0].toUpperCase()}${prioDept[1].slice(1)} priority tickets` } };
  }
  if (/(weekly|this week|last week|past week|last 7 days).{0,25}(report|summary|overview)|(ticket|weekly) report|generate.{0,15}report/.test(m)) {
    return { intent: "weekly_report", params: {} };
  }

  // Questions about PEOPLE (employees, users, managers, team leads, members, staff).
  // Answered only for ADMIN (tool-enforced); everyone else is refused.
  const PEOPLE = /\b(employees?|users?|staff|members?|managers?|team ?leads?|people|who)\b/;
  const ASKING = /\b(names?|list|show|tell|which|who|give|see)\b|\bdepartments?\b/;
  if (PEOPLE.test(m) && ASKING.test(m) && !/ticket|\bhow\b|dashboard|portal|profile|password/.test(m)) {
    return { intent: "people_directory", params: { all: /\b(each|every|all)\b/.test(m) && /\bdepartments?\b/.test(m) } };
  }

  // "what departments are there": a data question, not the manage-departments guidance.
  if (/\bdepartments?\b/.test(m) && /\b(what|which|list|show|all|available|names?|are there)\b/.test(m) && !/ticket|manage|create|configure|add|edit|\bhow\b/.test(m)) {
    return { intent: "list_departments", params: {} };
  }

  if (!GUIDANCE_START.test(m)) {
    const staff = wantsStaffScope(m, role);
    const scope = staff ? "staff" : "mine";
    const word = statsScopeWord(m, role);

    if (/(unassigned|not assigned|no assignee|without (an )?assignee|nobody assigned)/.test(m)) {
      return { intent: "list_tickets", params: { scope, filter: "unassigned", title: "Unassigned open tickets" } };
    }
    if (/(no (recent )?(activity|updates?)|inactive|stale|not (been )?updated|stuck|gone quiet)/.test(m)) {
      return { intent: "list_tickets", params: { scope, filter: "stale", staleDays: 7, title: "Open tickets with no update in 7 days" } };
    }
    if (/ticket/.test(m) && /(summary|statistics|stats|metrics|trend|trends|breakdown|how many|\bcount\b|totals?)/.test(m) && !/summar\w* (my |the )?tickets/.test(m)) {
      return { intent: "ticket_statistics", params: { word } };
    }
    if (/(recently updated|recent(ly)? (updated|updates|activity)|latest tickets|recent tickets|last updated)/.test(m)) {
      return { intent: "list_tickets", params: { scope, filter: "recent", title: "Recently updated tickets" } };
    }
    if (/\b(pending|on hold|on-hold)\b/.test(m) && /ticket/.test(m)) {
      return { intent: "list_tickets", params: { scope, filter: "pending", title: "Pending (on hold) tickets" } };
    }
    if (/summar\w*/.test(m) && /tickets/.test(m)) {
      return { intent: "summarize_tickets", params: { scope } };
    }
    if (/\b(search|find|look for|looking for)\b/.test(m) && /ticket|about|for\b/.test(m)) {
      const text = extractSearchText(message);
      if (text) return { intent: "search_tickets", params: { scope, text } };
      return { intent: "search_prompt", params: {} };
    }
    if (/\b(open|active|unresolved|in progress)\b/.test(m) && /ticket/.test(m)) {
      return { intent: "list_tickets", params: { scope, filter: "open", title: "Open tickets" } };
    }
    if (/\b(team|department|dept)\b.*ticket|ticket.*\b(team|department)\b/.test(m)) {
      return { intent: "list_tickets", params: { scope: "staff", filter: "any", title: "Department tickets" } };
    }
    if (/(\bmy\b|\bmine\b).*tickets?|tickets? (i|that i)|(show|list|view) (all )?tickets/.test(m)) {
      return { intent: "list_tickets", params: { scope, filter: "any", title: scope === "mine" ? "Your tickets" : "Tickets" } };
    }
  }

  // Guidance / knowledge base. Search ONLY articles this role may see.
  const [best, runnerUp] = knowledge.searchArticlesScored(m, role, 2);
  if (best) {
    // Reliable = the whole message IS a keyword, a long/specific keyword matched,
    // or a question-shaped message has one clear winner. A lone generic word in
    // a free-form sentence is only a guess, so the AI interpreter may override it
    // (the guess remains the fallback when AI is unavailable).
    const exact = best.article.keywords.some((k) => k.toLowerCase() === m.replace(/[?.!]+$/, ""));
    const clearWinner = !runnerUp || runnerUp.score * 2 <= best.score;
    const reliable = exact || best.score >= 144 || (GUIDANCE_START.test(m) && clearWinner);
    return { intent: intentForArticle(best.article.id), params: { articleId: best.article.id }, weak: !reliable };
  }

  // Matches an article that exists for ANOTHER role: refuse generically
  // without describing it.
  const otherKeywords = knowledge.ARTICLES.filter((x) => !x.roles.includes("ALL") && !x.roles.includes(role)).flatMap((x) => x.keywords).filter((k) => m.includes(k.toLowerCase()));
  if (otherKeywords.length) {
    // A specific phrase ("manage users") is a clear refusal; a loose word
    // ("portal") is only a hint, so the interpreter may try before refusing.
    const longest = Math.max(...otherKeywords.map((k) => k.length));
    return { intent: "restricted_feature", params: {}, weak: !(GUIDANCE_START.test(m) && longest >= 12) };
  }

  return { intent: "unsupported", params: {} };
}

module.exports = { classify, extractTicketRef, intentForArticle };
