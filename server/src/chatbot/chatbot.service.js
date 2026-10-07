const prisma = require("../config/prisma");
const env = require("../config/env");
const { ChatError, CODES, toErrorPayload } = require("./chatbot.errors");
const { recordChatAudit } = require("./chatbot.audit");
const { resolveRoleScope, portalFor, authorizedWhere } = require("./roleScope");
const { handlerFor, visibleDepartmentNames } = require("./intents/handlers");
const { extractEntities } = require("./entities/extract");
const { didYouMean } = require("./intents/didYouMean");
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
async function sendMessage(user, { message, conversationId, pageTicketId }) {
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

    const ctx = { scope, conversationId: convo.id, lastTicketNumber: ctxHistory.lastTicketNumber || pageTicketNumber, method: decision.method, aiIntent: decision.aiIntent };

    if (!result) {
      try {
        result = await handlerFor(intent)(ctx, params, cleaned);
      } catch (err) {
        if (!(err instanceof ChatError) || !SOFT_ERRORS.has(err.code)) throw err;
        error = { ...toErrorPayload(err), retryable: false };
        result = plain(err.message);
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
      // Layer 3: never a dead end. Say what was recognized and offer the closest real questions.
      const found = await extractEntities(cleaned, { visibleDepartments: await visibleDepartmentNames(ctx) }).catch(() => null);
      const hints = didYouMean({ message: cleaned, role: scope.role, found });
      if (hints.prompts.length) {
        result.message = `I'm not sure I understood that.${hints.noticed} Did you mean one of these?${aiNote ? " (AI interpretation is unavailable right now, so I can only understand the standard phrasings.)" : ""}`;
        result.suggestedActions = hints.prompts.map((p) => ({ label: p, prompt: p }));
      } else {
        result.suggestedActions = exampleActions(scope.role);
      }
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
const TITLE_CHARS = 60;

// The signed-in user's own earlier conversations, newest first. Titles are the
// first thing the user typed. Nothing from other users or other roles.
async function listConversations(user) {
  return guarded(async () => {
    const rows = await prisma.chatConversation.findMany({
      where: { userId: user.id, portalRole: user.role.name },
      orderBy: { lastMessageAt: "desc" },
      take: HISTORY_LIMIT,
    });
    const items = await Promise.all(
      rows.map(async (c) => {
        const [first] = await prisma.chatMessage.findMany({ where: { conversationId: c.id, senderType: "USER" }, orderBy: { createdAt: "asc" }, take: 1 });
        if (!first) return null;
        const text = String(first.messageText).replace(/\s+/g, " ").trim();
        return { conversationId: c.id, title: text.length > TITLE_CHARS ? `${text.slice(0, TITLE_CHARS - 1)}…` : text, status: c.status, lastMessageAt: c.lastMessageAt };
      })
    );
    return { conversations: items.filter(Boolean) };
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

// Permanently remove one of the user's own conversations (messages and feedback cascade).
async function deleteConversation(user, conversationId) {
  return guarded(async () => {
    const convo = await loadOwnedConversation(user, conversationId);
    await actions.cancelPendingInConversation(user, convo.id);
    await prisma.chatConversation.delete({ where: { id: convo.id } });
    await recordChatAudit({ userId: user.id, conversationId: null, action: "CONVERSATION_DELETED", resourceType: "ChatConversation", resourceId: convo.id, result: "SUCCESS" });
    return { conversationId: convo.id, deleted: true };
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

async function addDraftFiles(user, { conversationId, files }) {
  return guarded(async () => {
    if (!files?.length) throw new ChatError(CODES.ACTION_INVALID, { message: "I didn't receive a file. Please try attaching it again." });
    const { ctx, draft } = await draftContext(user, conversationId);
    const store = require("./ticketDraft/draftStore");
    const updated = await store.addFiles(draft, files);
    const names = files.map((f) => f.originalname).join(", ");
    const r = await require("./ticketDraft/flow").afterFilesChanged(ctx, updated, `Added ${names}.`);
    return saveDraftReply(user, ctx, r);
  });
}

async function removeDraftFile(user, { conversationId, attachmentId }) {
  return guarded(async () => {
    const { ctx, draft } = await draftContext(user, conversationId);
    const removed = await require("./ticketDraft/draftStore").removeFile(draft, attachmentId);
    const r = await require("./ticketDraft/flow").afterFilesChanged(ctx, draft, `Removed ${removed.fileName}.`);
    return saveDraftReply(user, ctx, r);
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
  resetConversation,
  submitFeedback,
  addDraftFiles,
  removeDraftFile,
  confirmAction,
  cancelAction,
  aiDiagnostics,
  missesReport,
  FEEDBACK_RATINGS,
  MAX_MESSAGE_CHARS,
};
