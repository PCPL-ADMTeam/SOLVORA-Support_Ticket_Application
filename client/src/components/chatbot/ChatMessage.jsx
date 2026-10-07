import { useState } from "react";
import { Box, Button, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import { format } from "date-fns";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import TicketListCard from "./TicketListCard";
import TicketSummaryCard from "./TicketSummaryCard";
import TicketHistoryCard from "./TicketHistoryCard";
import StatisticsCard from "./StatisticsCard";
import ChatFeedback from "./ChatFeedback";
import ActionConfirmCard from "./ActionConfirmCard";
import TicketDraftCard from "./TicketDraftCard";
import TicketReasonsCard from "./TicketReasonsCard";
import { card, focusRing, reducedMotion, rise, srOnly } from "./theme/chatStyles";

const enter = { animation: `${rise} var(--sv-base) ease both`, ...reducedMotion };
const small = { fontSize: 18 };
const actionBtn = { color: "var(--sv-muted)", "&:hover": { color: "var(--sv-accent-ink)", bgcolor: "var(--sv-accent-soft)" }, ...focusRing };

function Time({ at }) {
  if (!at) return null;
  return (
    <Typography component="time" dateTime={new Date(at).toISOString()} variant="caption" sx={{ color: "var(--sv-muted)", fontSize: 11 }}>
      {format(new Date(at), "h:mm a")}
    </Typography>
  );
}

// Assistant text is always rendered as TEXT (React-escaped; pre-line keeps the
// numbered steps) — never as HTML — so ticket-derived strings cannot inject markup.
export default function ChatMessage({ message, onNavigate, onSend, onFeedback, disabled, actionState = {}, onConfirmAction, onCancelAction, onEditAction, previews, onRemoveAttachment, activeDraftId }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (insecure context); nothing else to do.
    }
  };

  if (message.role === "user") {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0.25, ...enter }}>
        <Box sx={{ maxWidth: "85%", background: "var(--sv-accent-gradient)", color: "var(--sv-on-accent)", px: 1.75, py: 1.1, borderRadius: "var(--sv-radius-bubble)", borderBottomRightRadius: 6 }}>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: "inherit" }}>
            <Box component="span" sx={srOnly}>
              You said:{" "}
            </Box>
            {message.text}
          </Typography>
        </Box>
        <Time at={message.at} />
      </Box>
    );
  }

  const { data = {}, navigationTarget, suggestedActions = [], error } = message;
  // A ticket card already has its own Open button; don't repeat the same link under it.
  const cardOpensTarget = Boolean(navigationTarget?.path && data.tickets?.some((t) => navigationTarget.path === `/tickets/${t.ticketRouteId}`));
  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, ...enter }}>
      <Box aria-hidden sx={{ width: 28, height: 28, flexShrink: 0, borderRadius: "9px", display: "grid", placeItems: "center", bgcolor: "var(--sv-accent-soft)", color: "var(--sv-accent-ink)", mt: 0.25 }}>
        <SmartToyOutlinedIcon sx={{ fontSize: 17 }} />
      </Box>
      <Box sx={{ minWidth: 0, maxWidth: "calc(100% - 36px)", flex: 1 }}>
        <Box sx={{ ...card, display: "inline-block", maxWidth: "100%", px: 1.75, py: 1.25, borderRadius: "var(--sv-radius-bubble)", borderTopLeftRadius: 6, boxSizing: "border-box" }}>
          <Typography variant="caption" display="block" sx={{ color: "var(--sv-muted)", fontWeight: 600 }}>
            Assistant
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-line", wordBreak: "break-word", color: "var(--sv-text)" }}>
            {message.text}
          </Typography>
          {message.interpretation?.method === "openrouter" && (
            <Typography variant="caption" display="block" sx={{ mt: 0.5, color: "var(--sv-muted)" }}>
              Understood with AI. Data and changes still go through the secured tools.
            </Typography>
          )}

          {data.tickets && <TicketListCard tickets={data.tickets} total={data.total} onNavigate={onNavigate} />}
          {data.summary && <TicketSummaryCard summary={data.summary} />}
          {data.summaries && data.summaries.map((s) => <TicketSummaryCard key={s.ticketId} summary={s} compact />)}
          {data.history && <TicketHistoryCard history={data.history} />}
          {data.reasons && <TicketReasonsCard reasons={data.reasons} />}
          {data.statistics && <StatisticsCard statistics={data.statistics} />}
          {data.ticketDraft && (
            <TicketDraftCard
              draft={data.ticketDraft}
              previews={previews}
              onRemove={onRemoveAttachment}
              active={Boolean(activeDraftId) && data.ticketDraft.id === activeDraftId && !actionState[data.pendingAction?.id]?.status?.match(/EXECUTED|CANCELLED|SUPERSEDED/)}
              disabled={disabled}
              compact={Boolean(data.pendingAction)}
            />
          )}
          {data.pendingAction && (
            <ActionConfirmCard action={data.pendingAction} state={actionState[data.pendingAction.id]} onConfirm={onConfirmAction} onCancel={onCancelAction} onEdit={onEditAction} />
          )}

          {navigationTarget && !cardOpensTarget && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<OpenInNewIcon />}
              sx={{ mt: 1, color: "var(--sv-accent-ink)", borderColor: "var(--sv-accent-ink)", ...focusRing }}
              onClick={() => onNavigate(navigationTarget)}
            >
              {navigationTarget.label}
            </Button>
          )}
        </Box>

        <Stack direction="row" alignItems="center" spacing={0.25} sx={{ mt: 0.5, ml: 0.5 }}>
          <Time at={message.at} />
          <Tooltip title={copied ? "Copied" : "Copy"}>
            <IconButton size="small" aria-label={copied ? "Response copied" : "Copy response"} onClick={copy} sx={actionBtn}>
              {copied ? <CheckIcon sx={small} /> : <ContentCopyIcon sx={small} />}
            </IconButton>
          </Tooltip>
          {message.messageId && !error?.retryable && <ChatFeedback messageId={message.messageId} onSubmit={onFeedback} />}
        </Stack>

        {suggestedActions.length > 0 && (
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap role="group" aria-label="Follow-up questions" sx={{ mt: 1 }}>
            {suggestedActions.map((a) => (
              <Box
                key={a.prompt}
                component="button"
                type="button"
                onClick={() => onSend(a.prompt)}
                disabled={disabled}
                sx={{
                  font: "inherit",
                  fontSize: 13,
                  fontWeight: 600,
                  px: 1.4,
                  py: 0.6,
                  borderRadius: 99,
                  cursor: "pointer",
                  color: "var(--sv-accent-ink)",
                  bgcolor: "var(--sv-accent-soft)",
                  border: "1px solid transparent",
                  transition: "transform var(--sv-fast) ease, border-color var(--sv-fast) ease",
                  "&:hover:not(:disabled)": { borderColor: "var(--sv-accent-ink)", transform: "translateY(-1px)" },
                  "&:disabled": { opacity: 0.55, cursor: "default" },
                  ...focusRing,
                  ...reducedMotion,
                }}
              >
                {a.label}
              </Box>
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
