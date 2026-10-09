const prisma = require("../config/prisma");
const env = require("../config/env");
const { ChatError, CODES, toErrorPayload, USER_MESSAGES } = require("./chatbot.errors");
const { recordChatAudit } = require("./chatbot.audit");
const { resolveRoleScope, portalFor, authorizedWhere } = require("./roleScope");
const { handlerFor, visibleDepartmentNames } = require("./intents/handlers");
const { extractEntities } = require("./entities/extract");
const { didYouMean, fallbackSuggestions, departmentSuggestions } = require("./intents/didYouMean");
const { decide } = require("./interpretation/hybridInterpreter");
const { getRuntime } = require("./interpretation/aiRuntime");
const { isConfirmWord, isCancelWord } = require("./interpretation/conversationContext");
const { buildSystemPrompt } = require("./prompts");
const { getProvider } = require("./providers");
const { validateModelText } = require("./providers/validate");
const { listToolDefinitions } = require("./tools");
const { cleanUserMessage } = require("./text");
const { SUGGESTIONS } = require("./suggestions");
const actions = require("./actions/actionService");
const { validTimeZone } = require("./period");

const MAX_MESSAGE_CHARS = 1000;
const HISTORY_TURNS = 6;
const SOFT_ERRORS = new Set([CODES.ACTION_INVALID, CODES.INVALID_ROLE_OPERATION, CODES.INVALID_TICKET_TRANSITION, CODES.INVALID_ASSIGNEE, CODES.ACTION_BLOCKED_BY_DEPENDENCIES, CODES.NO_RESULTS, CODES.TICKET_NOT_FOUND, CODES.ACCESS_DENIED, CODES.INVALID_TICKET_ID, CODES.UNSUPPORTED_INTENT]);

// Wraps unexpected failures (Prisma etc.) so nothing internal reaches the user.
async function guarded(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ChatError) throw err;
    console.error(`[chatbot] unexpected failure: ${err.code || err.name}: ${err.message}`);
    throw new ChatError(CODES.DATABASE_ERROR, { internal: err.message });
  }
}

// ---- conversations ---------------------------------------------------------

// A conversation is only ever visible to the user who created it. Not-found
// and not-yours are indistinguishable to the caller; the latter is audited.
async function loadOwnedConversation(user, conversationId, { requireActive = false } = {}) {
  const convo = await prisma.chatConversation.findUnique({ where: { id: conversationId } });
  if (!convo || convo.userId !== user.id || (requireActive && convo.status !== "ACTIVE")) {
    if (convo && convo.userId !== user.id) {
      await recordChatAudit({ userId: user.id, conversationId, action: "CONVERSATION_ACCESS_DENIED", resourceType: "ChatConversation", resourceId: conversationId, result: "DENIED" });
    }
    throw new ChatError(CODES.CONVERSATION_NOT_FOUND);
  }
  return convo;
}

async function getOrCreateConversation(user, conversationId) {
  if (conversationId) return loadOwnedConversation(user, conversationId, { requireActive: true });
  return prisma.chatConversation.create({ data: { userId: user.id, portalRole: user.role.name } });
}

// Recent turns for the model prompt, the last ticket discussed, and the
// short-lived state (selection / clarification) carried by the PREVIOUS
// assistant message only.
async function recentContext(conversationId) {
  const rows = await prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_TURNS,
    select: { senderType: true, messageText: true, structuredPayload: true },
  });
  rows.reverse();
  const messages = rows.map((r) => ({ role: r.senderType === "USER" ? "user" : "assistant", content: r.messageText }));
  let lastTicketNumber = null;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const n = rows[i].structuredPayload?.lastTicketNumber;
    if (n) {
      lastTicketNumber = n;
      break;
    }
  }
  const lastAssistant = [...rows].reverse().find((r) => r.senderType === "ASSISTANT");
  return { messages, lastTicketNumber, state: lastAssistant?.structuredPayload?._state || {} };
}

// ---- model phrasing --------------------------------------------------------

// The model only REPHRASES the server-built draft. Every failure path falls
// back to the draft, so a provider outage never blocks a correct answer and
// the model can never be the source of a fact.
async function phrase({ scope, conversationId, result, question, history }) {
  if (!result.useModel) return { text: result.message, degraded: false };
  const provider = getProvider();
  const systemPrompt = buildSystemPrompt(scope.role);
  if (!provider || !systemPrompt) {
    await recordChatAudit({ userId: scope.userId, conversationId, action: "PROVIDER_FALLBACK", resourceType: "Provider", resourceId: "unavailable", result: "ERROR" });
    return { text: result.message, degraded: true };
  }
  try {
    const output = await provider.generateResponse({
      systemPrompt,
      messages: history,
      draft: result.message,
      context: result.data,
      question,
      tools: listToolDefinitions(),
    });
    const text = validateModelText(output?.text, { allowedTicketNumbers: result.ticketNumbers });
    return { text, degraded: false };
  } catch (err) {
    const code = err instanceof ChatError ? err.code : CODES.PROVIDER_UNAVAILABLE;
    await recordChatAudit({ userId: scope.userId, conversationId, action: "PROVIDER_FALLBACK", resourceType: "Provider", resourceId: code, result: "ERROR" });
    return { text: result.message, degraded: true };
  }
}

// ---- response shaping --------------------------------------------------------

const plain = (message, extra = {}) => ({ message, data: {}, navigationTarget: null, suggestedActions: [], useModel: false, ticketNumbers: [], ...extra });

function responseTypeOf({ result, error, state, intent }) {
  if (result.data?.pendingAction) return "preview";
  if (state?.selection || state?.clarification) return "clarification";
  if (error?.code === CODES.UNSUPPORTED_INTENT) return "unsupported";
  if (error) return "error";
  if (result.data?.article) return "guidance";
  if (intent === "action_result") return "action";
  return "data";
}

// What to say, and what to offer, when a request is outside what this role may see. The wording
// names the role's own limit (never the hidden data, ids or internals).
function accessReply(role, departments = []) {
  const reply = accessReplyBase(role, departments);
  // At least three working suggestions, whatever the role's departments are.
  for (const f of fallbackSuggestions(role)) if (reply.prompts.length < 3 && !reply.prompts.includes(f)) reply.prompts.push(f);
  return reply;
}

function accessReplyBase(role, departments) {
  switch (role) {
    case "EMPLOYEE":
      return { message: "I don't have access to that information from your Employee portal. I can help with your own tickets and tickets assigned to you.", prompts: ["Show my tickets", "Show tickets assigned to me", "Show my notifications"] };
    case "TEAMLEAD":
      return { message: "I can only access tickets for your assigned department.", prompts: ["Show my department tickets", "Show tickets assigned to me", "Show unassigned tickets"] };
    case "MANAGER":
      return { message: "I can only access ticket data for your authorized departments.", prompts: ["Show my department tickets", ...departments.slice(0, 3).map((d) => `Show ${d} tickets`)] };
    default:
      return { message: "I don't have access to that information.", prompts: ["Show all tickets", "Show all departments", "Show my notifications"] };
  }
}

// A question that names a department this user has no access to must be refused, not answered
// as "nothing found" (which would read as "I searched and there is none"). Department names are
// not secret (the Raise a Ticket page lists them for everyone); only their tickets and people are.
// Applies to READ questions only: raising a ticket to any department stays allowed.
const DEPARTMENT_GUARDED = new Set(["dashboard_overview", "list_departments", "list_tickets", "people_directory", "person_lookup", "unsupported", "ticket_statistics", "summarize_tickets", "tickets_by_department", "manager_assignments", "department_headcount"]);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function blockedDepartments(message, ctx) {
  const visible = await visibleDepartmentNames(ctx);
  const all = (await prisma.department.findMany({ select: { name: true } })).map((d) => d.name);
  const hidden = all.filter((n) => !visible.some((v) => v.toLowerCase() === n.toLowerCase()));
  const hit = hidden.filter((n) => new RegExp(`(^|[^a-z0-9])${escapeRe(n)}(?=$|[^a-z0-9])`, "i").test(message));
  return { hit, visible };
}

// When the user's wording was not understood and the model could not help, offer
// questions that always work instead of a bare refusal.
function exampleActions(role) {
  return (SUGGESTIONS[role] || []).slice(0, 4).map((p) => ({ label: p, prompt: p }));
}

// ---- main entry ------------------------------------------------------------

// `user` is ALWAYS req.user from middleware/auth.js. The request body carries
// only { message, conversationId } — never a role.
//
// Processing order: authenticate (middleware) -> trusted scope -> validate ->
// conversation state -> rules -> (only if no reliable rule) AI interpretation ->
// validate -> authorize/resolve inside the controlled handler -> read result,
// or write PREVIEW (execution needs the separate confirm call).
async function sendMessage(user, { message, conversationId, pageTicketId, timeZone }) {
  const cleaned = cleanUserMessage(message ?? "");
  if (!cleaned || cleaned.length > MAX_MESSAGE_CHARS) throw new ChatError(CODES.INVALID_INPUT);

  return guarded(async () => {
    const scope = await resolveRoleScope(user);
    if (!portalFor(scope.role)) throw new ChatError(CODES.ACCESS_DENIED, { internal: "unknown role" });

    const convo = await getOrCreateConversation(user, conversationId);
    const ctxHistory = await recentContext(convo.id);
    // "this ticket" while a ticket page is open: the page's id is only a hint. It is turned into a ticket
    // number ONLY if this user may view that ticket; the number then goes through the usual rules and checks.
    let pageTicketNumber = null;
    if (pageTicketId) {
      const hit = await prisma.ticket.findFirst({ where: { AND: [{ id: pageTicketId }, authorizedWhere(scope)] }, select: { ticketNumber: true } });
      pageTicketNumber = hit?.ticketNumber || null;
    }
    const state = ctxHistory.state;

    await prisma.chatMessage.create({ data: { conversationId: convo.id, senderType: "USER", messageText: cleaned } });

    let intent;
    let params;
    let decision = { method: "rule", confidence: 1 };
    let result;
    let error = null;
    let outState = null;

    // A ticket being raised through the assistant: while a draft is open, messages are answers to it
    // (or changes to it) unless they are clearly a different question, in which case the draft waits.
    const ticketDraft = require("./ticketDraft/flow");
    const draftStore = require("./ticketDraft/draftStore");
    const openDraft = await draftStore.getActive(user.id, convo.id);
    let draftResult = null;
    if (openDraft && !/^(?:raise|create)\s+(?:a|another)\s+ticket/i.test(cleaned)) {
      draftResult = await ticketDraft.handleTurn({ scope, conversationId: convo.id, method: "rule" }, openDraft, cleaned).catch(async (err) => {
        if (err instanceof ChatError && SOFT_ERRORS.has(err.code)) return { __error: err };
        throw err;
      });
    }

    // Typed "yes"/"cancel" are NOT confirmations. Confirm is a button (a separate
    // authenticated call); a typed cancel may only discard.
    const short = cleaned.split(/\s+/).length <= 4;
    const pendingOpen = short ? await actions.hasPendingInConversation(user, convo.id) : false;
    if (draftResult && !draftResult.__error) {
      intent = "ticket_draft";
      params = {};
      decision = { method: "conversation_context", confidence: 1 };
      result = draftResult;
    } else if (draftResult?.__error) {
      intent = "ticket_draft";
      params = {};
      decision = { method: "conversation_context", confidence: 1 };
      error = { ...toErrorPayload(draftResult.__error), retryable: false };
      result = plain(draftResult.__error.message);
    } else if (short && pendingOpen && isConfirmWord(cleaned)) {
      intent = "confirm_pending_action";
      decision = { method: "conversation_context", confidence: 1 };
      result = plain("To make this change, press the Confirm button on the preview above. I never act on typed replies. You can also press Cancel, or type \"cancel\".");
    } else if (short && isCancelWord(cleaned) && (pendingOpen || state.selection || state.clarification)) {
      intent = "cancel_pending_action";
      decision = { method: "conversation_context", confidence: 1 };
      const row = pendingOpen ? await actions.cancelPendingInConversation(user, convo.id) : null;
      result = plain(row ? "Cancelled. Nothing was changed." : "Okay, I've dropped that request.", row ? { data: { cancelledActionId: row.id } } : {});
    } else {
      decision = await decide({ message: cleaned, scope, state, lastTicketNumber: ctxHistory.lastTicketNumber, pageTicketNumber });
      intent = decision.intent;
      params = decision.params;
    }

    // `timeZone` only decides where "today" starts in date windows; an unknown zone means UTC.
    const ctx = { scope, conversationId: convo.id, lastTicketNumber: ctxHistory.lastTicketNumber || pageTicketNumber, method: decision.method, aiIntent: decision.aiIntent, timeZone: validTimeZone(timeZone) };

    if (!result) {
      try {
        if (scope.role !== "ADMIN" && DEPARTMENT_GUARDED.has(intent)) {
          const { hit, visible } = await blockedDepartments(cleaned, ctx);
          if (hit.length) {
            const denied = new ChatError(CODES.ACCESS_DENIED, { internal: `department outside access: ${hit.join(", ")}` });
            denied.roleReply = true; // answered with the role's own wording and working suggestions
            throw denied;
          }
        }
        result = await handlerFor(intent)(ctx, params, cleaned);
      } catch (err) {
        if (!(err instanceof ChatError) || !SOFT_ERRORS.has(err.code)) throw err;
        error = { ...toErrorPayload(err), retryable: false };
        result = plain(err.message);
        // Access denied: say what this role CAN do, with questions that work for it (no ids, no internals).
        if (err.code === CODES.ACCESS_DENIED) {
          const reply = accessReply(scope.role, await visibleDepartmentNames(ctx).catch(() => []));
          if (err.roleReply || err.message === USER_MESSAGES[CODES.ACCESS_DENIED]) result.message = reply.message;
          result.suggestedActions = reply.prompts.map((p) => ({ label: p, prompt: p }));
          result.message = `${result.message}\n\nTry:\n${reply.prompts.map((p) => `• ${p}`).join("\n")}`;
        }
        // Several matches: remember the candidates (ids stay on the server) and let the user pick.
        if (err.suggestions?.length) result.suggestedActions = err.suggestions;
        if (err.choices?.length) {
          outState = { selection: { options: err.choices.map((c) => ({ id: c.id, label: c.label })), resume: { intent, params }, at: Date.now() } };
          result.suggestedActions = err.choices.map((c) => ({ label: c.label, prompt: c.label }));
          error = null;
        }
        await recordChatAudit({
          userId: user.id,
          conversationId: convo.id,
          action: `CHAT_${err.code}`,
          resourceType: "Intent",
          resourceId: intent,
          result: err.code === CODES.ACCESS_DENIED ? "DENIED" : "SUCCESS",
        });
      }
    }
    if (result.state) outState = result.state;

    // Unrecognized wording and the model could not help: say so and offer working examples.
    const aiNote = decision.ai?.attempted && decision.ai.unavailable && decision.ai.unavailable !== "disabled" ? decision.ai.unavailable : null;
    if (error?.code === CODES.UNSUPPORTED_INTENT) {
      if (aiNote) {
        result.message = `${result.message} AI interpretation is unavailable right now, so I can only understand the standard phrasings. Try one of these:`;
        result.data = { ...result.data, aiUnavailable: true };
      }
      // Never a dead end and never a guess: say what happened, then offer the closest real questions for this role.
      const found = await extractEntities(cleaned, { visibleDepartments: await visibleDepartmentNames(ctx) }).catch(() => null);
      const hints = didYouMean({ message: cleaned, role: scope.role, found });
      const aiSuffix = aiNote ? " (AI interpretation is unavailable right now, so I can only understand the standard phrasings.)" : "";
      let prompts;
      if (/^(?:show|list|find|get|see|display|tell me)[?.!]*$/i.test(cleaned)) {
        // A verb with nothing after it: incomplete, not unknown.
        result.message = "What would you like to see?";
        prompts = fallbackSuggestions(scope.role);
      } else if (found?.department && cleaned.split(/\s+/).length <= 3) {
        // Just a department name: ambiguous. Offer what can be asked about it (only what this role may do).
        result.message = `I'm not sure what you'd like to check for ${found.department}.`;
        prompts = departmentSuggestions(scope.role, found.department);
      } else if (scope.role === "EMPLOYEE" && /^(?:(?:show|find|tell me about)\s+)?[A-Z][a-z]{2,}$/.test(cleaned)) {
        // A person's name from an Employee: other people cannot be looked up, so say what can be asked.
        const who = cleaned.replace(/^(?:show|find|tell me about)\s+/i, "");
        result.message = `I'm not sure what you want to know about "${who}". I can only show your own tickets and notifications. Did you mean one of these?`;
        prompts = fallbackSuggestions(scope.role);
      } else if (hints.prompts.length) {
        result.message = `I'm not sure I understood that.${hints.noticed} Did you mean one of these?${aiSuffix}`;
        prompts = hints.prompts;
      } else {
        const bare = cleaned.match(/^(?:show|find|list|get|see|display)\s+(?:me\s+)?(.{1,40}?)\s*[?.!]*$/i);
        result.message = bare ? `I'm not sure what you want to see for "${bare[1]}". Did you mean one of these?` : `I'm not sure what you're looking for.${aiSuffix}`;
        prompts = fallbackSuggestions(scope.role);
      }
      // Only questions that work for THIS user: drop any that name a department they cannot reach, then top up to at least three.
      const usable = [];
      for (const p of prompts) {
        const blocked = scope.role === "ADMIN" ? { hit: [] } : await blockedDepartments(p, ctx).catch(() => ({ hit: [] }));
        if (!blocked.hit.length && !usable.includes(p)) usable.push(p);
      }
      for (const f of fallbackSuggestions(scope.role)) if (usable.length < 3 && !usable.includes(f)) usable.push(f);
      result.suggestedActions = usable.slice(0, 5).map((p) => ({ label: p, prompt: p }));
      // The same suggestions in the text, so they are visible wherever the answer is shown.
      result.message = `${result.message}\n\nTry:\n${result.suggestedActions.map((a) => `• ${a.prompt}`).join("\n")}`;
    }

    if (decision.ai?.attempted && decision.ai.unavailable !== "disabled") {
      await recordChatAudit({
        userId: user.id,
        conversationId: convo.id,
        action: decision.method === "openrouter" || decision.method === "clarification" ? "AI_INTERPRETATION" : "AI_INTERPRETATION_UNAVAILABLE",
        resourceType: "Intent",
        resourceId: decision.aiIntent || decision.ai.unavailable || "none",
        result: decision.method === "openrouter" || decision.method === "clarification" ? "SUCCESS" : "ERROR",
      });
    }

    const phrased = await phrase({ scope, conversationId: convo.id, result, question: cleaned, history: ctxHistory.messages });
    const data = { ...result.data, ...(phrased.degraded ? { degraded: true } : {}) };
    const responseType = responseTypeOf({ result: { ...result, data }, error, state: outState, intent });

    const assistant = await prisma.chatMessage.create({
      data: {
        conversationId: convo.id,
        senderType: "ASSISTANT",
        messageText: phrased.text,
        intent,
        // `_state` is server-side conversation state; it is never returned to the browser.
        structuredPayload: outState ? { ...data, _state: outState } : data,
        errorCode: error?.code || null,
      },
    });
    await prisma.chatConversation.update({ where: { id: convo.id }, data: { lastMessageAt: new Date() } });

    const interpretation = { method: decision.method, confidence: decision.confidence };
    if (decision.model && getRuntime().config.exposeModelMetadata) interpretation.model = decision.model;

    return {
      conversationId: convo.id,
      messageId: assistant.id,
      responseType,
      intent,
      interpretation,
      message: phrased.text,
      data,
      suggestedActions: result.suggestedActions,
      navigationTarget: result.navigationTarget,
      pendingAction: data.pendingAction || null,
      error,
    };
  });
}

// A conversation is only ever shown back to its owner while they hold the role it
// was held under. If their role changed since, its stored answers may contain
// data the new role must not see, so it is treated as not found.
async function loadReadableConversation(user, conversationId) {
  const convo = await loadOwnedConversation(user, conversationId);
  if (convo.portalRole !== user.role.name) throw new ChatError(CODES.CONVERSATION_NOT_FOUND, { internal: "conversation opened under a different role" });
  return convo;
}

const HISTORY_LIMIT = 30;
const HISTORY_MAX_PAGE_SIZE = 50;
const BULK_DELETE_MAX = 50;
const TITLE_CHARS = 60;

// The signed-in user's own earlier conversations, newest first, one page at a time. Titles are the
// first thing the user typed. Nothing from other users or other roles. A conversation with no user
// message yet (nothing worth reopening) is not listed, and not counted.
async function listConversations(user, { page, pageSize } = {}) {
  return guarded(async () => {
    const size = Math.min(Math.max(Number.parseInt(pageSize, 10) || HISTORY_LIMIT, 1), HISTORY_MAX_PAGE_SIZE);
    const where = { userId: user.id, portalRole: user.role.name, messages: { some: { senderType: "USER" } } };
    const total = await prisma.chatConversation.count({ where });
    const totalPages = Math.max(Math.ceil(total / size), 1);
    // A page past the end (e.g. after deleting the last items of it) lands on the last page instead of an empty one.
    const current = Math.min(Math.max(Number.parseInt(page, 10) || 1, 1), totalPages);
    const rows = await prisma.chatConversation.findMany({ where, orderBy: { lastMessageAt: "desc" }, skip: (current - 1) * size, take: size });
    const items = await Promise.all(
      rows.map(async (c) => {
        const [first] = await prisma.chatMessage.findMany({ where: { conversationId: c.id, senderType: "USER" }, orderBy: { createdAt: "asc" }, take: 1 });
        if (!first) return null;
        const text = String(first.messageText).replace(/\s+/g, " ").trim();
        return { conversationId: c.id, title: text.length > TITLE_CHARS ? `${text.slice(0, TITLE_CHARS - 1)}…` : text, status: c.status, lastMessageAt: c.lastMessageAt };
      })
    );
    return { conversations: items.filter(Boolean), total, page: current, pageSize: size, totalPages };
  });
}

// Reopen an earlier conversation so it can be continued.
async function resumeConversation(user, conversationId) {
  return guarded(async () => {
    const convo = await loadReadableConversation(user, conversationId);
    if (convo.status !== "ACTIVE") await prisma.chatConversation.update({ where: { id: convo.id }, data: { status: "ACTIVE" } });
    await recordChatAudit({ userId: user.id, conversationId: convo.id, action: "CONVERSATION_RESUMED", resourceType: "ChatConversation", resourceId: convo.id, result: "SUCCESS" });
    return { conversationId: convo.id, status: "ACTIVE" };
  });
}

// Permanently removes conversations that belong to `user` (the user id is in every query, so nothing
// of anyone else's can be touched). Deleting is a real delete, not an archive: the messages and their
// feedback follow the conversation (foreign-key cascade). A change still waiting for confirmation in
// those conversations is cancelled and a ticket draft still being filled in (with its stored files) is
// discarded. Tickets, comments, notifications and the records of changes already made are other tables
// and are not touched. One transaction: all of it, or none of it.
async function removeConversations(user, ids) {
  if (!ids.length) return 0;
  const [, , removed] = await prisma.$transaction([
    prisma.chatPendingAction.updateMany({ where: { userId: user.id, conversationId: { in: ids }, status: "PENDING" }, data: { status: "CANCELLED", resolvedAt: new Date() } }),
    prisma.chatTicketDraft.deleteMany({ where: { userId: user.id, conversationId: { in: ids }, status: "ACTIVE" } }),
    prisma.chatConversation.deleteMany({ where: { userId: user.id, id: { in: ids } } }),
  ]);
  return removed.count;
}

// Delete one of the user's own conversations.
async function deleteConversation(user, conversationId) {
  return guarded(async () => {
    const convo = await loadOwnedConversation(user, conversationId);
    await removeConversations(user, [convo.id]);
    await recordChatAudit({ userId: user.id, conversationId: null, action: "CONVERSATION_DELETED", resourceType: "ChatConversation", resourceId: convo.id, result: "SUCCESS" });
    return { conversationId: convo.id, deleted: true };
  });
}

// Delete several of the user's own conversations. Ids that are not the caller's (or do not exist) are
// skipped without saying which, so the answer never confirms that someone else's conversation exists.
async function deleteConversations(user, conversationIds) {
  return guarded(async () => {
    const wanted = [...new Set(conversationIds)];
    if (!wanted.length || wanted.length > BULK_DELETE_MAX) throw new ChatError(CODES.INVALID_INPUT, { message: `Choose between 1 and ${BULK_DELETE_MAX} conversations to delete.`, internal: "bulk delete size" });
    const owned = (await prisma.chatConversation.findMany({ where: { userId: user.id, id: { in: wanted } } })).map((c) => c.id);
    if (owned.length < wanted.length) {
      await recordChatAudit({ userId: user.id, conversationId: null, action: "CONVERSATION_ACCESS_DENIED", resourceType: "ChatConversation", resourceId: `${wanted.length - owned.length} not found or not owned`, result: "DENIED" });
    }
    const deleted = await removeConversations(user, owned);
    await recordChatAudit({ userId: user.id, conversationId: null, action: "CONVERSATIONS_DELETED", resourceType: "ChatConversation", resourceId: `${deleted} deleted`, result: "SUCCESS" });
    return { deleted, deletedIds: owned };
  });
}

// Delete every conversation the signed-in user has (whatever role it was opened under). Never anyone else's.
async function deleteAllConversations(user) {
  return guarded(async () => {
    const owned = (await prisma.chatConversation.findMany({ where: { userId: user.id } })).map((c) => c.id);
    const deleted = await removeConversations(user, owned);
    await recordChatAudit({ userId: user.id, conversationId: null, action: "CONVERSATIONS_DELETED_ALL", resourceType: "ChatConversation", resourceId: `${deleted} deleted`, result: "SUCCESS" });
    return { deleted };
  });
}

async function getConversation(user, conversationId) {
  return guarded(async () => {
    const convo = await loadReadableConversation(user, conversationId);
    const rows = await prisma.chatMessage.findMany({ where: { conversationId: convo.id }, orderBy: { createdAt: "asc" }, take: 200 });
    return {
      conversationId: convo.id,
      status: convo.status,
      messages: rows.map((m) => {
        // Server-side conversation state and one-time confirmation tokens are never replayed.
        const { _state, ...visible } = m.structuredPayload || {};
        if (visible.pendingAction) visible.pendingAction = { ...visible.pendingAction, confirmationToken: undefined };
        return {
          id: m.id,
          sender: m.senderType === "USER" ? "user" : "assistant",
          text: m.messageText,
          intent: m.intent,
          data: m.structuredPayload ? visible : m.structuredPayload,
          errorCode: m.errorCode,
          createdAt: m.createdAt,
        };
      }),
    };
  });
}

async function resetConversation(user, conversationId) {
  return guarded(async () => {
    const convo = await loadOwnedConversation(user, conversationId);
    await prisma.chatConversation.update({ where: { id: convo.id }, data: { status: "ARCHIVED" } });
    return { conversationId: convo.id, status: "ARCHIVED" };
  });
}

const confirmAction = (user, actionId, proof) => guarded(() => actions.confirmAction(user, actionId, proof));
const cancelAction = (user, actionId, proof) => guarded(() => actions.cancelAction(user, actionId, proof));

// Admin-only diagnostics: configuration status + a live check of the configured
// models against the OpenRouter catalog. Never includes the API key.
// Admin-only: questions the assistant could not answer well (see misses.js).
async function missesReport(user, { days } = {}) {
  if (user.role.name !== "ADMIN") throw new ChatError(CODES.ACCESS_DENIED, { internal: "misses report by non-admin" });
  const { collectMisses } = require("./misses");
  const out = await collectMisses({ days: Math.min(Math.max(parseInt(days, 10) || 30, 1), 90) });
  await recordChatAudit({ userId: user.id, action: "MISSES_REPORT", resourceType: "Chatbot", resourceId: null, result: "SUCCESS" });
  return out;
}

async function aiDiagnostics(user) {
  if (user.role.name !== "ADMIN") throw new ChatError(CODES.ACCESS_DENIED, { internal: "ai diagnostics by non-admin" });
  const { getRuntime } = require("./interpretation/aiRuntime");
  const { aiStatus, summaryUsable } = require("./interpretation/aiConfig");
  const rt = getRuntime();
  const o = env.ai.openrouter;
  const status = aiStatus(env.ai);
  let models = null;
  if (env.ai.enabled && env.ai.provider === "openrouter") models = await rt.capability.check();
  await recordChatAudit({ userId: user.id, action: "AI_DIAGNOSTICS", resourceType: "Ai", resourceId: null, result: "SUCCESS" });
  return {
    enabled: env.ai.enabled,
    provider: env.ai.provider,
    apiKeyConfigured: Boolean(o.apiKey) && o.apiKey !== "your_server_side_key",
    intentInterpretation: status.usable ? "configured" : status.reason,
    configurationProblems: status.errors || [],
    summaryModel: summaryUsable(env.ai) ? "configured" : "not configured",
    intentModels: [o.intentModel, ...o.intentFallbackModels].filter(Boolean),
    summaryModels: [o.summaryModel, ...o.summaryFallbackModels].filter(Boolean),
    minConfidence: o.minConfidence,
    requireStructuredOutput: o.requireStructuredOutput,
    circuitBreaker: rt.breaker.state(),
    models,
  };
}

// ---- files for the ticket being raised ----------------------------------------
// The upload route has already applied the application's file-type filter and size limit (the same
// multer instance the Raise a Ticket page uses); the draft store applies the 5-file / 10 MB rules.
async function draftContext(user, conversationId) {
  const convo = await loadOwnedConversation(user, conversationId, { requireActive: true });
  const scope = await resolveRoleScope(user);
  const draft = await require("./ticketDraft/draftStore").getActive(user.id, convo.id);
  if (!draft) throw new ChatError(CODES.ACTION_INVALID, { message: 'There is no ticket being raised right now. Say "raise a ticket" to start one, then attach your files.' });
  return { ctx: { scope, conversationId: convo.id, method: "rule" }, draft };
}

async function saveDraftReply(user, ctx, r) {
  const assistant = await prisma.chatMessage.create({
    data: { conversationId: ctx.conversationId, senderType: "ASSISTANT", messageText: r.message, intent: "ticket_draft", structuredPayload: r.data || {} },
  });
  await prisma.chatConversation.update({ where: { id: ctx.conversationId }, data: { lastMessageAt: new Date() } });
  return { conversationId: ctx.conversationId, messageId: assistant.id, responseType: "text", intent: "ticket_draft", message: r.message, data: r.data || {}, suggestedActions: r.suggestedActions || [], navigationTarget: null, pendingAction: r.data?.pendingAction || null, error: null };
}

// While the form is open (not yet at the review) files are added in place: the form's own list changes and no
// chat message is created. At the review they go through the normal path, which builds a fresh review.
async function addDraftFiles(user, { conversationId, files, quiet = false }) {
  return guarded(async () => {
    if (!files?.length) throw new ChatError(CODES.ACTION_INVALID, { message: "I didn't receive a file. Please try attaching it again." });
    const { ctx, draft } = await draftContext(user, conversationId);
    const store = require("./ticketDraft/draftStore");
    const updated = await store.addFiles(draft, files);
    if (quiet && draft.step !== "REVIEW") {
      return { quiet: true, data: { ticketDraft: await require("./ticketDraft/flow").view(ctx, updated) } };
    }
    const names = files.map((f) => f.originalname).join(", ");
    const r = await require("./ticketDraft/flow").afterFilesChanged(ctx, updated, `Added ${names}.`);
    return saveDraftReply(user, ctx, r);
  });
}

async function removeDraftFile(user, { conversationId, attachmentId, quiet = false }) {
  return guarded(async () => {
    const { ctx, draft } = await draftContext(user, conversationId);
    const store = require("./ticketDraft/draftStore");
    const removed = await store.removeFile(draft, attachmentId);
    if (quiet && draft.step !== "REVIEW") {
      const fresh = await store.getActive(user.id, ctx.conversationId);
      return { quiet: true, data: { ticketDraft: await require("./ticketDraft/flow").view(ctx, fresh) } };
    }
    const r = await require("./ticketDraft/flow").afterFilesChanged(ctx, draft, `Removed ${removed.fileName}.`);
    return saveDraftReply(user, ctx, r);
  });
}

// The form's "Review Ticket": all fields at once. Validated and turned into the review; nothing is created.
async function submitDraftForm(user, { conversationId, ...payload }) {
  return guarded(async () => {
    const { ctx, draft } = await draftContext(user, conversationId);
    const r = await require("./ticketDraft/flow").submitForm(ctx, draft, payload);
    return saveDraftReply(user, ctx, r);
  });
}

// People to CC: the same search the Raise a Ticket page uses, only while a ticket is being raised, and never the requester.
async function searchDraftCc(user, { conversationId, q }) {
  return guarded(async () => {
    await draftContext(user, conversationId);
    const term = String(q || "").trim().slice(0, 60);
    if (term.length < 2) return { users: [] };
    const found = await require("../services/user.service").searchActiveEmployees(term);
    return { users: found.filter((u) => u.id !== user.id).slice(0, 8).map((u) => ({ id: u.id, name: u.name, email: u.email, department: u.department?.name || null })) };
  });
}

// One attachment of the ticket being raised, for the owner's own preview ("open in a new tab").
async function getDraftFile(user, { conversationId, attachmentId }) {
  return guarded(async () => {
    const { draft } = await draftContext(user, conversationId);
    const row = await prisma.chatDraftAttachment.findFirst({ where: { id: attachmentId, draftId: draft.id } });
    if (!row) throw new ChatError(CODES.ACTION_INVALID, { message: "I couldn't find that attachment on your ticket." });
    return { fileName: row.fileName, mimeType: row.mimeType, buffer: Buffer.from(row.data) };
  });
}

const FEEDBACK_RATINGS = ["helpful", "not_helpful", "incorrect", "unauthorized_information", "other"];

async function submitFeedback(user, messageId, { rating, reason }) {
  return guarded(async () => {
    const msg = await prisma.chatMessage.findUnique({ where: { id: messageId }, include: { conversation: { select: { userId: true } } } });
    if (!msg || msg.conversation.userId !== user.id || msg.senderType !== "ASSISTANT") {
      throw new ChatError(CODES.MESSAGE_NOT_FOUND);
    }
    const cleanedReason = reason ? cleanUserMessage(reason).slice(0, 500) : null;
    await prisma.chatFeedback.upsert({
      where: { messageId_userId: { messageId, userId: user.id } },
      update: { rating, reason: cleanedReason },
      create: { messageId, userId: user.id, rating, reason: cleanedReason },
    });
    await recordChatAudit({
      userId: user.id,
      conversationId: msg.conversationId,
      action: rating === "unauthorized_information" ? "FEEDBACK_UNAUTHORIZED_INFORMATION" : "FEEDBACK_SUBMITTED",
      resourceType: "ChatMessage",
      resourceId: messageId,
      result: "SUCCESS",
    });
    return { messageId, rating };
  });
}

module.exports = {
  sendMessage,
  getConversation,
  listConversations,
  resumeConversation,
  deleteConversation,
  deleteConversations,
  deleteAllConversations,
  resetConversation,
  submitFeedback,
  addDraftFiles,
  removeDraftFile,
  submitDraftForm,
  searchDraftCc,
  getDraftFile,
  confirmAction,
  cancelAction,
  aiDiagnostics,
  missesReport,
  FEEDBACK_RATINGS,
  MAX_MESSAGE_CHARS,
};
