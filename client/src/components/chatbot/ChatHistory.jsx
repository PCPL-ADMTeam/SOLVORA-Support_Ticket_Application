import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Checkbox, CircularProgress, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import { formatDistanceToNow } from "date-fns";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import AddIcon from "@mui/icons-material/Add";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import ChecklistIcon from "@mui/icons-material/Checklist";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ChatErrorState from "./ChatErrorState";
import { interactiveCard, focusRing, reducedMotion, rise } from "./theme/chatStyles";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const when = (iso) => {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
};

// What to say when a delete did not go through. The server's own wording is used only for a rate
// limit or a lost connection; anything else gets a plain retry message.
function failureText(res, what) {
  if (res.code === "CHAT_RATE_LIMITED" || res.code === "NETWORK") return res.message;
  return `I couldn't delete ${what}. Please try again.`;
}

// The user's earlier conversations (the server returns only their own), one page at a time.
// Opening a card resumes that conversation; deleting always asks first. "Select" turns the cards into
// checkboxes for deleting several at once, or everything.
export default function ChatHistory({ history, page = { page: 1, totalPages: 1, total: 0 }, error, onLoad, onOpen, onDelete, onDeleteMany, onDeleteAll, onNew, currentId }) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  // { kind: "one", id, title } | { kind: "selected" } | { kind: "all" }
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [paging, setPaging] = useState(false);
  // { tone: "success" | "error", text, retry? }
  const [notice, setNotice] = useState(null);
  const inFlight = useRef(false);
  const cancelRef = useRef(null);

  useEffect(() => {
    onLoad(1);
  }, [onLoad]);

  // Selection belongs to the page on screen: anything no longer listed is dropped from it.
  const visibleIds = useMemo(() => (history || []).map((c) => c.conversationId), [history]);
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => visibleIds.includes(id)));
      return next.size === prev.size ? prev : next;
    });
    if (history && history.length === 0) setSelecting(false);
  }, [visibleIds, history]);

  // A confirmation takes focus on its safe choice, so Enter never deletes by accident.
  useEffect(() => {
    if (confirm) cancelRef.current?.focus();
  }, [confirm]);

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOnPage = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someOnPage = visibleIds.some((id) => selected.has(id));
  const toggleAll = () => setSelected(allOnPage ? new Set() : new Set(visibleIds));

  // Runs one delete at a time: a second click while one is in flight does nothing.
  const run = async (operation, what) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    const res = await operation();
    inFlight.current = false;
    setBusy(false);
    if (res.ok) {
      setConfirm(null);
      setSelected(new Set());
      const done = res.deleted ? `Deleted ${plural(res.deleted, "conversation", "conversations")}.` : "Nothing was deleted; those conversations were already gone.";
      setNotice({ tone: "success", text: `${done}${res.removedOpen ? " The conversation you had open was deleted, so a new chat is ready." : ""}` });
    } else {
      setNotice({ tone: "error", text: failureText(res, what), retry: () => run(operation, what) });
    }
  };

  const confirmDelete = () => {
    if (!confirm) return;
    if (confirm.kind === "one") run(() => onDelete(confirm.id), "the conversation");
    else if (confirm.kind === "selected") {
      const ids = [...selected];
      run(() => onDeleteMany(ids), "the selected conversations");
    } else run(() => onDeleteAll(), "your conversations");
  };

  const goTo = async (p) => {
    setPaging(true);
    setSelected(new Set());
    setConfirm((c) => (c?.kind === "all" ? c : null));
    await onLoad(p);
    setPaging(false);
  };

  const confirmText =
    confirm?.kind === "selected"
      ? `Delete ${plural(selected.size, "selected conversation", "selected conversations")} permanently? This can't be undone.`
      : confirm?.kind === "all"
        ? `Delete all of your conversations${page.total ? ` (${page.total})` : ""}? This permanently removes every conversation saved in your Solvy history. Your tickets, comments and notifications are not affected. This can't be undone.`
        : null;

  return (
    <Box component="section" aria-label="Chat history" sx={{ display: "grid", gap: 1.25, animation: `${rise} var(--sv-base) ease both`, ...reducedMotion }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
        <Typography variant="overline" component="h3" sx={{ color: "var(--sv-muted)", fontWeight: 700, letterSpacing: "0.08em", lineHeight: 1.5 }}>
          Recent conversations{page.total ? ` (${page.total})` : ""}
        </Typography>
        <Stack direction="row" spacing={0.5}>
          {history?.length > 0 && (
            <Button
              size="small"
              startIcon={<ChecklistIcon />}
              aria-pressed={selecting}
              onClick={() => {
                setSelecting((v) => !v);
                setSelected(new Set());
                setConfirm(null);
              }}
              disabled={busy}
              sx={{ color: "var(--sv-accent-ink)", ...focusRing }}
            >
              {selecting ? "Done" : "Select"}
            </Button>
          )}
          <Button size="small" startIcon={<AddIcon />} onClick={onNew} disabled={busy} sx={{ color: "var(--sv-accent-ink)", ...focusRing }}>
            New chat
          </Button>
        </Stack>
      </Box>

      {selecting && history?.length > 0 && (
        <Box role="toolbar" aria-label="Selection" sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", p: 0.75, borderRadius: "12px", bgcolor: "var(--sv-accent-soft)" }}>
          <Box component="label" sx={{ display: "inline-flex", alignItems: "center", cursor: "pointer", mr: "auto" }}>
            <Checkbox size="small" checked={allOnPage} indeterminate={someOnPage && !allOnPage} onChange={toggleAll} disabled={busy} inputProps={{ "aria-label": "Select all on this page" }} sx={{ p: 0.5, color: "var(--sv-accent-ink)", "&.Mui-checked, &.MuiCheckbox-indeterminate": { color: "var(--sv-accent-ink)" } }} />
            <Typography variant="body2" sx={{ color: "var(--sv-text)" }} aria-live="polite">
              {selected.size ? `${selected.size} selected` : "Select all on this page"}
            </Typography>
          </Box>
          <Button size="small" variant="contained" disableElevation color="error" startIcon={<DeleteOutlineIcon />} disabled={!selected.size || busy} onClick={() => setConfirm({ kind: "selected" })} sx={focusRing}>
            Delete selected
          </Button>
          <Button size="small" color="error" disabled={busy} onClick={() => setConfirm({ kind: "all" })} sx={focusRing}>
            Delete all
          </Button>
        </Box>
      )}

      {confirmText && (
        <Box role="alertdialog" aria-labelledby="sv-history-confirm" sx={{ ...interactiveCard, cursor: "default", p: 1.25, display: "grid", gap: 1, borderColor: "var(--sv-error)", "&:hover:not(:disabled)": {} }}>
          <Typography id="sv-history-confirm" variant="body2" sx={{ color: "var(--sv-text)" }}>
            {confirmText}
          </Typography>
          <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
            <Button ref={cancelRef} size="small" disabled={busy} onClick={() => setConfirm(null)} sx={{ color: "var(--sv-text)", ...focusRing }}>
              Cancel
            </Button>
            <Button size="small" color="error" variant="contained" disableElevation disabled={busy} onClick={confirmDelete} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <DeleteOutlineIcon />} sx={focusRing}>
              {confirm.kind === "all" ? "Delete all conversations" : `Delete ${plural(selected.size, "conversation", "conversations")}`}
            </Button>
          </Stack>
        </Box>
      )}

      {notice && (
        <Box role={notice.tone === "error" ? "alert" : "status"} aria-label="History update" sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", p: 1, borderRadius: "10px", border: `1px solid ${notice.tone === "error" ? "var(--sv-error)" : "var(--sv-success)"}`, bgcolor: "var(--sv-surface)" }}>
          <Typography variant="body2" sx={{ flex: 1, minWidth: 160, color: "var(--sv-text)" }}>
            {notice.text}
          </Typography>
          {notice.retry && (
            <Button size="small" onClick={notice.retry} disabled={busy} sx={{ color: "var(--sv-accent-ink)", ...focusRing }}>
              Retry
            </Button>
          )}
          <Button size="small" onClick={() => setNotice(null)} sx={{ color: "var(--sv-muted)", ...focusRing }}>
            Dismiss
          </Button>
        </Box>
      )}

      {error && <ChatErrorState error={{ message: "I could not load your chat history.", retryable: true }} onRetry={() => onLoad(page.page)} />}
      {!error && !history && <CircularProgress size={20} aria-label="Loading history" sx={{ color: "var(--sv-accent-ink)" }} />}
      {!error && history?.length === 0 && (
        <Typography variant="body2" sx={{ color: "var(--sv-muted)" }}>
          No earlier conversations yet. Your chats are saved here after you send a message.
        </Typography>
      )}

      {history?.length > 0 && (
        <Box component="ul" aria-busy={busy || paging} aria-label="Conversations" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 1, opacity: paging ? 0.6 : 1, transition: "opacity var(--sv-fast) ease", ...reducedMotion }}>
          {history.map((c) => {
            const isOpen = c.conversationId === currentId;
            const rowInner = (
              <>
                <Box aria-hidden sx={{ width: 34, height: 34, flexShrink: 0, borderRadius: "10px", display: "grid", placeItems: "center", bgcolor: "var(--sv-accent-soft)", color: "var(--sv-accent-ink)" }}>
                  <ChatBubbleOutlineIcon fontSize="small" />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" fontWeight={600} noWrap sx={{ color: "var(--sv-text)" }}>
                    {c.title}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "var(--sv-muted)" }}>
                    {when(c.lastMessageAt)}
                    {isOpen ? " · open now" : ""}
                  </Typography>
                </Box>
              </>
            );

            if (confirm?.kind === "one" && confirm.id === c.conversationId) {
              return (
                <Box component="li" key={c.conversationId}>
                  <Box role="alertdialog" aria-label={`Delete conversation: ${c.title}`} sx={{ ...interactiveCard, cursor: "default", p: 1.25, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", borderColor: "var(--sv-error)" }}>
                    <Typography variant="body2" sx={{ flex: 1, minWidth: 140 }}>
                      Delete this conversation permanently? This can&apos;t be undone.
                    </Typography>
                    <Button size="small" color="error" variant="contained" disableElevation disabled={busy} onClick={confirmDelete} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null} sx={focusRing}>
                      Delete
                    </Button>
                    <Button ref={cancelRef} size="small" disabled={busy} onClick={() => setConfirm(null)} sx={{ color: "var(--sv-text)", ...focusRing }}>
                      Keep
                    </Button>
                  </Box>
                </Box>
              );
            }

            if (selecting) {
              const checked = selected.has(c.conversationId);
              return (
                <Box component="li" key={c.conversationId}>
                  <Box component="label" sx={{ ...interactiveCard, p: 1.25, display: "flex", alignItems: "center", gap: 1, ...(checked ? { borderColor: "var(--sv-accent-ink)", bgcolor: "var(--sv-accent-soft)" } : {}) }}>
                    <Checkbox size="small" checked={checked} onChange={() => toggle(c.conversationId)} disabled={busy} inputProps={{ "aria-label": `Select conversation: ${c.title}` }} sx={{ p: 0.5, color: "var(--sv-accent-ink)", "&.Mui-checked": { color: "var(--sv-accent-ink)" } }} />
                    {rowInner}
                  </Box>
                </Box>
              );
            }

            return (
              <Box component="li" key={c.conversationId} sx={{ display: "flex", alignItems: "stretch", gap: 0.5 }}>
                <Box
                  component="button"
                  type="button"
                  onClick={() => onOpen(c.conversationId)}
                  aria-current={isOpen ? "true" : undefined}
                  disabled={busy}
                  sx={{ ...interactiveCard, flex: 1, minWidth: 0, p: 1.25, display: "flex", alignItems: "center", gap: 1.25, ...(isOpen ? { borderColor: "var(--sv-accent-ink)" } : {}) }}
                >
                  {rowInner}
                </Box>
                <Tooltip title="Delete">
                  <IconButton
                    aria-label={`Delete conversation: ${c.title}`}
                    onClick={() => {
                      setNotice(null);
                      setConfirm({ kind: "one", id: c.conversationId, title: c.title });
                    }}
                    sx={{ alignSelf: "center", color: "var(--sv-muted)", "&:hover": { color: "var(--sv-error)" }, ...focusRing }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            );
          })}
        </Box>
      )}

      {page.totalPages > 1 && (
        <Box component="nav" aria-label="History pages" sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Button size="small" startIcon={<ChevronLeftIcon />} disabled={page.page <= 1 || paging || busy} onClick={() => goTo(page.page - 1)} sx={{ color: "var(--sv-accent-ink)", ...focusRing }}>
            Previous
          </Button>
          <Typography variant="caption" sx={{ color: "var(--sv-muted)" }} aria-live="polite">
            Page {page.page} of {page.totalPages}
          </Typography>
          <Button size="small" endIcon={<ChevronRightIcon />} disabled={page.page >= page.totalPages || paging || busy} onClick={() => goTo(page.page + 1)} sx={{ color: "var(--sv-accent-ink)", ...focusRing }}>
            Next
          </Button>
        </Box>
      )}
    </Box>
  );
}
