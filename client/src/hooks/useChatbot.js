import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chatbotApi } from "../api/chatbot";
import { MAX_ATTACHMENTS_PER_TICKET, MAX_ATTACHMENTS_TOTAL_SIZE_BYTES, validateNewAttachments } from "../utils/attachmentValidation";

const GENERIC_ERROR = "Something went wrong. Please try again.";

// Turns any failure into a { code, message, retryable } the UI can show. The
// server's own standardized error payload is preferred; network failures and
// anything unexpected become a generic, retryable message (no raw error text).
function toErrorInfo(err) {
  const payload = err?.response?.data?.error;
  if (payload?.code) {
    const retryable = ["CHAT_RATE_LIMITED", "CHAT_DATABASE_ERROR", "CHAT_PROVIDER_UNAVAILABLE", "CHAT_PROVIDER_TIMEOUT", "CHAT_PROVIDER_INVALID_RESPONSE"].includes(payload.code);
    return { code: payload.code, message: payload.message, retryable };
  }
  if (!err?.response) return { code: "NETWORK", message: "I couldn't reach the server. Check your connection and try again.", retryable: true };
  return { code: "UNKNOWN", message: GENERIC_ERROR, retryable: true };
}

// Tell the page that something changed (ticket pages listen and reload their data).
const announceChange = () => window.dispatchEvent(new CustomEvent("solvora:data-changed"));

let keyCounter = 0;
const nextKey = () => `m${(keyCounter += 1)}`;

/**
 * State + actions for the chat widget. The conversation id is the only
 * identifier the client keeps; role/portal/suggestions all come from the
 * server for the authenticated user.
 */
export function useChatbot({ pageTicketId = null } = {}) {
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState(null); // { text, error } of the last failed send
  const [intro, setIntro] = useState(null); // ChatSuggestions
  const [introError, setIntroError] = useState(false);
  // Outcome of each proposed admin change, by pending-action id: { status, busy }.
  const [actionState, setActionState] = useState({});
  // Earlier conversations: null until loaded, then [{ conversationId, title, status, lastMessageAt }].
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(false);
  // Object URLs for thumbnails of the files attached in this session, by attachment id.
  const [previews, setPreviews] = useState({});
  const conversationRef = useRef(null);
  const pageTicketRef = useRef(pageTicketId);
  pageTicketRef.current = pageTicketId;
  const loadingRef = useRef(false);

  const loadIntro = useCallback(async () => {
    try {
      const { data } = await chatbotApi.suggestions();
      setIntro(data.data);
      setIntroError(false);
    } catch {
      setIntroError(true);
    }
  }, []);

  useEffect(() => {
    loadIntro();
  }, [loadIntro]);

  const deliver = useCallback(async (text) => {
    loadingRef.current = true;
    setLoading(true);
    setFailure(null);
    try {
      const { data } = await chatbotApi.sendMessage(text, conversationRef.current, pageTicketRef.current);
      const r = data.data;
      conversationRef.current = r.conversationId;
      setConversationId(r.conversationId);
      // Typing "cancel" can discard a proposal on the server; reflect it on its card.
      if (r.data?.resolvedAction) {
        setActionState((prev) => ({ ...prev, [r.data.resolvedAction.id]: { status: r.data.resolvedAction.status, busy: false } }));
        if (r.data.resolvedAction.status === "EXECUTED") announceChange();
      }
      if (r.data?.cancelledActionId) setActionState((prev) => ({ ...prev, [r.data.cancelledActionId]: { status: "CANCELLED", busy: false } }));
      setMessages((prev) => [
        ...prev,
        {
          key: nextKey(),
          role: "assistant",
          at: Date.now(),
          text: r.message,
          messageId: r.messageId,
          intent: r.intent,
          responseType: r.responseType,
          interpretation: r.interpretation,
          data: r.data,
          navigationTarget: r.navigationTarget,
          suggestedActions: r.suggestedActions,
          error: r.error,
        },
      ]);
    } catch (err) {
      const info = toErrorInfo(err);
      // A conversation that no longer exists (e.g. reset elsewhere) — start fresh next time.
      if (info.code === "CHAT_CONVERSATION_NOT_FOUND") {
        conversationRef.current = null;
        setConversationId(null);
      }
      setFailure({ text, error: info });
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  const send = useCallback(
    async (rawText) => {
      const text = String(rawText || "").trim();
      if (!text || loadingRef.current) return;
      setMessages((prev) => [...prev, { key: nextKey(), role: "user", text, at: Date.now() }]);
      await deliver(text);
    },
    [deliver]
  );

  // Retry re-sends the failed text WITHOUT adding a second user bubble.
  const retry = useCallback(async () => {
    if (!failure || loadingRef.current) return;
    await deliver(failure.text);
  }, [failure, deliver]);

  const reset = useCallback(async () => {
    const id = conversationRef.current;
    conversationRef.current = null;
    setConversationId(null);
    setMessages([]);
    setFailure(null);
    setActionState({});
    if (id) {
      try {
        await chatbotApi.resetConversation(id);
      } catch {
        // The local conversation is already cleared; the server copy simply stays active.
      }
    }
  }, []);

  // Confirm/cancel a change the assistant PREPARED. The server executes it (or
  // refuses); what is shown is the server's actual result, never an assumption.
  const resolveAction = useCallback(async (action, verb) => {
    const actionId = action.id;
    setActionState((prev) => ({ ...prev, [actionId]: { status: "PENDING", busy: true } }));
    try {
      const call = verb === "confirm" ? chatbotApi.confirmAction : chatbotApi.cancelAction;
      const { data } = await call(actionId, action.confirmationToken, conversationRef.current);
      const r = data.data;
      setActionState((prev) => ({ ...prev, [actionId]: { status: r.status, busy: false } }));
      if (r.status === "EXECUTED") announceChange();
      setMessages((prev) => [
        ...prev,
        { key: nextKey(), role: "assistant", at: Date.now(), text: r.message, intent: "action_result", data: { ...(r.data || {}), ...(action.title === "Raise ticket" && ["EXECUTED", "CANCELLED"].includes(r.status) ? { ticketDraftClosed: true } : {}) }, navigationTarget: r.navigationTarget || null, error: r.status === "FAILED" || r.status === "EXPIRED" ? { code: `ACTION_${r.status}`, message: r.message, retryable: false } : null },
      ]);
    } catch (err) {
      const info = toErrorInfo(err);
      setActionState((prev) => ({ ...prev, [actionId]: { status: "PENDING", busy: false } }));
      setMessages((prev) => [...prev, { key: nextKey(), role: "assistant", at: Date.now(), text: info.message, intent: "action_result", data: {}, error: { ...info, retryable: false } }]);
    }
  }, []);
  const confirmAction = useCallback((action) => resolveAction(action, "confirm"), [resolveAction]);
  const cancelAction = useCallback((action) => resolveAction(action, "cancel"), [resolveAction]);

  const loadHistory = useCallback(async () => {
    setHistoryError(false);
    try {
      const { data } = await chatbotApi.listConversations();
      setHistory(data.data.conversations);
    } catch {
      setHistoryError(true);
    }
  }, []);

  // Reopen an earlier conversation and continue it. Replayed proposals have no
  // confirmation token (the server never resends it), so they are shown as
  // history, not as actionable cards.
  const openConversation = useCallback(async (id) => {
    if (loadingRef.current) return false;
    try {
      await chatbotApi.resumeConversation(id);
      const { data } = await chatbotApi.getConversation(id);
      const past = {};
      const restored = data.data.messages.map((m) => {
        if (m.data?.pendingAction?.id) past[m.data.pendingAction.id] = { status: "HISTORY", busy: false };
        return {
          key: nextKey(),
          role: m.sender,
          at: m.createdAt ? new Date(m.createdAt).getTime() : undefined,
          text: m.text,
          messageId: m.sender === "assistant" ? m.id : undefined,
          intent: m.intent,
          data: m.data || {},
          error: m.errorCode ? { code: m.errorCode, message: m.text, retryable: false } : null,
        };
      });
      conversationRef.current = id;
      setConversationId(id);
      setMessages(restored);
      setActionState(past);
      setFailure(null);
      return true;
    } catch {
      setHistoryError(true);
      return false;
    }
  }, []);

  const deleteConversation = useCallback(async (id) => {
    try {
      await chatbotApi.deleteConversation(id);
    } catch {
      return false;
    }
    setHistory((prev) => (prev ? prev.filter((c) => c.conversationId !== id) : prev));
    if (conversationRef.current === id) {
      conversationRef.current = null;
      setConversationId(null);
      setMessages([]);
      setFailure(null);
      setActionState({});
    }
    return true;
  }, []);

  // ---- files for the ticket being raised -------------------------------------------
  // A draft is "open" from the first ticket-draft reply until a reply says it is finished.
  const draftView = useMemo(() => {
    let open = null;
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      if (m.data?.ticketDraftClosed) open = null;
      else if (m.data?.ticketDraft) open = m.data.ticketDraft;
    }
    return open;
  }, [messages]);

  const pushAssistant = useCallback((payload) => {
    setMessages((prev) => [...prev, { key: nextKey(), role: "assistant", at: Date.now(), data: {}, ...payload }]);
  }, []);

  const uploadFiles = useCallback(
    async (files) => {
      if (!files?.length || loadingRef.current) return;
      if (!conversationRef.current || !draftView) {
        pushAssistant({ text: 'Say "raise a ticket" first, then attach your files.', intent: "ticket_draft" });
        return;
      }
      const have = draftView.attachments || [];
      const { validFiles, error } = validateNewAttachments(files, {
        remainingSlots: Math.max((draftView.limits?.maxFiles || MAX_ATTACHMENTS_PER_TICKET) - have.length, 0),
        remainingBytes: Math.max(MAX_ATTACHMENTS_TOTAL_SIZE_BYTES - have.reduce((s, a) => s + a.size, 0), 0),
      });
      if (error) pushAssistant({ text: error, intent: "ticket_draft", error: { code: "ATTACHMENT", message: error, retryable: false } });
      if (!validFiles.length) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const form = new FormData();
        form.append("conversationId", conversationRef.current);
        validFiles.forEach((f) => form.append("files", f));
        const { data } = await chatbotApi.uploadDraftFiles(form);
        const r = data.data;
        // Thumbnails come from the local files, matched to what the server stored.
        setPreviews((prev) => {
          const next = { ...prev };
          for (const att of r.data?.ticketDraft?.attachments || []) {
            if (next[att.id]) continue;
            const f = validFiles.find((x) => x.name === att.name && x.size === att.size && x.type.startsWith("image/"));
            if (f) next[att.id] = URL.createObjectURL(f);
          }
          return next;
        });
        pushAssistant({ text: r.message, messageId: r.messageId, intent: "ticket_draft", data: r.data, suggestedActions: r.suggestedActions });
      } catch (err) {
        const info = toErrorInfo(err);
        pushAssistant({ text: info.message, intent: "ticket_draft", error: { ...info, retryable: false } });
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [draftView, pushAssistant]
  );

  const removeAttachment = useCallback(
    async (attachmentId) => {
      if (loadingRef.current || !conversationRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const { data } = await chatbotApi.removeDraftFile(attachmentId, conversationRef.current);
        const r = data.data;
        pushAssistant({ text: r.message, messageId: r.messageId, intent: "ticket_draft", data: r.data, suggestedActions: r.suggestedActions });
      } catch (err) {
        const info = toErrorInfo(err);
        pushAssistant({ text: info.message, intent: "ticket_draft", error: { ...info, retryable: false } });
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [pushAssistant]
  );

  // The Edit button on a ticket review: the review is set aside and the assistant asks what to change.
  const supersedeAction = useCallback((actionId) => setActionState((prev) => ({ ...prev, [actionId]: { status: "SUPERSEDED", busy: false } })), []);

  const sendFeedback = useCallback(async (messageId, rating) => {
    await chatbotApi.sendFeedback(messageId, rating);
  }, []);

  return { messages, conversationId, loading, failure, intro, introError, loadIntro, send, retry, reset, sendFeedback, actionState, confirmAction, cancelAction, draftView, previews, uploadFiles, removeAttachment, supersedeAction, history, historyError, loadHistory, openConversation, deleteConversation };
}
