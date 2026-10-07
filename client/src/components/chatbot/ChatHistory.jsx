import { useEffect, useState } from "react";
import { Box, Button, CircularProgress, IconButton, Tooltip, Typography } from "@mui/material";
import { formatDistanceToNow } from "date-fns";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import AddIcon from "@mui/icons-material/Add";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import ChatErrorState from "./ChatErrorState";
import { interactiveCard, focusRing, reducedMotion, rise } from "./theme/chatStyles";

// The user's earlier conversations (the server returns only their own).
// Opening one resumes it; deleting one removes it permanently after a confirm.
export default function ChatHistory({ history, error, onLoad, onOpen, onDelete, onNew, currentId }) {
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    onLoad();
  }, [onLoad]);

  const remove = async (id) => {
    setBusy(true);
    await onDelete(id);
    setBusy(false);
    setConfirming(null);
  };

  return (
    <Box component="section" aria-label="Chat history" sx={{ display: "grid", gap: 1.25, animation: `${rise} var(--sv-base) ease both`, ...reducedMotion }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Typography variant="overline" component="h3" sx={{ color: "var(--sv-muted)", fontWeight: 700, letterSpacing: "0.08em", lineHeight: 1.5 }}>
          Recent conversations
        </Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={onNew} sx={{ color: "var(--sv-accent-ink)", ...focusRing }}>
          New chat
        </Button>
      </Box>

      {error && <ChatErrorState error={{ message: "I could not load your chat history.", retryable: true }} onRetry={onLoad} />}
      {!error && !history && <CircularProgress size={20} aria-label="Loading history" sx={{ color: "var(--sv-accent-ink)" }} />}
      {!error && history?.length === 0 && (
        <Typography variant="body2" sx={{ color: "var(--sv-muted)" }}>
          No earlier conversations yet. Your chats are saved here after you send a message.
        </Typography>
      )}

      {history?.length > 0 && (
        <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1 }}>
          {history.map((c) => (
            <Box component="li" key={c.conversationId} sx={{ display: "flex", alignItems: "stretch", gap: 0.5 }}>
              {confirming === c.conversationId ? (
                <Box role="group" aria-label={`Delete conversation: ${c.title}`} sx={{ ...interactiveCard, cursor: "default", flex: 1, p: 1.25, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                  <Typography variant="body2" sx={{ flex: 1, minWidth: 140 }}>
                    Delete this conversation permanently?
                  </Typography>
                  <Button size="small" color="error" variant="contained" disableElevation disabled={busy} onClick={() => remove(c.conversationId)}>
                    Delete
                  </Button>
                  <Button size="small" disabled={busy} onClick={() => setConfirming(null)} sx={{ color: "var(--sv-text)" }}>
                    Keep
                  </Button>
                </Box>
              ) : (
                <>
                  <Box
                    component="button"
                    type="button"
                    onClick={() => onOpen(c.conversationId)}
                    aria-current={c.conversationId === currentId ? "true" : undefined}
                    sx={{ ...interactiveCard, flex: 1, minWidth: 0, p: 1.25, display: "flex", alignItems: "center", gap: 1.25, ...(c.conversationId === currentId ? { borderColor: "var(--sv-accent-ink)" } : {}) }}
                  >
                    <Box aria-hidden sx={{ width: 34, height: 34, flexShrink: 0, borderRadius: "10px", display: "grid", placeItems: "center", bgcolor: "var(--sv-accent-soft)", color: "var(--sv-accent-ink)" }}>
                      <ChatBubbleOutlineIcon fontSize="small" />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600} noWrap sx={{ color: "var(--sv-text)" }}>
                        {c.title}
                      </Typography>
                      <Typography variant="caption" sx={{ color: "var(--sv-muted)" }}>
                        {formatDistanceToNow(new Date(c.lastMessageAt), { addSuffix: true })}
                      </Typography>
                    </Box>
                  </Box>
                  <Tooltip title="Delete">
                    <IconButton
                      aria-label={`Delete conversation: ${c.title}`}
                      onClick={() => setConfirming(c.conversationId)}
                      sx={{ alignSelf: "center", color: "var(--sv-muted)", "&:hover": { color: "var(--sv-error)" }, ...focusRing }}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </>
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
