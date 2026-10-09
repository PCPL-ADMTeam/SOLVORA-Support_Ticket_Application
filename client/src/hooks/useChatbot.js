import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chatbotApi } from "../api/chatbot";
import { MAX_ATTACHMENTS_PER_TICKET, MAX_ATTACHMENTS_TOTAL_SIZE_BYTES, validateNewAttachments } from "../utils/attachmentValidation";

const GENERIC_ERROR = "Something went wrong. Please try again.";
// Conversations per page in the history panel.
export const HISTORY_PAGE_SIZE = 10;

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

// Releases a temporary browser URL; a browser without the call (or an already-released URL) is not an error.
const revokeUrl = (url) => {
  try {
    URL.revokeObjectURL(url);
  } catch {
    // nothing to release
  }
};

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
  // Earlier conversations, one page at a time: null until loaded, then [{ conversationId, title, status, lastMessageAt }].
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(false);
  const [historyPage, setHistoryPage] = useState({ page: 1, totalPages: 1, total: 0 });
  const historyPageRef = useRef(1);
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

  // One page of the history. The server answers with the page it actually used (a page that no longer
  // exists after a delete becomes the last one), so the list never lands on an empty page.
  const loadHistory = useCallback(async (page = historyPageRef.current) => {
    setHistoryError(false);
    try {
      const { data } = await chatbotApi.listConversations({ page, pageSize: HISTORY_PAGE_SIZE });
      const d = data.data;
      const info = { page: d.page ?? 1, totalPages: d.totalPages ?? 1, total: d.total ?? d.conversations.length };
      historyPageRef.current = info.page;
      setHistoryPage(info);
      setHistory(d.conversations);
      return true;
    } catch {
      setHistoryError(true);
      return false;
    }
  }, []);

  // The conversation on screen was deleted: start a fresh chat so nothing is sent to a conversation
  // that no longer exists.
  const forgetOpenConversation = useCallback((deletedIds) => {
    const open = conversationRef.current;
    if (!open || (deletedIds && !deletedIds.includes(open))) return false;
    conversationRef.current = null;
    setConversationId(null);
    setMessages([]);
    setFailure(null);
    setActionState({});
    return true;
  }, []);

  // After a delete: drop the rows at once, then re-read the same page so counts and paging stay right.
  const afterDelete = useCallback(
    async (deletedIds) => {
      setHistory((prev) => (prev && deletedIds ? prev.filter((c) => !deletedIds.includes(c.conversationId)) : deletedIds ? prev : []));
      const removedOpen = forgetOpenConversation(deletedIds);
      await loadHistory(historyPageRef.current);
      return removedOpen;
    },
    [forgetOpenConversation, loadHistory]
  );

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

  // Deletes report { ok, deleted, removedOpen } or { ok: false, code, message }; they never throw.
  const deleteConversation = useCallback(
    async (id) => {
      try {
        await chatbotApi.deleteConversation(id);
      } catch (err) {
        return { ok: false, ...toErrorInfo(err) };
      }
      return { ok: true, deleted: 1, removedOpen: await afterDelete([id]) };
    },
    [afterDelete]
  );

  const deleteConversations = useCallback(
    async (ids) => {
      let result;
      try {
        const { data } = await chatbotApi.deleteConversations(ids);
        result = data.data;
      } catch (err) {
        return { ok: false, ...toErrorInfo(err) };
      }
      return { ok: true, deleted: result.deleted, removedOpen: await afterDelete(result.deletedIds || ids) };
    },
    [afterDelete]
  );

  const deleteAllConversations = useCallback(async () => {
    let result;
    try {
      const { data } = await chatbotApi.deleteAllConversations();
      result = data.data;
    } catch (err) {
      return { ok: false, ...toErrorInfo(err) };
    }
    historyPageRef.current = 1;
    return { ok: true, deleted: result.deleted, removedOpen: await afterDelete(null) };
  }, [afterDelete]);

  // ---- the ticket being raised: one form, one review, one Raise Ticket ---------------------------
  // The draft is "open" from the first ticket-draft reply until a reply says it is finished. `draftKey` is the
  // message that currently shows it: only that one is editable (older copies are read-only or hidden).
  const { draftView, draftKey } = useMemo(() => {
    let open = null;
    let key = null;
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      if (m.data?.ticketDraftClosed) {
        open = null;
        key = null;
      } else if (m.data?.ticketDraft) {
        open = m.data.ticketDraft;
        key = m.key;
      }
    }
    return { draftView: open, draftKey: key };
  }, [messages]);

  const pushAssistant = useCallback((payload) => {
    setMessages((prev) => [...prev, { key: nextKey(), role: "assistant", at: Date.now(), data: {}, ...payload }]);
  }, []);

  // The form changes in place (its files list, for example): the draft inside its own message is replaced,
  // so what the user has typed in the form is not lost and no new chat message appears.
  const patchDraft = useCallback((view) => {
    setMessages((prev) => {
      let at = -1;
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        const m = prev[i];
        if (m.role === "assistant" && m.data?.ticketDraft?.id === view.id && !m.data.pendingAction) {
          at = i;
          break;
        }
      }
      if (at < 0) return prev;
      const next = prev.slice();
      next[at] = { ...prev[at], data: { ...prev[at].data, ticketDraft: view } };
      return next;
    });
  }, []);

  // Temporary browser URLs for thumbnails of files chosen in this session. They are released when a file is
  // removed, when the ticket is finished or cancelled, and when the widget goes away.
  const previewsRef = useRef({});
  previewsRef.current = previews;
  const releasePreview = useCallback((id) => {
    setPreviews((prev) => {
      if (!prev[id]) return prev;
      revokeUrl(prev[id]);
      const { [id]: _gone, ...rest } = prev;
      return rest;
    });
  }, []);
  useEffect(() => {
    if (draftView || !Object.keys(previewsRef.current).length) return;
    Object.values(previewsRef.current).forEach((u) => revokeUrl(u));
    setPreviews({});
  }, [draftView]);
  useEffect(
    () => () => {
      Object.values(previewsRef.current).forEach((u) => revokeUrl(u));
    },
    []
  );

  // Files for the open ticket. While the form is showing they are added in place; at the review the server builds a
  // fresh review. `inline`: the caller shows the error itself (the form does) instead of a chat message.
  const uploadFiles = useCallback(
    async (files, { inline = false } = {}) => {
      const fail = (text) => {
        if (inline) return { error: text };
        pushAssistant({ text, intent: "ticket_draft", error: { code: "ATTACHMENT", message: text, retryable: false } });
        return { error: text };
      };
      if (!files?.length || loadingRef.current) return {};
      if (!conversationRef.current || !draftView) {
        const text = 'Say "raise a ticket" first, then attach your files.';
        if (inline) return { error: text };
        pushAssistant({ text, intent: "ticket_draft" });
        return { error: text };
      }
      const have = draftView.attachments || [];
      // The same file twice is not added twice.
      const fresh = files.filter((f) => !have.some((a) => a.name === f.name && a.size === f.size));
      if (!fresh.length) return fail("That file is already attached.");
      const { validFiles, error } = validateNewAttachments(fresh, {
        remainingSlots: Math.max((draftView.limits?.maxFiles || MAX_ATTACHMENTS_PER_TICKET) - have.length, 0),
        remainingBytes: Math.max(MAX_ATTACHMENTS_TOTAL_SIZE_BYTES - have.reduce((s, a) => s + a.size, 0), 0),
      });
      let problem = error || null;
      if (problem) fail(problem);
      if (!validFiles.length) return { error: problem };
      const quiet = draftView.step !== "REVIEW";
      loadingRef.current = true;
      setLoading(true);
      try {
        const form = new FormData();
        form.append("conversationId", conversationRef.current);
        if (quiet) form.append("quiet", "1");
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
        if (r.quiet) patchDraft(r.data.ticketDraft);
        else pushAssistant({ text: r.message, messageId: r.messageId, intent: "ticket_draft", data: r.data, suggestedActions: r.suggestedActions });
        return { ok: true, error: problem };
      } catch (err) {
        problem = toErrorInfo(err).message;
        if (!inline) pushAssistant({ text: problem, intent: "ticket_draft", error: { code: "ATTACHMENT", message: problem, retryable: false } });
        return { error: problem };
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [draftView, pushAssistant, patchDraft]
  );

  const removeAttachment = useCallback(
    async (attachmentId, { inline = false } = {}) => {
      if (loadingRef.current || !conversationRef.current) return {};
      const quiet = draftView?.step !== "REVIEW";
      loadingRef.current = true;
      setLoading(true);
      try {
        const { data } = await chatbotApi.removeDraftFile(attachmentId, conversationRef.current, quiet);
        const r = data.data;
        releasePreview(attachmentId);
        if (r.quiet) patchDraft(r.data.ticketDraft);
        else pushAssistant({ text: r.message, messageId: r.messageId, intent: "ticket_draft", data: r.data, suggestedActions: r.suggestedActions });
        return { ok: true };
      } catch (err) {
        const info = toErrorInfo(err);
        if (!inline) pushAssistant({ text: info.message, intent: "ticket_draft", error: { ...info, retryable: false } });
        return { error: info.message };
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [draftView, pushAssistant, patchDraft, releasePreview]
  );

  // "Review Ticket": the form's fields go to the server in one request. It answers with the review (the only
  // place a ticket can be raised from) or a clear reason, which the form shows next to the fields it keeps.
  const reviewDraft = useCallback(
    async (fields) => {
      if (loadingRef.current || !conversationRef.current) return { error: "Please wait a moment and try again." };
      loadingRef.current = true;
      setLoading(true);
      try {
        const { data } = await chatbotApi.reviewDraft({ conversationId: conversationRef.current, ...fields });
        const r = data.data;
        pushAssistant({ text: r.message, messageId: r.messageId, intent: "ticket_draft", data: r.data, suggestedActions: r.suggestedActions });
        return { ok: true };
      } catch (err) {
        return { error: toErrorInfo(err).message };
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [pushAssistant]
  );

  const searchDraftCc = useCallback(async (q) => {
    if (!conversationRef.current) return { users: [] };
    try {
      const { data } = await chatbotApi.searchDraftCc(conversationRef.current, q);
      return { users: data.data.users || [] };
    } catch (err) {
      return { users: [], error: toErrorInfo(err).message };
    }
  }, []);

  // Opens an attached file in a new tab (before the ticket exists, from the user's own draft only).
  const openAttachment = useCallback(async (attachmentId) => {
    const local = previewsRef.current[attachmentId];
    if (local) {
      window.open(local, "_blank");
      return {};
    }
    // The tab is opened first (a click is required for that); the file is put into it when it arrives.
    const tab = window.open("about:blank", "_blank");
    try {
      const { data } = await chatbotApi.fetchDraftFile(attachmentId, conversationRef.current);
      const url = URL.createObjectURL(data);
      if (tab) tab.location.href = url;
      else window.open(url, "_blank");
      setTimeout(() => revokeUrl(url), 60000);
      return {};
    } catch (err) {
      tab?.close();
      return { error: toErrorInfo(err).message };
    }
  }, []);

  // The Edit button on a ticket review: the review is set aside and the assistant asks what to change.
  const supersedeAction = useCallback((actionId) => setActionState((prev) => ({ ...prev, [actionId]: { status: "SUPERSEDED", busy: false } })), []);

  const sendFeedback = useCallback(async (messageId, rating) => {
    await chatbotApi.sendFeedback(messageId, rating);
  }, []);

  return { messages, conversationId, loading, failure, intro, introError, loadIntro, send, retry, reset, sendFeedback, actionState, confirmAction, cancelAction, draftView, draftKey, previews, uploadFiles, removeAttachment, reviewDraft, searchDraftCc, openAttachment, supersedeAction, history, historyError, historyPage, loadHistory, openConversation, deleteConversation, deleteConversations, deleteAllConversations };
}
