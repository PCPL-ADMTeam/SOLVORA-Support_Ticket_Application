const { classify } = require("../intents/router");
const { interpretWithAi } = require("./aiRuntime");
const { getIntent } = require("./intentRegistry");
const { UNSUPPORTED } = require("./intentSchemas");
const { applySelection, applyClarification, fresh } = require("./conversationContext");
const { normalizeMessage } = require("../intents/aliases");
const { resolveLastTicket } = require("../intents/pronouns");
const { extractEntities } = require("../entities/extract");
const { visibleDepartmentNames } = require("../intents/handlers");
const { ROLE_WORDS_FOR_FOLLOWUP } = require("../intents/queryFrame");

// The hybrid decision, in the mandated priority order:
//   0. conversation state (a pending choice / question the user is answering)
//   1. exact / pattern rule with high confidence          -> method "rule" (NO model call)
//   2. otherwise the OpenRouter interpreter              -> method "openrouter"
//   3. clarification when a required detail is missing   -> method "clarification"
//   4. otherwise the rule engine's weak guess, or UNSUPPORTED
//
// This module only DECIDES {intent, params}. It never reads data, resolves
// ids, checks permissions or executes anything: the chosen intent runs through
// the same handlers, tools and action preview/confirm flow as a rule-matched one.

const PARAM_QUESTION = {
  userReference: "Which person do you mean? Please give their full name.",
  departmentReference: "Which department do you mean?",
  ticketReference: "Which ticket number?",
  priorityReference: "Which priority should it be?",
  roleName: "Which role: Manager, Team Lead or Employee?",
  newName: "What should the new name be?",
  reason: "What is the reason?",
  searchText: "What should I search for?",
  topic: "Which feature or page do you want help with?",
  title: "What is the ticket about? Give a short subject.",
  description: "Please describe the problem in a sentence or two (up to 50 words).",
  comment: "What should the comment say?",
  assigneeReference: "Who should it be assigned to? Please give their full name.",
  emailAddress: "What is their email address?",
  statusValue: "Which status: In Progress, On Hold or Resolved?",
};

// Convert a validated AI result into a handler call, or a question to ask.
function routeAi(ai, role) {
  const def = getIntent(ai.intent);
  const missing = (def.required || []).filter((f) => ai.parameters[f] === undefined);
  if (missing.length) return { clarify: { kind: "ai", intentId: def.id, parameters: ai.parameters, field: missing[0] } };
  const routed = def.route(ai.parameters, { role });
  if (!routed) return { unsupported: true };
  return { routed };
}

function clarificationResult(clarify) {
  const question = PARAM_QUESTION[clarify.field] || "I need one more detail.";
  return { intent: "clarification_required", params: { question, state: { clarification: { ...clarify, at: Date.now() } } }, method: "clarification", confidence: 1 };
}

// "Only open ones", "only resolved", "what about Hardware", "show them": a short message that
// refines the previous data question. The previous question is kept as RESOLVED filters
// (department/person ids and names, status, priority, dates), never as raw text, and only the
// parts the new message mentions are changed. Nothing is inherited if the new message names
// nothing to change.
const FOLLOW_UP = /^(only|just|and|also|now|but|then|what about|how about|show only|filter|same|those|these|any)/;
const SHOW_THEM = /^(?:show|list|see|display|give me)(?: me)?\s+(?:them|those|these|all of them|the tickets|the list)\b/;

const PAGING = /^(?:show |see |give me |get )?(?:me )?(?:(?:the )?(more|next|previous|prev|back)(?: (?:page|ones?|tickets?|results?))?|more)[.!?]*$/;

async function followUp(message, scope, frame) {
  const m = normalizeMessage(message);
  // "Show more" / "next" / "previous": the same question, the next (or previous) page.
  const paging = m.match(PAGING);
  if (paging && frame.intent === "list_tickets") {
    const page = Math.max(1, (frame.params.page || 1) + (/previous|prev|back/.test(paging[0]) ? -1 : 1));
    return { intent: "list_tickets", params: { ...frame.params, mode: "list", page } };
  }
  // "Assigned to Jamie" / "raised by Manoj": the same list, narrowed to that person.
  const byPerson = frame.intent === "list_tickets" && String(message).trim().match(/^(?:no,?\s+|actually,?\s+|and\s+|only\s+|just\s+)*(assigned to|handled by|raised by|created by)\s+([a-z][a-z.' -]{1,40}?)\s*[?.!]*$/i);
  if (byPerson && !/\b\d{5,}\b/.test(byPerson[2])) {
    const { mine, ...rest } = frame.params || {};
    // "me" is the signed-in user, never a name to look up.
    if (/^(?:me|myself)$/i.test(byPerson[2].trim())) {
      const { userId, personRelation, ...plain } = rest;
      return { intent: "list_tickets", params: { ...plain, mode: "list", mine: /assigned|handled/i.test(byPerson[1]) ? "assignee" : "requester" } };
    }
    return { intent: "list_tickets", params: { ...rest, mode: "list", personText: byPerson[2].trim(), personRelation: /assigned|handled/i.test(byPerson[1]) ? "assignee" : "requester" } };
  }
  if (m.split(/\s+/).length > 8 || /\b\d{5,}\b/.test(m)) return null;
  const show = SHOW_THEM.test(m);
  // A bare department or status in a list conversation is a correction ("Actually BI/Copilot", "resolved").
  const shortCorrection = frame.intent === "list_tickets" && m.split(/\s+/).length <= 4 && !/\b(show|list|get|give|see|tickets?|my|all|how|what|who)\b/.test(m);
  if (!show && !shortCorrection && !FOLLOW_UP.test(m) && !/\b(ones|those|them|these)\b/.test(m)) return null;
  const base = frame.params || {};

  if (frame.intent === "people_directory") {
    const roles = ROLE_WORDS_FOR_FOLLOWUP(m);
    const found = await extractEntities(message, { visibleDepartments: await visibleDepartmentNames({ scope }) });
    if (!roles.length && !found.department && !show) return null;
    return { intent: "people_directory", params: { ...base, ...(roles.length ? { roleFilters: roles } : {}), ...(found.department ? { question: found.department } : {}), mode: "list" } };
  }

  if (frame.intent === "list_tickets") {
    const found = await extractEntities(message, { visibleDepartments: await visibleDepartmentNames({ scope }) });
    const params = { ...base, mode: "list" };
    let changed = show;
    if (found.status) (params.status = found.status), (params.filter = "any"), (changed = true);
    else if (/\b(open|unresolved|active)\b/.test(m)) (params.filter = "open"), delete params.status, (changed = true);
    if (found.priority) (params.priority = found.priority), (changed = true);
    if (found.department) (params.department = found.department), (changed = true);
    if (found.dateFrom) Object.assign(params, { dateFrom: found.dateFrom, dateTo: found.dateTo }), (changed = true);
    return changed ? { intent: "list_tickets", params } : null;
  }
  return null;
}

// "who is handling the first one", "show the last ticket's comments": the shown list is kept
// server-side as ticket NUMBERS; the phrase is replaced by the number and the message goes
// through the same rules and access checks as if the user had typed the number.
const ORDINALS = { first: 0, "1st": 0, second: 1, "2nd": 1, third: 2, "3rd": 2, fourth: 3, "4th": 3, fifth: 4, "5th": 4, last: -1 };
const ORDINAL_RE = /\b(?:the \s*)?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|last)(?: (?:one|ticket|result))?\b/i;

function resolveOrdinal(message, frame) {
  const list = frame?.results;
  if (!Array.isArray(list) || !list.length || !fresh(frame)) return message;
  const hit = message.match(ORDINAL_RE);
  if (!hit || /\b\d{5,}\b/.test(message)) return message;
  const idx = ORDINALS[hit[1].toLowerCase()];
  const number = idx === -1 ? list[list.length - 1] : list[idx];
  return number ? message.replace(ORDINAL_RE, `ticket ${number}`) : message;
}

async function decide({ message: original, scope, state = {}, lastTicketNumber, pageTicketNumber }) {
  // "the first one" -> a number from the list just shown; "it" / "this ticket" -> the last ticket shown.
  const message = resolveLastTicket(resolveOrdinal(original, state.frame), lastTicketNumber, pageTicketNumber);
  const role = scope.role;

  // 0) The user is answering something the assistant just asked.
  if (state.selection) {
    const picked = applySelection(message, state.selection);
    if (picked) return { intent: picked.intent, params: picked.params, method: "conversation_context", confidence: 1 };
  }

  // A refinement of the previous data question ("only open ones").
  if (state.frame && fresh(state.frame)) {
    const f = await followUp(message, scope, state.frame);
    if (f) return { intent: f.intent, params: f.params, method: "conversation_context", confidence: 1 };
  }

  const det = classify(message, role);

  // An answer to a free-text question (a reason, a comment, a description) is an answer even if it mentions a
  // ticket number or other words that look like a command ("duplicate of 2600007"); only an obvious new
  // question ("show my tickets") moves on.
  // A bare ticket number answers "Which ticket number?" instead of starting a lookup.
  const bareTicketAnswer = state.clarification?.field === "ticket" && /^#?\s?[A-Za-z]{0,4}-?\d{3,12}[.!?]*$/.test(message.trim());
  const freeTextAnswer = bareTicketAnswer || (state.clarification && ["reason", "comment", "description", "title"].includes(state.clarification.field) && !/^(?:show|list|who|how many|what|when|which|cancel|never ?mind)\b/i.test(message.trim()));
  if (state.clarification && (det.confidence !== "high" || freeTextAnswer)) {
    const cont = applyClarification(message, state.clarification);
    if (cont?.aiIntentId) {
      const r = routeAi({ intent: cont.aiIntentId, parameters: cont.parameters }, role);
      if (r.clarify) return clarificationResult(r.clarify);
      if (r.routed) return { ...r.routed, method: "conversation_context", confidence: 1 };
    } else if (cont) {
      return { ...cont, method: "conversation_context", confidence: 1 };
    }
  }

  // 1) A reliable rule matched: do not call the model.
  if (det.confidence === "high") return { intent: det.intent, params: det.params, method: "rule", confidence: 1 };

  // 2) No reliable rule: ask the interpreter (if available).
  const ai = await interpretWithAi({ message, role, userId: scope.userId });
  const fallback = { intent: det.intent, params: det.params, method: "rule", confidence: det.confidence === "low" ? 0.4 : 0, ai: { attempted: true, unavailable: ai.ok ? null : ai.unavailable } };

  if (ai.ok && ai.intent !== UNSUPPORTED) {
    const r = routeAi(ai, role);
    if (r.clarify) return { ...clarificationResult(r.clarify), model: ai.model, aiIntent: ai.intent, confidence: ai.confidence, method: "clarification" };
    if (r.routed) return { ...r.routed, method: "openrouter", confidence: ai.confidence, model: ai.model, aiIntent: ai.intent, ai: { attempted: true } };
  }
  // The interpreter said UNSUPPORTED (or was unavailable/rejected): keep the rule guess.
  if (ai.ok) fallback.ai = { attempted: true, unavailable: null };
  return fallback;
}

module.exports = { decide, routeAi, PARAM_QUESTION };
