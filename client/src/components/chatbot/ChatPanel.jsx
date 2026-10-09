import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Box, Paper } from "@mui/material";
import ChatHeader from "./ChatHeader";
import ChatInput from "./ChatInput";
import ChatMessage from "./ChatMessage";
import ChatHistory from "./ChatHistory";
import ChatWelcome from "./ChatWelcome";
import ChatErrorState from "./ChatErrorState";
import TypingIndicator from "./TypingIndicator";
import { popIn, reducedMotion, srOnly } from "./theme/chatStyles";

// The panel itself. All data comes from `chat` (useChatbot); navigation is
// delegated up so the panel stays router-agnostic and easy to test.
// `role` / `firstName` are display-only (theme + greeting).
const ChatPanel = forwardRef(function ChatPanel({ chat, panelId, onClose, onNavigate, role, firstName, expanded = false, onToggleExpand }, ref) {
  const { messages, loading, failure, intro, introError, loadIntro, send, retry, reset, sendFeedback, actionState, confirmAction, cancelAction, history, historyError, historyPage, loadHistory, openConversation, deleteConversation, deleteConversations, deleteAllConversations, conversationId, draftView, draftKey, previews, uploadFiles, removeAttachment, reviewDraft, searchDraftCc, openAttachment, supersedeAction } = chat;
  // What the ticket form needs from the chat: files in place, the review, CC people and opening a file.
  const draftTools = { upload: uploadFiles, remove: removeAttachment, review: reviewDraft, searchCc: searchDraftCc, open: openAttachment };
  const [draft, setDraft] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const inputRef = useRef(null);
  const endRef = useRef(null);

  useImperativeHandle(ref, () => ({ focusInput: () => inputRef.current?.focus() }));

  // Focus management: land in the input when the panel opens.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the newest content in view.
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, loading, failure]);

  const submit = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || loading) return;
    setDraft("");
    setShowHistory(false);
    send(text);
    inputRef.current?.focus();
  };

  const openFromHistory = async (id) => {
    if (await openConversation(id)) {
      setShowHistory(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };
  const newChat = async () => {
    await reset();
    setShowHistory(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // Edit a proposal: discard it on the server (nothing was changed) and put the
  // original request back in the composer so details can be added and re-sent.
  const editAction = async (action, index) => {
    // A ticket review is not re-typed: the assistant asks what to change and keeps everything else.
    if (action.title === "Raise ticket") {
      supersedeAction(action.id);
      send("I want to edit the ticket");
      return;
    }
    const original = messages.slice(0, index).reverse().find((m) => m.role === "user")?.text || "";
    await cancelAction(action);
    setDraft(original);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  // Screen-reader status: announced politely, separate from the visible log.
  const status = loading ? "Assistant is typing." : failure ? "Something went wrong. Retry is available." : lastAssistant ? "Assistant replied." : "";
  const online = !(introError && !intro) && failure?.error?.code !== "NETWORK";

  return (
    <Paper
      id={panelId}
      role="dialog"
      aria-label="Assistant chat"
      elevation={0}
      sx={{
        position: "fixed",
        zIndex: (t) => t.zIndex.modal - 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        // Mobile: full screen. Desktop: 420 x 700 floating window above the launcher.
        // Expanded: docked to the right edge at full height.
        inset: expanded ? { xs: 0, sm: "0 0 0 auto" } : { xs: 0, sm: "auto 24px 104px auto" },
        width: { xs: "100%", sm: expanded ? "min(760px, 100vw)" : 420 },
        height: { xs: "100%", sm: expanded ? "100vh" : "min(700px, calc(100vh - 128px))" },
        borderRadius: expanded ? 0 : { xs: 0, sm: "var(--sv-radius-window)" },
        bgcolor: "var(--sv-bg)",
        color: "var(--sv-text)",
        border: { xs: 0, sm: "1px solid var(--sv-border)" },
        boxShadow: { xs: "none", sm: "var(--sv-shadow)" },
        transformOrigin: "bottom right",
        animation: `${popIn} var(--sv-slow) cubic-bezier(0.2, 0.8, 0.2, 1) both`,
        ...reducedMotion,
      }}
    >
      <ChatHeader portal={intro?.portal} capabilities={intro?.capabilities || []} online={online} canReset={!loading && messages.length > 0} onReset={newChat} onClose={onClose} expanded={expanded} onToggleExpand={onToggleExpand} historyOpen={showHistory} onToggleHistory={() => setShowHistory((v) => !v)} />

      <Box
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Conversation"
        tabIndex={0}
        sx={{
          flex: 1,
          overflowY: "auto",
          p: 2,
          display: "flex",
          flexDirection: "column",
          gap: 1.75,
          scrollBehavior: "smooth",
          "&:focus-visible": { outline: "2px solid var(--sv-focus)", outlineOffset: -2 },
          ...reducedMotion,
        }}
      >
        {showHistory && (
          <ChatHistory history={history} page={historyPage} error={historyError} onLoad={loadHistory} onOpen={openFromHistory} onDelete={deleteConversation} onDeleteMany={deleteConversations} onDeleteAll={deleteAllConversations} onNew={newChat} currentId={conversationId} />
        )}

        {!showHistory && !messages.length && <ChatWelcome intro={intro} introError={introError} onRetry={loadIntro} onSelect={send} disabled={loading} firstName={firstName} role={role} />}

        {!showHistory && messages.map((m, i) => (
          <ChatMessage key={m.key} message={m} onNavigate={onNavigate} onSend={send} onFeedback={sendFeedback} disabled={loading} actionState={actionState} onConfirmAction={confirmAction} onCancelAction={cancelAction} onEditAction={(a) => editAction(a, i)} previews={previews} onRemoveAttachment={removeAttachment} activeDraftKey={draftKey} draftTools={draftTools} firstName={firstName} />
        ))}

        {!showHistory && loading && <TypingIndicator />}

        {!showHistory && failure && <ChatErrorState error={failure.error} onRetry={retry} />}
        <div ref={endRef} />
      </Box>

      <Box aria-live="polite" role="status" sx={srOnly}>
        {status}
      </Box>

      <ChatInput placeholder={messages.length ? "Ask about tickets..." : "Ask about tickets, people or departments..."} value={draft} onChange={setDraft} onSubmit={submit} inputRef={inputRef} loading={loading} canAttach={Boolean(draftView)} onFiles={uploadFiles} />
    </Paper>
  );
});

export default ChatPanel;
